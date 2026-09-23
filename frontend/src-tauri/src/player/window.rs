// Window plumbing for the built-in player, which lives INSIDE the main
// window (the PlayerModal overlay) like the comic reader does.
//
// The video is a native child HWND of the main window (video_host.rs) placed
// at the rectangle the React `PlayerStage` reports through
// `player_set_video_bounds`. A WebView cannot paint above a native sibling,
// so in "overlay" controls mode a second frameless, transparent window
// (`player-overlay`, owned by main: always above it, hidden/minimized with
// it) is kept aligned to `main.inner_position() + video rect` from the main
// window's move/resize/scale events and from every bounds update. In
// "docked" mode no overlay exists and the controls render in the main
// WebView below the video.

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::engine::PlayerEngineState;
use super::error::PlayerError;

pub const MAIN_LABEL: &str = "main";
pub const OVERLAY_LABEL: &str = "player-overlay";
pub const EVENT_ENDED: &str = "player://ended";

/// Physical-pixel rectangle inside the main window's client area.
pub type VideoRect = (i32, i32, i32, i32);

/// `player://ended`: why the engine stopped plus where it was, so the
/// frontend can persist an exact resume point (or mark the episode
/// watched) without depending on the last throttled status tick.
#[derive(Clone, Default, serde::Serialize)]
pub struct EndedPayload {
    pub reason: String,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub playlist_index: i64,
    pub path: Option<String>,
}

pub fn main_window(app: &AppHandle) -> Result<WebviewWindow, PlayerError> {
    app.get_webview_window(MAIN_LABEL).ok_or_else(|| PlayerError::window("main window not found"))
}

/// Registers the main-window event hook exactly once per process.
pub fn ensure_main_hooks(app: &AppHandle) -> Result<(), PlayerError> {
    let state = app.state::<PlayerEngineState>();
    {
        let mut engine = state.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
        if engine.main_hooks_installed {
            return Ok(());
        }
        engine.main_hooks_installed = true;
    }
    let main = main_window(app)?;
    let handle = app.clone();
    main.on_window_event(move |event| handle_main_window_event(&handle, event));
    Ok(())
}

fn handle_main_window_event(app: &AppHandle, event: &WindowEvent) {
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            sync_video_bounds(app);
            sync_overlay_bounds(app);
        }
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                teardown(&app, "closed").await;
            });
        }
        _ => {}
    }
}

fn current_rect(app: &AppHandle) -> Option<VideoRect> {
    let state = app.state::<PlayerEngineState>();
    let rect = state.0.lock().ok().and_then(|engine| engine.video_rect);
    rect
}

/// Creates the transparent overlay window over the video rect (no-op when it
/// already exists).
pub fn ensure_overlay_window(app: &AppHandle) -> Result<(), PlayerError> {
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        sync_overlay_bounds(app);
        return Ok(());
    }
    let main = main_window(app)?;
    let scale = main.scale_factor()?;
    let origin = main.inner_position()?;
    let (x, y, w, h) = current_rect(app).unwrap_or((0, 0, 1, 1));
    let mut overlay = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("/player-overlay".into()))
        .title("Metadea")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .position((origin.x + x) as f64 / scale, (origin.y + y) as f64 / scale)
        .inner_size(w.max(1) as f64 / scale, h.max(1) as f64 / scale);
    #[cfg(windows)]
    {
        overlay = overlay.owner(&main)?;
    }
    #[cfg(target_os = "macos")]
    {
        overlay = overlay.parent(&main)?;
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        overlay = overlay.transient_for(&main)?;
    }
    overlay.build()?;
    sync_overlay_bounds(app);
    Ok(())
}

pub fn destroy_overlay_window(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = overlay.destroy();
    }
}

/// Aligns the overlay with the video rect in screen space; hides it while
/// no rect has been reported yet.
pub fn sync_overlay_bounds(app: &AppHandle) {
    let (Ok(main), Some(overlay)) = (main_window(app), app.get_webview_window(OVERLAY_LABEL)) else {
        return;
    };
    let Some((x, y, w, h)) = current_rect(app).filter(|(_, _, w, h)| *w > 0 && *h > 0) else {
        let _ = overlay.hide();
        return;
    };
    if let Ok(origin) = main.inner_position() {
        let _ = overlay.set_position(PhysicalPosition::new(origin.x + x, origin.y + y));
        let _ = overlay.set_size(PhysicalSize::new(w as u32, h as u32));
        if !overlay.is_visible().unwrap_or(false) {
            let _ = overlay.show();
        }
    }
}

/// Moves the native surface to the reported rect (1×1 in the corner while
/// none is known, so nothing of the WebView is covered). Main thread only.
pub fn sync_video_bounds(app: &AppHandle) {
    let state = app.state::<PlayerEngineState>();
    let (host, rect) = match state.0.lock() {
        Ok(engine) => (engine.video_host, engine.video_rect),
        Err(_) => return,
    };
    let Some(host) = host else { return };
    match rect {
        Some((x, y, w, h)) if w > 0 && h > 0 => host.set_bounds(x, y, w, h),
        _ => host.set_bounds(0, 0, 1, 1),
    }
}

/// Stops the engine, releases the native surface and the overlay. Safe to
/// call when nothing is open.
pub async fn teardown(app: &AppHandle, reason: &str) {
    let mut payload = EndedPayload { reason: reason.to_string(), playlist_index: -1, ..Default::default() };
    let host = {
        let state = app.state::<PlayerEngineState>();
        let taken = match state.0.lock() {
            Ok(mut engine) => {
                if engine.is_open() {
                    // Read straight from mpv before quitting: the shared
                    // snapshot may be up to a throttle window old.
                    let last = engine.refresh_status();
                    payload.position_secs = last.position_secs;
                    payload.duration_secs = last.duration_secs;
                    payload.playlist_index = last.playlist_index;
                    payload.path = last.path;
                }
                engine.close();
                engine.video_host.take()
            }
            Err(_) => None,
        };
        taken
    };
    if let Some(host) = host {
        let _ = app.run_on_main_thread(move || host.destroy());
    }
    destroy_overlay_window(app);
    let _ = app.emit(EVENT_ENDED, payload);
}

/// Creates the native surface as a child of the main window, on the main
/// thread, sized to the current rect.
pub async fn create_video_host(app: &AppHandle, main: &WebviewWindow) -> Result<super::video_host::VideoHost, PlayerError> {
    #[cfg(windows)]
    let parent = main.hwnd()?.0 as isize;
    #[cfg(not(windows))]
    let parent = 0isize;
    let (_, _, w, h) = current_rect(app).unwrap_or((0, 0, 1, 1));
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(super::video_host::VideoHost::create(parent, w.max(1), h.max(1)));
    })?;
    rx.await.map_err(|_| PlayerError::window("main thread did not answer"))?
}
