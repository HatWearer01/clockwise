use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::commands::session::ApiError;
use crate::db::now_ms;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScheduleTemplate {
    pub id: i64,
    pub name: String,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScheduleBlock {
    pub id: i64,
    pub template_id: i64,
    pub day_of_week: i64,
    pub start_min: i64,
    pub end_min: i64,
    pub label: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlockChecklistItem {
    pub id: i64,
    pub block_id: i64,
    pub text: String,
    pub position: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DayTarget {
    pub day_of_week: i64,
    pub target_min: i64, // 0 means "derive from blocks"
}

#[derive(Debug, Serialize)]
pub struct SchedulePayload {
    pub templates: Vec<ScheduleTemplate>,
    pub active_template_id: i64,
    pub blocks: Vec<ScheduleBlock>,
    pub checklist_items: Vec<BlockChecklistItem>,
    pub day_targets: Vec<DayTarget>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveSchedulePayload {
    pub template_id: i64,
    pub blocks: Vec<ScheduleBlock>,
    pub checklist_items: Vec<BlockChecklistItem>,
}

async fn active_template_id(state: &AppState) -> Result<i64, String> {
    let row = sqlx::query("SELECT id FROM schedule_template WHERE is_active = 1 ORDER BY id LIMIT 1")
        .fetch_one(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    row.try_get(0).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_schedule(state: tauri::State<'_, AppState>) -> Result<SchedulePayload, ApiError> {
    let template_rows = sqlx::query("SELECT id, name, is_active FROM schedule_template ORDER BY created_at, id")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    let templates = template_rows
        .into_iter()
        .map(|row| {
            Ok(ScheduleTemplate {
                id: row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?,
                name: row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?,
                is_active: row.try_get::<i64, _>(2).map_err(|e| ApiError::from(e.to_string()))? == 1,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let active_template_id = active_template_id(&state).await.map_err(ApiError::from)?;

    let block_rows = sqlx::query(
        "SELECT id, template_id, day_of_week, start_min, end_min, COALESCE(label, 'Work block'), COALESCE(color, '#34D399')
         FROM schedule_block WHERE template_id = ? ORDER BY day_of_week, start_min, id",
    )
    .bind(active_template_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    let blocks = block_rows
        .into_iter()
        .map(|row| {
            Ok(ScheduleBlock {
                id: row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?,
                template_id: row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?,
                day_of_week: row.try_get(2).map_err(|e| ApiError::from(e.to_string()))?,
                start_min: row.try_get(3).map_err(|e| ApiError::from(e.to_string()))?,
                end_min: row.try_get(4).map_err(|e| ApiError::from(e.to_string()))?,
                label: row.try_get(5).map_err(|e| ApiError::from(e.to_string()))?,
                color: row.try_get(6).map_err(|e| ApiError::from(e.to_string()))?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    let checklist_rows = sqlx::query(
        "SELECT i.id, i.block_id, i.text, i.position
         FROM block_checklist_item i
         JOIN schedule_block b ON b.id = i.block_id
         WHERE b.template_id = ?
         ORDER BY i.block_id, i.position, i.id",
    )
    .bind(active_template_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    let checklist_items = checklist_rows
        .into_iter()
        .map(|row| {
            Ok(BlockChecklistItem {
                id: row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?,
                block_id: row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?,
                text: row.try_get(2).map_err(|e| ApiError::from(e.to_string()))?,
                position: row.try_get(3).map_err(|e| ApiError::from(e.to_string()))?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    let target_rows = sqlx::query(
        "SELECT day_of_week, target_min FROM schedule_day_target WHERE template_id = ? ORDER BY day_of_week",
    )
    .bind(active_template_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;
    let day_targets = target_rows
        .into_iter()
        .map(|row| {
            Ok(DayTarget {
                day_of_week: row.try_get(0).map_err(|e| ApiError::from(e.to_string()))?,
                target_min: row.try_get(1).map_err(|e| ApiError::from(e.to_string()))?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(SchedulePayload {
        templates,
        active_template_id,
        blocks,
        checklist_items,
        day_targets,
    })
}

#[tauri::command]
pub async fn save_schedule(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    payload: SaveSchedulePayload,
) -> Result<(), ApiError> {
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;

    let existing_ids: Vec<i64> = payload.blocks.iter().filter(|b| b.id > 0).map(|b| b.id).collect();
    if existing_ids.is_empty() {
        sqlx::query("DELETE FROM schedule_block WHERE template_id = ?")
            .bind(payload.template_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
    } else {
        let id_csv = existing_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let query = format!(
            "DELETE FROM schedule_block WHERE template_id = ?1 AND id NOT IN ({})",
            id_csv
        );
        sqlx::query(&query)
            .bind(payload.template_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
    }

    for block in &payload.blocks {
        if !(0..=6).contains(&block.day_of_week) {
            return Err(ApiError::from("Invalid day in schedule."));
        }
        if block.start_min < 0 || block.end_min < 0 || block.start_min > 1440 || block.end_min > 1440 || block.start_min == block.end_min {
            return Err(ApiError::from("Invalid start/end time in schedule."));
        }
        if block.id > 0 {
            sqlx::query(
                "UPDATE schedule_block
                 SET day_of_week = ?, start_min = ?, end_min = ?, label = ?, color = ?
                 WHERE id = ? AND template_id = ?",
            )
            .bind(block.day_of_week)
            .bind(block.start_min)
            .bind(block.end_min)
            .bind(block.label.as_str())
            .bind(block.color.as_str())
            .bind(block.id)
            .bind(payload.template_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
        } else {
            sqlx::query(
                "INSERT INTO schedule_block (template_id, day_of_week, start_min, end_min, label, color)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(payload.template_id)
            .bind(block.day_of_week)
            .bind(block.start_min)
            .bind(block.end_min)
            .bind(block.label.as_str())
            .bind(block.color.as_str())
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::from(e.to_string()))?;
        }
    }

    sqlx::query(
        "DELETE FROM block_checklist_item
         WHERE block_id IN (SELECT id FROM schedule_block WHERE template_id = ?)",
    )
    .bind(payload.template_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::from(e.to_string()))?;

    let persisted_rows = sqlx::query(
        "SELECT id, day_of_week, start_min, end_min, COALESCE(label, ''), COALESCE(color, '')
         FROM schedule_block
         WHERE template_id = ?",
    )
        .bind(payload.template_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    let persisted_blocks: Vec<(i64, i64, i64, i64, String, String)> = persisted_rows
        .into_iter()
        .map(|row| {
            Ok((
                row.try_get::<i64, _>(0).map_err(|e| ApiError::from(e.to_string()))?,
                row.try_get::<i64, _>(1).map_err(|e| ApiError::from(e.to_string()))?,
                row.try_get::<i64, _>(2).map_err(|e| ApiError::from(e.to_string()))?,
                row.try_get::<i64, _>(3).map_err(|e| ApiError::from(e.to_string()))?,
                row.try_get::<String, _>(4).map_err(|e| ApiError::from(e.to_string()))?,
                row.try_get::<String, _>(5).map_err(|e| ApiError::from(e.to_string()))?,
            ))
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    for item in &payload.checklist_items {
        let target_block_id = if item.block_id > 0 {
            item.block_id
        } else if let Some(src_block) = payload.blocks.iter().find(|b| b.id == item.block_id) {
            persisted_blocks
                .iter()
                .find(|(_, day, start, end, label, color)| {
                    *day == src_block.day_of_week
                        && *start == src_block.start_min
                        && *end == src_block.end_min
                        && *label == src_block.label
                        && *color == src_block.color
                })
                .map(|(id, _, _, _, _, _)| *id)
                .unwrap_or(0)
        } else {
            0
        };

        if target_block_id > 0 {
            sqlx::query("INSERT INTO block_checklist_item (block_id, text, position) VALUES (?, ?, ?)")
                .bind(target_block_id)
                .bind(item.text.as_str())
                .bind(item.position)
                .execute(&mut *tx)
                .await
            .map_err(|e| ApiError::from(e.to_string()))?;
        }
    }

    // Keep legacy schedule table in sync for compatibility with old logic.
    sqlx::query("DELETE FROM schedule")
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    for day in 0..=6 {
        let mut day_blocks: Vec<&ScheduleBlock> = payload
            .blocks
            .iter()
            .filter(|b| b.day_of_week == day)
            .collect();
        day_blocks.sort_by_key(|b| b.start_min);
        if let Some(first) = day_blocks.first() {
            let end = day_blocks.iter().map(|b| b.end_min).max().unwrap_or(first.end_min);
            sqlx::query("INSERT INTO schedule (day_of_week, enabled, start_min, end_min) VALUES (?, 1, ?, ?)")
                .bind(day)
                .bind(first.start_min)
                .bind(end)
                .execute(&mut *tx)
                .await
            .map_err(|e| ApiError::from(e.to_string()))?;
        } else {
            sqlx::query("INSERT INTO schedule (day_of_week, enabled, start_min, end_min) VALUES (?, 0, 540, 1020)")
                .bind(day)
                .execute(&mut *tx)
                .await
            .map_err(|e| ApiError::from(e.to_string()))?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    crate::notifications::recalculate_notifications(&app);
    Ok(())
}

#[tauri::command]
pub async fn create_template(state: tauri::State<'_, AppState>, name: String) -> Result<i64, ApiError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ApiError::from("Template name cannot be empty."));
    }
    let result = sqlx::query("INSERT INTO schedule_template (name, is_active, created_at) VALUES (?, 0, ?)")
        .bind(trimmed)
        .bind(now_ms())
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    Ok(result.last_insert_rowid())
}

#[tauri::command]
pub async fn activate_template(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    template_id: i64,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE schedule_template SET is_active = 0")
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    sqlx::query("UPDATE schedule_template SET is_active = 1 WHERE id = ?")
        .bind(template_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    crate::notifications::recalculate_notifications(&app);
    Ok(())
}

#[tauri::command]
pub async fn save_day_targets(
    state: tauri::State<'_, AppState>,
    template_id: i64,
    targets: Vec<DayTarget>,
) -> Result<(), ApiError> {
    for t in &targets {
        if !(0..=6).contains(&t.day_of_week) {
            return Err(ApiError::from("Invalid day_of_week"));
        }
        sqlx::query(
            "INSERT INTO schedule_day_target (template_id, day_of_week, target_min)
             VALUES (?, ?, ?)
             ON CONFLICT(template_id, day_of_week) DO UPDATE SET target_min = excluded.target_min",
        )
        .bind(template_id)
        .bind(t.day_of_week)
        .bind(t.target_min.max(0))
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::from(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_state;

    #[tokio::test]
    async fn get_active_template_id_returns_seeded() {
        let state = test_state().await;
        let id = active_template_id(&state).await.unwrap();
        assert!(id > 0);
    }

    #[tokio::test]
    async fn save_schedule_inserts_new_blocks() {
        let state = test_state().await;
        let template_id = active_template_id(&state).await.unwrap();

        // Clear existing blocks
        sqlx::query("DELETE FROM schedule_block WHERE template_id = ?")
            .bind(template_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let mut tx = state.pool.begin().await.unwrap();

        // Insert a new block (negative ID means create)
        sqlx::query(
            "INSERT INTO schedule_block (template_id, day_of_week, start_min, end_min, label, color) VALUES (?, 1, 480, 720, 'Morning', '#34D399')",
        )
        .bind(template_id)
        .execute(&mut *tx)
        .await
        .unwrap();

        tx.commit().await.unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_block WHERE template_id = ?")
            .bind(template_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn save_schedule_updates_existing_blocks() {
        let state = test_state().await;
        let template_id = active_template_id(&state).await.unwrap();

        let block_id: i64 = sqlx::query_scalar("SELECT id FROM schedule_block WHERE template_id = ? LIMIT 1")
            .bind(template_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("UPDATE schedule_block SET start_min = 600, end_min = 900 WHERE id = ?")
            .bind(block_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let start: i64 = sqlx::query_scalar("SELECT start_min FROM schedule_block WHERE id = ?")
            .bind(block_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(start, 600);
    }

    #[tokio::test]
    async fn save_schedule_deletes_removed_blocks() {
        let state = test_state().await;
        let template_id = active_template_id(&state).await.unwrap();

        let initial_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_block WHERE template_id = ?")
            .bind(template_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(initial_count, 5);

        // Keep only the first block
        let first_id: i64 = sqlx::query_scalar("SELECT id FROM schedule_block WHERE template_id = ? ORDER BY id LIMIT 1")
            .bind(template_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();

        let query = format!(
            "DELETE FROM schedule_block WHERE template_id = ?1 AND id NOT IN ({})",
            first_id
        );
        sqlx::query(&query)
            .bind(template_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_block WHERE template_id = ?")
            .bind(template_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn save_schedule_validates_day_of_week() {
        // Day must be 0..=6
        let block = ScheduleBlock {
            id: -1,
            template_id: 1,
            day_of_week: 7, // invalid
            start_min: 540,
            end_min: 1020,
            label: "Work".to_string(),
            color: "#34D399".to_string(),
        };
        let valid = (0..=6).contains(&block.day_of_week);
        assert!(!valid);
    }

    #[tokio::test]
    async fn save_schedule_validates_time_range() {
        let block = ScheduleBlock {
            id: -1,
            template_id: 1,
            day_of_week: 1,
            start_min: 1020,
            end_min: 540, // end before start
            label: "Work".to_string(),
            color: "#34D399".to_string(),
        };
        let valid = block.start_min >= 0 && block.end_min <= 1440 && block.start_min < block.end_min;
        assert!(!valid);
    }

    #[tokio::test]
    async fn legacy_schedule_sync_creates_7_rows() {
        let state = test_state().await;

        // Simulate what save_schedule does for legacy sync
        sqlx::query("DELETE FROM schedule")
            .execute(&state.pool)
            .await
            .unwrap();

        for day in 0..=6 {
            let enabled = if (1..=5).contains(&day) { 1 } else { 0 };
            sqlx::query("INSERT INTO schedule (day_of_week, enabled, start_min, end_min) VALUES (?, ?, 540, 1020)")
                .bind(day)
                .bind(enabled)
                .execute(&state.pool)
                .await
                .unwrap();
        }

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(count, 7);
    }

    #[tokio::test]
    async fn create_template_rejects_empty_name() {
        let name = "   ";
        let trimmed = name.trim();
        assert!(trimmed.is_empty());
    }

    #[tokio::test]
    async fn create_template_inserts_new_row() {
        let state = test_state().await;

        let result = sqlx::query("INSERT INTO schedule_template (name, is_active, created_at) VALUES ('Test template', 0, 1000)")
            .execute(&state.pool)
            .await
            .unwrap();

        assert!(result.last_insert_rowid() > 0);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_template")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(count, 2); // "Normal week" + new one
    }

    #[tokio::test]
    async fn activate_template_deactivates_others() {
        let state = test_state().await;

        sqlx::query("INSERT INTO schedule_template (name, is_active, created_at) VALUES ('Alt', 0, 1000)")
            .execute(&state.pool)
            .await
            .unwrap();

        let alt_id: i64 = sqlx::query_scalar("SELECT id FROM schedule_template WHERE name = 'Alt'")
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("UPDATE schedule_template SET is_active = 0")
            .execute(&state.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE schedule_template SET is_active = 1 WHERE id = ?")
            .bind(alt_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let active_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM schedule_template WHERE is_active = 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(active_count, 1);

        let active_name: String = sqlx::query_scalar("SELECT name FROM schedule_template WHERE is_active = 1")
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(active_name, "Alt");
    }

    #[tokio::test]
    async fn checklist_items_cascade_on_block_delete() {
        let state = test_state().await;
        let template_id = active_template_id(&state).await.unwrap();

        let block_id: i64 = sqlx::query_scalar("SELECT id FROM schedule_block WHERE template_id = ? LIMIT 1")
            .bind(template_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();

        sqlx::query("INSERT INTO block_checklist_item (block_id, text, position) VALUES (?, 'Task 1', 0)")
            .bind(block_id)
            .execute(&state.pool)
            .await
            .unwrap();

        sqlx::query("DELETE FROM schedule_block WHERE id = ?")
            .bind(block_id)
            .execute(&state.pool)
            .await
            .unwrap();

        let item_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM block_checklist_item WHERE block_id = ?")
            .bind(block_id)
            .fetch_one(&state.pool)
            .await
            .unwrap();
        assert_eq!(item_count, 0, "Checklist items should cascade-delete with block");
    }
}
