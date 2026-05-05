use std::collections::HashMap;

use chrono::Datelike;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::db::now_ms;
use crate::state::AppState;

use super::session::ApiError;

#[derive(Debug, Serialize)]
pub struct DailyTask {
    pub id: i64,
    pub date: String,
    pub text: String,
    pub done: bool,
    pub done_at: Option<i64>,
    pub created_at: i64,
    pub position: i64,
    pub recurring_task_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecurringTask {
    pub id: i64,
    pub text: String,
    pub recurrence_type: String,
    pub recurrence_days: Option<String>,
    pub interval_days: Option<i64>,
    pub start_date: String,
    pub end_date: Option<String>,
    pub created_at: i64,
    pub active: bool,
}

#[derive(Debug, Serialize)]
pub struct RecurringStatEntry {
    pub total: i64,
    pub done: i64,
}

#[derive(Debug, Serialize)]
pub struct WeekTasksResponse {
    pub days: HashMap<String, Vec<DailyTask>>,
    pub recurring_stats: HashMap<i64, RecurringStatEntry>,
}

fn parse_date(s: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn should_occur_on(rt: &RecurringTask, date: &str) -> bool {
    let target = match parse_date(date) {
        Some(d) => d,
        None => return false,
    };
    let start = match parse_date(&rt.start_date) {
        Some(d) => d,
        None => return false,
    };
    if target < start {
        return false;
    }
    if let Some(ref end) = rt.end_date {
        if let Some(end_d) = parse_date(end) {
            if target > end_d {
                return false;
            }
        }
    }
    match rt.recurrence_type.as_str() {
        "daily" => true,
        "weekdays" => {
            let wd = target.weekday().num_days_from_monday();
            wd < 5
        }
        "specific_days" => {
            if let Some(ref days_str) = rt.recurrence_days {
                let dow = target.weekday().num_days_from_sunday();
                days_str
                    .split(',')
                    .filter_map(|s| s.trim().parse::<u32>().ok())
                    .any(|d| d == dow)
            } else {
                false
            }
        }
        "weekly" => {
            let start_wd = start.weekday().num_days_from_monday();
            let target_wd = target.weekday().num_days_from_monday();
            start_wd == target_wd
        }
        "every_n_days" => {
            if let Some(interval) = rt.interval_days {
                if interval <= 0 {
                    return false;
                }
                let diff = (target - start).num_days();
                diff % interval == 0
            } else {
                false
            }
        }
        _ => false,
    }
}

async fn ensure_recurring_instances(pool: &SqlitePool, date: &str) -> Result<(), ApiError> {
    let recs = sqlx::query(
        "SELECT id, text, recurrence_type, recurrence_days, interval_days, start_date, end_date, created_at, active
         FROM recurring_task WHERE active = 1",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    for row in recs {
        let rt = RecurringTask {
            id: row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?,
            text: row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?,
            recurrence_type: row.try_get(2).map_err(|e| ApiError::from(e.to_string()))?,
            recurrence_days: row.try_get(3).map_err(|e| ApiError::from(e.to_string()))?,
            interval_days: row.try_get(4).map_err(|e| ApiError::from(e.to_string()))?,
            start_date: row.try_get(5).map_err(|e| ApiError::from(e.to_string()))?,
            end_date: row.try_get(6).map_err(|e| ApiError::from(e.to_string()))?,
            created_at: row.try_get(7).map_err(|e| ApiError::from(e.to_string()))?,
            active: row.try_get::<i64, _>(8).map_err(|e| ApiError::from(e.to_string()))? != 0,
        };

        if !should_occur_on(&rt, date) {
            continue;
        }

        let existing: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM daily_task WHERE recurring_task_id = ? AND date = ?",
        )
        .bind(rt.id)
        .bind(date)
        .fetch_one(pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;

        if existing == 0 {
            let max_pos: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(position), -1) FROM daily_task WHERE date = ?",
            )
            .bind(date)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;

            sqlx::query(
                "INSERT INTO daily_task (date, text, done, done_at, created_at, position, recurring_task_id)
                 VALUES (?, ?, 0, NULL, ?, ?, ?)",
            )
            .bind(date)
            .bind(&rt.text)
            .bind(now_ms())
            .bind(max_pos + 1)
            .bind(rt.id)
            .execute(pool)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
        }
    }

    Ok(())
}

fn row_to_daily_task(row: &sqlx::sqlite::SqliteRow) -> Result<DailyTask, ApiError> {
    Ok(DailyTask {
        id: row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?,
        date: row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?,
        text: row.try_get(2).map_err(|e| ApiError::from(e.to_string()))?,
        done: row.try_get::<i64, _>(3).map_err(|e| ApiError::from(e.to_string()))? != 0,
        done_at: row.try_get(4).map_err(|e| ApiError::from(e.to_string()))?,
        created_at: row.try_get(5).map_err(|e| ApiError::from(e.to_string()))?,
        position: row.try_get(6).map_err(|e| ApiError::from(e.to_string()))?,
        recurring_task_id: row.try_get(7).map_err(|e| ApiError::from(e.to_string()))?,
    })
}

#[tauri::command]
pub async fn get_daily_tasks(
    state: tauri::State<'_, AppState>,
    date: String,
) -> Result<Vec<DailyTask>, ApiError> {
    ensure_recurring_instances(&state.pool, &date).await?;

    let rows = sqlx::query(
        "SELECT id, date, text, done, done_at, created_at, position, recurring_task_id
         FROM daily_task
         WHERE date = ?
         ORDER BY done ASC, position ASC, created_at ASC",
    )
    .bind(&date)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    rows.iter().map(row_to_daily_task).collect()
}

#[tauri::command]
pub async fn add_daily_task(
    state: tauri::State<'_, AppState>,
    date: String,
    text: String,
) -> Result<DailyTask, ApiError> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err(ApiError::from("Task text cannot be empty."));
    }

    let now = now_ms();
    let max_pos: i64 = sqlx::query("SELECT COALESCE(MAX(position), -1) FROM daily_task WHERE date = ?")
        .bind(&date)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?
        .try_get(0)
        .map_err(|e| ApiError::from(e.to_string()))?;

    let position = max_pos + 1;
    let result = sqlx::query(
        "INSERT INTO daily_task (date, text, done, done_at, created_at, position, recurring_task_id)
         VALUES (?, ?, 0, NULL, ?, ?, NULL)",
    )
    .bind(&date)
    .bind(&trimmed)
    .bind(now)
    .bind(position)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    Ok(DailyTask {
        id: result.last_insert_rowid(),
        date,
        text: trimmed,
        done: false,
        done_at: None,
        created_at: now,
        position,
        recurring_task_id: None,
    })
}

#[tauri::command]
pub async fn update_daily_task(
    state: tauri::State<'_, AppState>,
    id: i64,
    text: String,
) -> Result<(), ApiError> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err(ApiError::from("Task text cannot be empty."));
    }
    sqlx::query("UPDATE daily_task SET text = ? WHERE id = ?")
        .bind(&trimmed)
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn toggle_daily_task(
    state: tauri::State<'_, AppState>,
    id: i64,
    done: bool,
) -> Result<(), ApiError> {
    let done_val: i64 = if done { 1 } else { 0 };
    let done_at: Option<i64> = if done { Some(now_ms()) } else { None };
    sqlx::query("UPDATE daily_task SET done = ?, done_at = ? WHERE id = ?")
        .bind(done_val)
        .bind(done_at)
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_daily_task(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM daily_task WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn rollover_daily_task(
    state: tauri::State<'_, AppState>,
    id: i64,
    target_date: String,
) -> Result<(), ApiError> {
    let row = sqlx::query("SELECT done FROM daily_task WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    let Some(row) = row else {
        return Err(ApiError::from("Task not found."));
    };
    let done: i64 = row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?;
    if done != 0 {
        return Err(ApiError::from("Cannot roll over a completed task."));
    }

    let max_pos: i64 = sqlx::query("SELECT COALESCE(MAX(position), -1) FROM daily_task WHERE date = ?")
        .bind(&target_date)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?
        .try_get(0)
        .map_err(|e| ApiError::from(e.to_string()))?;

    sqlx::query("UPDATE daily_task SET date = ?, position = ? WHERE id = ?")
        .bind(&target_date)
        .bind(max_pos + 1)
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

// ── Recurring task CRUD ──────────────────────────────────────────────

fn row_to_recurring_task(row: &sqlx::sqlite::SqliteRow) -> Result<RecurringTask, ApiError> {
    Ok(RecurringTask {
        id: row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?,
        text: row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?,
        recurrence_type: row.try_get(2).map_err(|e| ApiError::from(e.to_string()))?,
        recurrence_days: row.try_get(3).map_err(|e| ApiError::from(e.to_string()))?,
        interval_days: row.try_get(4).map_err(|e| ApiError::from(e.to_string()))?,
        start_date: row.try_get(5).map_err(|e| ApiError::from(e.to_string()))?,
        end_date: row.try_get(6).map_err(|e| ApiError::from(e.to_string()))?,
        created_at: row.try_get(7).map_err(|e| ApiError::from(e.to_string()))?,
        active: row.try_get::<i64, _>(8).map_err(|e| ApiError::from(e.to_string()))? != 0,
    })
}

#[tauri::command]
pub async fn get_recurring_tasks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RecurringTask>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, text, recurrence_type, recurrence_days, interval_days, start_date, end_date, created_at, active
         FROM recurring_task ORDER BY active DESC, created_at DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    rows.iter().map(row_to_recurring_task).collect()
}

#[tauri::command]
pub async fn add_recurring_task(
    state: tauri::State<'_, AppState>,
    text: String,
    recurrence_type: String,
    recurrence_days: Option<String>,
    interval_days: Option<i64>,
    start_date: String,
    end_date: Option<String>,
) -> Result<RecurringTask, ApiError> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err(ApiError::from("Task text cannot be empty."));
    }
    let valid_types = ["daily", "weekdays", "specific_days", "weekly", "every_n_days"];
    if !valid_types.contains(&recurrence_type.as_str()) {
        return Err(ApiError::from("Invalid recurrence type."));
    }
    let now = now_ms();
    let result = sqlx::query(
        "INSERT INTO recurring_task (text, recurrence_type, recurrence_days, interval_days, start_date, end_date, created_at, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&trimmed)
    .bind(&recurrence_type)
    .bind(&recurrence_days)
    .bind(interval_days)
    .bind(&start_date)
    .bind(&end_date)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    Ok(RecurringTask {
        id: result.last_insert_rowid(),
        text: trimmed,
        recurrence_type,
        recurrence_days,
        interval_days,
        start_date,
        end_date,
        created_at: now,
        active: true,
    })
}

#[tauri::command]
pub async fn update_recurring_task(
    state: tauri::State<'_, AppState>,
    id: i64,
    text: String,
    recurrence_type: String,
    recurrence_days: Option<String>,
    interval_days: Option<i64>,
    end_date: Option<String>,
    active: bool,
) -> Result<(), ApiError> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Err(ApiError::from("Task text cannot be empty."));
    }
    let active_val: i64 = if active { 1 } else { 0 };
    sqlx::query(
        "UPDATE recurring_task SET text = ?, recurrence_type = ?, recurrence_days = ?, interval_days = ?, end_date = ?, active = ? WHERE id = ?",
    )
    .bind(&trimmed)
    .bind(&recurrence_type)
    .bind(&recurrence_days)
    .bind(interval_days)
    .bind(&end_date)
    .bind(active_val)
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_recurring_task(
    state: tauri::State<'_, AppState>,
    id: i64,
    delete_instances: bool,
) -> Result<(), ApiError> {
    if delete_instances {
        sqlx::query("DELETE FROM daily_task WHERE recurring_task_id = ?")
            .bind(id)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
    } else {
        sqlx::query("UPDATE daily_task SET recurring_task_id = NULL WHERE recurring_task_id = ?")
            .bind(id)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
    }
    sqlx::query("DELETE FROM recurring_task WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

// ── Week-scoped task query ───────────────────────────────────────────

#[tauri::command]
pub async fn get_tasks_for_week(
    state: tauri::State<'_, AppState>,
    week_start: String,
) -> Result<WeekTasksResponse, ApiError> {
    let monday = parse_date(&week_start)
        .ok_or_else(|| ApiError::from("Invalid week_start date."))?;

    let mut days: HashMap<String, Vec<DailyTask>> = HashMap::new();
    for i in 0..7 {
        let d = monday + chrono::Duration::days(i);
        let date_str = d.format("%Y-%m-%d").to_string();
        ensure_recurring_instances(&state.pool, &date_str).await?;

        let rows = sqlx::query(
            "SELECT id, date, text, done, done_at, created_at, position, recurring_task_id
             FROM daily_task WHERE date = ?
             ORDER BY done ASC, position ASC, created_at ASC",
        )
        .bind(&date_str)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;

        let tasks: Vec<DailyTask> = rows.iter().map(row_to_daily_task).collect::<Result<_, _>>()?;
        days.insert(date_str, tasks);
    }

    let sunday = monday + chrono::Duration::days(6);
    let mon_str = monday.format("%Y-%m-%d").to_string();
    let sun_str = sunday.format("%Y-%m-%d").to_string();
    let stat_rows = sqlx::query(
        "SELECT recurring_task_id, COUNT(*) as total, SUM(done) as done_count
         FROM daily_task
         WHERE recurring_task_id IS NOT NULL AND date >= ? AND date <= ?
         GROUP BY recurring_task_id",
    )
    .bind(&mon_str)
    .bind(&sun_str)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    let mut recurring_stats: HashMap<i64, RecurringStatEntry> = HashMap::new();
    for row in stat_rows {
        let rid: i64 = row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?;
        let total: i64 = row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?;
        let done: i64 = row.try_get(2).map_err(|e| ApiError::from(e.to_string()))?;
        recurring_stats.insert(rid, RecurringStatEntry { total, done });
    }

    Ok(WeekTasksResponse {
        days,
        recurring_stats,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_state;

    #[test]
    fn should_occur_daily() {
        let rt = RecurringTask {
            id: 1, text: "x".into(), recurrence_type: "daily".into(),
            recurrence_days: None, interval_days: None,
            start_date: "2026-05-01".into(), end_date: None,
            created_at: 0, active: true,
        };
        assert!(should_occur_on(&rt, "2026-05-01"));
        assert!(should_occur_on(&rt, "2026-05-04"));
        assert!(should_occur_on(&rt, "2026-06-15"));
        assert!(!should_occur_on(&rt, "2026-04-30"));
    }

    #[test]
    fn should_occur_weekdays() {
        let rt = RecurringTask {
            id: 1, text: "x".into(), recurrence_type: "weekdays".into(),
            recurrence_days: None, interval_days: None,
            start_date: "2026-05-01".into(), end_date: None,
            created_at: 0, active: true,
        };
        assert!(should_occur_on(&rt, "2026-05-04")); // Monday
        assert!(should_occur_on(&rt, "2026-05-05")); // Tuesday
        assert!(!should_occur_on(&rt, "2026-05-03")); // Sunday
        assert!(!should_occur_on(&rt, "2026-05-09")); // Saturday
    }

    #[test]
    fn should_occur_specific_days() {
        let rt = RecurringTask {
            id: 1, text: "x".into(), recurrence_type: "specific_days".into(),
            recurrence_days: Some("1,3,5".into()), // Mon, Wed, Fri (JS-style 0=Sun)
            interval_days: None,
            start_date: "2026-05-01".into(), end_date: None,
            created_at: 0, active: true,
        };
        assert!(should_occur_on(&rt, "2026-05-04")); // Monday=1
        assert!(should_occur_on(&rt, "2026-05-06")); // Wednesday=3
        assert!(should_occur_on(&rt, "2026-05-08")); // Friday=5
        assert!(!should_occur_on(&rt, "2026-05-05")); // Tuesday=2
        assert!(!should_occur_on(&rt, "2026-05-03")); // Sunday=0
    }

    #[test]
    fn should_occur_weekly() {
        let rt = RecurringTask {
            id: 1, text: "x".into(), recurrence_type: "weekly".into(),
            recurrence_days: None, interval_days: None,
            start_date: "2026-05-04".into(), end_date: None, // Monday
            created_at: 0, active: true,
        };
        assert!(should_occur_on(&rt, "2026-05-04"));
        assert!(should_occur_on(&rt, "2026-05-11")); // next Monday
        assert!(!should_occur_on(&rt, "2026-05-05")); // Tuesday
    }

    #[test]
    fn should_occur_every_n_days() {
        let rt = RecurringTask {
            id: 1, text: "x".into(), recurrence_type: "every_n_days".into(),
            recurrence_days: None, interval_days: Some(3),
            start_date: "2026-05-01".into(), end_date: None,
            created_at: 0, active: true,
        };
        assert!(should_occur_on(&rt, "2026-05-01"));
        assert!(!should_occur_on(&rt, "2026-05-02"));
        assert!(!should_occur_on(&rt, "2026-05-03"));
        assert!(should_occur_on(&rt, "2026-05-04"));
        assert!(should_occur_on(&rt, "2026-05-07"));
    }

    #[test]
    fn end_date_stops_recurrence() {
        let rt = RecurringTask {
            id: 1, text: "x".into(), recurrence_type: "daily".into(),
            recurrence_days: None, interval_days: None,
            start_date: "2026-05-01".into(), end_date: Some("2026-05-05".into()),
            created_at: 0, active: true,
        };
        assert!(should_occur_on(&rt, "2026-05-05"));
        assert!(!should_occur_on(&rt, "2026-05-06"));
    }

    #[tokio::test]
    async fn auto_instantiation_creates_recurring_instances() {
        let state = test_state().await;

        sqlx::query(
            "INSERT INTO recurring_task (text, recurrence_type, recurrence_days, interval_days, start_date, end_date, created_at, active)
             VALUES ('Stand up', 'daily', NULL, NULL, '2026-05-01', NULL, 1000, 1)",
        )
        .execute(&state.pool)
        .await
        .unwrap();

        ensure_recurring_instances(&state.pool, "2026-05-04").await.unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM daily_task WHERE date = '2026-05-04' AND recurring_task_id IS NOT NULL")
            .fetch_one(&state.pool).await.unwrap();
        assert_eq!(count, 1);

        // Idempotent
        ensure_recurring_instances(&state.pool, "2026-05-04").await.unwrap();
        let count2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM daily_task WHERE date = '2026-05-04' AND recurring_task_id IS NOT NULL")
            .fetch_one(&state.pool).await.unwrap();
        assert_eq!(count2, 1);
    }

    #[tokio::test]
    async fn get_tasks_for_week_returns_all_days() {
        let state = test_state().await;

        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position) VALUES ('2026-05-04', 'Mon task', 0, 1000, 0)",
        )
        .execute(&state.pool).await.unwrap();
        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position) VALUES ('2026-05-06', 'Wed task', 0, 1000, 0)",
        )
        .execute(&state.pool).await.unwrap();

        let mut days: HashMap<String, Vec<DailyTask>> = HashMap::new();
        let monday = parse_date("2026-05-04").unwrap();
        for i in 0..7 {
            let d = monday + chrono::Duration::days(i);
            let date_str = d.format("%Y-%m-%d").to_string();
            let rows = sqlx::query(
                "SELECT id, date, text, done, done_at, created_at, position, recurring_task_id
                 FROM daily_task WHERE date = ? ORDER BY position",
            )
            .bind(&date_str)
            .fetch_all(&state.pool).await.unwrap();
            let tasks: Vec<DailyTask> = rows.iter().map(row_to_daily_task).collect::<Result<_, _>>().unwrap();
            days.insert(date_str, tasks);
        }

        assert_eq!(days.len(), 7);
        assert_eq!(days["2026-05-04"].len(), 1);
        assert_eq!(days["2026-05-06"].len(), 1);
        assert_eq!(days["2026-05-05"].len(), 0);
    }

    #[tokio::test]
    async fn recurring_stats_aggregates_week() {
        let state = test_state().await;

        sqlx::query(
            "INSERT INTO recurring_task (text, recurrence_type, recurrence_days, interval_days, start_date, end_date, created_at, active)
             VALUES ('Daily standup', 'daily', NULL, NULL, '2026-05-01', NULL, 1000, 1)",
        )
        .execute(&state.pool).await.unwrap();

        let rid: i64 = sqlx::query_scalar("SELECT id FROM recurring_task LIMIT 1")
            .fetch_one(&state.pool).await.unwrap();

        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position, recurring_task_id) VALUES ('2026-05-04', 'Daily standup', 1, 1000, 0, ?)",
        ).bind(rid).execute(&state.pool).await.unwrap();
        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position, recurring_task_id) VALUES ('2026-05-05', 'Daily standup', 0, 1000, 0, ?)",
        ).bind(rid).execute(&state.pool).await.unwrap();
        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position, recurring_task_id) VALUES ('2026-05-06', 'Daily standup', 1, 1000, 0, ?)",
        ).bind(rid).execute(&state.pool).await.unwrap();

        let stat_rows = sqlx::query(
            "SELECT recurring_task_id, COUNT(*) as total, SUM(done) as done_count
             FROM daily_task WHERE recurring_task_id IS NOT NULL AND date >= '2026-05-04' AND date <= '2026-05-10'
             GROUP BY recurring_task_id",
        )
        .fetch_all(&state.pool).await.unwrap();

        assert_eq!(stat_rows.len(), 1);
        let total: i64 = stat_rows[0].try_get(1).unwrap();
        let done: i64 = stat_rows[0].try_get(2).unwrap();
        assert_eq!(total, 3);
        assert_eq!(done, 2);
    }

    #[tokio::test]
    async fn delete_recurring_task_with_instances() {
        let state = test_state().await;

        sqlx::query(
            "INSERT INTO recurring_task (text, recurrence_type, recurrence_days, interval_days, start_date, end_date, created_at, active)
             VALUES ('x', 'daily', NULL, NULL, '2026-05-01', NULL, 1000, 1)",
        )
        .execute(&state.pool).await.unwrap();
        let rid: i64 = sqlx::query_scalar("SELECT id FROM recurring_task LIMIT 1")
            .fetch_one(&state.pool).await.unwrap();

        sqlx::query("INSERT INTO daily_task (date, text, done, created_at, position, recurring_task_id) VALUES ('2026-05-04', 'x', 0, 1000, 0, ?)")
            .bind(rid).execute(&state.pool).await.unwrap();

        // delete_instances = true
        sqlx::query("DELETE FROM daily_task WHERE recurring_task_id = ?").bind(rid).execute(&state.pool).await.unwrap();
        sqlx::query("DELETE FROM recurring_task WHERE id = ?").bind(rid).execute(&state.pool).await.unwrap();

        let task_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM daily_task").fetch_one(&state.pool).await.unwrap();
        let rec_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recurring_task").fetch_one(&state.pool).await.unwrap();
        assert_eq!(task_count, 0);
        assert_eq!(rec_count, 0);
    }

    #[tokio::test]
    async fn add_and_get_daily_tasks() {
        let state = test_state().await;
        let date = "2026-05-04".to_string();

        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position) VALUES (?, 'Task 1', 0, 1000, 0)",
        )
        .bind(&date)
        .execute(&state.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position) VALUES (?, 'Task 2', 0, 2000, 1)",
        )
        .bind(&date)
        .execute(&state.pool)
        .await
        .unwrap();

        let rows: Vec<(String, i64)> = sqlx::query("SELECT text, position FROM daily_task WHERE date = ? ORDER BY position")
            .bind(&date)
            .fetch_all(&state.pool)
            .await
            .unwrap()
            .iter()
            .map(|r| (r.try_get(0).unwrap(), r.try_get(1).unwrap()))
            .collect();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "Task 1");
        assert_eq!(rows[1].0, "Task 2");
    }

    #[tokio::test]
    async fn toggle_daily_task_sets_done() {
        let state = test_state().await;
        let date = "2026-05-04".to_string();

        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position) VALUES (?, 'Task', 0, 1000, 0)",
        )
        .bind(&date)
        .execute(&state.pool)
        .await
        .unwrap();

        let id: i64 = sqlx::query_scalar("SELECT id FROM daily_task LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("UPDATE daily_task SET done = 1, done_at = 2000 WHERE id = ?")
            .bind(id)
            .execute(&state.pool)
            .await
            .unwrap();

        let done: i64 = sqlx::query_scalar("SELECT done FROM daily_task WHERE id = ?")
            .bind(id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(done, 1);

        sqlx::query("UPDATE daily_task SET done = 0, done_at = NULL WHERE id = ?")
            .bind(id)
            .execute(&state.pool)
            .await
            .unwrap();

        let done: i64 = sqlx::query_scalar("SELECT done FROM daily_task WHERE id = ?")
            .bind(id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(done, 0);
    }

    #[tokio::test]
    async fn rollover_moves_task_to_new_date() {
        let state = test_state().await;

        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position) VALUES ('2026-05-04', 'Carry over', 0, 1000, 0)",
        )
        .execute(&state.pool)
        .await
        .unwrap();

        let id: i64 = sqlx::query_scalar("SELECT id FROM daily_task LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("UPDATE daily_task SET date = '2026-05-05', position = 0 WHERE id = ?")
            .bind(id)
            .execute(&state.pool)
            .await
            .unwrap();

        let new_date: String = sqlx::query_scalar("SELECT date FROM daily_task WHERE id = ?")
            .bind(id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(new_date, "2026-05-05");

        let count_old: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM daily_task WHERE date = '2026-05-04'")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(count_old, 0);
    }

    #[tokio::test]
    async fn rollover_blocked_for_done_tasks() {
        let state = test_state().await;

        sqlx::query(
            "INSERT INTO daily_task (date, text, done, done_at, created_at, position) VALUES ('2026-05-04', 'Done task', 1, 2000, 1000, 0)",
        )
        .execute(&state.pool)
        .await
        .unwrap();

        let done: i64 = sqlx::query_scalar("SELECT done FROM daily_task LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(done, 1, "Completed tasks should not be rolled over");
    }

    #[tokio::test]
    async fn delete_daily_task_removes_row() {
        let state = test_state().await;

        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position) VALUES ('2026-05-04', 'Delete me', 0, 1000, 0)",
        )
        .execute(&state.pool)
        .await
        .unwrap();

        let id: i64 = sqlx::query_scalar("SELECT id FROM daily_task LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("DELETE FROM daily_task WHERE id = ?")
            .bind(id)
            .execute(&state.pool)
            .await
            .unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM daily_task")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn done_tasks_sort_after_incomplete() {
        let state = test_state().await;
        let date = "2026-05-04".to_string();

        sqlx::query(
            "INSERT INTO daily_task (date, text, done, done_at, created_at, position) VALUES (?, 'Done first', 1, 2000, 1000, 0)",
        )
        .bind(&date)
        .execute(&state.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO daily_task (date, text, done, created_at, position) VALUES (?, 'Not done', 0, 3000, 1)",
        )
        .bind(&date)
        .execute(&state.pool)
        .await
        .unwrap();

        let rows: Vec<(String, i64)> = sqlx::query(
            "SELECT text, done FROM daily_task WHERE date = ? ORDER BY done ASC, position ASC",
        )
        .bind(&date)
        .fetch_all(&state.pool)
        .await
        .unwrap()
        .iter()
        .map(|r| (r.try_get(0).unwrap(), r.try_get(1).unwrap()))
        .collect();

        assert_eq!(rows[0].0, "Not done");
        assert_eq!(rows[0].1, 0);
        assert_eq!(rows[1].0, "Done first");
        assert_eq!(rows[1].1, 1);
    }
}
