#![allow(clippy::missing_errors_doc)]

mod commands;
mod db;
mod heartbeat;
mod lock_detect;
mod notifications;
mod startup;
mod state;
mod sync_server;
#[cfg(test)]
mod test_helpers;
mod tray;
mod window;

use std::fs;
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as _;

use crate::state::{AppState, SyncState};

#[tauri::command]
async fn cmd_generate_pairing_code(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let code = sync_server::generate_pairing_code();
    *state.sync.pairing_code.write().await = Some(code.clone());
    Ok(code)
}

#[tauri::command]
async fn cmd_get_sync_status(state: tauri::State<'_, AppState>) -> Result<serde_json::Value, String> {
    let paired = state.sync.paired_device.read().await.clone();
    let connected = *state.sync.connected.read().await;
    let ip = sync_server::get_local_ip();
    Ok(serde_json::json!({
        "paired_device": paired,
        "connected": connected,
        "local_ip": ip,
        "port": sync_server::SYNC_PORT,
    }))
}

#[tauri::command]
fn cmd_get_local_ip() -> Result<String, String> {
    sync_server::get_local_ip().ok_or_else(|| "Could not determine local IP".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:clockwise.db", db::plugin_migrations())
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = dirs::document_dir()
                .ok_or("Cannot determine Documents directory")?
                .join("Clockwise");
            fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

            // Migrate from legacy location (exe_dir/data/) if new location is empty
            let db_path = data_dir.join("clockwise.db");
            if !db_path.exists() {
                if let Ok(exe) = std::env::current_exe() {
                    if let Some(exe_dir) = exe.parent() {
                        let legacy_db = exe_dir.join("data").join("clockwise.db");
                        if legacy_db.exists() {
                            log::info!("[setup] migrating DB from {:?} to {:?}", legacy_db, db_path);
                            let _ = fs::copy(&legacy_db, &db_path);
                            // Also copy WAL/SHM if present
                            let legacy_wal = exe_dir.join("data").join("clockwise.db-wal");
                            let legacy_shm = exe_dir.join("data").join("clockwise.db-shm");
                            if legacy_wal.exists() {
                                let _ = fs::copy(&legacy_wal, data_dir.join("clockwise.db-wal"));
                            }
                            if legacy_shm.exists() {
                                let _ = fs::copy(&legacy_shm, data_dir.join("clockwise.db-shm"));
                            }
                        }
                    }
                }
            }

            let db_url = db::sqlite_url_from_path(&db_path);
            let pool = tauri::async_runtime::block_on(db::connect_pool(&db_url))?;

            let state = AppState {
                pool: pool.clone(),
                heartbeat_path: data_dir.join("heartbeat"),
                data_dir: data_dir.clone(),
                sync: Arc::new(SyncState::default()),
            };

            tauri::async_runtime::block_on(db::init_db(&pool))?;
            tauri::async_runtime::block_on(startup::reconcile_stale_session(&state))?;
            app.manage(state.clone());

            // Spawn LAN sync server
            tauri::async_runtime::spawn(sync_server::start_sync_server(state.clone()));

            let managed = app.state::<AppState>().inner().clone();
            heartbeat::start_heartbeat_writer(managed.heartbeat_path.clone());
            let autostart = tauri::async_runtime::block_on(async {
                sqlx::query("SELECT value FROM settings WHERE key = 'autostart_enabled'")
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten()
                    .and_then(|row| sqlx::Row::try_get::<String, _>(&row, 0).ok())
                    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                    .unwrap_or(true)
            });
            if autostart {
                let _ = app.autolaunch().enable();
            } else {
                let _ = app.autolaunch().disable();
            }

            notifications::recalculate_notifications(&app.handle());
            notifications::start_notification_timer(&app.handle());
            lock_detect::init_lock_and_sleep_listener(&app.handle());
            tray::init_tray(app)?;
            window::init_window_mode_support(app);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            cmd_generate_pairing_code,
            cmd_get_sync_status,
            cmd_get_local_ip,
            commands::session::clock_in,
            commands::session::clock_out,
            commands::session::start_break,
            commands::session::resume_break,
            commands::session::get_status,
            commands::session::get_week_summary,
            commands::session::get_stats_summary,
            commands::session::get_insights,
            commands::session::get_weekly_review,
            commands::session::get_last_reviewed_week,
            commands::session::set_last_reviewed_week,
            commands::session::get_pending_recovery,
            commands::session::apply_pending_recovery,
            commands::session::get_session_checklist,
            commands::session::toggle_checklist_item,
            commands::session::mark_week_done,
            commands::session::is_week_done,
            commands::session::mark_day_done,
            commands::session::is_day_done,
            commands::schedule::get_schedule,
            commands::schedule::save_schedule,
            commands::schedule::create_template,
            commands::schedule::activate_template,
            commands::schedule::save_day_targets,
            commands::settings::get_app_settings,
            commands::settings::save_app_settings,
            commands::settings::consume_startup_notice,
            commands::settings::open_data_folder,
            commands::tasks::get_daily_tasks,
            commands::tasks::add_daily_task,
            commands::tasks::update_daily_task,
            commands::tasks::toggle_daily_task,
            commands::tasks::delete_daily_task,
            commands::tasks::rollover_daily_task,
            commands::tasks::get_recurring_tasks,
            commands::tasks::add_recurring_task,
            commands::tasks::update_recurring_task,
            commands::tasks::delete_recurring_task,
            commands::tasks::get_tasks_for_week,
            commands::tasks::add_subtask,
            commands::tasks::toggle_subtask,
            commands::tasks::delete_subtask,
            notifications::check_notifications,
            notifications::get_notification_history,
            window::set_mode,
            window::show_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
