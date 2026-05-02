use serde::Serialize;
use std::sync::OnceLock;
use std::thread;
use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    TranslateMessage, CS_HREDRAW, CS_VREDRAW, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WM_POWERBROADCAST,
    WM_WTSSESSION_CHANGE, WNDCLASSW,
};

#[derive(Serialize, Clone)]
struct SessionEventPayload {
    reason: String,
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
const WTS_SESSION_LOCK_EVENT: u32 = 0x7;
const WTS_SESSION_UNLOCK_EVENT: u32 = 0x8;
const PBT_APMSUSPEND_EVENT: u32 = 0x4;
const PBT_APMRESUMEAUTOMATIC_EVENT: u32 = 0x12;

unsafe extern "system" fn session_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let handle_opt = APP_HANDLE.get();
    if let Some(handle) = handle_opt {
        match msg {
            WM_WTSSESSION_CHANGE => {
                let reason = if wparam.0 as u32 == WTS_SESSION_LOCK_EVENT {
                    Some(("session-away", "lock"))
                } else if wparam.0 as u32 == WTS_SESSION_UNLOCK_EVENT {
                    Some(("session-back", "unlock"))
                } else {
                    None
                };
                if let Some((event_name, reason)) = reason {
                    let _ = handle.emit(
                        event_name,
                        SessionEventPayload {
                            reason: reason.to_string(),
                        },
                    );
                }
            }
            WM_POWERBROADCAST => {
                let reason = if wparam.0 as u32 == PBT_APMSUSPEND_EVENT {
                    Some(("session-away", "sleep"))
                } else if wparam.0 as u32 == PBT_APMRESUMEAUTOMATIC_EVENT {
                    Some(("session-back", "wake"))
                } else {
                    None
                };
                if let Some((event_name, reason)) = reason {
                    let _ = handle.emit(
                        event_name,
                        SessionEventPayload {
                            reason: reason.to_string(),
                        },
                    );
                }
            }
            _ => {}
        }
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

pub fn init_lock_and_sleep_listener(app: &AppHandle) {
    let handle = app.clone();
    thread::spawn(move || unsafe {
        let _ = APP_HANDLE.set(handle);

        let class_name = w!("ClockwiseSessionListener");
        let window_class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(session_wnd_proc),
            lpszClassName: class_name,
            ..Default::default()
        };
        let _ = RegisterClassW(&window_class);

        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            class_name,
            Default::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            None,
            None,
        );
        if let Ok(hwnd) = hwnd {
            let _ = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    });
}
