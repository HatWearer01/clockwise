import { getDb } from "../db/connection";
import type {
  DailyTask,
  RecurrenceType,
  RecurringTask,
  RecurringStatEntry,
  Subtask,
  WeekTasksResponse,
} from "../types";

function nowMs(): number {
  const ms = Date.now();
  return Math.floor(ms / 1000) * 1000;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYmd(dateStr: string): { y: number; m: number; d: number } | null {
  const m = YMD_RE.exec(dateStr);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Rust `Weekday::num_days_from_monday()` — Monday = 0 … Sunday = 6 */
function daysFromMondayUtc(y: number, mo: number, d: number): number {
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return dow === 0 ? 6 : dow - 1;
}

/** Rust `Weekday::num_days_from_sunday()` — Sunday = 0 … Saturday = 6 (matches JS getUTCDay) */
function jsDayOfWeekUtc(y: number, mo: number, d: number): number {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function calendarDaysBetween(startStr: string, endStr: string): number | null {
  const a = parseYmd(startStr);
  const b = parseYmd(endStr);
  if (!a || !b) return null;
  const t0 = Date.UTC(a.y, a.m - 1, a.d);
  const t1 = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((t1 - t0) / (86_400_000));
}

function shouldOccurOn(rt: RecurringTask, date: string): boolean {
  const targetParts = parseYmd(date);
  const startParts = parseYmd(rt.start_date);
  if (!targetParts || !startParts) return false;

  if (date < rt.start_date) return false;
  if (rt.end_date != null && rt.end_date !== "") {
    if (date > rt.end_date) return false;
  }

  const { y: ty, m: tm, d: td } = targetParts;
  const { y: sy, m: sm, d: sd } = startParts;

  switch (rt.recurrence_type) {
    case "daily":
      return true;
    case "weekdays": {
      const wd = daysFromMondayUtc(ty, tm, td);
      return wd < 5;
    }
    case "specific_days": {
      if (!rt.recurrence_days) return false;
      const dow = jsDayOfWeekUtc(ty, tm, td);
      return rt.recurrence_days
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .some((s) => Number(s) === dow);
    }
    case "weekly": {
      const startWd = daysFromMondayUtc(sy, sm, sd);
      const targetWd = daysFromMondayUtc(ty, tm, td);
      return startWd === targetWd;
    }
    case "every_n_days": {
      const interval = rt.interval_days;
      if (interval == null || interval <= 0) return false;
      const diff = calendarDaysBetween(rt.start_date, date);
      if (diff == null) return false;
      return diff % interval === 0;
    }
    default:
      return false;
  }
}

type DailyTaskRow = {
  id: number;
  date: string;
  text: string;
  done: number;
  done_at: number | null;
  created_at: number;
  position: number;
  recurring_task_id: number | null;
};

type SubtaskRow = {
  id: number;
  task_id: number;
  text: string;
  done: number;
  position: number;
};

function rowToDailyTask(row: DailyTaskRow): DailyTask {
  return {
    id: row.id,
    date: row.date,
    text: row.text,
    done: row.done !== 0,
    done_at: row.done_at,
    created_at: row.created_at,
    position: row.position,
    recurring_task_id: row.recurring_task_id,
    subtasks: [],
  };
}

function rowToSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    task_id: row.task_id,
    text: row.text,
    done: row.done !== 0,
    position: row.position,
  };
}

async function attachSubtasks(tasks: DailyTask[]): Promise<void> {
  if (tasks.length === 0) return;
  const db = await getDb();
  const ids = tasks.map((t) => t.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.getAllAsync<SubtaskRow>(
    `SELECT id, task_id, text, done, position FROM subtask WHERE task_id IN (${placeholders}) ORDER BY position ASC`,
    ids
  );
  const map = new Map<number, Subtask[]>();
  for (const row of rows) {
    const st = rowToSubtask(row);
    const list = map.get(st.task_id);
    if (list) list.push(st);
    else map.set(st.task_id, [st]);
  }
  for (const task of tasks) {
    task.subtasks = map.get(task.id) ?? [];
  }
}

function rowToRecurringTask(row: {
  id: number;
  text: string;
  recurrence_type: string;
  recurrence_days: string | null;
  interval_days: number | null;
  start_date: string;
  end_date: string | null;
  created_at: number;
  active: number;
}): RecurringTask {
  return {
    id: row.id,
    text: row.text,
    recurrence_type: row.recurrence_type as RecurrenceType,
    recurrence_days: row.recurrence_days,
    interval_days: row.interval_days,
    start_date: row.start_date,
    end_date: row.end_date,
    created_at: row.created_at,
    active: row.active !== 0,
  };
}

export async function ensureRecurringInstances(date: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE recurring_task SET active = 0 WHERE active = 1 AND end_date IS NOT NULL AND end_date < ?",
    [date]
  );

  const recRows = await db.getAllAsync<{
    id: number;
    text: string;
    recurrence_type: string;
    recurrence_days: string | null;
    interval_days: number | null;
    start_date: string;
    end_date: string | null;
    created_at: number;
    active: number;
  }>(
    `SELECT id, text, recurrence_type, recurrence_days, interval_days, start_date, end_date, created_at, active
     FROM recurring_task WHERE active = 1`
  );

  for (const row of recRows) {
    const rt = rowToRecurringTask(row);
    if (!shouldOccurOn(rt, date)) continue;

    const existing = await db.getFirstAsync<{ c: number }>(
      "SELECT COUNT(*) as c FROM daily_task WHERE recurring_task_id = ? AND date = ?",
      [rt.id, date]
    );
    if ((existing?.c ?? 0) !== 0) continue;

    const maxRow = await db.getFirstAsync<{ m: number | null }>(
      "SELECT MAX(position) as m FROM daily_task WHERE date = ?",
      [date]
    );
    const maxPos = maxRow?.m != null ? maxRow.m : -1;
    const position = maxPos + 1;
    const createdAt = nowMs();

    await db.runAsync(
      `INSERT INTO daily_task (date, text, done, done_at, created_at, position, recurring_task_id)
       VALUES (?, ?, 0, NULL, ?, ?, ?)`,
      [date, rt.text, createdAt, position, rt.id]
    );
  }
}

export async function getDailyTasks(date: string): Promise<DailyTask[]> {
  await ensureRecurringInstances(date);
  const db = await getDb();
  const rows = await db.getAllAsync<DailyTaskRow>(
    `SELECT id, date, text, done, done_at, created_at, position, recurring_task_id
     FROM daily_task
     WHERE date = ?
     ORDER BY (recurring_task_id IS NULL), done ASC, position ASC, created_at ASC`,
    [date]
  );
  const tasks = rows.map(rowToDailyTask);
  await attachSubtasks(tasks);
  return tasks;
}

export async function addDailyTask(date: string, text: string): Promise<DailyTask> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Task text cannot be empty.");

  const db = await getDb();
  const now = nowMs();
  const maxRow = await db.getFirstAsync<{ m: number | null }>(
    "SELECT MAX(position) as m FROM daily_task WHERE date = ?",
    [date]
  );
  const maxPos = maxRow?.m != null ? maxRow.m : -1;
  const position = maxPos + 1;

  const result = await db.runAsync(
    `INSERT INTO daily_task (date, text, done, done_at, created_at, position, recurring_task_id)
     VALUES (?, ?, 0, NULL, ?, ?, NULL)`,
    [date, trimmed, now, position]
  );

  return {
    id: Number(result.lastInsertRowId),
    date,
    text: trimmed,
    done: false,
    done_at: null,
    created_at: now,
    position,
    recurring_task_id: null,
    subtasks: [],
  };
}

export async function updateDailyTask(id: number, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Task text cannot be empty.");
  const db = await getDb();
  await db.runAsync("UPDATE daily_task SET text = ? WHERE id = ?", [trimmed, id]);
}

export async function toggleDailyTask(id: number, done: boolean): Promise<void> {
  const db = await getDb();
  const doneVal = done ? 1 : 0;
  const doneAt = done ? nowMs() : null;
  await db.runAsync("UPDATE daily_task SET done = ?, done_at = ? WHERE id = ?", [doneVal, doneAt, id]);
}

export async function deleteDailyTask(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM subtask WHERE task_id = ?", [id]);
  await db.runAsync("DELETE FROM daily_task WHERE id = ?", [id]);
}

export async function rolloverDailyTask(id: number, targetDate: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ done: number }>("SELECT done FROM daily_task WHERE id = ?", [id]);
  if (!row) throw new Error("Task not found.");
  if (row.done !== 0) throw new Error("Cannot roll over a completed task.");

  const maxRow = await db.getFirstAsync<{ m: number | null }>(
    "SELECT MAX(position) as m FROM daily_task WHERE date = ?",
    [targetDate]
  );
  const maxPos = maxRow?.m != null ? maxRow.m : -1;
  await db.runAsync("UPDATE daily_task SET date = ?, position = ? WHERE id = ?", [
    targetDate,
    maxPos + 1,
    id,
  ]);
}

export async function addSubtask(taskId: number, text: string): Promise<Subtask> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Subtask text cannot be empty.");
  const db = await getDb();
  const maxRow = await db.getFirstAsync<{ m: number | null }>(
    "SELECT MAX(position) as m FROM subtask WHERE task_id = ?",
    [taskId]
  );
  const maxPos = maxRow?.m != null ? maxRow.m : -1;
  const position = maxPos + 1;

  const result = await db.runAsync(
    "INSERT INTO subtask (task_id, text, done, position) VALUES (?, ?, 0, ?)",
    [taskId, trimmed, position]
  );

  return {
    id: Number(result.lastInsertRowId),
    task_id: taskId,
    text: trimmed,
    done: false,
    position,
  };
}

export async function toggleSubtask(id: number, done: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE subtask SET done = ? WHERE id = ?", [done ? 1 : 0, id]);
}

export async function deleteSubtask(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM subtask WHERE id = ?", [id]);
}

const VALID_RECURRENCE: RecurrenceType[] = [
  "daily",
  "weekdays",
  "specific_days",
  "weekly",
  "every_n_days",
];

export async function getRecurringTasks(): Promise<RecurringTask[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    text: string;
    recurrence_type: string;
    recurrence_days: string | null;
    interval_days: number | null;
    start_date: string;
    end_date: string | null;
    created_at: number;
    active: number;
  }>(
    `SELECT id, text, recurrence_type, recurrence_days, interval_days, start_date, end_date, created_at, active
     FROM recurring_task ORDER BY active DESC, created_at DESC`
  );
  return rows.map(rowToRecurringTask);
}

export async function addRecurringTask(
  text: string,
  recurrenceType: RecurrenceType,
  recurrenceDays: string | null,
  intervalDays: number | null,
  startDate: string,
  endDate: string | null
): Promise<RecurringTask> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Task text cannot be empty.");
  if (!VALID_RECURRENCE.includes(recurrenceType)) throw new Error("Invalid recurrence type.");

  const db = await getDb();
  const now = nowMs();
  const result = await db.runAsync(
    `INSERT INTO recurring_task (text, recurrence_type, recurrence_days, interval_days, start_date, end_date, created_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [trimmed, recurrenceType, recurrenceDays, intervalDays, startDate, endDate, now]
  );

  return {
    id: Number(result.lastInsertRowId),
    text: trimmed,
    recurrence_type: recurrenceType,
    recurrence_days: recurrenceDays,
    interval_days: intervalDays,
    start_date: startDate,
    end_date: endDate,
    created_at: now,
    active: true,
  };
}

export async function updateRecurringTask(
  id: number,
  text: string,
  recurrenceType: RecurrenceType,
  recurrenceDays: string | null,
  intervalDays: number | null,
  endDate: string | null,
  active: boolean
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Task text cannot be empty.");
  const db = await getDb();
  await db.runAsync(
    `UPDATE recurring_task SET text = ?, recurrence_type = ?, recurrence_days = ?, interval_days = ?, end_date = ?, active = ? WHERE id = ?`,
    [trimmed, recurrenceType, recurrenceDays, intervalDays, endDate, active ? 1 : 0, id]
  );
}

export async function deleteRecurringTask(id: number, deleteInstances: boolean): Promise<void> {
  const db = await getDb();
  if (deleteInstances) {
    await db.runAsync("DELETE FROM daily_task WHERE recurring_task_id = ?", [id]);
  } else {
    await db.runAsync("UPDATE daily_task SET recurring_task_id = NULL WHERE recurring_task_id = ?", [id]);
  }
  await db.runAsync("DELETE FROM recurring_task WHERE id = ?", [id]);
}

export async function getTasksForWeek(weekStart: string): Promise<WeekTasksResponse> {
  if (!parseYmd(weekStart)) throw new Error("Invalid week_start date.");

  const days: Record<string, DailyTask[]> = {};
  const monParts = parseYmd(weekStart)!;
  const db = await getDb();

  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(monParts.y, monParts.m - 1, monParts.d + i));
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    const dateStr = `${y}-${mo}-${da}`;

    await ensureRecurringInstances(dateStr);
    const rows = await db.getAllAsync<DailyTaskRow>(
      `SELECT id, date, text, done, done_at, created_at, position, recurring_task_id
       FROM daily_task WHERE date = ?
       ORDER BY (recurring_task_id IS NULL), done ASC, position ASC, created_at ASC`,
      [dateStr]
    );
    const tasks = rows.map(rowToDailyTask);
    await attachSubtasks(tasks);
    days[dateStr] = tasks;
  }

  const sunday = new Date(Date.UTC(monParts.y, monParts.m - 1, monParts.d + 6));
  const sunY = sunday.getUTCFullYear();
  const sunMo = String(sunday.getUTCMonth() + 1).padStart(2, "0");
  const sunD = String(sunday.getUTCDate()).padStart(2, "0");
  const sunStr = `${sunY}-${sunMo}-${sunD}`;
  const monStr = weekStart;

  const statRows = await db.getAllAsync<{
    recurring_task_id: number;
    total: number;
    done_count: number | null;
  }>(
    `SELECT recurring_task_id, COUNT(*) as total, COALESCE(SUM(done), 0) as done_count
     FROM daily_task
     WHERE recurring_task_id IS NOT NULL AND date >= ? AND date <= ?
     GROUP BY recurring_task_id`,
    [monStr, sunStr]
  );

  const recurring_stats: Record<number, RecurringStatEntry> = {};
  for (const row of statRows) {
    recurring_stats[row.recurring_task_id] = {
      total: row.total,
      done: Number(row.done_count ?? 0),
    };
  }

  return { days, recurring_stats };
}
