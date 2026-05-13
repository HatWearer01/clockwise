import type { SQLiteDatabase } from "expo-sqlite";
import { getDb } from "../db/connection";
import { nowMs, todayISODate, weekStartDateFor } from "../lib/time";
import type {
  Insight,
  PendingRecovery,
  ScheduleBlock,
  SessionRecord,
  StatsSummary,
  StatusResponse,
  StatusState,
  WeekDaySummary,
  WeeklyReview,
  WeeklyReviewDay,
  WeekPoint,
} from "../types";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localMidnightMillis(parts: { y: number; m: number; d: number }): number {
  return new Date(parts.y, parts.m - 1, parts.d, 0, 0, 0, 0).getTime();
}

function parseIsoLocal(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function formatIsoLocal(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Calendar date `iso` plus `deltaDays` (local). */
function addDaysIso(iso: string, deltaDays: number): string {
  const { y, m, d } = parseIsoLocal(iso);
  const dt = new Date(y, m - 1, d + deltaDays);
  return formatIsoLocal(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function formatReviewCalendarDay(iso: string): string {
  const { y, m, d } = parseIsoLocal(iso);
  const dt = new Date(y, m - 1, d);
  return `${MONTH_SHORT[dt.getMonth()]} ${dt.getDate()}`;
}

function startOfWorkdayWindow(): [number, number] {
  const now = new Date();
  const start = localMidnightMillis({
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: now.getDate(),
  });
  const end = start + 24 * 60 * 60 * 1000;
  return [start, end];
}

function boundaryTimestamp(minuteOfDay: number, tomorrow: boolean): number | null {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  if (tomorrow) base.setDate(base.getDate() + 1);
  const h = Math.floor(minuteOfDay / 60);
  const min = minuteOfDay % 60;
  base.setHours(h, min, 0, 0);
  return base.getTime();
}

function boundaryTimestampForToday(minuteOfDay: number): number | null {
  return boundaryTimestamp(minuteOfDay, false);
}

function dayLabel(dayOfWeek: number): string {
  switch (dayOfWeek) {
    case 0:
      return "Sun";
    case 1:
      return "Mon";
    case 2:
      return "Tue";
    case 3:
      return "Wed";
    case 4:
      return "Thu";
    case 5:
      return "Fri";
    default:
      return "Sat";
  }
}

function minuteInAnyBlock(currentMinute: number, blocks: ScheduleBlock[]): boolean {
  return blocks.some((block) => {
    const overnight = block.start_min > block.end_min;
    if (overnight) return currentMinute >= block.start_min || currentMinute < block.end_min;
    return currentMinute >= block.start_min && currentMinute < block.end_min;
  });
}

function timezoneOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** Like Rust `rem_euclid(m)` for integers: result in `[0, m)`. */
function remEuclid(n: number, m: number): number {
  return ((n % m) + m) % m;
}

async function activeTemplateId(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM schedule_template WHERE is_active = 1 ORDER BY id LIMIT 1"
  );
  if (!row) throw new Error("No active schedule template.");
  return row.id;
}

async function weekStartDaySetting(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'week_start_day'");
  const n = row?.value != null ? Number.parseInt(row.value, 10) : 1;
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

async function scheduleBlocksForToday(db: SQLiteDatabase): Promise<ScheduleBlock[]> {
  const now = new Date();
  const day = now.getDay();
  let templateId: number;
  try {
    templateId = await activeTemplateId(db);
  } catch {
    return [];
  }
  return db.getAllAsync<ScheduleBlock>(
    `SELECT id, template_id, day_of_week, start_min, end_min,
            COALESCE(label, 'Work block') AS label, COALESCE(color, '#34D399') AS color
     FROM schedule_block
     WHERE template_id = ? AND day_of_week = ?
     ORDER BY start_min, end_min, id`,
    [templateId, day]
  );
}

async function activePauseForSession(db: SQLiteDatabase, sessionId: number): Promise<number | null> {
  const row = await db.getFirstAsync<{ paused_at: number }>(
    `SELECT paused_at FROM session_pause WHERE session_id = ? AND resumed_at IS NULL ORDER BY paused_at DESC LIMIT 1`,
    [sessionId]
  );
  return row?.paused_at ?? null;
}

async function effectivePlannedMsForWeekday(
  db: SQLiteDatabase,
  templateId: number,
  dayOfWeek: number
): Promise<number> {
  const plannedRow = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(CASE WHEN end_min > start_min THEN (end_min - start_min) * 60000
              ELSE (1440 - start_min + end_min) * 60000 END), 0) AS s
     FROM schedule_block WHERE template_id = ? AND day_of_week = ?`,
    [templateId, dayOfWeek]
  );
  const plannedMs = plannedRow?.s ?? 0;

  const targetRow = await db.getFirstAsync<{ target_min: number }>(
    "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
    [templateId, dayOfWeek]
  );
  const dayTargetMin = targetRow?.target_min ?? 0;

  return dayTargetMin > 0 ? dayTargetMin * 60_000 : plannedMs;
}

async function remainingWeekHasScheduledWork(
  db: SQLiteDatabase,
  templateId: number,
  todayIso: string,
  weekStartIso: string
): Promise<boolean> {
  const weekEndIso = addDaysIso(weekStartIso, 6);
  let cursor = todayIso;
  while (cursor <= weekEndIso) {
    const { y, m, d } = parseIsoLocal(cursor);
    const dow = new Date(y, m - 1, d).getDay();
    const ms = await effectivePlannedMsForWeekday(db, templateId, dow);
    if (ms > 0) return true;
    cursor = addDaysIso(cursor, 1);
  }
  return false;
}

async function tryAutoMarkWeekDone(db: SQLiteDatabase): Promise<void> {
  const nowLocal = new Date();
  const wsd = await weekStartDaySetting(db);
  const weekAnchor = weekStartDateFor(nowLocal, wsd);
  const doneKey = `done_week_${weekAnchor}`;
  const declinedKey = `done_week_declined_${weekAnchor}`;

  const existing = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", [doneKey]);

  let tid: number;
  try {
    tid = await activeTemplateId(db);
  } catch {
    return;
  }

  const todayIso = todayISODate();
  const hasWork = await remainingWeekHasScheduledWork(db, tid, todayIso, weekAnchor);

  if (hasWork) {
    if (existing?.value === "auto") {
      await db.runAsync("DELETE FROM app_meta WHERE key = ?", [doneKey]);
      await db.runAsync("DELETE FROM app_meta WHERE key = ?", [declinedKey]);
    }
    return;
  }

  if (existing) return;

  const declined = await db.getFirstAsync<{ k: number }>("SELECT 1 AS k FROM app_meta WHERE key = ? LIMIT 1", [
    declinedKey,
  ]);
  if (declined) return;

  await db.runAsync(
    `INSERT INTO app_meta (key, value) VALUES (?, 'auto')
     ON CONFLICT(key) DO UPDATE SET value = 'auto'`,
    [doneKey]
  );
}

async function tryAutoMarkDayDone(db: SQLiteDatabase): Promise<void> {
  const dateStr = todayISODate();
  const doneKey = `done_day_${dateStr}`;
  const declinedKey = `done_day_declined_${dateStr}`;

  if (await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", [doneKey])) return;

  const declined = await db.getFirstAsync<{ k: number }>("SELECT 1 AS k FROM app_meta WHERE key = ? LIMIT 1", [
    declinedKey,
  ]);
  if (declined) return;

  let tid: number;
  try {
    tid = await activeTemplateId(db);
  } catch {
    return;
  }

  const now = new Date();
  const dayOfWeek = now.getDay();

  const hasBlocks = !!(await db.getFirstAsync<{ k: number }>(
    "SELECT 1 AS k FROM schedule_block WHERE template_id = ? AND day_of_week = ? LIMIT 1",
    [tid, dayOfWeek]
  ));

  const explicitRow = await db.getFirstAsync<{ t: number }>(
    "SELECT COALESCE(target_min, 0) AS t FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
    [tid, dayOfWeek]
  );
  const explicitTarget = explicitRow?.t ?? 0;

  if (hasBlocks || explicitTarget > 0) return;

  await db.runAsync(
    `INSERT INTO app_meta (key, value) VALUES (?, 'auto')
     ON CONFLICT(key) DO UPDATE SET value = 'auto'`,
    [doneKey]
  );
}

async function computeActualBetween(db: SQLiteDatabase, startMs: number, endMs: number): Promise<number> {
  const now = nowMs();
  const grossRow = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at), 0) AS s
     FROM session
     WHERE started_at >= ? AND started_at < ?`,
    [now, startMs, endMs]
  );
  const gross = grossRow?.s ?? 0;

  const pauseRow = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(COALESCE(sp.resumed_at, ?) - sp.paused_at), 0) AS s
     FROM session_pause sp
     JOIN session s ON s.id = sp.session_id
     WHERE s.started_at >= ? AND s.started_at < ?`,
    [now, startMs, endMs]
  );
  const pauses = pauseRow?.s ?? 0;
  return Math.max(0, gross - pauses);
}

async function computeShiftCoverage(
  db: SQLiteDatabase,
  dayStartMs: number,
  dayEndMs: number,
  blockRanges: readonly [number, number][]
): Promise<number> {
  if (blockRanges.length === 0) return 0;
  const now = nowMs();
  const sessionRows = await db.getAllAsync<{ started_at: number; ended_at: number | null; id: number }>(
    "SELECT started_at, COALESCE(ended_at, ?) AS ended_at, id FROM session WHERE started_at >= ? AND started_at < ?",
    [now, dayStartMs, dayEndMs]
  );

  let coverage = 0;
  for (const row of sessionRows) {
    const sStart = row.started_at;
    const sEnd = row.ended_at ?? now;
    const sId = row.id;

    const pauseRows = await db.getAllAsync<{ paused_at: number; resumed_at: number | null }>(
      "SELECT paused_at, COALESCE(resumed_at, ?) AS resumed_at FROM session_pause WHERE session_id = ?",
      [now, sId]
    );

    for (const [bs, be] of blockRanges) {
      const overlapStart = Math.max(sStart, bs);
      const overlapEnd = Math.min(sEnd, be);
      if (overlapStart >= overlapEnd) continue;

      let gross = overlapEnd - overlapStart;
      for (const p of pauseRows) {
        const pStart = p.paused_at;
        const pEnd = p.resumed_at ?? now;
        const poStart = Math.max(pStart, overlapStart);
        const poEnd = Math.min(pEnd, overlapEnd);
        if (poStart < poEnd) gross -= poEnd - poStart;
      }
      coverage += Math.max(0, gross);
    }
  }
  return coverage;
}

export async function activeSession(): Promise<SessionRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SessionRecord>(
    "SELECT id, started_at, ended_at FROM session WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1"
  );
  return row ?? null;
}

export async function clockIn(): Promise<SessionRecord> {
  const db = await getDb();
  if (await activeSession()) throw new Error("You are already clocked in.");

  const startedAt = nowMs();
  const todayBlocks = await scheduleBlocksForToday(db);
  const nowLocal = new Date();
  const currentMinute = nowLocal.getHours() * 60 + nowLocal.getMinutes();
  const matchingBlock = todayBlocks.find((b) => currentMinute >= b.start_min && currentMinute < b.end_min);
  const blockId = matchingBlock?.id ?? null;

  const dayDoneKey = `done_day_${todayISODate()}`;
  await db.runAsync("DELETE FROM app_meta WHERE key = ?", [dayDoneKey]);

  const result = await db.runAsync("INSERT INTO session (started_at, ended_at, block_id) VALUES (?, NULL, ?)", [
    startedAt,
    blockId,
  ]);

  return {
    id: Number(result.lastInsertRowId),
    started_at: startedAt,
    ended_at: null,
  };
}

export async function clockOut(endedAt?: number): Promise<SessionRecord> {
  const db = await getDb();
  const session = await activeSession();
  if (!session) throw new Error("No active session to clock out from.");

  let end = endedAt !== undefined ? endedAt : nowMs();
  if (end < session.started_at) end = nowMs();

  await db.runAsync("UPDATE session SET ended_at = ? WHERE id = ?", [end, session.id]);
  await db.runAsync("UPDATE session_pause SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL", [
    end,
    session.id,
  ]);

  return { ...session, ended_at: end };
}

export async function startBreak(): Promise<void> {
  const db = await getDb();
  const session = await activeSession();
  if (!session) throw new Error("No active session to pause.");

  const pauseAt = await activePauseForSession(db, session.id);
  if (pauseAt !== null) throw new Error("Session is already on break.");

  await db.runAsync("INSERT INTO session_pause (session_id, paused_at, reason) VALUES (?, ?, 'manual')", [
    session.id,
    nowMs(),
  ]);
}

export async function resumeBreak(): Promise<void> {
  const db = await getDb();
  const session = await activeSession();
  if (!session) throw new Error("No active session to resume.");

  const pausedAt = await activePauseForSession(db, session.id);
  if (pausedAt === null) throw new Error("Session is not currently on break.");

  await db.runAsync("UPDATE session_pause SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL", [
    nowMs(),
    session.id,
  ]);
}

export async function getStatus(): Promise<StatusResponse> {
  const db = await getDb();
  const active = await activeSession();
  const now = nowMs();
  const [windowStart, windowEnd] = startOfWorkdayWindow();

  const workedGrossRow = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM((COALESCE(ended_at, ?) - started_at)), 0) AS s
     FROM session
     WHERE started_at >= ? AND started_at < ?`,
    [now, windowStart, windowEnd]
  );
  const workedGrossMs = workedGrossRow?.s ?? 0;

  const pauseMsRow = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(COALESCE(sp.resumed_at, ?) - sp.paused_at), 0) AS s
     FROM session_pause sp
     JOIN session s ON s.id = sp.session_id
     WHERE s.started_at >= ? AND s.started_at < ?`,
    [now, windowStart, windowEnd]
  );
  const pauseMs = pauseMsRow?.s ?? 0;

  const workedTodayMs = Math.max(0, workedGrossMs - pauseMs);
  const breakTodayMs = Math.max(0, pauseMs);

  const todayBlocks = await scheduleBlocksForToday(db);
  const nowLocal = new Date();
  const currentMinute = nowLocal.getHours() * 60 + nowLocal.getMinutes();

  const modeRow = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'accountability_mode'"
  );
  const accountabilityMode = modeRow?.value ?? "shift";
  const targetMode = accountabilityMode === "target";

  let templateIdForTarget = 0;
  try {
    templateIdForTarget = await activeTemplateId(db);
  } catch {
    templateIdForTarget = 0;
  }

  const dayOfWeekToday = nowLocal.getDay();
  const targetMinRow = await db.getFirstAsync<{ target_min: number }>(
    "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
    [templateIdForTarget, dayOfWeekToday]
  );
  const explicitTargetMin = targetMinRow?.target_min ?? 0;

  let plannedFromBlocksMs = 0;
  for (const b of todayBlocks) {
    plannedFromBlocksMs += b.end_min > b.start_min
      ? (b.end_min - b.start_min) * 60_000
      : (1440 - b.start_min + b.end_min) * 60_000;
  }
  const targetTodayMs = explicitTargetMin > 0 ? explicitTargetMin * 60_000 : plannedFromBlocksMs;

  let paused = false;
  if (active) {
    paused = (await activePauseForSession(db, active.id)) !== null;
  }

  await tryAutoMarkWeekDone(db);
  await tryAutoMarkDayDone(db);

  const wsd = await weekStartDaySetting(db);
  const weekAnchor = weekStartDateFor(nowLocal, wsd);
  const doneWeekKey = `done_week_${weekAnchor}`;
  const weekDone = !!(await db.getFirstAsync<{ k: number }>(
    "SELECT 1 AS k FROM app_meta WHERE key = ? LIMIT 1",
    [doneWeekKey]
  ));

  const dayDoneKey = `done_day_${todayISODate()}`;
  const dayDone = !!(await db.getFirstAsync<{ k: number }>(
    "SELECT 1 AS k FROM app_meta WHERE key = ? LIMIT 1",
    [dayDoneKey]
  ));

  let stateName: StatusState;
  let nextBoundaryMs: number | null;

  if (active && paused) {
    stateName = "on_break";
    nextBoundaryMs = now + 1000;
  } else if (active) {
    stateName = "on_clock";
    nextBoundaryMs = now + 1000;
  } else if (weekDone) {
    stateName = "week_done";
    nextBoundaryMs = null;
  } else if (dayDone) {
    stateName = "day_done";
    nextBoundaryMs = null;
  } else {
    let nextStart: number | null = null;
    let currentBlockEnd: number | null = null;
    let endIsTomorrow = false;
    let anyBlock = false;

    for (const block of todayBlocks) {
      anyBlock = true;
      const isOvernight = block.start_min > block.end_min;

      const inBlock = isOvernight
        ? currentMinute >= block.start_min || currentMinute <= block.end_min
        : currentMinute >= block.start_min && currentMinute <= block.end_min;

      const beforeBlock = isOvernight
        ? currentMinute < block.start_min && currentMinute > block.end_min
        : currentMinute < block.start_min;

      if (beforeBlock) {
        nextStart = nextStart === null ? block.start_min : Math.min(nextStart, block.start_min);
      }
      if (inBlock) {
        if (isOvernight && currentMinute >= block.start_min) endIsTomorrow = true;
        currentBlockEnd =
          currentBlockEnd === null ? block.end_min : Math.max(currentBlockEnd, block.end_min);
      }
    }

    if (!anyBlock && targetMode && explicitTargetMin > 0 && workedTodayMs < targetTodayMs) {
      stateName = "behind_target";
      nextBoundaryMs = null;
    } else if (!anyBlock) {
      stateName = "off_day";
      nextBoundaryMs = null;
    } else if (currentBlockEnd !== null) {
      stateName = "in_shift";
      nextBoundaryMs = boundaryTimestamp(currentBlockEnd, endIsTomorrow);
    } else if (nextStart !== null) {
      stateName = "before_shift";
      nextBoundaryMs = boundaryTimestampForToday(nextStart);
    } else if (targetMode && targetTodayMs > 0 && workedTodayMs < targetTodayMs) {
      stateName = "behind_target";
      nextBoundaryMs = null;
    } else {
      stateName = "after_shift";
      nextBoundaryMs = null;
    }
  }

  let offSchedule = false;
  if (active) {
    const inAnyBlock = todayBlocks.some((block) => {
      const overnight = block.start_min > block.end_min;
      if (overnight) return currentMinute >= block.start_min || currentMinute < block.end_min;
      return currentMinute >= block.start_min && currentMinute < block.end_min;
    });
    offSchedule = !inAnyBlock;
  }

  const overnightSession = active ? active.started_at < windowStart : false;

  const todayDateParts = parseIsoLocal(todayISODate());
  const dayBaseMs = localMidnightMillis(todayDateParts);

  const blockRanges: [number, number][] = todayBlocks.map((b) => {
    const bs = dayBaseMs + b.start_min * 60_000;
    const be =
      b.end_min > b.start_min ? dayBaseMs + b.end_min * 60_000 : dayBaseMs + (1440 + b.end_min) * 60_000;
    return [bs, be];
  });

  const shiftCoverageMs = await computeShiftCoverage(db, windowStart, windowEnd, blockRanges);

  return {
    active_session: active,
    worked_today_ms: workedTodayMs,
    break_today_ms: breakTodayMs,
    state: stateName,
    next_boundary_ms: nextBoundaryMs,
    paused,
    week_done: weekDone,
    day_done: dayDone,
    overnight_session: overnightSession,
    target_today_ms: targetTodayMs,
    off_schedule: offSchedule,
    shift_coverage_ms: shiftCoverageMs,
  };
}

export async function markWeekDone(done: boolean): Promise<void> {
  const db = await getDb();
  const wsd = await weekStartDaySetting(db);
  const weekAnchor = weekStartDateFor(new Date(), wsd);
  const key = `done_week_${weekAnchor}`;
  const declinedKey = `done_week_declined_${weekAnchor}`;

  if (done) {
    await db.runAsync("DELETE FROM app_meta WHERE key = ?", [declinedKey]);
    await db.runAsync(
      `INSERT INTO app_meta (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
      [key]
    );
  } else {
    await db.runAsync("DELETE FROM app_meta WHERE key = ?", [key]);
    await db.runAsync(
      `INSERT INTO app_meta (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
      [declinedKey]
    );
  }
}

export async function markDayDone(done: boolean): Promise<void> {
  const db = await getDb();
  const key = `done_day_${todayISODate()}`;
  const declinedKey = `done_day_declined_${todayISODate()}`;

  if (done) {
    await db.runAsync("DELETE FROM app_meta WHERE key = ?", [declinedKey]);
    await db.runAsync(
      `INSERT INTO app_meta (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
      [key]
    );
  } else {
    await db.runAsync("DELETE FROM app_meta WHERE key = ?", [key]);
    await db.runAsync(
      `INSERT INTO app_meta (key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
      [declinedKey]
    );
  }
}

export async function isDayDone(): Promise<boolean> {
  const db = await getDb();
  await tryAutoMarkDayDone(db);
  const key = `done_day_${todayISODate()}`;
  const row = await db.getFirstAsync<{ k: number }>("SELECT 1 AS k FROM app_meta WHERE key = ? LIMIT 1", [key]);
  return !!row;
}

export async function isWeekDone(): Promise<boolean> {
  const db = await getDb();
  await tryAutoMarkWeekDone(db);
  const wsd = await weekStartDaySetting(db);
  const weekAnchor = weekStartDateFor(new Date(), wsd);
  const key = `done_week_${weekAnchor}`;
  const row = await db.getFirstAsync<{ k: number }>("SELECT 1 AS k FROM app_meta WHERE key = ? LIMIT 1", [key]);
  return !!row;
}

export async function getWeekSummary(weekStart?: string, weekStartDay?: number): Promise<WeekDaySummary[]> {
  const db = await getDb();
  const templateId = await activeTemplateId(db);
  const wsd = weekStartDay ?? 1;

  let anchorIso: string;
  if (weekStart) {
    anchorIso = weekStart;
    const parts = parseIsoLocal(weekStart);
    const probe = new Date(parts.y, parts.m - 1, parts.d);
    if (Number.isNaN(probe.getTime())) throw new Error("Invalid week_start date format");
  } else {
    anchorIso = weekStartDateFor(new Date(), wsd);
  }

  const rows: WeekDaySummary[] = [];
  for (let i = 0; i < 7; i++) {
    const dayIso = addDaysIso(anchorIso, i);
    const { y, m, d } = parseIsoLocal(dayIso);
    const dayStart = localMidnightMillis({ y, m, d });
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const weekday = new Date(y, m - 1, d).getDay();

    const plannedRow = await db.getFirstAsync<{ s: number }>(
      `SELECT COALESCE(SUM(CASE WHEN end_min > start_min THEN (end_min - start_min) * 60000
                ELSE (1440 - start_min + end_min) * 60000 END), 0) AS s
       FROM schedule_block
       WHERE template_id = ? AND day_of_week = ?`,
      [templateId, weekday]
    );
    const plannedMs = plannedRow?.s ?? 0;

    const dayTargetRow = await db.getFirstAsync<{ target_min: number }>(
      "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
      [templateId, weekday]
    );
    const dayTargetMin = dayTargetRow?.target_min ?? 0;

    const effectivePlannedMs = dayTargetMin > 0 ? dayTargetMin * 60_000 : plannedMs;

    const actualMs = await computeActualBetween(db, dayStart, dayEnd);

    const blockRows = await db.getAllAsync<{ start_min: number; end_min: number }>(
      "SELECT start_min, end_min FROM schedule_block WHERE template_id = ? AND day_of_week = ?",
      [templateId, weekday]
    );

    const blockRanges: [number, number][] = blockRows.map((r) => {
      const bs = dayStart + r.start_min * 60_000;
      const be =
        r.end_min > r.start_min ? dayStart + r.end_min * 60_000 : dayStart + (1440 + r.end_min) * 60_000;
      return [bs, be];
    });

    const dayCoverage = await computeShiftCoverage(db, dayStart, dayEnd, blockRanges);

    rows.push({
      day_of_week: weekday,
      label: dayLabel(weekday),
      planned_ms: effectivePlannedMs,
      actual_ms: actualMs,
      target_ms: dayTargetMin * 60_000,
      shift_coverage_ms: dayCoverage,
    });
  }

  return rows;
}

export async function getStatsSummary(weekStartDay?: number): Promise<StatsSummary> {
  const db = await getDb();
  const now = new Date();
  const wsd = weekStartDay ?? 1;
  const offsetMin = timezoneOffsetMinutes();

  const weekPoints: WeekPoint[] = [];
  const anchor = weekStartDateFor(now, wsd);

  for (let offset = 7; offset >= 0; offset--) {
    const weekStartDateStr = addDaysIso(anchor, -offset * 7);
    const { y, m, d } = parseIsoLocal(weekStartDateStr);
    const weekStartMs = localMidnightMillis({ y, m, d });
    const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000;
    const workedMs = await computeActualBetween(db, weekStartMs, weekEndMs);

    const wsDate = new Date(y, m - 1, d);
    weekPoints.push({
      week_label: `${String(wsDate.getMonth() + 1).padStart(2, "0")}/${String(wsDate.getDate()).padStart(2, "0")}`,
      worked_ms: workedMs,
      week_start_date: weekStartDateStr,
    });
  }

  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;

  const avgStartRow = await db.getFirstAsync<{ v: number | null }>(
    `SELECT CAST(AVG(((started_at / 60000) + ? ) % 1440) AS INTEGER) AS v FROM session WHERE started_at > ?`,
    [offsetMin, cutoff]
  );

  const avgEndRow = await db.getFirstAsync<{ v: number | null }>(
    `SELECT CAST(AVG(((ended_at / 60000) + ? ) % 1440) AS INTEGER) AS v
     FROM session WHERE ended_at IS NOT NULL AND ended_at > ?`,
    [offsetMin, cutoff]
  );

  const monthStart = localMidnightMillis({
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: 1,
  });
  const monthTotalMs = await computeActualBetween(db, monthStart, Date.now());

  return {
    week_points: weekPoints,
    avg_start_minute: avgStartRow?.v ?? null,
    avg_end_minute: avgEndRow?.v ?? null,
    month_total_ms: monthTotalMs,
  };
}

function insightSeverity(s: string): Insight["severity"] {
  if (s === "warning" || s === "positive" || s === "info") return s;
  return "info";
}

export async function getWeeklyReview(weekStartDay?: number, weekStart?: string): Promise<WeeklyReview> {
  const db = await getDb();
  const wsd = weekStartDay ?? 1;
  const now = new Date();
  const currentWeekStart = weekStartDateFor(now, wsd);

  let reviewWeekStartIso: string;
  if (weekStart) {
    reviewWeekStartIso = weekStart;
    const p = parseIsoLocal(weekStart);
    if (Number.isNaN(new Date(p.y, p.m - 1, p.d).getTime())) throw new Error("Invalid date");
  } else {
    reviewWeekStartIso = addDaysIso(currentWeekStart, -7);
  }

  const reviewWeekEndIso = addDaysIso(reviewWeekStartIso, 7);
  const lastDayOfWeekIso = addDaysIso(reviewWeekEndIso, -1);
  const weekLabel = `${formatReviewCalendarDay(reviewWeekStartIso)} \u2013 ${formatReviewCalendarDay(lastDayOfWeekIso)}`;

  const wsParts = parseIsoLocal(reviewWeekStartIso);
  const weekStartMs = localMidnightMillis(wsParts);
  const weParts = parseIsoLocal(reviewWeekEndIso);
  const weekEndMs = localMidnightMillis(weParts);

  const offsetMin = timezoneOffsetMinutes();

  let templateId = 0;
  try {
    templateId = await activeTemplateId(db);
  } catch {
    templateId = 0;
  }

  const blockRows = await db.getAllAsync<ScheduleBlock>(
    `SELECT id, template_id, day_of_week, start_min, end_min,
            COALESCE(label, 'Work block') AS label, COALESCE(color, '#34D399') AS color
     FROM schedule_block
     WHERE template_id = ?`,
    [templateId]
  );

  const blocksByDow = new Map<number, ScheduleBlock[]>();
  for (const raw of blockRows) {
    const list = blocksByDow.get(raw.day_of_week) ?? [];
    list.push(raw);
    blocksByDow.set(raw.day_of_week, list);
  }
  for (const list of blocksByDow.values()) {
    list.sort((a: ScheduleBlock, b: ScheduleBlock) => a.start_min - b.start_min);
  }

  const dayDetails: WeeklyReviewDay[] = [];
  let daysWorked = 0;
  let daysScheduled = 0;
  let totalTargetMs = 0;
  let totalActualMs = 0;
  let onTimeDays = 0;

  for (let i = 0; i < 7; i++) {
    const dayIso = addDaysIso(reviewWeekStartIso, i);
    const { y, m, d } = parseIsoLocal(dayIso);
    const dayStart = localMidnightMillis({ y, m, d });
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const weekday = new Date(y, m - 1, d).getDay();

    const plannedRow = await db.getFirstAsync<{ s: number }>(
      `SELECT COALESCE(SUM(CASE WHEN end_min > start_min THEN (end_min - start_min) * 60000
                ELSE (1440 - start_min + end_min) * 60000 END), 0) AS s
       FROM schedule_block
       WHERE template_id = ? AND day_of_week = ?`,
      [templateId, weekday]
    );
    const plannedMs = plannedRow?.s ?? 0;

    const dayTargetRow = await db.getFirstAsync<{ target_min: number }>(
      "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
      [templateId, weekday]
    );
    const dayTargetMin = dayTargetRow?.target_min ?? 0;

    const targetMs = dayTargetMin > 0 ? dayTargetMin * 60_000 : plannedMs;

    const actualMs = await computeActualBetween(db, dayStart, dayEnd);

    if (actualMs > 60_000) daysWorked += 1;
    if (targetMs > 0) daysScheduled += 1;
    totalTargetMs += targetMs;
    totalActualMs += actualMs;

    const firstStartedRow = await db.getFirstAsync<{ m: number | null }>(
      "SELECT MIN(started_at) AS m FROM session WHERE started_at >= ? AND started_at < ?",
      [dayStart, dayEnd]
    );
    const firstStarted = firstStartedRow?.m ?? null;

    const blocksForDay: ScheduleBlock[] = blocksByDow.get(weekday) ?? [];
    const firstBlockStart =
      blocksForDay.length > 0
        ? Math.min(...blocksForDay.map((b: ScheduleBlock) => b.start_min))
        : undefined;

    let onTime = false;
    if (firstStarted != null && firstBlockStart !== undefined) {
      const smin = remEuclid(Math.floor(firstStarted / 60_000) + offsetMin, 1440);
      onTime = Math.abs(smin - firstBlockStart) <= 30;
    }
    if (onTime) onTimeDays += 1;

    dayDetails.push({
      label: dayLabel(weekday),
      target_ms: targetMs,
      actual_ms: actualMs,
      on_time: onTime,
    });
  }

  const avgStartRow = await db.getFirstAsync<{ v: number | null }>(
    `SELECT CAST(AVG(((started_at / 60000) + ?) % 1440) AS INTEGER) AS v
     FROM session WHERE started_at >= ? AND started_at < ?`,
    [offsetMin, weekStartMs, weekEndMs]
  );

  const avgEndRow = await db.getFirstAsync<{ v: number | null }>(
    `SELECT CAST(AVG(((ended_at / 60000) + ?) % 1440) AS INTEGER) AS v
     FROM session WHERE ended_at IS NOT NULL AND ended_at >= ? AND ended_at < ?`,
    [offsetMin, weekStartMs, weekEndMs]
  );

  const sessionStarts = await db.getAllAsync<{ started_at: number }>(
    "SELECT started_at FROM session WHERE started_at >= ? AND started_at < ?",
    [weekStartMs, weekEndMs]
  );

  let offScheduleSessions = 0;
  for (const { started_at: ts } of sessionStarts) {
    const dt = new Date(ts);
    const weekday = dt.getDay();
    const minute = dt.getHours() * 60 + dt.getMinutes();
    const blocks = blocksByDow.get(weekday) ?? [];
    if (!minuteInAnyBlock(minute, blocks)) offScheduleSessions += 1;
  }

  const insights: Insight[] = [];

  const lateCountRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM session WHERE started_at >= ? AND started_at < ?
     AND ((started_at / 60000 + ?) % 1440) >= 1320`,
    [weekStartMs, weekEndMs, offsetMin]
  );
  const lateCount = lateCountRow?.c ?? 0;

  if (lateCount > 0) {
    insights.push({
      kind: "late_night",
      message: `${lateCount} session${lateCount === 1 ? "" : "s"} past 10 PM.`,
      severity: insightSeverity("warning"),
    });
  }

  const weekendRow = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM session WHERE started_at >= ? AND started_at < ?
     AND CAST(strftime('%w', datetime(started_at/1000, 'unixepoch', 'localtime')) AS INTEGER) IN (0, 6)`,
    [weekStartMs, weekEndMs]
  );
  const weekendSessions = weekendRow?.c ?? 0;

  if (weekendSessions > 0) {
    insights.push({
      kind: "weekend",
      message: `${weekendSessions} weekend session${weekendSessions === 1 ? "" : "s"}.`,
      severity: insightSeverity("warning"),
    });
  }

  if (daysWorked >= daysScheduled && daysScheduled > 0) {
    insights.push({
      kind: "streak",
      message: `Hit target on all ${daysScheduled} scheduled days!`,
      severity: insightSeverity("positive"),
    });
  }

  if (totalActualMs > 0) {
    for (const detail of dayDetails) {
      if (detail.actual_ms > totalActualMs / 2 && detail.actual_ms > 3_600_000) {
        const pct = Math.round((detail.actual_ms / totalActualMs) * 100);
        insights.push({
          kind: "cramming",
          message: `${pct}% of hours were on ${detail.label}.`,
          severity: insightSeverity("warning"),
        });
        break;
      }
    }
  }

  return {
    week_label: weekLabel,
    days_worked: daysWorked,
    days_scheduled: daysScheduled,
    total_target_ms: totalTargetMs,
    total_actual_ms: totalActualMs,
    avg_start_minute: avgStartRow?.v ?? null,
    avg_end_minute: avgEndRow?.v ?? null,
    on_time_days: onTimeDays,
    off_schedule_sessions: offScheduleSessions,
    day_details: dayDetails,
    insights,
  };
}

export async function getPendingRecovery(): Promise<PendingRecovery | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = 'pending_recovery'");
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as {
      session_id: number;
      started_at: number;
      suggested_end_at: number;
    };
    if (
      typeof parsed.session_id !== "number" ||
      typeof parsed.started_at !== "number" ||
      typeof parsed.suggested_end_at !== "number"
    ) {
      throw new Error("Invalid shape");
    }
    return {
      session_id: parsed.session_id,
      started_at: parsed.started_at,
      suggested_end_at: parsed.suggested_end_at,
    };
  } catch {
    throw new Error("Invalid pending recovery");
  }
}

export async function applyPendingRecovery(endedAt: number): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = 'pending_recovery'");
  if (!row?.value) return;

  let pending: PendingRecovery | null = null;
  try {
    const v = JSON.parse(row.value) as Record<string, unknown>;
    const session_id = typeof v.session_id === "number" ? v.session_id : Number(v.session_id);
    const started_at = typeof v.started_at === "number" ? v.started_at : Number(v.started_at);
    const suggested_end_at =
      typeof v.suggested_end_at === "number" ? v.suggested_end_at : Number(v.suggested_end_at);
    if ([session_id, started_at, suggested_end_at].every(Number.isFinite)) {
      pending = { session_id, started_at, suggested_end_at };
    }
  } catch {
    pending = null;
  }
  if (!pending) return;

  const safeEndedAt = Math.min(Math.max(endedAt, pending.started_at), nowMs());

  await db.runAsync("UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL", [
    safeEndedAt,
    pending.session_id,
  ]);
  await db.runAsync("UPDATE session_pause SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL", [
    safeEndedAt,
    pending.session_id,
  ]);
  await db.runAsync("DELETE FROM app_meta WHERE key IN ('pending_recovery', 'startup_notice')");
}

export async function consumeStartupNotice(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key = 'startup_notice'");
  const notice = row?.value ?? null;
  if (notice !== null) {
    await db.runAsync("DELETE FROM app_meta WHERE key = 'startup_notice'");
  }
  return notice;
}

export async function getSessionChecklist(sessionId: number): Promise<number[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ item_id: number }>(
    "SELECT item_id FROM session_checklist_state WHERE session_id = ?",
    [sessionId]
  );
  return rows.map((r: { item_id: number }) => r.item_id);
}

export async function toggleChecklistItem(sessionId: number, itemId: number, done: boolean): Promise<void> {
  const db = await getDb();
  if (done) {
    await db.runAsync(
      "INSERT OR IGNORE INTO session_checklist_state (session_id, item_id, done_at) VALUES (?, ?, ?)",
      [sessionId, itemId, nowMs()]
    );
  } else {
    await db.runAsync("DELETE FROM session_checklist_state WHERE session_id = ? AND item_id = ?", [
      sessionId,
      itemId,
    ]);
  }
}
