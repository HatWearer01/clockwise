import * as Notifications from "expo-notifications";
import type { NotificationLogEntry } from "../types";
import { getDb } from "../db/connection";
import { nowMs, todayISODate, weekStartDateFor } from "../lib/time";

const LAST_NOTIF_META_KEY = "last_notif_key";
const DND_META_KEY = "dnd_until";
const SCHEDULED_PREFIX = "cw-scheduled-";

function parseReminderIntervalMs(raw: string | null): number {
  const minutes = raw != null ? parseInt(raw, 10) : NaN;
  const clamped = Number.isFinite(minutes) ? Math.min(60, Math.max(1, minutes)) : 5;
  return clamped * 60 * 1000;
}

function notificationsGloballyDisabled(val: string | null): boolean {
  return val === "0" || val === "false" || val === "False";
}

function quietHoursActive(val: string | null): boolean {
  return val === "1" || val === "true" || val === "True";
}

function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function shiftEndTimestampMs(now: Date, startMin: number, endMin: number): number | null {
  const y = now.getFullYear();
  const mo = now.getMonth();
  const day = now.getDate();
  const hour = Math.floor(endMin / 60);
  const min = endMin % 60;
  if (startMin <= endMin) {
    return new Date(y, mo, day, hour, min, 0, 0).getTime();
  }
  const nextCal = new Date(y, mo, day + 1);
  return new Date(nextCal.getFullYear(), nextCal.getMonth(), nextCal.getDate(), hour, min, 0, 0).getTime();
}

function isInQuietHours(minute: number, quietStart: number, quietEnd: number): boolean {
  if (quietStart <= quietEnd) return minute >= quietStart && minute < quietEnd;
  return minute >= quietStart || minute < quietEnd;
}

async function getSetting(db: Awaited<ReturnType<typeof getDb>>, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

async function weekStartDaySetting(db: Awaited<ReturnType<typeof getDb>>): Promise<0 | 1> {
  const raw = await getSetting(db, "week_start_day");
  const n = raw != null ? parseInt(raw, 10) : 1;
  const c = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  return c as 0 | 1;
}

async function computeActualBetween(db: Awaited<ReturnType<typeof getDb>>, startMs: number, endMs: number): Promise<number> {
  const n = nowMs();
  const grossRow = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at), 0) AS v
     FROM session WHERE started_at >= ? AND started_at < ?`,
    [n, startMs, endMs]
  );
  const gross = grossRow?.v ?? 0;
  const pauseRow = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(COALESCE(sp.resumed_at, ?) - sp.paused_at), 0) AS v
     FROM session_pause sp
     JOIN session s ON s.id = sp.session_id
     WHERE s.started_at >= ? AND s.started_at < ?`,
    [n, startMs, endMs]
  );
  const pauses = pauseRow?.v ?? 0;
  return Math.max(0, gross - pauses);
}

async function parseQuietBounds(db: Awaited<ReturnType<typeof getDb>>): Promise<{ start: number; end: number }> {
  const startRaw = await getSetting(db, "quiet_hours_start_min");
  const endRaw = await getSetting(db, "quiet_hours_end_min");
  const start = startRaw != null ? parseInt(startRaw, 10) : 1320;
  const end = endRaw != null ? parseInt(endRaw, 10) : 480;
  const qs = Number.isFinite(start) ? Math.max(0, Math.min(1439, start)) : 1320;
  const qe = Number.isFinite(end) ? Math.max(0, Math.min(1439, end)) : 480;
  return { start: qs, end: qe };
}

function localMidnightMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

function minuteToTimestamp(minuteOfDay: number, baseDate?: Date): number {
  const d = baseDate ?? new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0).getTime();
}

// ─── DND (Do Not Disturb) ───

export async function isDndActive(): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", [DND_META_KEY]);
  if (!row?.value) return false;
  const until = parseInt(row.value, 10);
  if (!Number.isFinite(until)) return false;
  if (until === -1) return true;
  if (Date.now() >= until) {
    await db.runAsync("DELETE FROM app_meta WHERE key = ?", [DND_META_KEY]);
    return false;
  }
  return true;
}

export async function setDnd(mode: "off" | "tomorrow" | "next_week" | "indefinite"): Promise<void> {
  const db = await getDb();
  if (mode === "off") {
    await db.runAsync("DELETE FROM app_meta WHERE key = ?", [DND_META_KEY]);
    return;
  }

  let until: number;
  const now = new Date();
  if (mode === "tomorrow") {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    until = tomorrow.getTime();
  } else if (mode === "next_week") {
    const daysUntilNextWeek = 7 - now.getDay() + 1;
    const nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilNextWeek, 0, 0, 0, 0);
    until = nextWeek.getTime();
  } else {
    until = -1;
  }

  await db.runAsync(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [DND_META_KEY, String(until)]
  );

  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch { /* */ }
}

export async function getDndUntil(): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", [DND_META_KEY]);
  if (!row?.value) return null;
  const val = parseInt(row.value, 10);
  return Number.isFinite(val) ? val : null;
}

// ─── Scheduled shift notifications (calendar-style) ───

export async function scheduleShiftNotifications(): Promise<void> {
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch { /* */ }

  const db = await getDb();
  if (notificationsGloballyDisabled(await getSetting(db, "notifications_enabled"))) return;
  if (await isDndActive()) return;

  const now = new Date();
  const dow = now.getDay();

  const templateRow = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM schedule_template WHERE is_active = 1 ORDER BY id LIMIT 1"
  );
  if (!templateRow) return;

  const blockRows = await db.getAllAsync<{ start_min: number; end_min: number }>(
    `SELECT start_min, end_min FROM schedule_block
     WHERE template_id = ? AND day_of_week = ?
     ORDER BY start_min`,
    [templateRow.id, dow]
  );

  if (blockRows.length === 0) return;

  const earliestStart = Math.min(...blockRows.map((b) => b.start_min));
  const latestEnd = Math.max(...blockRows.map((b) => b.end_min));
  const nowMinute = minuteOfDay(now);

  const warningTime = minuteToTimestamp(Math.max(0, earliestStart - 10));
  if (warningTime > Date.now()) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${SCHEDULED_PREFIX}start-warning`,
        content: {
          title: "Shift starts in 10 minutes",
          body: "Get ready — your workday is about to begin.",
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(warningTime), channelId: "clockwise-alerts" },
      });
    } catch { /* */ }
  }

  const startTime = minuteToTimestamp(earliestStart);
  if (startTime > Date.now()) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${SCHEDULED_PREFIX}shift-start`,
        content: {
          title: "Time to clock in",
          body: "Your shift has started. Open Clockwise to begin tracking.",
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(startTime), channelId: "clockwise-alerts" },
      });
    } catch { /* */ }
  }

  const endTs = shiftEndTimestampMs(now, earliestStart, latestEnd);
  if (endTs && endTs > Date.now()) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${SCHEDULED_PREFIX}shift-end`,
        content: {
          title: "Shift ended",
          body: "Your scheduled shift is over. Clock out when you're done.",
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(endTs), channelId: "clockwise-alerts" },
      });
    } catch { /* */ }
  }

  const taskCount = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM daily_task WHERE date = ? AND done = 0",
    [todayISODate()]
  );
  if ((taskCount?.c ?? 0) > 0) {
    const taskReminderTime = minuteToTimestamp(earliestStart + 5);
    if (taskReminderTime > Date.now()) {
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: `${SCHEDULED_PREFIX}tasks`,
          content: {
            title: `${taskCount!.c} task${taskCount!.c === 1 ? "" : "s"} for today`,
            body: "Check your task list when you're ready.",
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(taskReminderTime), channelId: "clockwise-tasks" },
        });
      } catch { /* */ }
    }
  }
}

// ─── Immediate notification with dedup ───

export async function sendReminder(
  key: string,
  title: string,
  body: string,
  actionKind?: string | null,
  intervalMs = Number.MAX_SAFE_INTEGER,
  channelId = "clockwise-alerts"
): Promise<void> {
  const db = await getDb();
  const ts = nowMs();

  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", [LAST_NOTIF_META_KEY]);
  if (row?.value) {
    const pipe = row.value.indexOf("|");
    if (pipe !== -1) {
      const lastKey = row.value.slice(0, pipe);
      const lastTsStr = row.value.slice(pipe + 1);
      const lastTs = parseInt(lastTsStr, 10);
      if (lastKey === key && Number.isFinite(lastTs) && ts - lastTs < intervalMs) {
        return;
      }
    }
  }

  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { channelId },
  });

  const combined = `${key}|${ts}`;
  await db.runAsync(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [LAST_NOTIF_META_KEY, combined]
  );

  await db.runAsync(
    "INSERT INTO notification_log (key, title, body, action_kind, created_at) VALUES (?, ?, ?, ?, ?)",
    [key, title, body, actionKind ?? null, ts]
  );
}

// ─── Polling-based check (smart nudges) ───

export async function checkAndNotify(): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const dow = now.getDay();
  const minute = minuteOfDay(now);
  const dateKey = todayISODate();

  if (notificationsGloballyDisabled(await getSetting(db, "notifications_enabled"))) return;
  if (await isDndActive()) return;

  const quietEnabled = await getSetting(db, "quiet_hours_enabled");
  if (quietHoursActive(quietEnabled)) {
    const { start: quietStart, end: quietEnd } = await parseQuietBounds(db);
    if (isInQuietHours(minute, quietStart, quietEnd)) return;
  }

  const wsd = await weekStartDaySetting(db);
  const weekAnchor = weekStartDateFor(now, wsd);
  const weekDoneRow = await db.getFirstAsync<{ one: number }>(
    "SELECT 1 AS one FROM app_meta WHERE key = ? LIMIT 1",
    [`done_week_${weekAnchor}`]
  );
  if (weekDoneRow) return;

  const dayDoneRow = await db.getFirstAsync<{ one: number }>(
    "SELECT 1 AS one FROM app_meta WHERE key = ? LIMIT 1",
    [`done_day_${dateKey}`]
  );
  if (dayDoneRow) return;

  const templateRow = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM schedule_template WHERE is_active = 1 ORDER BY id LIMIT 1"
  );
  if (!templateRow) return;
  const templateId = templateRow.id;

  const blockRows = await db.getAllAsync<{ start_min: number; end_min: number }>(
    `SELECT start_min, end_min FROM schedule_block
     WHERE template_id = ? AND day_of_week = ?
     ORDER BY start_min, end_min`,
    [templateId, dow]
  );

  let startMin: number | undefined;
  let endMin: number | undefined;
  for (const row of blockRows) {
    startMin = startMin !== undefined ? Math.min(startMin, row.start_min) : row.start_min;
    endMin = endMin !== undefined ? Math.max(endMin, row.end_min) : row.end_min;
  }

  let inShift = false;
  let beforeShift = false;
  if (startMin !== undefined && endMin !== undefined) {
    const overnight = startMin > endMin;
    inShift = overnight ? minute >= startMin || minute < endMin : minute >= startMin && minute < endMin;
    const sixBefore = Math.max(0, startMin - 6);
    beforeShift = minute >= sixBefore && minute < startMin;
  }

  const activeCountRow = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM session WHERE ended_at IS NULL"
  );
  const hasActiveSession = (activeCountRow?.c ?? 0) > 0;

  const intervalMs = parseReminderIntervalMs(await getSetting(db, "reminder_interval_min"));

  // ─── Standard shift reminders ───
  if (startMin !== undefined && endMin !== undefined) {
    const overnight = startMin > endMin;

    if (beforeShift) {
      await sendReminder(`${dateKey}:start-soon`, "Work starts soon", "Your workday starts in a few minutes.", null, Number.MAX_SAFE_INTEGER);
    } else if (inShift && !hasActiveSession) {
      const lateMinutes = minute - startMin;
      if (lateMinutes >= 15) {
        await sendReminder(
          `${dateKey}:forgot-clock-in`,
          "Forgot to clock in?",
          `Your shift started ${lateMinutes} minutes ago. Tap to clock in now.`,
          "clock_in",
          intervalMs
        );
      } else {
        await sendReminder(
          `${dateKey}:clock-in`,
          "Time to clock in",
          "Your shift has started. Clock in to start tracking.",
          "clock_in",
          intervalMs
        );
      }
    } else if (!inShift && !beforeShift && hasActiveSession && minute >= startMin) {
      const effectivePast = overnight ? minute >= endMin && minute < startMin : minute >= endMin;
      if (effectivePast) {
        let skipClockOutNudge = false;
        const sessRow = await db.getFirstAsync<{ started_at: number }>(
          "SELECT started_at FROM session WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
        );
        const startedAt = sessRow?.started_at;
        if (startedAt != null) {
          const endTs = shiftEndTimestampMs(now, startMin, endMin);
          if (endTs != null && startedAt >= endTs) skipClockOutNudge = true;
        }
        if (!skipClockOutNudge) {
          await sendReminder(
            `${dateKey}:clock-out`,
            "Shift ended",
            "Your scheduled shift has ended. Clock out when ready.",
            "clock_out",
            intervalMs
          );
        }
      }
    }
  }

  // ─── Approaching overtime (15 min before threshold) ───
  if (startMin !== undefined && endMin !== undefined && hasActiveSession && !beforeShift) {
    const endTs = shiftEndTimestampMs(now, startMin, endMin);
    const ts = nowMs();
    if (endTs != null) {
      const msPastEnd = ts - endTs;
      if (msPastEnd >= 15 * 60_000 && msPastEnd < 20 * 60_000) {
        await sendReminder(
          `${dateKey}:approaching-overtime`,
          "Approaching overtime",
          "You've been working 15 minutes past your shift. Consider wrapping up.",
          "clock_out",
          30 * 60_000
        );
      }
      if (msPastEnd >= 30 * 60_000 && minute % 30 === 0) {
        await sendReminder(
          `${dateKey}:overtime`,
          "Overtime reminder",
          "You've been clocked in well past your scheduled shift end.",
          "clock_out",
          30 * 60_000
        );
      }
    }
  }

  // ─── Idle too long (2h clocked in with no break) ───
  if (hasActiveSession) {
    const sessRow = await db.getFirstAsync<{ started_at: number; id: number }>(
      "SELECT id, started_at FROM session WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
    );
    if (sessRow) {
      const lastBreakRow = await db.getFirstAsync<{ resumed_at: number }>(
        "SELECT COALESCE(resumed_at, paused_at) AS resumed_at FROM session_pause WHERE session_id = ? ORDER BY paused_at DESC LIMIT 1",
        [sessRow.id]
      );
      const lastActivity = lastBreakRow?.resumed_at ?? sessRow.started_at;
      const idleMs = nowMs() - lastActivity;
      if (idleMs >= 2 * 60 * 60_000) {
        await sendReminder(
          `${dateKey}:idle-long`,
          "Still working?",
          "You've been clocked in for 2+ hours without a break. Consider taking a breather.",
          null,
          60 * 60_000
        );
      }
    }
  }

  // ─── Behind target (target mode) ───
  const acctMode = (await getSetting(db, "accountability_mode")) ?? "shift";

  if (acctMode === "target" && !hasActiveSession) {
    const targetRow = await db.getFirstAsync<{ target_min: number }>(
      "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
      [templateId, dow]
    );
    const explicitTargetMin = targetRow?.target_min ?? 0;
    const blockPlannedRow = await db.getFirstAsync<{ v: number }>(
      `SELECT COALESCE(SUM(CASE WHEN end_min > start_min THEN (end_min - start_min) * 60000
           ELSE (1440 - start_min + end_min) * 60000 END), 0) AS v
       FROM schedule_block WHERE template_id = ? AND day_of_week = ?`,
      [templateId, dow]
    );
    const blockPlannedMs = blockPlannedRow?.v ?? 0;
    const targetMs = explicitTargetMin > 0 ? explicitTargetMin * 60 * 1000 : blockPlannedMs;

    if (targetMs > 0) {
      const todayStart = localMidnightMs(now);
      const todayEnd = todayStart + 24 * 60 * 60 * 1000;
      const workedMs = await computeActualBetween(db, todayStart, todayEnd);

      let pastWindow = true;
      if (startMin !== undefined && endMin !== undefined) {
        const isOvernight = startMin > endMin;
        pastWindow = isOvernight ? minute >= endMin && minute < startMin : minute >= endMin;
      }

      if (pastWindow && workedMs < targetMs) {
        const remainingMin = Math.floor((targetMs - workedMs) / 60_000);
        const remainingLabel = remainingMin >= 60 ? `${(remainingMin / 60).toFixed(1)}h` : `${remainingMin}min`;
        await sendReminder(
          `${dateKey}:behind-target`,
          "Behind daily target",
          `You still have ${remainingLabel} to go today.`,
          "clock_in",
          intervalMs
        );
      }
    }
  }

  // ─── Task due (75%+ through shift with incomplete tasks) ───
  if (startMin !== undefined && endMin !== undefined && hasActiveSession) {
    const shiftDurationMin = startMin <= endMin ? endMin - startMin : (1440 - startMin + endMin);
    const elapsedInShift = minute >= startMin ? minute - startMin : minute + (1440 - startMin);
    const shiftProgress = shiftDurationMin > 0 ? elapsedInShift / shiftDurationMin : 0;

    if (shiftProgress >= 0.75) {
      const taskCountRow = await db.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) AS c FROM daily_task WHERE date = ? AND done = 0",
        [dateKey]
      );
      const pendingTasks = taskCountRow?.c ?? 0;
      if (pendingTasks > 0) {
        await sendReminder(
          `${dateKey}:tasks-due`,
          `${pendingTasks} task${pendingTasks === 1 ? "" : "s"} remaining`,
          "Your shift is almost over. Check your task list.",
          null,
          60 * 60_000,
          "clockwise-tasks"
        );
      }
    }
  }
}

// ─── History & maintenance ───

export async function getNotificationHistory(offset = 0, limit = 50): Promise<NotificationLogEntry[]> {
  const db = await getDb();
  const lim = Math.min(200, Math.max(1, limit));
  const off = Math.max(0, offset);
  const rows = await db.getAllAsync<{
    id: number;
    key: string;
    title: string;
    body: string;
    action_kind: string | null;
    created_at: number;
  }>(
    `SELECT id, key, title, body, action_kind, created_at
     FROM notification_log
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [lim, off]
  );
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    title: r.title,
    body: r.body,
    action_kind: r.action_kind,
    created_at: r.created_at,
  }));
}

export async function runDailyMaintenance(): Promise<void> {
  const db = await getDb();
  const cutoff = nowMs() - 30 * 24 * 60 * 60 * 1000;
  await db.runAsync("DELETE FROM notification_log WHERE created_at < ?", [cutoff]);
}
