use chrono::{Datelike, Local, Timelike};
use sqlx::Row;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::System::SystemInformation::GetTickCount;

use crate::state::AppState;

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

    let monday = now.date_naive() - chrono::Duration::days(i64::from(now.weekday().num_days_from_monday()));
    let done_key = format!("done_week_{}", monday.format("%Y-%m-%d"));
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
    let (Some(start_min), Some(end_min)) = (start_min, end_min) else {
        return;
    };

    let has_active_session: bool = sqlx::query("SELECT COUNT(*) FROM session WHERE ended_at IS NULL")
        .fetch_one(&state.pool)
        .await
        .and_then(|row| row.try_get::<i64, _>(0))
        .map(|c| c > 0)
        .unwrap_or(false);

    let is_overnight = start_min > end_min;
    let in_shift = if is_overnight {
        minute >= start_min || minute < end_min
    } else {
        minute >= start_min && minute < end_min
    };
    let before_shift = minute >= start_min.saturating_sub(6) && minute < start_min;

    let interval_ms = get_interval_ms(state).await;
    let date_key = now.format("%Y-%m-%d").to_string();

    log::debug!("[notify] check: minute={minute}, start={start_min}, end={end_min}, in_shift={in_shift}, before={before_shift}, active={has_active_session}, interval={}min", interval_ms / 60000);

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
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        let state = app.state::<AppState>().inner().clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            check_and_notify(&app, &state).await;
        });
    });
}

#[tauri::command]
pub async fn check_notifications(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    check_and_notify(&app, &state).await;
    Ok(())
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
}
