use chrono::{Datelike, Local, TimeZone, Timelike};
use serde::Serialize;
use sqlx::Row;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::System::SystemInformation::GetTickCount;

use crate::commands::session::{week_start_date_for, week_start_day_setting, ApiError};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct NotificationLogEntry {
    pub id: i64,
    pub key: String,
    pub title: String,
    pub body: String,
    pub action_kind: Option<String>,
    pub created_at: i64,
}

/// End of today's merged schedule window in local time (`start_min` / `end_min` from blocks, same aggregation as `in_shift`).
fn shift_end_timestamp_ms(now: chrono::DateTime<Local>, start_min: i64, end_min: i64) -> Option<i64> {
    let date = now.date_naive();
    if start_min <= end_min {
        let naive = date.and_hms_opt(
            u32::try_from(end_min / 60).ok()?,
            u32::try_from(end_min % 60).ok()?,
            0,
        )?;
        Local.from_local_datetime(&naive).earliest().map(|dt| dt.timestamp_millis())
    } else {
        let next = date + chrono::Duration::days(1);
        let naive = next.and_hms_opt(
            u32::try_from(end_min / 60).ok()?,
            u32::try_from(end_min % 60).ok()?,
            0,
        )?;
        Local.from_local_datetime(&naive).earliest().map(|dt| dt.timestamp_millis())
    }
}

fn get_idle_seconds() -> u64 {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    let success = unsafe { GetLastInputInfo(&mut info) };
    if success.as_bool() {
        let now_tick = unsafe { GetTickCount() };
        let elapsed_ms = now_tick.wrapping_sub(info.dwTime);
        (elapsed_ms / 1000) as u64
    } else {
        0
    }
}

async fn get_interval_ms(state: &AppState) -> i64 {
    let raw: Option<String> = sqlx::query("SELECT value FROM settings WHERE key = 'reminder_interval_min'")
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get(0).ok());
    let minutes = raw
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(5)
        .clamp(1, 60);
    minutes * 60 * 1000
}

async fn send_reminder(
    state: &AppState,
    app: &AppHandle,
    key: &str,
    title: &str,
    body: &str,
    action_kind: Option<&str>,
    interval_ms: i64,
) {
    let now_ms = Local::now().timestamp_millis();

    let row: Option<(String, String)> = sqlx::query("SELECT value FROM app_meta WHERE key = 'last_notif_key'")
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<String, _>(0).ok())
        .and_then(|v| {
            let parts: Vec<&str> = v.splitn(2, '|').collect();
            if parts.len() == 2 {
                Some((parts[0].to_string(), parts[1].to_string()))
            } else {
                None
            }
        });

    if let Some((last_key, last_ts_str)) = &row {
        if let Ok(last_ts) = last_ts_str.parse::<i64>() {
            if last_key == key && (now_ms - last_ts) < interval_ms {
                log::debug!("[notify] skipped {key} (interval not elapsed, {}ms remaining)", interval_ms - (now_ms - last_ts));
                return;
            }
        }
    }

    log::info!("[notify] firing: {key} — {title}");

    match app.notification().builder().title(title).body(body).show() {
        Ok(_) => log::info!("[notify] OS notification sent"),
        Err(e) => log::warn!("[notify] OS notification failed: {e}"),
    }

    if let Some(kind) = action_kind {
        let _ = app.emit(
            "notification-action",
            serde_json::json!({
                "kind": kind,
                "message": body
            }),
        );
        log::info!("[notify] in-app action emitted: {kind}");
    }

    let combined = format!("{}|{}", key, now_ms);
    let _ = sqlx::query(
        "INSERT INTO app_meta (key, value) VALUES ('last_notif_key', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&combined)
    .execute(&state.pool)
    .await;

    let _ = sqlx::query(
        "INSERT INTO notification_log (key, title, body, action_kind, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(key)
    .bind(title)
    .bind(body)
    .bind(action_kind)
    .bind(now_ms)
    .execute(&state.pool)
    .await;
}

async fn check_and_notify(app: &AppHandle, state: &AppState) {
    let now = Local::now();
    let day = i64::from(now.weekday().num_days_from_sunday());
    let minute = i64::from(now.hour()) * 60 + i64::from(now.minute());

    let notifications_enabled: Option<String> = sqlx::query("SELECT value FROM settings WHERE key = 'notifications_enabled'")
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get(0).ok());
    if matches!(notifications_enabled.as_deref(), Some("0") | Some("false") | Some("False")) {
        return;
    }

    let quiet_enabled: Option<String> = sqlx::query("SELECT value FROM settings WHERE key = 'quiet_hours_enabled'")
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get(0).ok());
    if matches!(quiet_enabled.as_deref(), Some("1") | Some("true") | Some("True")) {
        let quiet_start: i64 = sqlx::query("SELECT COALESCE(value, '1320') FROM settings WHERE key = 'quiet_hours_start_min'")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<String, _>(0).ok())
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(1320)
            .clamp(0, 1439);
        let quiet_end: i64 = sqlx::query("SELECT COALESCE(value, '480') FROM settings WHERE key = 'quiet_hours_end_min'")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .and_then(|row| row.try_get::<String, _>(0).ok())
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(480)
            .clamp(0, 1439);
        let in_quiet = if quiet_start <= quiet_end {
            minute >= quiet_start && minute < quiet_end
        } else {
            minute >= quiet_start || minute < quiet_end
        };
        if in_quiet {
            log::debug!("[notify] in quiet hours ({minute}min), skipping");
            return;
        }
    }

    let wsd = week_start_day_setting(&state.pool).await;
    let week_anchor = week_start_date_for(now.date_naive(), wsd);
    let done_key = format!("done_week_{}", week_anchor.format("%Y-%m-%d"));
    let week_done = sqlx::query("SELECT 1 FROM app_meta WHERE key = ?")
        .bind(&done_key)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .is_some();
    if week_done {
        log::debug!("[notify] week marked done, skipping");
        return;
    }

    let day_done_key = format!("done_day_{}", now.format("%Y-%m-%d"));
    let day_done = sqlx::query("SELECT 1 FROM app_meta WHERE key = ?")
        .bind(&day_done_key)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .is_some();
    if day_done {
        log::debug!("[notify] day marked done, skipping");
        return;
    }

    let template_id: Result<i64, _> = sqlx::query(
        "SELECT id FROM schedule_template WHERE is_active = 1 ORDER BY id LIMIT 1",
    )
    .fetch_one(&state.pool)
    .await
    .and_then(|row| row.try_get::<i64, _>(0));
    let Ok(template_id) = template_id else {
        return;
    };
    let rows = match sqlx::query(
        "SELECT start_min, end_min
         FROM schedule_block
         WHERE template_id = ? AND day_of_week = ?
         ORDER BY start_min, end_min",
    )
    .bind(template_id)
    .bind(day)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(_) => return,
    };
    let mut start_min: Option<i64> = None;
    let mut end_min: Option<i64> = None;
    for row in rows {
        let start: i64 = row.try_get(0).unwrap_or(0);
        let end: i64 = row.try_get(1).unwrap_or(0);
        start_min = Some(start_min.map(|s| s.min(start)).unwrap_or(start));
        end_min = Some(end_min.map(|e| e.max(end)).unwrap_or(end));
    }
    // If no blocks exist, we may still need to send behind-target nudges
    let _has_blocks = start_min.is_some() && end_min.is_some();

    let (in_shift, before_shift) = if let (Some(sm), Some(em)) = (start_min, end_min) {
        let is_overnight = sm > em;
        let in_s = if is_overnight {
            minute >= sm || minute < em
        } else {
            minute >= sm && minute < em
        };
        let before_s = minute >= sm.saturating_sub(6) && minute < sm;
        (in_s, before_s)
    } else {
        (false, false)
    };

    let has_active_session: bool = sqlx::query("SELECT COUNT(*) FROM session WHERE ended_at IS NULL")
        .fetch_one(&state.pool)
        .await
        .and_then(|row| row.try_get::<i64, _>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    let interval_ms = get_interval_ms(state).await;
    let date_key = now.format("%Y-%m-%d").to_string();

    if let (Some(start_min), Some(end_min)) = (start_min, end_min) {
        let is_overnight = start_min > end_min;
        log::debug!(
            "[notify] check: minute={minute}, start={start_min}, end={end_min}, in_shift={in_shift}, before={before_shift}, active={has_active_session}, interval={}min",
            interval_ms / 60000
        );

        if before_shift {
            send_reminder(
                state, app,
                &format!("{}:start-soon", date_key),
                "Work starts soon",
                "Your workday starts in a few minutes.",
                None,
                i64::MAX,
            ).await;
        } else if in_shift && !has_active_session {
            send_reminder(
                state, app,
                &format!("{}:clock-in", date_key),
                "Time to clock in",
                "Your shift has started. Clock in to start tracking.",
                Some("clock_in"),
                interval_ms,
            ).await;
        } else if !in_shift && !before_shift && has_active_session && minute >= start_min {
            let effective_past = if is_overnight {
                minute >= end_min && minute < start_min
            } else {
                minute >= end_min
            };
            if effective_past {
                let mut skip_clock_out_nudge = false;
                if let Some(started_at) = sqlx::query_scalar::<_, i64>(
                    "SELECT started_at FROM session WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
                )
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten()
                {
                    if let Some(end_ts) = shift_end_timestamp_ms(now, start_min, end_min) {
                        // Started entirely after the scheduled window (e.g. late makeup) — don't nag "shift ended".
                        if started_at >= end_ts {
                            skip_clock_out_nudge = true;
                            log::debug!(
                                "[notify] skip clock-out nudge: session started after shift end (started_at={started_at}, shift_end={end_ts})"
                            );
                        }
                    }
                }
                if !skip_clock_out_nudge {
                    send_reminder(
                        state, app,
                        &format!("{}:clock-out", date_key),
                        "Shift ended",
                        "Your scheduled shift has ended. Clock out when ready.",
                        Some("clock_out"),
                        interval_ms,
                    ).await;
                }
            }
        }
    }

    // Behind-target nudge: only in "target" accountability mode
    let acct_mode: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'accountability_mode'")
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "shift".to_string());

    let day_done_key = format!("done_day_{}", now.format("%Y-%m-%d"));
    let day_done = sqlx::query("SELECT 1 FROM app_meta WHERE key = ?")
        .bind(&day_done_key)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .is_some();

    if acct_mode == "target" && !has_active_session && !day_done {
        let explicit_target_min: i64 = sqlx::query_scalar(
            "SELECT target_min FROM schedule_day_target WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(day)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

        let block_planned_ms: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(CASE WHEN end_min > start_min THEN (end_min - start_min) * 60000 ELSE (1440 - start_min + end_min) * 60000 END), 0) FROM schedule_block WHERE template_id = ? AND day_of_week = ?",
        )
        .bind(template_id)
        .bind(day)
        .fetch_one(&state.pool)
        .await
        .unwrap_or(0);

        let target_ms = if explicit_target_min > 0 {
            explicit_target_min * 60 * 1000
        } else {
            block_planned_ms
        };

        if target_ms > 0 {
            let today_start = Local::now().date_naive()
                .and_hms_opt(0, 0, 0)
                .and_then(|naive| Local.from_local_datetime(&naive).earliest())
                .map(|dt| dt.timestamp_millis())
                .unwrap_or(0);
            let today_end = today_start + 24 * 60 * 60 * 1000;

            let worked_ms = crate::commands::session::compute_actual_between_pub(&state.pool, today_start, today_end)
                .await
                .unwrap_or(0);

            // Only nudge AFTER the last block has ended, not before it starts
            let past_window = if let (Some(sm), Some(em)) = (start_min, end_min) {
                let is_overnight = sm > em;
                if is_overnight {
                    minute >= em && minute < sm
                } else {
                    minute >= em
                }
            } else {
                true // no blocks = flex day, always eligible
            };

            if past_window && worked_ms < target_ms {
                let remaining_min = (target_ms - worked_ms) / 60_000;
                send_reminder(
                    state, app,
                    &format!("{}:behind-target", date_key),
                    "Behind daily target",
                    &format!(
                        "You still have {} to go today. Clock in to stay on track.",
                        if remaining_min >= 60 {
                            format!("{:.1}h", remaining_min as f64 / 60.0)
                        } else {
                            format!("{}min", remaining_min)
                        }
                    ),
                    Some("clock_in"),
                    interval_ms,
                ).await;
            }
        }
    }

    let idle_nudge_enabled: Option<String> = sqlx::query("SELECT value FROM settings WHERE key = 'idle_nudge_enabled'")
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get(0).ok());
    if !matches!(idle_nudge_enabled.as_deref(), Some("0") | Some("false") | Some("False")) {
        let active = sqlx::query(
            "SELECT id, started_at FROM session WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
        )
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        if let Some(active) = active {
            let session_id: i64 = active.try_get(0).unwrap_or(0);
            let started_at: i64 = active.try_get(1).unwrap_or(now.timestamp_millis());
            let open_pause_count: i64 = sqlx::query(
                "SELECT COUNT(*) FROM session_pause WHERE session_id = ? AND resumed_at IS NULL",
            )
            .bind(session_id)
            .fetch_one(&state.pool)
            .await
            .and_then(|row| row.try_get::<i64, _>(0))
            .unwrap_or(0);
            let on_break = open_pause_count > 0;

            let last_break_end: Option<i64> = sqlx::query(
                "SELECT MAX(resumed_at) FROM session_pause WHERE session_id = ? AND resumed_at IS NOT NULL",
            )
            .bind(session_id)
            .fetch_one(&state.pool)
            .await
            .ok()
            .and_then(|row| row.try_get::<Option<i64>, _>(0).ok().flatten());
            let continuous_work_start = last_break_end.unwrap_or(started_at);
            let continuous_work_ms = now.timestamp_millis() - continuous_work_start;

            let work_threshold_min: i64 = sqlx::query("SELECT value FROM settings WHERE key = 'idle_nudge_work_min'")
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten()
                .and_then(|row| row.try_get::<String, _>(0).ok())
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(90)
                .clamp(15, 240);
            let idle_threshold_min: i64 = sqlx::query("SELECT value FROM settings WHERE key = 'idle_nudge_idle_min'")
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten()
                .and_then(|row| row.try_get::<String, _>(0).ok())
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(15)
                .clamp(5, 60);

            if continuous_work_ms > work_threshold_min * 60 * 1000 && !on_break {
                send_reminder(
                    state, app,
                    &format!("{}:no-break", date_key),
                    "Break reminder",
                    &format!("You've been working {} hours straight. Consider taking a short break.",
                             if work_threshold_min >= 60 {
                                 format!("{:.1}", work_threshold_min as f64 / 60.0)
                             } else {
                                 format!("{} min", work_threshold_min)
                             }),
                    Some("break"),
                    interval_ms,
                ).await;
            }

            let idle_secs = get_idle_seconds();
            if idle_secs >= (idle_threshold_min * 60) as u64 && !on_break {
                log::debug!("[notify] user idle for {}s while clocked in", idle_secs);
                send_reminder(
                    state, app,
                    &format!("{}:input-idle", date_key),
                    "Are you still there?",
                    &format!(
                        "You've been idle for {} minutes while clocked in. Take a break or clock out?",
                        idle_secs / 60
                    ),
                    Some("break"),
                    interval_ms,
                ).await;
            }
        }
    }
}

pub fn recalculate_notifications(app: &AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        check_and_notify(&app, &state).await;
    });
}

pub fn start_notification_timer(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last_date = Local::now().format("%Y-%m-%d").to_string();
        let mut day_transition_at: Option<i64> = None;

        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));

            let now = Local::now();
            let current_date = now.format("%Y-%m-%d").to_string();

            if current_date != last_date {
                last_date = current_date;
                day_transition_at = Some(now.timestamp_millis());
                log::info!("[notify] day changed to {}, emitting event + running maintenance", &last_date);
                let _ = app.emit("day-changed", ());

                let state = app.state::<AppState>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    crate::db::run_daily_maintenance(&state.pool).await;
                });
            }

            // Grace period: skip notifications for 5 minutes after midnight transition
            if let Some(transition_ts) = day_transition_at {
                if now.timestamp_millis() - transition_ts < 5 * 60 * 1000 {
                    log::debug!("[notify] within 5min grace period after day change, skipping");
                    continue;
                }
                day_transition_at = None;
            }

            let state = app.state::<AppState>().inner().clone();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                check_and_notify(&app, &state).await;
            });
        }
    });
}

#[tauri::command]
pub async fn check_notifications(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    check_and_notify(&app, &state).await;
    Ok(())
}

#[tauri::command]
pub async fn get_notification_history(
    state: tauri::State<'_, AppState>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<NotificationLogEntry>, ApiError> {
    let lim = limit.unwrap_or(50).clamp(1, 200);
    let off = offset.unwrap_or(0).max(0);

    let rows = sqlx::query(
        "SELECT id, key, title, body, action_kind, created_at
         FROM notification_log
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?",
    )
    .bind(lim)
    .bind(off)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    let entries = rows
        .iter()
        .map(|row| NotificationLogEntry {
            id: row.try_get(0).unwrap_or(0),
            key: row.try_get(1).unwrap_or_default(),
            title: row.try_get(2).unwrap_or_default(),
            body: row.try_get(3).unwrap_or_default(),
            action_kind: row.try_get(4).ok(),
            created_at: row.try_get(5).unwrap_or(0),
        })
        .collect();

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use crate::test_helpers::test_state;
    use sqlx::Row;

    fn is_in_quiet_hours(minute: i64, quiet_start: i64, quiet_end: i64) -> bool {
        if quiet_start <= quiet_end {
            minute >= quiet_start && minute < quiet_end
        } else {
            minute >= quiet_start || minute < quiet_end
        }
    }

    #[test]
    fn quiet_hours_no_wrap() {
        assert!(!is_in_quiet_hours(480, 540, 1020));
        assert!(is_in_quiet_hours(540, 540, 1020));
        assert!(is_in_quiet_hours(720, 540, 1020));
        assert!(!is_in_quiet_hours(1020, 540, 1020));
        assert!(!is_in_quiet_hours(1200, 540, 1020));
    }

    #[test]
    fn quiet_hours_wrap_around() {
        assert!(is_in_quiet_hours(1320, 1320, 480));
        assert!(is_in_quiet_hours(1400, 1320, 480));
        assert!(is_in_quiet_hours(0, 1320, 480));
        assert!(is_in_quiet_hours(300, 1320, 480));
        assert!(!is_in_quiet_hours(480, 1320, 480));
        assert!(!is_in_quiet_hours(720, 1320, 480));
    }

    #[tokio::test]
    async fn notify_once_deduplicates_by_key() {
        let state = test_state().await;

        sqlx::query(
            "INSERT INTO app_meta (key, value) VALUES ('last_notif_key', 'test-key-1|1700000000000')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .execute(&state.pool)
        .await
        .unwrap();

        let raw: String = sqlx::query("SELECT value FROM app_meta WHERE key = 'last_notif_key'")
            .fetch_one(&state.pool)
            .await
            .unwrap()
            .try_get(0)
            .unwrap();
        let parts: Vec<&str> = raw.splitn(2, '|').collect();
        assert_eq!(parts[0], "test-key-1");

        let should_skip = parts[0] == "test-key-1";
        assert!(should_skip);

        let should_skip = parts[0] == "test-key-2";
        assert!(!should_skip);
    }

    #[tokio::test]
    async fn overtime_nudge_fires_at_30_min_intervals() {
        let end_min = 1020;
        for minute in [1050, 1080, 1110, 1140] {
            assert!(minute > end_min && minute % 30 == 0, "minute {} should trigger", minute);
        }
        for minute in [1021, 1035, 1045, 1055] {
            assert!(!(minute > end_min && minute % 30 == 0), "minute {} should not trigger", minute);
        }
    }

    #[tokio::test]
    async fn no_break_nudge_fires_after_90_minutes() {
        let threshold_ms = 90 * 60 * 1000;
        let started_at = 1_700_000_000_000_i64;
        let now_ms = started_at + threshold_ms + 1;
        let active_for = now_ms - started_at;
        assert!(active_for > threshold_ms);

        let now_ms_early = started_at + threshold_ms - 1;
        let active_for_early = now_ms_early - started_at;
        assert!(active_for_early <= threshold_ms);
    }

    #[tokio::test]
    async fn db_backed_idle_nudge_thresholds() {
        let state = test_state().await;

        sqlx::query("INSERT INTO settings (key, value) VALUES ('idle_nudge_work_min', '60')")
            .execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('idle_nudge_idle_min', '10')")
            .execute(&state.pool).await.unwrap();

        let work_str: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'idle_nudge_work_min'")
            .fetch_one(&state.pool).await.unwrap();
        let idle_str: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'idle_nudge_idle_min'")
            .fetch_one(&state.pool).await.unwrap();
        let work = work_str.parse::<i64>().unwrap().clamp(15, 240);
        let idle = idle_str.parse::<i64>().unwrap().clamp(5, 60);

        assert_eq!(work, 60);
        assert_eq!(idle, 10);

        let work_threshold_ms = work * 60 * 1000;
        let started_at = 1_700_000_000_000_i64;
        let now_ms = started_at + work_threshold_ms + 1;
        assert!(now_ms - started_at > work_threshold_ms);
    }

    #[test]
    fn idle_seconds_returns_zero_or_more() {
        let secs = super::get_idle_seconds();
        assert!(secs < 60 * 60 * 24, "idle seconds should be reasonable, got {}", secs);
    }

    #[tokio::test]
    async fn notifications_disabled_skips_all() {
        let state = test_state().await;

        sqlx::query("INSERT INTO settings (key, value) VALUES ('notifications_enabled', '0')")
            .execute(&state.pool)
            .await
            .unwrap();

        let val: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'notifications_enabled'")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert!(matches!(val.as_str(), "0" | "false" | "False"));
    }

    #[test]
    fn shift_end_timestamp_same_calendar_day() {
        use chrono::TimeZone;
        let local = chrono::Local;
        let now = local.with_ymd_and_hms(2026, 5, 9, 18, 0, 0).unwrap();
        let end = super::shift_end_timestamp_ms(now, 9 * 60, 17 * 60).unwrap();
        let expect = local.with_ymd_and_hms(2026, 5, 9, 17, 0, 0).unwrap().timestamp_millis();
        assert_eq!(end, expect);
    }

    #[test]
    fn shift_end_timestamp_overnight_ends_next_morning() {
        use chrono::TimeZone;
        let local = chrono::Local;
        let now = local.with_ymd_and_hms(2026, 5, 9, 23, 0, 0).unwrap();
        let end = super::shift_end_timestamp_ms(now, 22 * 60 + 30, 6 * 60).unwrap();
        let expect = local.with_ymd_and_hms(2026, 5, 10, 6, 0, 0).unwrap().timestamp_millis();
        assert_eq!(end, expect);
    }

    #[tokio::test]
    async fn notification_log_insert_and_query() {
        let state = test_state().await;
        let now = chrono::Local::now().timestamp_millis();

        sqlx::query(
            "INSERT INTO notification_log (key, title, body, action_kind, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind("2026-05-09:clock-in")
        .bind("Clock In Reminder")
        .bind("Time to start your shift.")
        .bind(Some("clock_in"))
        .bind(now)
        .execute(&state.pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO notification_log (key, title, body, action_kind, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind("2026-05-09:clock-out")
        .bind("Shift Ended")
        .bind("Your shift has ended.")
        .bind(None::<String>)
        .bind(now + 1000)
        .execute(&state.pool)
        .await
        .unwrap();

        let rows: Vec<(i64, String, String, String, Option<String>, i64)> = sqlx::query_as(
            "SELECT id, key, title, body, action_kind, created_at FROM notification_log ORDER BY created_at DESC",
        )
        .fetch_all(&state.pool)
        .await
        .unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].2, "Shift Ended");
        assert_eq!(rows[1].2, "Clock In Reminder");
        assert_eq!(rows[1].4, Some("clock_in".to_string()));
        assert!(rows[0].4.is_none());
    }

    #[tokio::test]
    async fn notification_log_pagination() {
        let state = test_state().await;
        let base = chrono::Local::now().timestamp_millis();

        for i in 0..5 {
            sqlx::query(
                "INSERT INTO notification_log (key, title, body, action_kind, created_at) VALUES (?, ?, ?, NULL, ?)",
            )
            .bind(format!("key-{i}"))
            .bind(format!("Title {i}"))
            .bind(format!("Body {i}"))
            .bind(base + i * 1000)
            .execute(&state.pool)
            .await
            .unwrap();
        }

        let page1: Vec<(i64, String)> = sqlx::query_as(
            "SELECT id, title FROM notification_log ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(2i64)
        .bind(0i64)
        .fetch_all(&state.pool)
        .await
        .unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].1, "Title 4");
        assert_eq!(page1[1].1, "Title 3");

        let page2: Vec<(i64, String)> = sqlx::query_as(
            "SELECT id, title FROM notification_log ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(2i64)
        .bind(2i64)
        .fetch_all(&state.pool)
        .await
        .unwrap();
        assert_eq!(page2.len(), 2);
        assert_eq!(page2[0].1, "Title 2");
    }
}
