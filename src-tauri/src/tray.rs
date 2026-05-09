use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Emitter, Manager};

pub fn init_tray(app: &App) -> Result<(), String> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "No default window icon found".to_string())?;
    let show = MenuItem::with_id(app, "show", "Show Clockwise", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let clock_in = MenuItem::with_id(app, "clock_in", "Clock In", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let clock_out = MenuItem::with_id(app, "clock_out", "Clock Out", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let week_done =
        MenuItem::with_id(app, "week_done", "Done for the week", true, None::<&str>)
            .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;

    let menu = Menu::with_items(app, &[&show, &clock_in, &clock_out, &week_done, &quit]).map_err(|e| e.to_string())?;

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Clockwise")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "clock_in" => {
                let _ = app.emit("tray-clock-in", ());
            }
            "clock_out" => {
                let _ = app.emit("tray-clock-out", ());
            }
            "week_done" => {
                let _ = app.emit("tray-toggle-week-done", ());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let visible = window.is_visible().unwrap_or(true);
                    if visible {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    Ok(())
}
