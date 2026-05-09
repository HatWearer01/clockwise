use chrono::{Duration, Local, TimeZone};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Acquire, Row, SqlitePool};
use std::path::Path;
use std::str::FromStr;
use tauri_plugin_sql::{Migration, MigrationKind};

pub fn now_ms() -> i64 {
    let ms = chrono::Utc::now().timestamp_millis();
    (ms / 1000) * 1000
}

pub fn sqlite_url_from_path(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if normalized.starts_with('/') {
        format!("sqlite://{normalized}")
    } else {
        format!("sqlite:///{normalized}")
    }
}

pub async fn connect_pool(db_url: &str) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::from_str(db_url)
        .map_err(|e| e.to_string())?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal);
    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|e| e.to_string())
}

pub const BASE_SCHEMA_SQL: &str = r#"
        CREATE TABLE IF NOT EXISTS session (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          block_id INTEGER REFERENCES schedule_block(id),
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS schedule (
          day_of_week INTEGER PRIMARY KEY,
          enabled INTEGER NOT NULL,
          start_min INTEGER NOT NULL,
          end_min INTEGER NOT NULL
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
          PRIMARY KEY(session_id, item_id),
          FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE,
          FOREIGN KEY(item_id) REFERENCES block_checklist_item(id) ON DELETE CASCADE
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
"#;

pub fn plugin_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "init_clockwise_schema",
        sql: BASE_SCHEMA_SQL,
        kind: MigrationKind::Up,
    }]
}

pub fn start_of_workday_window() -> Result<(i64, i64), String> {
    let now = Local::now();
    let today = now.date_naive();
    let start_naive = today
        .and_hms_opt(0, 0, 0)
        .ok_or("failed to build workday start timestamp")?;
    let start = Local
        .from_local_datetime(&start_naive)
        .earliest()
        .ok_or("failed to resolve local workday start timestamp")?;
    let end = start + Duration::days(1);
    Ok((start.timestamp_millis(), end.timestamp_millis()))
}

pub async fn init_db(pool: &SqlitePool) -> Result<(), String> {
    // Ensure all tables exist (IF NOT EXISTS makes this idempotent with plugin migrations)
    for stmt in BASE_SCHEMA_SQL.split(';') {
        let trimmed = stmt.trim();
        if trimmed.is_empty() {
            continue;
        }
        sqlx::query(trimmed)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    let mut session_has_block_id = false;
    let mut session_has_notes = false;
    let info_rows = sqlx::query("PRAGMA table_info(session)")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    for row in &info_rows {
        let name: String = row.try_get(1).map_err(|e| e.to_string())?;
        if name == "block_id" {
            session_has_block_id = true;
        }
        if name == "notes" {
            session_has_notes = true;
        }
    }
    if !session_has_block_id {
        sqlx::query("ALTER TABLE session ADD COLUMN block_id INTEGER")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    if !session_has_notes {
        sqlx::query("ALTER TABLE session ADD COLUMN notes TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    let mut has_block_fk = false;
    let fk_rows = sqlx::query("PRAGMA foreign_key_list(session)")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    for row in fk_rows {
        let table_name: String = row.try_get(2).map_err(|e| e.to_string())?;
        let from_col: String = row.try_get(3).map_err(|e| e.to_string())?;
        if table_name == "schedule_block" && from_col == "block_id" {
            has_block_fk = true;
            break;
        }
    }
    if !has_block_fk {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        sqlx::query("PRAGMA foreign_keys=OFF")
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        // Clean up leftover from a previous crashed migration attempt
        sqlx::query("DROP TABLE IF EXISTS session_new")
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
        let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
        sqlx::query(
            "CREATE TABLE session_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              started_at INTEGER NOT NULL,
              ended_at INTEGER,
              block_id INTEGER REFERENCES schedule_block(id),
              notes TEXT
            )",
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT INTO session_new (id, started_at, ended_at, block_id, notes)
             SELECT id, started_at, ended_at, block_id, notes
             FROM session",
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        sqlx::query("DROP TABLE session")
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("ALTER TABLE session_new RENAME TO session")
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT OR REPLACE INTO sqlite_sequence(name, seq)
             SELECT 'session', COALESCE(MAX(id), 0) FROM session",
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
        sqlx::query("PRAGMA foreign_keys=ON")
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Ensure recurring_task table exists (for pre-existing DBs)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS recurring_task (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          recurrence_type TEXT NOT NULL,
          recurrence_days TEXT,
          interval_days INTEGER,
          start_date TEXT NOT NULL,
          end_date TEXT,
          created_at INTEGER NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut daily_task_has_recurring = false;
    let dt_info = sqlx::query("PRAGMA table_info(daily_task)")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    for row in &dt_info {
        let name: String = row.try_get(1).map_err(|e| e.to_string())?;
        if name == "recurring_task_id" {
            daily_task_has_recurring = true;
        }
    }
    if !daily_task_has_recurring {
        sqlx::query("ALTER TABLE daily_task ADD COLUMN recurring_task_id INTEGER REFERENCES recurring_task(id)")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schedule_day_target (
          template_id INTEGER NOT NULL,
          day_of_week INTEGER NOT NULL,
          target_min INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(template_id, day_of_week),
          FOREIGN KEY(template_id) REFERENCES schedule_template(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS subtask (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          text TEXT NOT NULL,
          done INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL,
          FOREIGN KEY(task_id) REFERENCES daily_task(id) ON DELETE CASCADE
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS notification_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          action_kind TEXT,
          created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let count: i64 = sqlx::query("SELECT COUNT(*) FROM schedule")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?
        .try_get(0)
        .map_err(|e| e.to_string())?;

    if count == 0 {
        for day in 0..=6 {
            let enabled = if (1..=5).contains(&day) { 1 } else { 0 };
            sqlx::query("INSERT INTO schedule (day_of_week, enabled, start_min, end_min) VALUES (?, ?, 540, 1020)")
                .bind(day)
                .bind(enabled)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    let template_count: i64 = sqlx::query("SELECT COUNT(*) FROM schedule_template")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?
        .try_get(0)
        .map_err(|e| e.to_string())?;
    if template_count == 0 {
        let created_at = now_ms();
        let insert = sqlx::query("INSERT INTO schedule_template (name, is_active, created_at) VALUES ('Normal week', 1, ?)")
            .bind(created_at)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        let template_id = insert.last_insert_rowid();

        let rows = sqlx::query("SELECT day_of_week, enabled, start_min, end_min FROM schedule ORDER BY day_of_week")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
        for row in rows {
            let day: i64 = row.try_get(0).map_err(|e| e.to_string())?;
            let enabled: i64 = row.try_get(1).map_err(|e| e.to_string())?;
            let start_min: i64 = row.try_get(2).map_err(|e| e.to_string())?;
            let end_min: i64 = row.try_get(3).map_err(|e| e.to_string())?;
            if enabled == 1 {
                sqlx::query(
                    "INSERT INTO schedule_block (template_id, day_of_week, start_min, end_min, label, color)
                     VALUES (?, ?, ?, ?, 'Work block', '#34D399')",
                )
                .bind(template_id)
                .bind(day)
                .bind(start_min)
                .bind(end_min)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_pool;

    #[tokio::test]
    async fn init_db_creates_all_tables() {
        let pool = test_pool().await;
        init_db(&pool).await.unwrap();

        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert!(tables.contains(&"session".to_string()));
        assert!(tables.contains(&"session_pause".to_string()));
        assert!(tables.contains(&"schedule".to_string()));
        assert!(tables.contains(&"schedule_template".to_string()));
        assert!(tables.contains(&"schedule_block".to_string()));
        assert!(tables.contains(&"schedule_day_target".to_string()));
        assert!(tables.contains(&"block_checklist_item".to_string()));
        assert!(tables.contains(&"app_meta".to_string()));
        assert!(tables.contains(&"settings".to_string()));
        assert!(tables.contains(&"session_checklist_state".to_string()));
        assert!(tables.contains(&"recurring_task".to_string()));
        assert!(tables.contains(&"subtask".to_string()));
    }

    #[tokio::test]
    async fn init_db_is_idempotent() {
        let pool = test_pool().await;
        init_db(&pool).await.unwrap();
        init_db(&pool).await.unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_template")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "Should still have exactly one template after double init");
    }

    #[tokio::test]
    async fn init_db_seeds_default_schedule() {
        let pool = test_pool().await;
        init_db(&pool).await.unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 7, "All 7 days should be populated");

        let enabled_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule WHERE enabled = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(enabled_count, 5, "Mon-Fri should be enabled");
    }

    #[tokio::test]
    async fn init_db_seeds_normal_week_template() {
        let pool = test_pool().await;
        init_db(&pool).await.unwrap();

        let name: String =
            sqlx::query_scalar("SELECT name FROM schedule_template WHERE is_active = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(name, "Normal week");
    }

    #[tokio::test]
    async fn init_db_creates_blocks_from_schedule() {
        let pool = test_pool().await;
        init_db(&pool).await.unwrap();

        let block_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_block")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(block_count, 5, "Blocks should be created for Mon-Fri");

        let block_start: i64 = sqlx::query_scalar(
            "SELECT start_min FROM schedule_block ORDER BY day_of_week LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(block_start, 540, "Default start should be 9:00 (540 min)");

        let block_end: i64 = sqlx::query_scalar(
            "SELECT end_min FROM schedule_block ORDER BY day_of_week LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(block_end, 1020, "Default end should be 17:00 (1020 min)");
    }

    #[tokio::test]
    async fn session_table_has_block_id_and_notes_columns() {
        let pool = test_pool().await;
        init_db(&pool).await.unwrap();

        sqlx::query("INSERT INTO session (started_at, ended_at, block_id, notes) VALUES (1000, 2000, NULL, 'test')")
            .execute(&pool)
            .await
            .unwrap();

        let notes: String = sqlx::query_scalar("SELECT notes FROM session WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(notes, "test");
    }

    #[test]
    fn now_ms_is_truncated_to_seconds() {
        let ms = now_ms();
        assert_eq!(ms % 1000, 0);
    }

    #[tokio::test]
    async fn start_of_workday_window_returns_valid_range() {
        let (start, end) = start_of_workday_window().unwrap();
        assert!(end > start);
        assert_eq!(end - start, 24 * 60 * 60 * 1000);
    }
}
