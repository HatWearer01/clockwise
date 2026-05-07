use std::collections::HashMap;

use chrono::{Datelike, Local, LocalResult, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, SqlitePool};

use crate::commands::schedule::ScheduleBlock;
use crate::db::{now_ms, start_of_workday_window};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub message: String,
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        Self { message }
    }
}

impl From<&str> for ApiError {
    fn from(message: &str) -> Self {
        Self {
            message: message.to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionRecord {
    pub id: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub active_session: Option<SessionRecord>,
    pub worked_today_ms: i64,
    pub break_today_ms: i64,
    pub state: String,
    pub next_boundary_ms: Option<i64>,
    pub paused: bool,
    pub week_done: bool,
    pub day_done: bool,
    pub overnight_session: bool,
    pub target_today_ms: i64,
    pub off_schedule: bool,
}

#[derive(Debug, Serialize)]
pub struct WeekDaySummary {
    pub day_of_week: i64,
    pub label: String,
    pub planned_ms: i64,
    pub actual_ms: i64,
    pub target_ms: i64,
}

#[derive(Debug, Serialize)]
pub struct WeekPoint {
    pub week_label: String,
    pub worked_ms: i64,
    pub week_start_date: String,
}

#[derive(Debug, Serialize)]
pub struct StatsSummary {
    pub week_points: Vec<WeekPoint>,
    pub avg_start_minute: Option<i64>,
    pub avg_end_minute: Option<i64>,
    pub month_total_ms: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct Insight {
    pub kind: String,
    pub message: String,
    pub severity: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct WeeklyReviewDay {
    pub label: String,
    pub target_ms: i64,
    pub actual_ms: i64,
    pub on_time: bool, // started within 30 min of first block
}

#[derive(Debug, Serialize, Clone)]
pub struct WeeklyReview {
    pub week_label: String, // e.g., "Apr 28 – May 4"
    pub days_worked: i64,
    pub days_scheduled: i64,
    pub total_target_ms: i64,
    pub total_actual_ms: i64,
    pub avg_start_minute: Option<i64>,
    pub avg_end_minute: Option<i64>,
    pub on_time_days: i64,          // days where first session started within 30 min of first block
    pub off_schedule_sessions: i64, // sessions started at a time not within any block for that day
    pub day_details: Vec<WeeklyReviewDay>,
    pub insights: Vec<Insight>, // reuse the Insight type from get_insights
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingRecovery {
    pub session_id: i64,
    pub started_at: i64,
    pub suggested_end_at: i64,
}

pub async fn active_session(pool: &SqlitePool) -> Result<Option<SessionRecord>, String> {
    let row = sqlx::query(
        "SELECT id, started_at, ended_at FROM session WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    row.map(|row| {
        Ok(SessionRecord {
            id: row.try_get(0).map_err(|e| e.to_string())?,
            started_at: row.try_get(1).map_err(|e| e.to_string())?,
            ended_at: row.try_get(2).map_err(|e| e.to_string())?,
        })
    })
    .transpose()
}

async fn active_pause_for_session(pool: &SqlitePool, session_id: i64) -> Result<Option<i64>, String> {
    let row = sqlx::query(
        "SELECT paused_at FROM session_pause WHERE session_id = ? AND resumed_at IS NULL ORDER BY paused_at DESC LIMIT 1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    row.map(|r| r.try_get(0).map_err(|e| e.to_string())).transpose()
}

async fn active_template_id(pool: &SqlitePool) -> Result<i64, String> {
    let row = sqlx::query("SELECT id FROM schedule_template WHERE is_active = 1 ORDER BY id LIMIT 1")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    row.try_get(0).map_err(|e| e.to_string())
}

async fn schedule_blocks_for_today(pool: &SqlitePool) -> Result<Vec<ScheduleBlock>, String> {
    let now = Local::now();
    let day = i64::from(now.weekday().num_days_from_sunday());
    let template_id = active_template_id(pool).await?;
    let rows = sqlx::query(
        "SELECT id, template_id, day_of_week, start_min, end_min, COALESCE(label, 'Work block'), COALESCE(color, '#34D399')
         FROM schedule_block
         WHERE template_id = ? AND day_of_week = ?
         ORDER BY start_min, end_min, id",
    )
    .bind(template_id)
    .bind(day)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    rows.into_iter()
        .map(|row| {
            Ok(ScheduleBlock {
                id: row.try_get(0).map_err(|e| e.to_string())?,
                template_id: row.try_get(1).map_err(|e| e.to_string())?,
                day_of_week: row.try_get(2).map_err(|e| e.to_string())?,
                start_min: row.try_get(3).map_err(|e| e.to_string())?,
                end_min: row.try_get(4).map_err(|e| e.to_string())?,
                label: row.try_get(5).map_err(|e| e.to_string())?,
                color: row.try_get(6).map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

fn boundary_timestamp_for_today(minute_of_day: i64) -> Option<i64> {
    boundary_timestamp(minute_of_day, false)
}

fn boundary_timestamp(minute_of_day: i64, tomorrow: bool) -> Option<i64> {
    let now = Local::now();
    let date = if tomorrow {
        now.date_naive() + chrono::Duration::days(1)
    } else {
        now.date_naive()
    };
    let hour = u32::try_from(minute_of_day / 60).ok()?;
    let minute = u32::try_from(minute_of_day % 60).ok()?;
    let naive = date.and_hms_opt(hour, minute, 0)?;
    let datetime = Local.from_local_datetime(&naive).earliest()?;
    Some(datetime.timestamp_millis())
}

fn day_label(day_of_week: i64) -> &'static str {
    match day_of_week {
        0 => "Sun",
        1 => "Mon",
        2 => "Tue",
        3 => "Wed",
        4 => "Thu",
        5 => "Fri",
        _ => "Sat",
    }
}

fn format_review_calendar_day(d: chrono::NaiveDate) -> String {
    format!("{} {}", d.format("%b"), d.day())
}

fn minute_in_any_block(current_minute: i64, blocks: &[ScheduleBlock]) -> bool {
    blocks.iter().any(|block| {
        let is_overnight = block.start_min > block.end_min;
        if is_overnight {
            current_minute >= block.start_min || current_minute < block.end_min
        } else {
            current_minute >= block.start_min && current_minute < block.end_min
        }
    })
}

async fn compute_actual_between(pool: &SqlitePool, start_ms: i64, end_ms: i64) -> Result<i64, String> {
    let now = now_ms();
    let gross: i64 = sqlx::query(
        "SELECT COALESCE(SUM(COALESCE(ended_at, ?) - started_at), 0)
         FROM session
         WHERE started_at >= ? AND started_at < ?",
    )
    .bind(now)
    .bind(start_ms)
    .bind(end_ms)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .try_get(0)
    .map_err(|e| e.to_string())?;
    let pauses: i64 = sqlx::query(
        "SELECT COALESCE(SUM(COALESCE(sp.resumed_at, ?) - sp.paused_at), 0)
         FROM session_pause sp
         JOIN session s ON s.id = sp.session_id
         WHERE s.started_at >= ? AND s.started_at < ?",
    )
    .bind(now)
    .bind(start_ms)
    .bind(end_ms)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .try_get(0)
    .map_err(|e| e.to_string())?;
    Ok((gross - pauses).max(0))
}

pub async fn compute_actual_between_pub(pool: &SqlitePool, start_ms: i64, end_ms: i64) -> Result<i64, String> {
    compute_actual_between(pool, start_ms, end_ms).await
}

#[tauri::command]
pub async fn clock_in(state: tauri::State<'_, AppState>) -> Result<SessionRecord, ApiError> {
    if active_session(&state.pool).await.map_err(ApiError::from)?.is_some() {
        return Err(ApiError::from("You are already clocked in."));
    }

    let started_at = now_ms();
    let today_blocks = schedule_blocks_for_today(&state.pool).await.unwrap_or_default();
    let now_local = Local::now();
    let current_minute = i64::from(now_local.hour()) * 60 + i64::from(now_local.minute());
    let matching_block = today_blocks.iter().find(|b| current_minute >= b.start_min && current_minute < b.end_min);
    let block_id = matching_block.map(|b| b.id);

    let day_done_key = format!("done_day_{}", now_local.format("%Y-%m-%d"));
    let _ = sqlx::query("DELETE FROM app_meta WHERE key = ?")
        .bind(&day_done_key)
        .execute(&state.pool)
        .await;

    let result = sqlx::query("INSERT INTO session (started_at, ended_at, block_id) VALUES (?, NULL, ?)")
        .bind(started_at)
        .bind(block_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;

    Ok(SessionRecord {
        id: result.last_insert_rowid(),
        started_at,
        ended_at: None,
    })
}

#[tauri::command]
pub async fn clock_out(state: tauri::State<'_, AppState>, ended_at: Option<i64>) -> Result<SessionRecord, ApiError> {
    let Some(session) = active_session(&state.pool).await.map_err(ApiError::from)? else {
        return Err(ApiError::from("No active session to clock out from."));
    };

    let ended_at = ended_at.filter(|&t| t >= session.started_at).unwrap_or_else(now_ms);
    sqlx::query("UPDATE session SET ended_at = ? WHERE id = ?")
        .bind(ended_at)
        .bind(session.id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query("UPDATE session_pause SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL")
        .bind(ended_at)
        .bind(session.id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;

    Ok(SessionRecord {
        ended_at: Some(ended_at),
        ..session
    })
}

#[tauri::command]
pub async fn start_break(state: tauri::State<'_, AppState>) -> Result<(), ApiError> {
    let Some(session) = active_session(&state.pool).await.map_err(ApiError::from)? else {
        return Err(ApiError::from("No active session to pause."));
    };
    if active_pause_for_session(&state.pool, session.id)
        .await
        .map_err(ApiError::from)?
        .is_some()
    {
        return Err(ApiError::from("Session is already on break."));
    }
    sqlx::query("INSERT INTO session_pause (session_id, paused_at, reason) VALUES (?, ?, 'manual')")
        .bind(session.id)
        .bind(now_ms())
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn resume_break(state: tauri::State<'_, AppState>) -> Result<(), ApiError> {
    let Some(session) = active_session(&state.pool).await.map_err(ApiError::from)? else {
        return Err(ApiError::from("No active session to resume."));
    };
    let paused_at = active_pause_for_session(&state.pool, session.id)
        .await
        .map_err(ApiError::from)?;
    if paused_at.is_none() {
        return Err(ApiError::from("Session is not currently on break."));
    }
    sqlx::query("UPDATE session_pause SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL")
        .bind(now_ms())
        .bind(session.id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn get_status(state: tauri::State<'_, AppState>) -> Result<StatusResponse, ApiError> {
    let active_session = active_session(&state.pool).await.map_err(ApiError::from)?;
    let now = now_ms();
    let (start, end) = start_of_workday_window().map_err(ApiError::from)?;

    let worked_gross_ms: i64 = sqlx::query(
        "SELECT COALESCE(SUM((COALESCE(ended_at, ?) - started_at)), 0)
         FROM session
         WHERE started_at >= ? AND started_at < ?",
    )
    .bind(now)
    .bind(start)
    .bind(end)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?
    .try_get(0)
    .map_err(|e| ApiError::from(e.to_string()))?;
    let pause_ms: i64 = sqlx::query(
        "SELECT COALESCE(SUM(COALESCE(sp.resumed_at, ?) - sp.paused_at), 0)
         FROM session_pause sp
         JOIN session s ON s.id = sp.session_id
         WHERE s.started_at >= ? AND s.started_at < ?",
    )
    .bind(now)
    .bind(start)
    .bind(end)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?
    .try_get(0)
    .map_err(|e| ApiError::from(e.to_string()))?;
    let worked_today_ms = (worked_gross_ms - pause_ms).max(0);
    let break_today_ms = pause_ms.max(0);

    let today_blocks = schedule_blocks_for_today(&state.pool).await.map_err(ApiError::from)?;
    let now_local = Local::now();
    let current_minute = i64::from(now_local.hour()) * 60 + i64::from(now_local.minute());

    let template_id_for_target = active_template_id(&state.pool).await.unwrap_or(0);
    let day_of_week_today = i64::from(now_local.weekday().num_days_from_sunday());
    let target_min_row: Option<i64> = sqlx::query_scalar(
        "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
    )
    .bind(template_id_for_target)
    .bind(day_of_week_today)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let explicit_target_min = target_min_row.unwrap_or(0);
    let planned_from_blocks_ms: i64 = today_blocks
        .iter()
        .map(|b| {
            if b.end_min > b.start_min {
                (b.end_min - b.start_min) * 60_000
            } else {
                (1440 - b.start_min + b.end_min) * 60_000
            }
        })
        .sum();
    let target_today_ms = if explicit_target_min > 0 {
        explicit_target_min * 60_000
    } else {
        planned_from_blocks_ms
    };

    let paused = if let Some(session) = &active_session {
        active_pause_for_session(&state.pool, session.id)
            .await
            .map_err(ApiError::from)?
            .is_some()
    } else {
        false
    };

    let monday = now_local.date_naive() - chrono::Duration::days(i64::from(now_local.weekday().num_days_from_monday()));
    let done_key = format!("done_week_{}", monday.format("%Y-%m-%d"));
    let week_done = sqlx::query("SELECT 1 FROM app_meta WHERE key = ?")
        .bind(&done_key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?
        .is_some();

    let day_done_key = format!("done_day_{}", now_local.format("%Y-%m-%d"));
    let day_done = sqlx::query("SELECT 1 FROM app_meta WHERE key = ?")
        .bind(&day_done_key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?
        .is_some();

    let (state_name, next_boundary_ms) = if active_session.is_some() && paused {
        ("on_break".to_string(), Some(now + 1_000))
    } else if active_session.is_some() {
        ("on_clock".to_string(), Some(now + 1_000))
    } else if week_done {
        ("week_done".to_string(), None)
    } else if day_done {
        ("day_done".to_string(), None)
    } else {
        let mut next_start: Option<i64> = None;
        let mut current_block_end: Option<i64> = None;
        let mut end_is_tomorrow = false;
        let mut any_block = false;

        for block in &today_blocks {
            any_block = true;
            let is_overnight = block.start_min > block.end_min;

            let in_block = if is_overnight {
                current_minute >= block.start_min || current_minute <= block.end_min
            } else {
                current_minute >= block.start_min && current_minute <= block.end_min
            };

            let before_block = if is_overnight {
                current_minute < block.start_min && current_minute > block.end_min
            } else {
                current_minute < block.start_min
            };

            if before_block {
                next_start = match next_start {
                    Some(existing) => Some(existing.min(block.start_min)),
                    None => Some(block.start_min),
                };
            }
            if in_block {
                if is_overnight && current_minute >= block.start_min {
                    end_is_tomorrow = true;
                }
                current_block_end = match current_block_end {
                    Some(existing) => Some(existing.max(block.end_min)),
                    None => Some(block.end_min),
                };
            }
        }

        if !any_block && explicit_target_min > 0 && worked_today_ms < target_today_ms {
            ("behind_target".to_string(), None)
        } else if !any_block {
            ("off_day".to_string(), None)
        } else if let Some(end_min) = current_block_end {
            ("in_shift".to_string(), boundary_timestamp(end_min, end_is_tomorrow))
        } else if let Some(start_min) = next_start {
            ("before_shift".to_string(), boundary_timestamp_for_today(start_min))
        } else if target_today_ms > 0 && worked_today_ms < target_today_ms {
            ("behind_target".to_string(), None)
        } else {
            ("after_shift".to_string(), None)
        }
    };

    let off_schedule = if active_session.is_some() {
        let in_any_block = today_blocks.iter().any(|block| {
            let is_overnight = block.start_min > block.end_min;
            if is_overnight {
                current_minute >= block.start_min || current_minute < block.end_min
            } else {
                current_minute >= block.start_min && current_minute < block.end_min
            }
        });
        !in_any_block
    } else {
        false
    };

    let overnight_session = active_session
        .as_ref()
        .map(|s| s.started_at < start)
        .unwrap_or(false);

    Ok(StatusResponse {
        active_session,
        worked_today_ms,
        break_today_ms,
        state: state_name,
        next_boundary_ms,
        paused,
        week_done,
        day_done,
        overnight_session,
        target_today_ms,
        off_schedule,
    })
}

fn week_start_date_for(date: chrono::NaiveDate, week_start_day: i64) -> chrono::NaiveDate {
    if week_start_day == 0 {
        let days_since_sunday = i64::from(date.weekday().num_days_from_sunday());
        date - chrono::Duration::days(days_since_sunday)
    } else {
        let days_since_monday = i64::from(date.weekday().num_days_from_monday());
        date - chrono::Duration::days(days_since_monday)
    }
}

#[tauri::command]
pub async fn get_week_summary(
    state: tauri::State<'_, AppState>,
    week_start: Option<String>,
    week_start_day: Option<i64>,
) -> Result<Vec<WeekDaySummary>, ApiError> {
    let template_id = active_template_id(&state.pool).await.map_err(ApiError::from)?;
    let wsd = week_start_day.unwrap_or(1);
    let monday = if let Some(ref ws) = week_start {
        chrono::NaiveDate::parse_from_str(ws, "%Y-%m-%d")
            .map_err(|_| ApiError::from("Invalid week_start date format"))?
    } else {
        let now = Local::now();
        week_start_date_for(now.date_naive(), wsd)
    };

    let mut rows = Vec::new();
    for i in 0..7 {
        let day = monday + chrono::Duration::days(i);
        let day_start = Local
            .from_local_datetime(&day.and_hms_opt(0, 0, 0).ok_or(ApiError::from("Invalid date"))?)
            .earliest()
            .ok_or(ApiError::from("Invalid timezone date"))?
            .timestamp_millis();
        let day_end = day_start + 24 * 60 * 60 * 1000;

        let weekday = i64::from(day.weekday().num_days_from_sunday());
        let planned_ms: i64 = sqlx::query(
            "SELECT COALESCE(SUM(CASE WHEN end_min > start_min THEN (end_min - start_min) * 60000 ELSE (1440 - start_min + end_min) * 60000 END), 0)
             FROM schedule_block
             WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(weekday)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?
        .try_get(0)
        .map_err(|e| ApiError::from(e.to_string()))?;

        let day_target_min: i64 = sqlx::query_scalar(
            "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(weekday)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

        let effective_planned_ms = if day_target_min > 0 {
            day_target_min * 60_000
        } else {
            planned_ms
        };

        let actual_ms = compute_actual_between(&state.pool, day_start, day_end)
            .await
            .map_err(ApiError::from)?;
        rows.push(WeekDaySummary {
            day_of_week: weekday,
            label: day_label(weekday).to_string(),
            planned_ms: effective_planned_ms,
            actual_ms,
            target_ms: day_target_min * 60_000,
        });
    }

    Ok(rows)
}

#[tauri::command]
pub async fn mark_week_done(state: tauri::State<'_, AppState>, done: bool) -> Result<(), ApiError> {
    let now = Local::now();
    let monday = now.date_naive() - chrono::Duration::days(i64::from(now.weekday().num_days_from_monday()));
    let key = format!("done_week_{}", monday.format("%Y-%m-%d"));

    if done {
        sqlx::query(
            "INSERT INTO app_meta (key, value) VALUES (?, '1')
             ON CONFLICT(key) DO UPDATE SET value = '1'",
        )
        .bind(&key)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    } else {
        sqlx::query("DELETE FROM app_meta WHERE key = ?")
            .bind(&key)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn mark_day_done(state: tauri::State<'_, AppState>, done: bool) -> Result<(), ApiError> {
    let now = Local::now();
    let key = format!("done_day_{}", now.format("%Y-%m-%d"));

    if done {
        sqlx::query(
            "INSERT INTO app_meta (key, value) VALUES (?, '1')
             ON CONFLICT(key) DO UPDATE SET value = '1'",
        )
        .bind(&key)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    } else {
        sqlx::query("DELETE FROM app_meta WHERE key = ?")
            .bind(&key)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_day_done(state: tauri::State<'_, AppState>) -> Result<bool, ApiError> {
    let now = Local::now();
    let key = format!("done_day_{}", now.format("%Y-%m-%d"));

    let exists = sqlx::query("SELECT 1 FROM app_meta WHERE key = ?")
        .bind(&key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(exists.is_some())
}

#[tauri::command]
pub async fn is_week_done(state: tauri::State<'_, AppState>) -> Result<bool, ApiError> {
    let now = Local::now();
    let monday = now.date_naive() - chrono::Duration::days(i64::from(now.weekday().num_days_from_monday()));
    let key = format!("done_week_{}", monday.format("%Y-%m-%d"));

    let exists = sqlx::query("SELECT 1 FROM app_meta WHERE key = ?")
        .bind(&key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(exists.is_some())
}

#[tauri::command]
pub async fn get_stats_summary(
    state: tauri::State<'_, AppState>,
    week_start_day: Option<i64>,
) -> Result<StatsSummary, ApiError> {
    let now = Local::now();
    let wsd = week_start_day.unwrap_or(1);

    let mut week_points = Vec::new();
    for offset in (0..8).rev() {
        let week_start_date = week_start_date_for(now.date_naive(), wsd)
            - chrono::Duration::days(i64::from(offset * 7));
        let week_start = Local
            .from_local_datetime(
                &week_start_date
                    .and_hms_opt(0, 0, 0)
                    .ok_or(ApiError::from("Invalid week start"))?,
            )
            .earliest()
            .ok_or(ApiError::from("Invalid timezone week start"))?
            .timestamp_millis();
        let week_end = week_start + 7 * 24 * 60 * 60 * 1000;
        let worked_ms = compute_actual_between(&state.pool, week_start, week_end)
            .await
            .map_err(ApiError::from)?;
        week_points.push(WeekPoint {
            week_label: week_start_date.format("%m/%d").to_string(),
            worked_ms,
            week_start_date: week_start_date.format("%Y-%m-%d").to_string(),
        });
    }

    let offset_minutes = i64::from(now.offset().local_minus_utc()) / 60;
    let avg_start_minute: Option<i64> = sqlx::query(
        "SELECT CAST(AVG(((started_at / 60000) + ? ) % 1440) AS INTEGER) FROM session WHERE started_at > ?",
    )
    .bind(offset_minutes)
    .bind(now.timestamp_millis() - 60_i64 * 24 * 60 * 60 * 1000)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?
    .try_get(0)
    .map_err(|e| ApiError::from(e.to_string()))?;

    let avg_end_minute: Option<i64> = sqlx::query(
        "SELECT CAST(AVG(((ended_at / 60000) + ? ) % 1440) AS INTEGER) FROM session WHERE ended_at IS NOT NULL AND ended_at > ?",
    )
    .bind(offset_minutes)
    .bind(now.timestamp_millis() - 60_i64 * 24 * 60 * 60 * 1000)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?
    .try_get(0)
    .map_err(|e| ApiError::from(e.to_string()))?;

    let month_start_date = now
        .date_naive()
        .with_day(1)
        .ok_or(ApiError::from("Invalid month start"))?;
    let month_start = Local
        .from_local_datetime(
            &month_start_date
                .and_hms_opt(0, 0, 0)
                .ok_or(ApiError::from("Invalid month start time"))?,
        )
        .earliest()
        .ok_or(ApiError::from("Invalid timezone month start"))?
        .timestamp_millis();
    let month_total_ms = compute_actual_between(&state.pool, month_start, now.timestamp_millis())
        .await
        .map_err(ApiError::from)?;

    Ok(StatsSummary {
        week_points,
        avg_start_minute,
        avg_end_minute,
        month_total_ms,
    })
}

#[tauri::command]
pub async fn get_insights(
    state: tauri::State<'_, AppState>,
    week_start_day: Option<i64>,
) -> Result<Vec<Insight>, ApiError> {
    let wsd = week_start_day.unwrap_or(1);
    let now = Local::now();
    let today = now.date_naive();
    let week_start = week_start_date_for(today, wsd);
    let mut insights = Vec::new();
    let template_id = active_template_id(&state.pool).await.unwrap_or(0);

    let week_start_ms = Local
        .from_local_datetime(&week_start.and_hms_opt(0, 0, 0).ok_or(ApiError::from("bad date"))?)
        .earliest()
        .ok_or(ApiError::from("bad tz"))?
        .timestamp_millis();
    let week_end_ms = week_start_ms + 7 * 24 * 60 * 60 * 1000;
    let offset_min = i64::from(now.offset().local_minus_utc()) / 60;

    // a) Start time drift
    let session_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session WHERE started_at >= ? AND started_at < ?",
    )
    .bind(week_start_ms)
    .bind(week_end_ms)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    if session_count >= 3 {
        let avg_start: Option<i64> = sqlx::query_scalar(
            "SELECT CAST(AVG(((started_at / 60000) + ?) % 1440) AS INTEGER) FROM session WHERE started_at >= ? AND started_at < ?",
        )
        .bind(offset_min)
        .bind(week_start_ms)
        .bind(week_end_ms)
        .fetch_one(&state.pool)
        .await
        .ok()
        .flatten();

        let earliest_sched: Option<i64> = sqlx::query_scalar(
            "SELECT MIN(start_min) FROM schedule_block WHERE template_id = ?",
        )
        .bind(template_id)
        .fetch_one(&state.pool)
        .await
        .ok()
        .flatten();

        if let (Some(avg), Some(sched_start)) = (avg_start, earliest_sched) {
            if avg > sched_start + 30 {
                let avg_h = avg / 60;
                let avg_m = avg % 60;
                let sched_h = sched_start / 60;
                let sched_m = sched_start % 60;
                insights.push(Insight {
                    kind: "drift".to_string(),
                    message: format!(
                        "Your average start this week is {}:{:02} — your schedule starts at {}:{:02}.",
                        avg_h, avg_m, sched_h, sched_m
                    ),
                    severity: "warning".to_string(),
                });
            }
        }
    }

    // b) Weekend creep
    let four_weeks_ago_ms = week_start_ms - 4 * 7 * 24 * 60 * 60 * 1000;
    let weekend_weeks: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT strftime('%Y-%W', datetime(started_at/1000, 'unixepoch', 'localtime'))
         FROM session
         WHERE started_at >= ?
         AND CAST(strftime('%w', datetime(started_at/1000, 'unixepoch', 'localtime')) AS INTEGER) IN (0, 6)",
    )
    .bind(four_weeks_ago_ms)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    if weekend_weeks.len() >= 3 {
        insights.push(Insight {
            kind: "weekend".to_string(),
            message: format!(
                "You've worked on weekends {} of the last 4 weeks.",
                weekend_weeks.len()
            ),
            severity: "warning".to_string(),
        });
    }

    // c) Late night sessions
    let late_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session
         WHERE started_at >= ? AND started_at < ?
         AND ((started_at / 60000 + ?) % 1440) >= 1320",
    )
    .bind(week_start_ms)
    .bind(week_end_ms)
    .bind(offset_min)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    if late_count > 0 {
        insights.push(Insight {
            kind: "late_night".to_string(),
            message: format!(
                "You had {} session{} past 10 PM this week.",
                late_count,
                if late_count == 1 { "" } else { "s" }
            ),
            severity: "warning".to_string(),
        });
    }

    // d) Cramming
    let mut day_totals: Vec<(String, i64)> = Vec::new();
    let mut week_total: i64 = 0;
    for i in 0..7 {
        let d = week_start + chrono::Duration::days(i);
        let d_start = Local
            .from_local_datetime(&d.and_hms_opt(0, 0, 0).ok_or(ApiError::from("bad date"))?)
            .earliest()
            .ok_or(ApiError::from("bad tz"))?
            .timestamp_millis();
        let d_end = d_start + 24 * 60 * 60 * 1000;
        let worked = compute_actual_between(&state.pool, d_start, d_end).await.unwrap_or(0);
        day_totals.push((d.format("%A").to_string(), worked));
        week_total += worked;
    }

    if week_total > 0 {
        for (day_name, day_ms) in &day_totals {
            if *day_ms > week_total / 2 && *day_ms > 60 * 60 * 1000 {
                let pct = (*day_ms as f64 / week_total as f64 * 100.0).round() as i64;
                insights.push(Insight {
                    kind: "cramming".to_string(),
                    message: format!("You did {}% of this week's hours on {}.", pct, day_name),
                    severity: "warning".to_string(),
                });
                break;
            }
        }
    }

    // e) Missed days
    for i in 0..7 {
        let d = week_start + chrono::Duration::days(i);
        if d >= today {
            break;
        }
        let weekday = i64::from(d.weekday().num_days_from_sunday());
        let has_block: bool = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM schedule_block WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(weekday)
        .fetch_one(&state.pool)
        .await
        .map(|c| c > 0)
        .unwrap_or(false);

        let has_target: bool = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(target_min, 0) FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(weekday)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .map(|t| t > 0)
        .unwrap_or(false);

        if !has_block && !has_target {
            continue;
        }

        let d_start = Local
            .from_local_datetime(&d.and_hms_opt(0, 0, 0).ok_or(ApiError::from("bad date"))?)
            .earliest()
            .ok_or(ApiError::from("bad tz"))?
            .timestamp_millis();
        let d_end = d_start + 24 * 60 * 60 * 1000;
        let worked = compute_actual_between(&state.pool, d_start, d_end).await.unwrap_or(0);

        if worked < 60_000 {
            insights.push(Insight {
                kind: "missed".to_string(),
                message: format!("You didn't clock in on {}.", day_label(weekday)),
                severity: "info".to_string(),
            });
        }
    }

    // f) Streak
    let mut streak = 0i64;
    let mut check_date = today - chrono::Duration::days(1);
    loop {
        let weekday = i64::from(check_date.weekday().num_days_from_sunday());
        let target_min: i64 = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(weekday)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .flatten()
        .unwrap_or(0);

        let block_ms: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(CASE WHEN end_min > start_min THEN (end_min - start_min) * 60000 ELSE (1440 - start_min + end_min) * 60000 END), 0) FROM schedule_block WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(weekday)
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);

        let day_target_ms = if target_min > 0 {
            target_min * 60_000
        } else {
            block_ms
        };

        if day_target_ms == 0 {
            check_date -= chrono::Duration::days(1);
            if today.signed_duration_since(check_date).num_days() > 30 {
                break;
            }
            continue;
        }

        let naive = check_date
            .and_hms_opt(0, 0, 0)
            .ok_or(ApiError::from("bad date"))?;
        let d_start = match Local.from_local_datetime(&naive).earliest() {
            Some(dt) => dt.timestamp_millis(),
            None => break,
        };
        let d_end = d_start + 24 * 60 * 60 * 1000;
        let worked = compute_actual_between(&state.pool, d_start, d_end).await.unwrap_or(0);

        if worked >= day_target_ms - 60_000 {
            streak += 1;
            check_date -= chrono::Duration::days(1);
            if today.signed_duration_since(check_date).num_days() > 30 {
                break;
            }
        } else {
            break;
        }
    }

    if streak >= 3 {
        insights.push(Insight {
            kind: "streak".to_string(),
            message: format!("You've followed your schedule for {} days straight!", streak),
            severity: "positive".to_string(),
        });
    }

    Ok(insights)
}

#[tauri::command]
pub async fn get_weekly_review(
    state: tauri::State<'_, AppState>,
    week_start_day: Option<i64>,
    week_start: Option<String>,
) -> Result<WeeklyReview, ApiError> {
    let wsd = week_start_day.unwrap_or(1);
    let now = Local::now();
    let current_week_start = week_start_date_for(now.date_naive(), wsd);
    let review_week_start = if let Some(ref ws) = week_start {
        chrono::NaiveDate::parse_from_str(ws, "%Y-%m-%d").map_err(|_| ApiError::from("Invalid date"))?
    } else {
        current_week_start - chrono::Duration::days(7)
    };
    let review_week_end = review_week_start + chrono::Duration::days(7);

    let week_label = format!(
        "{} – {}",
        format_review_calendar_day(review_week_start),
        format_review_calendar_day(review_week_end - chrono::Duration::days(1))
    );

    let week_start_ms = Local
        .from_local_datetime(
            &review_week_start
                .and_hms_opt(0, 0, 0)
                .ok_or_else(|| ApiError::from("Invalid date"))?,
        )
        .earliest()
        .ok_or_else(|| ApiError::from("Invalid timezone date"))?
        .timestamp_millis();
    let week_end_ms = Local
        .from_local_datetime(
            &review_week_end
                .and_hms_opt(0, 0, 0)
                .ok_or_else(|| ApiError::from("Invalid date"))?,
        )
        .earliest()
        .ok_or_else(|| ApiError::from("Invalid timezone date"))?
        .timestamp_millis();

    let offset_min = i64::from(now.offset().local_minus_utc()) / 60;
    let template_id = active_template_id(&state.pool).await.unwrap_or(0);

    let block_rows = sqlx::query(
        "SELECT id, template_id, day_of_week, start_min, end_min, COALESCE(label, 'Work block'), COALESCE(color, '#34D399')
         FROM schedule_block
         WHERE template_id = ?",
    )
    .bind(template_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let mut blocks_by_dow: HashMap<i64, Vec<ScheduleBlock>> = HashMap::new();
    for row in block_rows {
        let block = ScheduleBlock {
            id: row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?,
            template_id: row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?,
            day_of_week: row.try_get(2).map_err(|e| ApiError::from(e.to_string()))?,
            start_min: row.try_get(3).map_err(|e| ApiError::from(e.to_string()))?,
            end_min: row.try_get(4).map_err(|e| ApiError::from(e.to_string()))?,
            label: row.try_get(5).map_err(|e| ApiError::from(e.to_string()))?,
            color: row.try_get(6).map_err(|e| ApiError::from(e.to_string()))?,
        };
        blocks_by_dow.entry(block.day_of_week).or_default().push(block);
    }
    for blocks in blocks_by_dow.values_mut() {
        blocks.sort_by_key(|b| b.start_min);
    }

    let mut day_details = Vec::new();
    let mut days_worked = 0_i64;
    let mut days_scheduled = 0_i64;
    let mut total_target_ms = 0_i64;
    let mut total_actual_ms = 0_i64;
    let mut on_time_days = 0_i64;

    for i in 0..7 {
        let day = review_week_start + chrono::Duration::days(i);
        let day_start = Local
            .from_local_datetime(
                &day
                    .and_hms_opt(0, 0, 0)
                    .ok_or_else(|| ApiError::from("Invalid date"))?,
            )
            .earliest()
            .ok_or_else(|| ApiError::from("Invalid timezone date"))?
            .timestamp_millis();
        let day_end = day_start + 24 * 60 * 60 * 1000;

        let weekday = i64::from(day.weekday().num_days_from_sunday());

        let planned_ms: i64 = sqlx::query(
            "SELECT COALESCE(SUM(CASE WHEN end_min > start_min THEN (end_min - start_min) * 60000 ELSE (1440 - start_min + end_min) * 60000 END), 0)
             FROM schedule_block
             WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(weekday)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?
        .try_get(0)
        .map_err(|e| ApiError::from(e.to_string()))?;

        let day_target_min: i64 = sqlx::query_scalar(
            "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(weekday)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

        let target_ms = if day_target_min > 0 {
            day_target_min * 60_000
        } else {
            planned_ms
        };

        let actual_ms = compute_actual_between(&state.pool, day_start, day_end)
            .await
            .map_err(ApiError::from)?;

        if actual_ms > 60_000 {
            days_worked += 1;
        }
        if target_ms > 0 {
            days_scheduled += 1;
        }
        total_target_ms += target_ms;
        total_actual_ms += actual_ms;

        let first_started: Option<i64> = sqlx::query_scalar(
            "SELECT MIN(started_at) FROM session WHERE started_at >= ? AND started_at < ?",
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();

        let first_block_start = blocks_by_dow
            .get(&weekday)
            .and_then(|blocks| blocks.iter().map(|b| b.start_min).min());

        let on_time = match (first_started, first_block_start) {
            (Some(ts), Some(bm)) => {
                let smin = (ts / 60_000 + offset_min).rem_euclid(1440);
                (smin - bm).abs() <= 30
            }
            _ => false,
        };
        if on_time {
            on_time_days += 1;
        }

        day_details.push(WeeklyReviewDay {
            label: day_label(weekday).to_string(),
            target_ms,
            actual_ms,
            on_time,
        });
    }

    let avg_start_minute: Option<i64> = sqlx::query_scalar(
        "SELECT CAST(AVG(((started_at / 60000) + ?) % 1440) AS INTEGER) FROM session WHERE started_at >= ? AND started_at < ?",
    )
    .bind(offset_min)
    .bind(week_start_ms)
    .bind(week_end_ms)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    let avg_end_minute: Option<i64> = sqlx::query_scalar(
        "SELECT CAST(AVG(((ended_at / 60000) + ?) % 1440) AS INTEGER) FROM session WHERE ended_at IS NOT NULL AND ended_at >= ? AND ended_at < ?",
    )
    .bind(offset_min)
    .bind(week_start_ms)
    .bind(week_end_ms)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    let session_starts: Vec<i64> = sqlx::query_scalar(
        "SELECT started_at FROM session WHERE started_at >= ? AND started_at < ?",
    )
    .bind(week_start_ms)
    .bind(week_end_ms)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let mut off_schedule_sessions = 0_i64;
    for ts in session_starts {
        let dt = match Local.timestamp_millis_opt(ts) {
            LocalResult::Single(d) => d,
            _ => continue,
        };
        let weekday = i64::from(dt.weekday().num_days_from_sunday());
        let minute = i64::from(dt.hour()) * 60 + i64::from(dt.minute());
        let blocks = blocks_by_dow.get(&weekday).map(|v| v.as_slice()).unwrap_or(&[]);
        if !minute_in_any_block(minute, blocks) {
            off_schedule_sessions += 1;
        }
    }

    let mut insights = Vec::new();

    let late_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session WHERE started_at >= ? AND started_at < ? AND ((started_at / 60000 + ?) % 1440) >= 1320",
    )
    .bind(week_start_ms)
    .bind(week_end_ms)
    .bind(offset_min)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    if late_count > 0 {
        insights.push(Insight {
            kind: "late_night".to_string(),
            message: format!("{} session{} past 10 PM.", late_count, if late_count == 1 { "" } else { "s" }),
            severity: "warning".to_string(),
        });
    }

    let weekend_sessions: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM session WHERE started_at >= ? AND started_at < ? AND CAST(strftime('%w', datetime(started_at/1000, 'unixepoch', 'localtime')) AS INTEGER) IN (0, 6)",
    )
    .bind(week_start_ms)
    .bind(week_end_ms)
    .fetch_one(&state.pool)
    .await
    .unwrap_or(0);

    if weekend_sessions > 0 {
        insights.push(Insight {
            kind: "weekend".to_string(),
            message: format!("{} weekend session{}.", weekend_sessions, if weekend_sessions == 1 { "" } else { "s" }),
            severity: "warning".to_string(),
        });
    }

    if days_worked >= days_scheduled && days_scheduled > 0 {
        insights.push(Insight {
            kind: "streak".to_string(),
            message: format!("Hit target on all {} scheduled days!", days_scheduled),
            severity: "positive".to_string(),
        });
    }

    if total_actual_ms > 0 {
        for detail in &day_details {
            if detail.actual_ms > total_actual_ms / 2 && detail.actual_ms > 3_600_000 {
                let pct = (detail.actual_ms as f64 / total_actual_ms as f64 * 100.0).round() as i64;
                insights.push(Insight {
                    kind: "cramming".to_string(),
                    message: format!("{}% of hours were on {}.", pct, detail.label),
                    severity: "warning".to_string(),
                });
                break;
            }
        }
    }

    Ok(WeeklyReview {
        week_label,
        days_worked,
        days_scheduled,
        total_target_ms,
        total_actual_ms,
        avg_start_minute,
        avg_end_minute,
        on_time_days,
        off_schedule_sessions,
        day_details,
        insights,
    })
}

#[tauri::command]
pub async fn get_last_reviewed_week(state: tauri::State<'_, AppState>) -> Result<Option<String>, ApiError> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'last_reviewed_week'")
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(value)
}

#[tauri::command]
pub async fn set_last_reviewed_week(state: tauri::State<'_, AppState>, week_start: String) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO app_meta (key, value) VALUES ('last_reviewed_week', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&week_start)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn get_session_checklist(
    state: tauri::State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<i64>, ApiError> {
    let rows = sqlx::query(
        "SELECT item_id FROM session_checklist_state WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    let ids: Vec<i64> = rows
        .iter()
        .map(|row| row.try_get(0).unwrap_or(0))
        .collect();
    Ok(ids)
}

#[tauri::command]
pub async fn toggle_checklist_item(
    state: tauri::State<'_, AppState>,
    session_id: i64,
    item_id: i64,
    done: bool,
) -> Result<(), ApiError> {
    if done {
        sqlx::query(
            "INSERT OR IGNORE INTO session_checklist_state (session_id, item_id, done_at) VALUES (?, ?, ?)",
        )
        .bind(session_id)
        .bind(item_id)
        .bind(now_ms())
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    } else {
        sqlx::query(
            "DELETE FROM session_checklist_state WHERE session_id = ? AND item_id = ?",
        )
        .bind(session_id)
        .bind(item_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_pending_recovery(state: tauri::State<'_, AppState>) -> Result<Option<PendingRecovery>, ApiError> {
    let value: Option<String> = sqlx::query("SELECT value FROM app_meta WHERE key = 'pending_recovery'")
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?
        .map(|row| row.try_get(0).map_err(|e| ApiError::from(e.to_string())))
        .transpose()?;
    let Some(value) = value else {
        return Ok(None);
    };
    let parsed: Value = serde_json::from_str(&value).map_err(|e| ApiError::from(e.to_string()))?;
    Ok(Some(PendingRecovery {
        session_id: parsed["session_id"].as_i64().ok_or(ApiError::from("Invalid pending recovery"))?,
        started_at: parsed["started_at"].as_i64().ok_or(ApiError::from("Invalid pending recovery"))?,
        suggested_end_at: parsed["suggested_end_at"]
            .as_i64()
            .ok_or(ApiError::from("Invalid pending recovery"))?,
    }))
}

#[tauri::command]
pub async fn apply_pending_recovery(
    state: tauri::State<'_, AppState>,
    ended_at: i64,
) -> Result<(), ApiError> {
    let value: Option<String> = sqlx::query("SELECT value FROM app_meta WHERE key = 'pending_recovery'")
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?
        .map(|row| row.try_get(0).map_err(|e| ApiError::from(e.to_string())))
        .transpose()?;
    let pending = value
        .and_then(|v| serde_json::from_str::<Value>(&v).ok())
        .and_then(|v| {
            Some(PendingRecovery {
                session_id: v["session_id"].as_i64()?,
                started_at: v["started_at"].as_i64()?,
                suggested_end_at: v["suggested_end_at"].as_i64()?,
            })
        });
    let Some(pending) = pending else {
        return Ok(());
    };
    let safe_ended_at = ended_at.max(pending.started_at).min(now_ms());
    sqlx::query("UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL")
        .bind(safe_ended_at)
        .bind(pending.session_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query("UPDATE session_pause SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL")
        .bind(safe_ended_at)
        .bind(pending.session_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query("DELETE FROM app_meta WHERE key IN ('pending_recovery', 'startup_notice')")
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::now_ms;
    use crate::test_helpers::test_state;

    #[tokio::test]
    async fn clock_in_creates_session() {
        let state = test_state().await;
        let now = now_ms();

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(now)
            .execute(&state.pool)
            .await
            .unwrap();

        let session = active_session(&state.pool).await.unwrap();
        assert!(session.is_some());
        let session = session.unwrap();
        assert_eq!(session.started_at, now);
        assert!(session.ended_at.is_none());
    }

    #[tokio::test]
    async fn active_session_returns_none_when_no_open_session() {
        let state = test_state().await;
        let session = active_session(&state.pool).await.unwrap();
        assert!(session.is_none());
    }

    #[tokio::test]
    async fn active_session_ignores_closed_sessions() {
        let state = test_state().await;
        let now = now_ms();

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, ?)")
            .bind(now - 3600_000)
            .bind(now)
            .execute(&state.pool)
            .await
            .unwrap();

        let session = active_session(&state.pool).await.unwrap();
        assert!(session.is_none());
    }

    #[tokio::test]
    async fn clock_out_closes_session() {
        let state = test_state().await;
        let now = now_ms();

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(now - 3600_000)
            .execute(&state.pool)
            .await
            .unwrap();

        let ended_at = now;
        sqlx::query("UPDATE session SET ended_at = ? WHERE ended_at IS NULL")
            .bind(ended_at)
            .execute(&state.pool)
            .await
            .unwrap();

        let session = active_session(&state.pool).await.unwrap();
        assert!(session.is_none());
    }

    #[tokio::test]
    async fn start_break_creates_pause_row() {
        let state = test_state().await;
        let now = now_ms();

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(now - 3600_000)
            .execute(&state.pool)
            .await
            .unwrap();

        let session = active_session(&state.pool).await.unwrap().unwrap();

        sqlx::query("INSERT INTO session_pause (session_id, paused_at, reason) VALUES (?, ?, 'manual')")
            .bind(session.id)
            .bind(now)
            .execute(&state.pool)
            .await
            .unwrap();

        let pause = active_pause_for_session(&state.pool, session.id).await.unwrap();
        assert!(pause.is_some());
        assert_eq!(pause.unwrap(), now);
    }

    #[tokio::test]
    async fn resume_break_closes_pause() {
        let state = test_state().await;
        let now = now_ms();

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(now - 3600_000)
            .execute(&state.pool)
            .await
            .unwrap();

        let session = active_session(&state.pool).await.unwrap().unwrap();

        sqlx::query("INSERT INTO session_pause (session_id, paused_at, reason) VALUES (?, ?, 'manual')")
            .bind(session.id)
            .bind(now - 600_000)
            .execute(&state.pool)
            .await
            .unwrap();

        sqlx::query("UPDATE session_pause SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL")
            .bind(now)
            .bind(session.id)
            .execute(&state.pool)
            .await
            .unwrap();

        let pause = active_pause_for_session(&state.pool, session.id).await.unwrap();
        assert!(pause.is_none());
    }

    #[tokio::test]
    async fn compute_actual_between_subtracts_pauses() {
        let state = test_state().await;
        let base = 1_700_000_000_000_i64;

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, ?)")
            .bind(base)
            .bind(base + 3_600_000)
            .execute(&state.pool)
            .await
            .unwrap();

        let session_id: i64 = sqlx::query_scalar("SELECT id FROM session WHERE started_at = ?")
            .bind(base)
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO session_pause (session_id, paused_at, resumed_at, reason) VALUES (?, ?, ?, 'manual')")
            .bind(session_id)
            .bind(base + 1_000_000)
            .bind(base + 1_600_000)
            .execute(&state.pool)
            .await
            .unwrap();

        let actual = compute_actual_between(&state.pool, base, base + 4_000_000).await.unwrap();
        // 1h session - 10min pause = 50min = 3_000_000ms
        assert_eq!(actual, 3_000_000);
    }

    #[tokio::test]
    async fn compute_actual_between_no_sessions_returns_zero() {
        let state = test_state().await;
        let actual = compute_actual_between(&state.pool, 0, 1_000_000_000_000).await.unwrap();
        assert_eq!(actual, 0);
    }

    #[tokio::test]
    async fn active_template_id_returns_active() {
        let state = test_state().await;
        let id = active_template_id(&state.pool).await.unwrap();
        assert!(id > 0);
    }

    #[tokio::test]
    async fn day_label_returns_correct_names() {
        assert_eq!(day_label(0), "Sun");
        assert_eq!(day_label(1), "Mon");
        assert_eq!(day_label(2), "Tue");
        assert_eq!(day_label(3), "Wed");
        assert_eq!(day_label(4), "Thu");
        assert_eq!(day_label(5), "Fri");
        assert_eq!(day_label(6), "Sat");
        assert_eq!(day_label(99), "Sat");
    }

    #[tokio::test]
    async fn get_pending_recovery_returns_none_when_empty() {
        let state = test_state().await;
        let val: Option<String> = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'pending_recovery'")
            .fetch_optional(&state.pool)
            .await
            .unwrap();
        assert!(val.is_none());
    }

    #[tokio::test]
    async fn apply_pending_recovery_clamps_ended_at() {
        let state = test_state().await;
        let started = 1_700_000_000_000_i64;
        let suggested = started + 3_600_000;

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(started)
            .execute(&state.pool)
            .await
            .unwrap();

        let session_id: i64 = sqlx::query_scalar("SELECT id FROM session LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        let pending = serde_json::json!({
            "session_id": session_id,
            "started_at": started,
            "suggested_end_at": suggested,
        });
        sqlx::query("INSERT INTO app_meta (key, value) VALUES ('pending_recovery', ?)")
            .bind(pending.to_string())
            .execute(&state.pool)
            .await
            .unwrap();

        // Try to apply a time BEFORE started_at — should clamp to started_at
        let too_early = started - 1000;
        let safe_ended_at = too_early.max(started);
        sqlx::query("UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL")
            .bind(safe_ended_at)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let ended: i64 = sqlx::query_scalar("SELECT ended_at FROM session WHERE id = ?")
            .bind(session_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(ended, started, "Should clamp to started_at");
    }

    #[tokio::test]
    async fn apply_pending_recovery_closes_open_pauses() {
        let state = test_state().await;
        let started = now_ms() - 7_200_000;
        let paused = started + 3_600_000;

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(started)
            .execute(&state.pool)
            .await
            .unwrap();

        let session_id: i64 = sqlx::query_scalar("SELECT id FROM session ORDER BY id DESC LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO session_pause (session_id, paused_at, resumed_at) VALUES (?, ?, NULL)")
            .bind(session_id)
            .bind(paused)
            .execute(&state.pool)
            .await
            .unwrap();

        let pending = serde_json::json!({
            "session_id": session_id,
            "started_at": started,
            "suggested_end_at": started + 5_400_000,
        });
        sqlx::query("INSERT INTO app_meta (key, value) VALUES ('pending_recovery', ?)")
            .bind(pending.to_string())
            .execute(&state.pool)
            .await
            .unwrap();

        let ended_at = started + 5_400_000;
        let safe_ended_at = ended_at.max(started).min(now_ms());

        sqlx::query("UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL")
            .bind(safe_ended_at)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .unwrap();

        sqlx::query("UPDATE session_pause SET resumed_at = ? WHERE session_id = ? AND resumed_at IS NULL")
            .bind(safe_ended_at)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let resumed: i64 = sqlx::query_scalar(
            "SELECT resumed_at FROM session_pause WHERE session_id = ?",
        )
        .bind(session_id)
        .fetch_one(&state.pool)
        .await
        .unwrap();

        assert_eq!(resumed, safe_ended_at, "Open pause should be closed with session end time");
    }

    #[tokio::test]
    async fn apply_pending_recovery_caps_future_ended_at() {
        let state = test_state().await;
        let started = now_ms() - 3_600_000;
        let future_time = now_ms() + 86_400_000; // 1 day in the future

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(started)
            .execute(&state.pool)
            .await
            .unwrap();

        let session_id: i64 = sqlx::query_scalar("SELECT id FROM session ORDER BY id DESC LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        let pending = serde_json::json!({
            "session_id": session_id,
            "started_at": started,
            "suggested_end_at": future_time,
        });
        sqlx::query("INSERT INTO app_meta (key, value) VALUES ('pending_recovery', ?)")
            .bind(pending.to_string())
            .execute(&state.pool)
            .await
            .unwrap();

        let safe_ended_at = future_time.max(started).min(now_ms());

        sqlx::query("UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL")
            .bind(safe_ended_at)
            .bind(session_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let ended: i64 = sqlx::query_scalar("SELECT ended_at FROM session WHERE id = ?")
            .bind(session_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();

        assert!(ended <= now_ms(), "Recovery should cap ended_at to now, not allow future timestamps");
        assert!(ended >= started, "Recovery should not go before started_at");
    }

    #[tokio::test]
    async fn toggle_checklist_item_inserts_and_deletes() {
        let state = test_state().await;
        let now = now_ms();

        let template_id: i64 = sqlx::query_scalar("SELECT id FROM schedule_template LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO schedule_block (template_id, day_of_week, start_min, end_min) VALUES (?, 1, 540, 1020)")
            .bind(template_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let block_id: i64 = sqlx::query_scalar("SELECT id FROM schedule_block LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO block_checklist_item (block_id, text, position) VALUES (?, 'Test item', 0)")
            .bind(block_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let item_id: i64 = sqlx::query_scalar("SELECT id FROM block_checklist_item LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO session (started_at, ended_at, block_id) VALUES (?, NULL, ?)")
            .bind(now)
            .bind(block_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let session_id: i64 = sqlx::query_scalar("SELECT id FROM session LIMIT 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        // Mark done
        sqlx::query("INSERT OR IGNORE INTO session_checklist_state (session_id, item_id, done_at) VALUES (?, ?, ?)")
            .bind(session_id)
            .bind(item_id)
            .bind(now)
            .execute(&state.pool)
            .await
            .unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session_checklist_state WHERE session_id = ?")
            .bind(session_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(count, 1);

        // Unmark
        sqlx::query("DELETE FROM session_checklist_state WHERE session_id = ? AND item_id = ?")
            .bind(session_id)
            .bind(item_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session_checklist_state WHERE session_id = ?")
            .bind(session_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn overnight_session_detected_when_started_before_midnight() {
        let state = test_state().await;
        let now = Local::now();
        let today_midnight = Local
            .from_local_datetime(&now.date_naive().and_hms_opt(0, 0, 0).unwrap())
            .earliest()
            .unwrap()
            .timestamp_millis();
        let yesterday_session_start = today_midnight - 4 * 3_600_000;

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(yesterday_session_start)
            .execute(&state.pool)
            .await
            .unwrap();

        let session = active_session(&state.pool).await.unwrap().unwrap();
        let (start, _end) = crate::db::start_of_workday_window().unwrap();
        let is_overnight = session.started_at < start;
        assert!(is_overnight, "Session that started before midnight should be detected as overnight");
    }

    #[tokio::test]
    async fn same_day_session_not_detected_as_overnight() {
        let state = test_state().await;
        let now = now_ms();

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(now - 60_000)
            .execute(&state.pool)
            .await
            .unwrap();

        let session = active_session(&state.pool).await.unwrap().unwrap();
        let (start, _end) = crate::db::start_of_workday_window().unwrap();
        let is_overnight = session.started_at < start;
        assert!(!is_overnight, "Session that started today should not be overnight");
    }
}
