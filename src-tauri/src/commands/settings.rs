use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt as _;

use crate::commands::session::ApiError;
use crate::notifications;
use crate::state::AppState;

#[tauri::command]
pub async fn consume_startup_notice(state: tauri::State<'_, AppState>) -> Result<Option<String>, ApiError> {
    let notice: Option<String> = sqlx::query("SELECT value FROM app_meta WHERE key = 'startup_notice'")
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?
        .map(|row| row.try_get(0).map_err(|e| ApiError::from(e.to_string())))
        .transpose()?;

    if notice.is_some() {
        sqlx::query("DELETE FROM app_meta WHERE key = 'startup_notice'")
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
    }

    Ok(notice)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub autostart_enabled: bool,
    pub notifications_enabled: bool,
    pub idle_nudge_enabled: bool,
    pub quiet_hours_enabled: bool,
    pub quiet_hours_start_min: i64,
    pub quiet_hours_end_min: i64,
    pub reminder_interval_min: i64,
    pub window_opacity: f64,
    pub always_on_top: bool,
    pub week_start_day: i64,
    pub time_format: String,
    pub idle_nudge_work_min: i64,
    pub idle_nudge_idle_min: i64,
    pub accountability_mode: String, // "shift" or "target"
}

async fn get_bool(state: &AppState, key: &str, default: bool) -> Result<bool, String> {
    let value: Option<String> = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?
        .map(|row| row.try_get(0).map_err(|e| e.to_string()))
        .transpose()?;
    Ok(value
        .as_deref()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(default))
}

async fn get_string(state: &AppState, key: &str, default: &str) -> Result<String, String> {
    let value: Option<String> = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?
        .map(|row| row.try_get(0).map_err(|e| e.to_string()))
        .transpose()?;
    Ok(value.unwrap_or_else(|| default.to_string()))
}

async fn get_f64(state: &AppState, key: &str, default: f64) -> Result<f64, String> {
    let value: Option<String> = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?
        .map(|row| row.try_get(0).map_err(|e| e.to_string()))
        .transpose()?;
    Ok(value
        .and_then(|v| v.parse::<f64>().ok())
        .map(|v| v.clamp(0.45, 1.0))
        .unwrap_or(default))
}

async fn get_i64(state: &AppState, key: &str, default: i64) -> Result<i64, String> {
    let value: Option<String> = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?
        .map(|row| row.try_get(0).map_err(|e| e.to_string()))
        .transpose()?;
    Ok(value.and_then(|v| v.parse::<i64>().ok()).unwrap_or(default))
}

async fn build_app_settings(state: &AppState) -> Result<AppSettings, String> {
    Ok(AppSettings {
        autostart_enabled: get_bool(state, "autostart_enabled", true).await?,
        notifications_enabled: get_bool(state, "notifications_enabled", true).await?,
        idle_nudge_enabled: get_bool(state, "idle_nudge_enabled", true).await?,
        quiet_hours_enabled: get_bool(state, "quiet_hours_enabled", false).await?,
        quiet_hours_start_min: get_i64(state, "quiet_hours_start_min", 1320).await?,
        quiet_hours_end_min: get_i64(state, "quiet_hours_end_min", 480).await?,
        reminder_interval_min: get_i64(state, "reminder_interval_min", 5).await?,
        window_opacity: get_f64(state, "window_opacity", 0.96).await?,
        always_on_top: get_bool(state, "always_on_top", false).await?,
        week_start_day: get_i64(state, "week_start_day", 1).await?.clamp(0, 1),
        time_format: get_string(state, "time_format", "12h").await?,
        idle_nudge_work_min: get_i64(state, "idle_nudge_work_min", 90).await?.clamp(15, 240),
        idle_nudge_idle_min: get_i64(state, "idle_nudge_idle_min", 15).await?.clamp(5, 60),
        accountability_mode: get_string(state, "accountability_mode", "shift").await?,
    })
}

#[tauri::command]
pub async fn get_app_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, ApiError> {
    build_app_settings(&state).await.map_err(ApiError::from)
}

#[tauri::command]
pub async fn save_app_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('autostart_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(if settings.autostart_enabled { "1" } else { "0" })
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('notifications_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(if settings.notifications_enabled { "1" } else { "0" })
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    if settings.autostart_enabled {
        let _ = app.autolaunch().enable();
    } else {
        let _ = app.autolaunch().disable();
    }
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('idle_nudge_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(if settings.idle_nudge_enabled { "1" } else { "0" })
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('quiet_hours_enabled', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(if settings.quiet_hours_enabled { "1" } else { "0" })
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('quiet_hours_start_min', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(settings.quiet_hours_start_min.clamp(0, 1439).to_string())
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('quiet_hours_end_min', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(settings.quiet_hours_end_min.clamp(0, 1439).to_string())
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('reminder_interval_min', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(settings.reminder_interval_min.clamp(1, 60).to_string())
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('window_opacity', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(settings.window_opacity.clamp(0.45, 1.0).to_string())
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('always_on_top', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(if settings.always_on_top { "1" } else { "0" })
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('week_start_day', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(settings.week_start_day.clamp(0, 1).to_string())
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('time_format', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(if settings.time_format == "24h" { "24h" } else { "12h" })
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('idle_nudge_work_min', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(settings.idle_nudge_work_min.clamp(15, 240).to_string())
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('idle_nudge_idle_min', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(settings.idle_nudge_idle_min.clamp(5, 60).to_string())
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('accountability_mode', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(if settings.accountability_mode == "target" { "target" } else { "shift" })
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(settings.always_on_top);
    }

    notifications::recalculate_notifications(&app);

    Ok(())
}

#[tauri::command]
pub async fn open_data_folder(state: tauri::State<'_, AppState>) -> Result<(), ApiError> {
    tauri_plugin_opener::open_path(state.data_dir.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
pub async fn get_app_settings_direct(state: &AppState) -> Result<AppSettings, String> {
    build_app_settings(state).await
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_state;

    #[tokio::test]
    async fn defaults_when_no_settings_stored() {
        let state = test_state().await;
        let settings = get_app_settings_direct(&state).await.unwrap();

        assert!(settings.autostart_enabled);
        assert!(settings.notifications_enabled);
        assert!(settings.idle_nudge_enabled);
        assert!(!settings.quiet_hours_enabled);
        assert_eq!(settings.quiet_hours_start_min, 1320);
        assert_eq!(settings.quiet_hours_end_min, 480);
        assert!((settings.window_opacity - 0.96).abs() < f64::EPSILON);
        assert!(!settings.always_on_top);
        assert_eq!(settings.week_start_day, 1);
        assert_eq!(settings.time_format, "12h");
        assert_eq!(settings.idle_nudge_work_min, 90);
        assert_eq!(settings.idle_nudge_idle_min, 15);
        assert_eq!(settings.accountability_mode, "shift");
    }

    #[tokio::test]
    async fn round_trip_settings() {
        let state = test_state().await;

        sqlx::query("INSERT INTO settings (key, value) VALUES ('autostart_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('notifications_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('window_opacity', '0.75') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .execute(&state.pool).await.unwrap();

        let settings = get_app_settings_direct(&state).await.unwrap();
        assert!(!settings.autostart_enabled);
        assert!(!settings.notifications_enabled);
        assert!((settings.window_opacity - 0.75).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn window_opacity_clamped_low() {
        let state = test_state().await;

        sqlx::query("INSERT INTO settings (key, value) VALUES ('window_opacity', '0.1')")
            .execute(&state.pool)
            .await
            .unwrap();

        let settings = get_app_settings_direct(&state).await.unwrap();
        assert!((settings.window_opacity - 0.45).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn window_opacity_clamped_high() {
        let state = test_state().await;

        sqlx::query("INSERT INTO settings (key, value) VALUES ('window_opacity', '1.5')")
            .execute(&state.pool)
            .await
            .unwrap();

        let settings = get_app_settings_direct(&state).await.unwrap();
        assert!((settings.window_opacity - 1.0).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn boolean_parsing_variants() {
        let state = test_state().await;

        sqlx::query("INSERT INTO settings (key, value) VALUES ('autostart_enabled', 'true')")
            .execute(&state.pool)
            .await
            .unwrap();

        let val = get_bool(&state, "autostart_enabled", false).await.unwrap();
        assert!(val);

        sqlx::query("UPDATE settings SET value = '1' WHERE key = 'autostart_enabled'")
            .execute(&state.pool)
            .await
            .unwrap();

        let val = get_bool(&state, "autostart_enabled", false).await.unwrap();
        assert!(val);

        sqlx::query("UPDATE settings SET value = '0' WHERE key = 'autostart_enabled'")
            .execute(&state.pool)
            .await
            .unwrap();

        let val = get_bool(&state, "autostart_enabled", true).await.unwrap();
        assert!(!val);
    }

    #[tokio::test]
    async fn consume_startup_notice_returns_and_deletes() {
        let state = test_state().await;

        sqlx::query("INSERT INTO app_meta (key, value) VALUES ('startup_notice', 'hello world')")
            .execute(&state.pool)
            .await
            .unwrap();

        let notice: Option<String> = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'startup_notice'")
            .fetch_optional(&state.pool)
            .await
            .unwrap();
        assert_eq!(notice, Some("hello world".to_string()));

        sqlx::query("DELETE FROM app_meta WHERE key = 'startup_notice'")
            .execute(&state.pool)
            .await
            .unwrap();

        let after: Option<String> = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'startup_notice'")
            .fetch_optional(&state.pool)
            .await
            .unwrap();
        assert!(after.is_none());
    }

    #[tokio::test]
    async fn round_trip_new_settings_keys() {
        let state = test_state().await;

        sqlx::query("INSERT INTO settings (key, value) VALUES ('always_on_top', '1')")
            .execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('week_start_day', '0')")
            .execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('time_format', '24h')")
            .execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('idle_nudge_work_min', '120')")
            .execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('idle_nudge_idle_min', '30')")
            .execute(&state.pool).await.unwrap();

        let settings = get_app_settings_direct(&state).await.unwrap();
        assert!(settings.always_on_top);
        assert_eq!(settings.week_start_day, 0);
        assert_eq!(settings.time_format, "24h");
        assert_eq!(settings.idle_nudge_work_min, 120);
        assert_eq!(settings.idle_nudge_idle_min, 30);
    }

    #[tokio::test]
    async fn idle_nudge_thresholds_clamped() {
        let state = test_state().await;

        sqlx::query("INSERT INTO settings (key, value) VALUES ('idle_nudge_work_min', '5')")
            .execute(&state.pool).await.unwrap();
        sqlx::query("INSERT INTO settings (key, value) VALUES ('idle_nudge_idle_min', '1')")
            .execute(&state.pool).await.unwrap();

        let settings = get_app_settings_direct(&state).await.unwrap();
        assert_eq!(settings.idle_nudge_work_min, 15);
        assert_eq!(settings.idle_nudge_idle_min, 5);

        sqlx::query("UPDATE settings SET value = '999' WHERE key = 'idle_nudge_work_min'")
            .execute(&state.pool).await.unwrap();
        sqlx::query("UPDATE settings SET value = '999' WHERE key = 'idle_nudge_idle_min'")
            .execute(&state.pool).await.unwrap();

        let settings = get_app_settings_direct(&state).await.unwrap();
        assert_eq!(settings.idle_nudge_work_min, 240);
        assert_eq!(settings.idle_nudge_idle_min, 60);
    }

    #[tokio::test]
    async fn week_start_day_clamped() {
        let state = test_state().await;

        sqlx::query("INSERT INTO settings (key, value) VALUES ('week_start_day', '5')")
            .execute(&state.pool).await.unwrap();

        let settings = get_app_settings_direct(&state).await.unwrap();
        assert_eq!(settings.week_start_day, 1); // clamped to max 1
    }

}
