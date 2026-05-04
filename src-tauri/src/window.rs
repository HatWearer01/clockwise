use tauri::{LogicalSize, Manager, WebviewWindow};

#[tauri::command]
pub fn show_window(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_mode(window: WebviewWindow, mode: String) -> Result<(), String> {
    match mode.as_str() {
        "compact" => {
            let _ = window.set_fullscreen(false);
            window
                .set_size(LogicalSize::new(450.0, 720.0))
                .map_err(|e| e.to_string())?;
        }
        "expanded" => {
            let _ = window.set_fullscreen(false);
            window
                .set_size(LogicalSize::new(960.0, 740.0))
                .map_err(|e| e.to_string())?;
        }
        "fullscreen" => {
            window
                .set_fullscreen(true)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Unknown mode".to_string()),
    };
    Ok(())
}

pub fn init_window_mode_support(app: &tauri::App) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};

        if let Some(window) = app.get_webview_window("main") {
            let _ = apply_mica(&window, Some(true))
                .or_else(|_| apply_acrylic(&window, Some((18, 18, 18, 125))));
        }
    }
}
