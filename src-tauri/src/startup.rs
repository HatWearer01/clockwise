use chrono::{Local, TimeZone};
use serde_json::json;

use crate::commands::session::{active_session, SessionRecord};
use crate::db::now_ms;
use crate::heartbeat::heartbeat_timestamp_ms;
use crate::state::AppState;

async fn save_startup_notice(state: &AppState, message: &str) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO app_meta (key, value) VALUES ('startup_notice', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(message)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn reconcile_stale_session(state: &AppState) -> Result<(), String> {
    let stale: Option<SessionRecord> = active_session(&state.pool).await?;
    let Some(stale) = stale else {
        return Ok(());
    };

    let now = now_ms();
    let estimated_stop = heartbeat_timestamp_ms(&state.heartbeat_path)
        .filter(|value| *value >= stale.started_at && *value <= now)
        .unwrap_or(now);

    let pending = json!({
        "session_id": stale.id,
        "started_at": stale.started_at,
        "suggested_end_at": estimated_stop
    })
    .to_string();
    sqlx::query(
        "INSERT INTO app_meta (key, value) VALUES ('pending_recovery', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(pending)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let start_local = Local.timestamp_millis_opt(stale.started_at).single();
    let end_local = Local.timestamp_millis_opt(estimated_stop).single();
    let end_label = match (&start_local, &end_local) {
        (Some(s), Some(e)) if s.date_naive() != e.date_naive() => {
            e.format("%b %d, %Y at %H:%M").to_string()
        }
        (_, Some(e)) => e.format("%H:%M").to_string(),
        _ => "unknown time".to_string(),
    };
    let message = format!(
        "Found an open session from last run. Suggested end time: {}. Please confirm or edit it.",
        end_label
    );
    save_startup_notice(state, &message).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::now_ms;
    use crate::test_helpers::test_state;

    #[tokio::test]
    async fn reconcile_does_nothing_when_no_open_session() {
        let state = test_state().await;
        reconcile_stale_session(&state).await.unwrap();

        let pending: Option<String> = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'pending_recovery'")
            .fetch_optional(&state.pool)
            .await
            .unwrap();
        assert!(pending.is_none());
    }

    #[tokio::test]
    async fn reconcile_creates_pending_recovery_for_open_session() {
        let state = test_state().await;
        let started = now_ms() - 7_200_000; // 2 hours ago

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(started)
            .execute(&state.pool)
            .await
            .unwrap();

        reconcile_stale_session(&state).await.unwrap();

        let pending: String = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'pending_recovery'")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        let parsed: serde_json::Value = serde_json::from_str(&pending).unwrap();
        assert_eq!(parsed["started_at"].as_i64().unwrap(), started);
        assert!(parsed["session_id"].as_i64().unwrap() > 0);
        assert!(parsed["suggested_end_at"].as_i64().unwrap() >= started);
    }

    #[tokio::test]
    async fn reconcile_creates_startup_notice() {
        let state = test_state().await;
        let started = now_ms() - 3_600_000;

        sqlx::query("INSERT INTO session (started_at, ended_at) VALUES (?, NULL)")
            .bind(started)
            .execute(&state.pool)
            .await
            .unwrap();

        reconcile_stale_session(&state).await.unwrap();

        let notice: String = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'startup_notice'")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert!(notice.contains("Found an open session"));
    }

    #[tokio::test]
    async fn save_startup_notice_can_be_consumed() {
        let state = test_state().await;
        save_startup_notice(&state, "Test notice").await.unwrap();

        let notice: String = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'startup_notice'")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(notice, "Test notice");

        // Consuming deletes it
        sqlx::query("DELETE FROM app_meta WHERE key = 'startup_notice'")
            .execute(&state.pool)
            .await
            .unwrap();

        let consumed: Option<String> = sqlx::query_scalar("SELECT value FROM app_meta WHERE key = 'startup_notice'")
            .fetch_optional(&state.pool)
            .await
            .unwrap();
        assert!(consumed.is_none());
    }

    #[tokio::test]
    async fn heartbeat_timestamp_returns_none_for_missing_file() {
        let path = std::path::PathBuf::from("nonexistent_heartbeat_file_test_12345");
        let ts = heartbeat_timestamp_ms(&path);
        assert!(ts.is_none());
    }

    #[tokio::test]
    async fn heartbeat_timestamp_returns_value_for_existing_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("clockwise_test_heartbeat");
        std::fs::write(&path, "alive").unwrap();

        let ts = heartbeat_timestamp_ms(&path);
        assert!(ts.is_some());
        assert!(ts.unwrap() > 0);

        std::fs::remove_file(&path).ok();
    }
}
