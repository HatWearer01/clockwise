import type { Insight } from "../types";
import { getDb } from "../db/connection";
import { dayName, weekStartDateFor } from "../lib/time";

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

async function activeTemplateId(db: Awaited<ReturnType<typeof getDb>>): Promise<number | null> {
  const row = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM schedule_template WHERE is_active = 1 ORDER BY id LIMIT 1"
  );
  return row?.id ?? null;
}

function parseLocalDay(isoYmd: string): Date {
  const [y, m, d] = isoYmd.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function localMidnightMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function minuteOfDayFromMs(ms: number): number {
  const dt = new Date(ms);
  return dt.getHours() * 60 + dt.getMinutes();
}

/** Gross worked ms minus pauses for sessions whose `started_at` falls in [startMs, endMs). */
async function computeActualBetween(db: Awaited<ReturnType<typeof getDb>>, startMs: number, endMs: number): Promise<number> {
  const now = Date.now();
  const nowRounded = Math.floor(now / 1000) * 1000;
  const grossRow = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at), 0) AS v
     FROM session WHERE started_at >= ? AND started_at < ?`,
    [nowRounded, startMs, endMs]
  );
  const gross = grossRow?.v ?? 0;
  const pauseRow = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(COALESCE(sp.resumed_at, ?) - sp.paused_at), 0) AS v
     FROM session_pause sp
     JOIN session s ON s.id = sp.session_id
     WHERE s.started_at >= ? AND s.started_at < ?`,
    [nowRounded, startMs, endMs]
  );
  const pauses = pauseRow?.v ?? 0;
  return Math.max(0, gross - pauses);
}

async function dayHasSchedule(
  db: Awaited<ReturnType<typeof getDb>>,
  templateId: number,
  dow: number
): Promise<boolean> {
  const blockCount = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM schedule_block WHERE template_id = ? AND day_of_week = ?",
    [templateId, dow]
  );
  if ((blockCount?.c ?? 0) > 0) return true;
  const tgt = await db.getFirstAsync<{ target_min: number }>(
    "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
    [templateId, dow]
  );
  return (tgt?.target_min ?? 0) > 0;
}

async function effectiveDayTargetMs(
  db: Awaited<ReturnType<typeof getDb>>,
  templateId: number,
  dow: number
): Promise<number> {
  const targetRow = await db.getFirstAsync<{ target_min: number }>(
    "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
    [templateId, dow]
  );
  const targetMin = targetRow?.target_min ?? 0;
  const blockRow = await db.getFirstAsync<{ v: number }>(
    `SELECT COALESCE(SUM(CASE WHEN end_min > start_min THEN (end_min - start_min) * 60000
         ELSE (1440 - start_min + end_min) * 60000 END), 0) AS v
     FROM schedule_block WHERE template_id = ? AND day_of_week = ?`,
    [templateId, dow]
  );
  const blockMs = blockRow?.v ?? 0;
  return targetMin > 0 ? targetMin * 60_000 : blockMs;
}

function dayLabelShort(dow: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow] ?? "?";
}

/** Local Monday calendar date id — buckets sessions into the same week as desktop `%Y-%W` style summaries. */
function localMondayWeekKey(d: Date): string {
  const day = d.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
  return isoDateLocal(mon);
}

/**
 * Weekly behavioral insights (parity with desktop `get_insights`), using local calendar semantics.
 * `weekStartDay`: 0 = Sunday start, 1 = Monday start; omit to load from settings.
 */
export async function getInsights(weekStartDay?: number): Promise<Insight[]> {
  const db = await getDb();
  const wsd = weekStartDay !== undefined ? (Math.max(0, Math.min(1, weekStartDay)) as 0 | 1) : await weekStartDaySetting(db);
  const templateId = await activeTemplateId(db);
  if (templateId == null) return [];

  const now = new Date();
  const todayStart = localMidnightMs(now);
  const weekAnchorIso = weekStartDateFor(now, wsd);
  const weekStartDate = parseLocalDay(weekAnchorIso);
  const weekStartMs = weekStartDate.getTime();
  const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000;

  const insights: Insight[] = [];

  const dowScheduled: boolean[] = [];
  for (let d = 0; d < 7; d++) {
    dowScheduled[d] = await dayHasSchedule(db, templateId, d);
  }

  // a) Late start drift (≥2 days late, average > 30 min after first block)
  {
    let driftCount = 0;
    let totalDrift = 0;
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStartDate);
      day.setDate(weekStartDate.getDate() + i);
      const dow = day.getDay();

      const firstBlockRow = await db.getFirstAsync<{ m: number | null }>(
        "SELECT MIN(start_min) AS m FROM schedule_block WHERE template_id = ? AND day_of_week = ?",
        [templateId, dow]
      );
      const blockStart = firstBlockRow?.m;
      if (blockStart == null) continue;

      const dayStartMs = localMidnightMs(day);
      const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;

      const firstStartRow = await db.getFirstAsync<{ m: number | null }>(
        "SELECT MIN(started_at) AS m FROM session WHERE started_at >= ? AND started_at < ?",
        [dayStartMs, dayEndMs]
      );
      const firstStartedAt = firstStartRow?.m;
      if (firstStartedAt == null) continue;

      const sessionMin = minuteOfDayFromMs(firstStartedAt);
      const diff = sessionMin - blockStart;
      if (diff > 0) {
        driftCount += 1;
        totalDrift += diff;
      }
    }

    if (driftCount >= 2) {
      const avgDrift = Math.floor(totalDrift / driftCount);
      if (avgDrift > 30) {
        const h = Math.floor(avgDrift / 60);
        const m = avgDrift % 60;
        insights.push({
          kind: "drift",
          message:
            h > 0
              ? `You're starting ~${h}h ${m}m late on average (${driftCount} days this week).`
              : `You're starting ~${m}m late on average (${driftCount} days this week).`,
          severity: "warning",
        });
      }
    }
  }

  // b) Work on days with no scheduled blocks (rolling 4 weeks, ≥3 distinct weeks)
  {
    const scanStartMs = weekStartMs - 4 * 7 * 24 * 60 * 60 * 1000;
    const sessions = await db.getAllAsync<{ started_at: number }>(
      "SELECT started_at FROM session WHERE started_at >= ? AND started_at < ?",
      [scanStartMs, weekEndMs]
    );

    const weekHits = new Set<string>();
    for (const { started_at } of sessions) {
      const dt = new Date(started_at);
      const dow = dt.getDay();
      if (!dowScheduled[dow]) {
        weekHits.add(localMondayWeekKey(dt));
      }
    }

    if (weekHits.size >= 3) {
      insights.push({
        kind: "weekend",
        message: `You've logged work on unscheduled days in ${weekHits.size} of the last several weeks.`,
        severity: "warning",
      });
    }
  }

  // c) Late nights — sessions ending at or after 10:00 PM local
  {
    const sessions = await db.getAllAsync<{ started_at: number; ended_at: number | null }>(
      "SELECT started_at, ended_at FROM session WHERE started_at >= ? AND started_at < ?",
      [weekStartMs, weekEndMs]
    );
    const nowRounded = Math.floor(Date.now() / 1000) * 1000;
    let lateCount = 0;
    for (const s of sessions) {
      const endMs = s.ended_at ?? nowRounded;
      const endMin = minuteOfDayFromMs(endMs);
      if (endMin > 22 * 60) lateCount += 1;
    }
    if (lateCount > 0) {
      insights.push({
        kind: "late_night",
        message: `You had ${lateCount} session${lateCount === 1 ? "" : "s"} ending after 10 PM this week.`,
        severity: "warning",
      });
    }
  }

  // d) Cramming (>50% of weekly hours on one day, that day >1h)
  {
    const dayTotals: Array<{ name: string; ms: number }> = [];
    let weekTotal = 0;
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStartDate);
      day.setDate(weekStartDate.getDate() + i);
      const ds = localMidnightMs(day);
      const de = ds + 24 * 60 * 60 * 1000;
      const worked = await computeActualBetween(db, ds, de);
      dayTotals.push({ name: dayName(day.getDay()), ms: worked });
      weekTotal += worked;
    }

    if (weekTotal > 0) {
      for (const { name, ms } of dayTotals) {
        if (ms > weekTotal / 2 && ms > 60 * 60 * 1000) {
          const pct = Math.round((ms / weekTotal) * 100);
          insights.push({
            kind: "cramming",
            message: `You did ${pct}% of this week's hours on ${name}.`,
            severity: "warning",
          });
          break;
        }
      }
    }
  }

  // e) Missed scheduled days (past calendar days in this week only)
  {
    const todayDate = parseLocalDay(isoDateLocal(now));
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStartDate);
      day.setDate(weekStartDate.getDate() + i);
      if (day >= todayDate) break;

      const weekday = day.getDay();
      const hasBlockRow = await db.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) AS c FROM schedule_block WHERE template_id = ? AND day_of_week = ?",
        [templateId, weekday]
      );
      const hasBlocks = (hasBlockRow?.c ?? 0) > 0;

      const tgtRow = await db.getFirstAsync<{ target_min: number | null }>(
        "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
        [templateId, weekday]
      );
      const hasTarget = (tgtRow?.target_min ?? 0) > 0;

      if (!hasBlocks && !hasTarget) continue;

      const ds = localMidnightMs(day);
      const de = ds + 24 * 60 * 60 * 1000;
      const worked = await computeActualBetween(db, ds, de);

      if (worked < 60_000) {
        insights.push({
          kind: "missed",
          message: `You didn't clock in on ${dayLabelShort(weekday)}.`,
          severity: "info",
        });
      }
    }
  }

  // f) Target streak (positive)
  {
    let streak = 0;
    const check = new Date(todayStart);
    check.setDate(check.getDate() - 1);
    const horizonMs = 30 * 24 * 60 * 60 * 1000;

    for (;;) {
      if (todayStart - localMidnightMs(check) > horizonMs) break;

      const weekday = check.getDay();
      const dayTargetMs = await effectiveDayTargetMs(db, templateId, weekday);
      if (dayTargetMs === 0) {
        check.setDate(check.getDate() - 1);
        continue;
      }

      const ds = localMidnightMs(check);
      const de = ds + 24 * 60 * 60 * 1000;
      const worked = await computeActualBetween(db, ds, de);

      if (worked >= dayTargetMs - 60_000) {
        streak += 1;
        check.setDate(check.getDate() - 1);
      } else {
        break;
      }
    }

    if (streak >= 3) {
      insights.push({
        kind: "streak",
        message: `You've followed your schedule for ${streak} days straight!`,
        severity: "positive",
      });
    }
  }

  return insights;
}
