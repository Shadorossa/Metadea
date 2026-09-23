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

use super::continue_frame;
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
    /// The "continue watching" frame captured at the stop point
    /// (continue_frame.rs), when there was one.
    pub frame_path: Option<String>,
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

/// Clips the reported rect to the main window's client area: the overlay is
/// a separate top-level window, so an unclipped rect would let it hang
/// outside the window (a stray strip of controls under the bottom edge).
fn clamp_to_client(rect: VideoRect, client: PhysicalSize<u32>) -> Option<VideoRect> {
    let (x, y, w, h) = rect;
    let (client_w, client_h) = (client.width as i32, client.height as i32);
    let left = x.max(0);
    let top = y.max(0);
    let right = (x + w).min(client_w);
    let bottom = (y + h).min(client_h);
    (right > left && bottom > top).then_some((left, top, right - left, bottom - top))
}

/// Aligns the overlay with the video rect in screen space; hides it while
/// no rect has been reported yet or the rect lies entirely off the window.
pub fn sync_overlay_bounds(app: &AppHandle) {
    let (Ok(main), Some(overlay)) = (main_window(app), app.get_webview_window(OVERLAY_LABEL)) else {
        return;
    };
    let rect = current_rect(app)
        .filter(|(_, _, w, h)| *w > 0 && *h > 0)
        .and_then(|rect| main.inner_size().ok().map_or(Some(rect), |client| clamp_to_client(rect, client)));
    let Some((x, y, w, h)) = rect else {
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
/// call when nothing is open — then nothing is emitted either, so the two
/// close paths that race on a normal stop (the close button and the modal
/// unmounting) produce exactly one `player://ended`: the one carrying the
/// real position.
pub async fn teardown(app: &AppHandle, reason: &str) {
    let mut payload = EndedPayload { reason: reason.to_string(), playlist_index: -1, ..Default::default() };
    let mut was_open = false;
    let mut stopped_at: Option<(String, f64)> = None;
    let frames_root = app.path().app_data_dir().ok();
    let host = {
        let state = app.state::<PlayerEngineState>();
        let taken = match state.0.lock() {
            Ok(mut engine) => {
                was_open = engine.is_open();
                if was_open {
                    // Read straight from mpv before quitting: the shared
                    // snapshot may be up to a throttle window old.
                    let last = engine.refresh_status();
                    payload.position_secs = last.position_secs;
                    payload.duration_secs = last.duration_secs;
                    payload.playlist_index = last.playlist_index;
                    payload.path = last.path;
                    // Before quitting: the frame has to come from the live
                    // decoder. A failed capture only costs the thumbnail.
                    stopped_at = engine.episode_at(last.playlist_index);
                    if let (Some((external_id, episode)), Some(root)) = (&stopped_at, &frames_root) {
                        if continue_frame::worth_capturing(last.position_secs, last.duration_secs) {
                            let frame = continue_frame::continue_frame_path(root, external_id, *episode);
                            if engine.capture_frame(&frame).is_ok() {
                                payload.frame_path = Some(frame.to_string_lossy().into_owned());
                            }
                        }
                    }
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
    // Closing the player always leaves fullscreen: the fullscreen was the
    // player's, not the page's.
    if was_open {
        if let Ok(main) = main_window(app) {
            if main.is_fullscreen().unwrap_or(false) {
                let _ = main.set_fullscreen(false);
            }
        }
    }
    if let Some((external_id, episode)) = &stopped_at {
        if continue_frame::worth_capturing(payload.position_secs, payload.duration_secs) {
            let db = app.state::<crate::db::MetadeaDb>();
            if let Ok(conn) = db.conn.lock() {
                let _ = continue_frame::record_frame(
                    &conn, external_id, *episode, payload.frame_path.as_deref(), payload.position_secs, payload.duration_secs,
                );
            };
        }
    }
    if was_open {
        let _ = app.emit(EVENT_ENDED, payload);
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ended_payload_carries_the_continue_frame_path() {
        let payload = EndedPayload { frame_path: Some("C:/data/metadata/continue_frames/anime_21_13.jpg".into()), ..Default::default() };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["frame_path"], "C:/data/metadata/continue_frames/anime_21_13.jpg");
        assert!(serde_json::to_value(EndedPayload::default()).unwrap()["frame_path"].is_null());
    }

    #[test]
    fn overlay_rect_is_clipped_to_the_client_area() {
        let client = PhysicalSize::new(1000u32, 600u32);
        assert_eq!(clamp_to_client((0, 0, 1000, 600), client), Some((0, 0, 1000, 600)));
        // Hanging below the window (the reported rect included a strip past
        // the bottom edge) is cut back to the client area.
        assert_eq!(clamp_to_client((0, 100, 1000, 700), client), Some((0, 100, 1000, 500)));
        assert_eq!(clamp_to_client((-20, -10, 200, 100), client), Some((0, 0, 180, 90)));
        assert_eq!(clamp_to_client((1000, 600, 50, 50), client), None);
    }
}
