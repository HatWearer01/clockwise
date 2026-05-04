#![allow(clippy::missing_errors_doc)]

mod commands;
mod db;
mod heartbeat;
mod lock_detect;
mod notifications;
mod startup;
mod state;
#[cfg(test)]
mod test_helpers;
mod tray;
mod window;

use std::fs;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as _;

use crate::state::AppState;

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
            let exe_dir = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .parent()
                .ok_or("Cannot determine exe directory")?
                .to_path_buf();
            let data_dir = exe_dir.join("data");
            fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
            let db_path = data_dir.join("clockwise.db");
            let db_url = db::sqlite_url_from_path(&db_path);
            let pool = tauri::async_runtime::block_on(db::connect_pool(&db_url))?;

            let state = AppState {
                pool: pool.clone(),
                heartbeat_path: data_dir.join("heartbeat"),
                data_dir: data_dir.clone(),
            };

            tauri::async_runtime::block_on(db::init_db(&pool))?;
            tauri::async_runtime::block_on(startup::reconcile_stale_session(&state))?;
            app.manage(state);
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
            let _ = commands::settings::apply_saved_window_settings(&app.handle(), &managed);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::session::clock_in,
            commands::session::clock_out,
            commands::session::start_break,
            commands::session::resume_break,
            commands::session::get_status,
            commands::session::get_week_summary,
            commands::session::get_stats_summary,
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
            notifications::check_notifications,
            window::set_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
