// The always-on-top native toast window, shared by the F12 "screenshot
// saved" notice and the "episode marked as watched" notice (which carries
// an Undo button). One window, one page (pages/screenshot-toast.astro);
// each kind is its own event + payload, and only the watched toast accepts
// mouse input (the screenshot one stays click-through).

use serde::Serialize;

pub const SCREENSHOT_EVENT: &str = "local-screenshot-saved";
pub const EPISODE_WATCHED_EVENT: &str = "local-episode-watched";
/// Break reminder / clock alert while a game runs (game_break_reminder.rs).
pub const GAME_BREAK_EVENT: &str = "local-game-break-reminder";
/// Raised app-wide when the toast page's Undo button is pressed.
pub const TOAST_ACTION_EVENT: &str = "toast://action";

const WINDOW_LABEL: &str = "screenshot-toast";
const SCREENSHOT_VISIBLE_MS: u64 = 3_200;
const EPISODE_WATCHED_VISIBLE_MS: u64 = 8_000;
const GAME_BREAK_VISIBLE_MS: u64 = 8_000;

#[derive(Clone, Serialize)]
pub(super) struct ScreenshotToastPayload {
    pub(super) work_name: String,
    pub(super) episode_label: String,
    pub(super) timecode: String,
}

#[derive(Clone, Serialize)]
struct EpisodeWatchedToastPayload {
    work_name: String,
    episode_label: String,
    /// Echoed back by the Undo button so the frontend matches the right mark.
    token: u64,
}

#[derive(Clone, Serialize)]
struct ToastActionPayload {
    action: String,
    token: u64,
}

/// What to show once the page reports ready (it may still be loading when
/// the first toast is requested).
#[derive(Clone)]
struct PendingToast {
    event: &'static str,
    payload: serde_json::Value,
    interactive: bool,
}

#[derive(Default)]
pub struct ScreenshotToastState {
    latest: std::sync::Mutex<Option<PendingToast>>,
    page_ready: std::sync::atomic::AtomicBool,
    generation: std::sync::atomic::AtomicU64,
}

fn screenshot_toast_position(app_handle: &tauri::AppHandle) -> (f64, f64) {
    use tauri::Manager;

    const TOAST_WIDTH: f64 = 430.0;
    const RIGHT_MARGIN: f64 = 4.0;
    const TOP_MARGIN: f64 = 11.0;

    let monitor = app_handle
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| {
            app_handle
                .get_webview_window("main")
                .and_then(|window| window.primary_monitor().ok().flatten())
        });
    let Some(monitor) = monitor else {
        return (800.0, TOP_MARGIN);
    };

    let scale = monitor.scale_factor().max(1.0);
    let position = monitor.position();
    let size = monitor.size();
    (
        position.x as f64 / scale + size.width as f64 / scale - TOAST_WIDTH - RIGHT_MARGIN,
        position.y as f64 / scale + TOP_MARGIN,
    )
}

fn present(window: &tauri::WebviewWindow, pending: &PendingToast) {
    use tauri::Emitter;
    let _ = window.set_ignore_cursor_events(!pending.interactive);
    let _ = window.emit(pending.event, pending.payload.clone());
    let _ = window.show();
}

#[tauri::command]
pub fn screenshot_toast_ready(app_handle: tauri::AppHandle) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    let state = app_handle.state::<ScreenshotToastState>();
    let pending = {
        let latest = state.latest.lock().map_err(|error| error.to_string())?;
        state.page_ready.store(true, Ordering::Release);
        latest.clone()
    };
    let Some(window) = app_handle.get_webview_window(WINDOW_LABEL) else {
        return Ok(());
    };
    if let Some(pending) = pending {
        present(&window, &pending);
    }
    Ok(())
}

fn show_toast(app_handle: &tauri::AppHandle, pending: PendingToast, visible_ms: u64) {
    use std::sync::atomic::Ordering;
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    let state = app_handle.state::<ScreenshotToastState>();
    if let Ok(mut latest) = state.latest.lock() {
        *latest = Some(pending.clone());
    }
    let generation = state.generation.fetch_add(1, Ordering::Relaxed) + 1;

    if let Some(window) = app_handle.get_webview_window(WINDOW_LABEL) {
        if state.page_ready.load(Ordering::Acquire) {
            present(&window, &pending);
        }
    } else {
        let (x, y) = screenshot_toast_position(app_handle);
        let interactive = pending.interactive;
        let builder = WebviewWindowBuilder::new(
            app_handle,
            WINDOW_LABEL,
            WebviewUrl::App("/screenshot-toast".into()),
        )
        .title("Metadea")
        .inner_size(430.0, 131.0)
        .position(x, y)
        .decorations(false)
        .resizable(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .shadow(false)
        .on_page_load(move |window, page| {
            if page.event() != tauri::webview::PageLoadEvent::Finished
                || !page.url().path().ends_with("/screenshot-toast")
            {
                return;
            }
            let _ = window.set_ignore_cursor_events(!interactive);
        });

        match builder.build() {
            Ok(window) => {
                let _ = window.set_ignore_cursor_events(!interactive);
            }
            Err(error) => log::warn!("Could not create screenshot toast window: {error}"),
        }
    }

    let app_for_hide = app_handle.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(visible_ms)).await;
        if app_for_hide
            .state::<ScreenshotToastState>()
            .generation
            .load(Ordering::Relaxed)
            == generation
        {
            if let Some(window) = app_for_hide.get_webview_window(WINDOW_LABEL) {
                let _ = window.hide();
            }
        }
    });
}

pub(super) fn show_screenshot_toast(app_handle: &tauri::AppHandle, payload: ScreenshotToastPayload) {
    let Ok(payload) = serde_json::to_value(payload) else { return };
    show_toast(app_handle, PendingToast { event: SCREENSHOT_EVENT, payload, interactive: false }, SCREENSHOT_VISIBLE_MS);
}

/// "You've been playing <title> for 2 h — time for a short break?" or a
/// clock alert: click-through, never focused, over fullscreen games too.
pub fn show_game_break_toast(app_handle: &tauri::AppHandle, payload: impl Serialize) {
    let Ok(payload) = serde_json::to_value(payload) else { return };
    show_toast(app_handle, PendingToast { event: GAME_BREAK_EVENT, payload, interactive: false }, GAME_BREAK_VISIBLE_MS);
}

/// "<work> · <episode> marked as watched" with an Undo button; `token` comes
/// back in `toast://action` when the button is pressed.
#[tauri::command]
pub fn show_episode_watched_toast(
    app_handle: tauri::AppHandle,
    work_name: String,
    episode_label: String,
    token: u64,
) -> Result<(), String> {
    let payload = serde_json::to_value(EpisodeWatchedToastPayload { work_name, episode_label, token })
        .map_err(|error| error.to_string())?;
    show_toast(&app_handle, PendingToast { event: EPISODE_WATCHED_EVENT, payload, interactive: true }, EPISODE_WATCHED_VISIBLE_MS);
    Ok(())
}

/// Invoked by the toast page's button; relayed app-wide so the main window
/// (playback-service) can act on it, then the toast hides itself.
#[tauri::command]
pub fn episode_toast_action(app_handle: tauri::AppHandle, action: String, token: u64) -> Result<(), String> {
    use tauri::{Emitter, Manager};
    app_handle
        .emit(TOAST_ACTION_EVENT, ToastActionPayload { action, token })
        .map_err(|error| error.to_string())?;
    if let Some(window) = app_handle.get_webview_window(WINDOW_LABEL) {
        let _ = window.hide();
    }
    Ok(())
}
