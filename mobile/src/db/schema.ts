import type { SQLiteDatabase } from "expo-sqlite";

export const SCHEMA_VERSION = 1;

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    block_id INTEGER,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS schedule_template (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule_block (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL,
    label TEXT,
    color TEXT,
    FOREIGN KEY(template_id) REFERENCES schedule_template(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS schedule_day_target (
    template_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    target_min INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(template_id, day_of_week),
    FOREIGN KEY(template_id) REFERENCES schedule_template(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS block_checklist_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY(block_id) REFERENCES schedule_block(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_pause (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    paused_at INTEGER NOT NULL,
    resumed_at INTEGER,
    reason TEXT NOT NULL DEFAULT 'manual',
    FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS session_checklist_state (
    session_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    done_at INTEGER NOT NULL,
    PRIMARY KEY(session_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS daily_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    done_at INTEGER,
    created_at INTEGER NOT NULL,
    position INTEGER NOT NULL,
    recurring_task_id INTEGER REFERENCES recurring_task(id)
  );

  CREATE TABLE IF NOT EXISTS subtask (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES daily_task(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recurring_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    recurrence_type TEXT NOT NULL,
    recurrence_days TEXT,
    interval_days INTEGER,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    action_kind TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedule (
    day_of_week INTEGER PRIMARY KEY,
    enabled INTEGER NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL
  );
`;

export async function initDb(db: SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");

  const stmts = BASE_SCHEMA.split(";").map((s) => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    await db.execAsync(stmt + ";");
  }

  await seedDefaults(db);
}

async function seedDefaults(db: SQLiteDatabase): Promise<void> {
  const scheduleCount = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM schedule");
  if (!scheduleCount || scheduleCount.c === 0) {
    for (let day = 0; day <= 6; day++) {
      const enabled = day >= 1 && day <= 5 ? 1 : 0;
      await db.runAsync("INSERT INTO schedule (day_of_week, enabled, start_min, end_min) VALUES (?, ?, 540, 1020)", [day, enabled]);
    }
  }

  const templateCount = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM schedule_template");
  if (!templateCount || templateCount.c === 0) {
    const now = Math.floor(Date.now() / 1000) * 1000;
    const result = await db.runAsync("INSERT INTO schedule_template (name, is_active, created_at) VALUES ('Normal week', 1, ?)", [now]);
    const templateId = result.lastInsertRowId;

    const rows = await db.getAllAsync<{ day_of_week: number; enabled: number; start_min: number; end_min: number }>(
      "SELECT day_of_week, enabled, start_min, end_min FROM schedule ORDER BY day_of_week"
    );
    for (const row of rows) {
      if (row.enabled === 1) {
        await db.runAsync(
          "INSERT INTO schedule_block (template_id, day_of_week, start_min, end_min, label, color) VALUES (?, ?, ?, ?, 'Work block', '#34D399')",
          [templateId, row.day_of_week, row.start_min, row.end_min]
        );
      }
    }
  }
}
