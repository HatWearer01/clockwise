use serde::Serialize;
use sqlx::Row;

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
}

#[tauri::command]
pub async fn get_daily_tasks(
    state: tauri::State<'_, AppState>,
    date: String,
) -> Result<Vec<DailyTask>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, date, text, done, done_at, created_at, position
         FROM daily_task
         WHERE date = ?
         ORDER BY done ASC, position ASC, created_at ASC",
    )
    .bind(&date)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    rows.into_iter()
        .map(|row| {
            Ok(DailyTask {
                id: row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?,
                date: row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?,
                text: row.try_get(2).map_err(|e| ApiError::from(e.to_string()))?,
                done: row.try_get::<i64, _>(3).map_err(|e| ApiError::from(e.to_string()))? != 0,
                done_at: row.try_get(4).map_err(|e| ApiError::from(e.to_string()))?,
                created_at: row.try_get(5).map_err(|e| ApiError::from(e.to_string()))?,
                position: row.try_get(6).map_err(|e| ApiError::from(e.to_string()))?,
            })
        })
        .collect()
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
        "INSERT INTO daily_task (date, text, done, done_at, created_at, position)
         VALUES (?, ?, 0, NULL, ?, ?)",
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_state;

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
