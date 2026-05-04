use serde::{Deserialize, Serialize};
use sqlx::Row;
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

#[tauri::command]
pub async fn get_app_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, ApiError> {
    Ok(AppSettings {
        autostart_enabled: get_bool(&state, "autostart_enabled", true).await.map_err(ApiError::from)?,
        notifications_enabled: get_bool(&state, "notifications_enabled", true).await.map_err(ApiError::from)?,
        idle_nudge_enabled: get_bool(&state, "idle_nudge_enabled", true).await.map_err(ApiError::from)?,
        quiet_hours_enabled: get_bool(&state, "quiet_hours_enabled", false).await.map_err(ApiError::from)?,
        quiet_hours_start_min: get_string(&state, "quiet_hours_start_min", "1320")
            .await
            .map_err(ApiError::from)?
            .parse::<i64>()
            .unwrap_or(1320),
        quiet_hours_end_min: get_string(&state, "quiet_hours_end_min", "480")
            .await
            .map_err(ApiError::from)?
            .parse::<i64>()
            .unwrap_or(480),
        reminder_interval_min: get_string(&state, "reminder_interval_min", "5")
            .await
            .map_err(ApiError::from)?
            .parse::<i64>()
            .unwrap_or(5),
        window_opacity: get_f64(&state, "window_opacity", 0.96).await.map_err(ApiError::from)?,
    })
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
    Ok(AppSettings {
        autostart_enabled: get_bool(state, "autostart_enabled", true).await?,
        notifications_enabled: get_bool(state, "notifications_enabled", true).await?,
        idle_nudge_enabled: get_bool(state, "idle_nudge_enabled", true).await?,
        quiet_hours_enabled: get_bool(state, "quiet_hours_enabled", false).await?,
        quiet_hours_start_min: get_string(state, "quiet_hours_start_min", "1320")
            .await?
            .parse::<i64>()
            .unwrap_or(1320),
        quiet_hours_end_min: get_string(state, "quiet_hours_end_min", "480")
            .await?
            .parse::<i64>()
            .unwrap_or(480),
        reminder_interval_min: get_string(state, "reminder_interval_min", "5")
            .await?
            .parse::<i64>()
            .unwrap_or(5),
        window_opacity: get_f64(state, "window_opacity", 0.96).await?,
    })
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

}
