// The `player_*` commands the frontend invokes. Every one returns
// `PlayerError` (a stable code + detail) so the UI can translate failures.
//
// Concurrency rule: the engine mutex is never held while waiting on the
// main thread (window events also take it from there).

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

use super::engine::{OpenRequest, PlayerEngineState, PlayerSessionInfo, ScreenshotSaved};
use super::error::PlayerError;
use super::event_loop::StatusSink;
use super::screenshot_names::sanitize_capture_folder_name;
use super::status::PlayerStatus;
use super::window::{
    create_video_host, destroy_overlay_window, ensure_main_hooks, ensure_overlay_window, main_window, sync_overlay_bounds,
    sync_video_bounds, teardown, OVERLAY_LABEL,
};

pub const EVENT_STATUS: &str = "player://status";
pub const EVENT_TRACK_CHANGED: &str = "player://track-changed";
pub const EVENT_ERROR: &str = "player://error";
pub const EVENT_SESSION: &str = "player://session";
pub const EVENT_SCREENSHOT: &str = "player://screenshot";

#[derive(Clone, serde::Serialize)]
struct TrackChangedPayload {
    index: i64,
    path: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct ErrorPayload {
    code: &'static str,
}

struct TauriSink {
    app: AppHandle,
}

impl StatusSink for TauriSink {
    fn status(&self, status: &PlayerStatus) {
        let _ = self.app.emit(EVENT_STATUS, status);
    }

    fn track_changed(&self, index: i64, path: Option<&str>) {
        let _ = self.app.emit(EVENT_TRACK_CHANGED, TrackChangedPayload { index, path: path.map(str::to_string) });
    }

    fn ended(&self, reason: &str) {
        // Our own `quit` (teardown) already emitted the full payload with
        // the exact position; only an unexpected shutdown gets a bare one.
        if reason == "shutdown" {
            return;
        }
        let payload = super::window::EndedPayload { reason: reason.to_string(), playlist_index: -1, ..Default::default() };
        let _ = self.app.emit(super::window::EVENT_ENDED, payload);
    }

    fn load_failed(&self) {
        let _ = self.app.emit(EVENT_ERROR, ErrorPayload { code: "load_failed" });
    }
}

fn library_dirs(app: &AppHandle) -> (Option<PathBuf>, Option<PathBuf>) {
    let resource_dir = app.path().resource_dir().ok();
    let exe_dir = std::env::current_exe().ok().and_then(|exe| exe.parent().map(PathBuf::from));
    (resource_dir, exe_dir)
}

fn with_engine<T>(state: &State<'_, PlayerEngineState>, f: impl FnOnce(&super::engine::PlayerEngine) -> Result<T, PlayerError>) -> Result<T, PlayerError> {
    let engine = state.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
    f(&engine)
}

#[tauri::command]
pub async fn player_engine_available(app: AppHandle, state: State<'_, PlayerEngineState>) -> Result<bool, PlayerError> {
    let (resource_dir, exe_dir) = library_dirs(&app);
    let mut engine = state.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
    match engine.ensure_library(resource_dir, exe_dir) {
        Ok(_) => Ok(true),
        Err(error) => {
            log::info!("libmpv unavailable, local video playback is disabled: {error}");
            Ok(false)
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerOpenArgs {
    pub queue: Vec<String>,
    #[serde(default)]
    pub start_index: Option<usize>,
    #[serde(default)]
    pub start_seconds: Option<f64>,
    pub work_name: String,
    #[serde(default)]
    pub episode_labels: Vec<String>,
    #[serde(default)]
    pub titles: Option<Vec<String>>,
    #[serde(default)]
    pub external_id: Option<String>,
    #[serde(default)]
    pub episode_numbers: Option<Vec<i64>>,
    /// Queue episodes that are filler when the entry skips filler.
    #[serde(default)]
    pub filler_episodes: Option<Vec<i64>>,
    /// `true` (default): controls in the transparent overlay window;
    /// `false`: docked controls in the main WebView, no overlay.
    #[serde(default)]
    pub overlay: Option<bool>,
}

#[tauri::command]
pub async fn player_open(
    app: AppHandle,
    state: State<'_, PlayerEngineState>,
    request: PlayerOpenArgs,
) -> Result<PlayerSessionInfo, PlayerError> {
    let PlayerOpenArgs {
        queue,
        start_index,
        start_seconds,
        work_name,
        episode_labels,
        titles,
        external_id,
        episode_numbers,
        filler_episodes,
        overlay,
    } = request;
    if queue.is_empty() {
        return Err(PlayerError::invalid_argument("empty queue"));
    }
    let capture_dir = app
        .path()
        .picture_dir()?
        .join("Metadea")
        .join(sanitize_capture_folder_name(&work_name));
    std::fs::create_dir_all(&capture_dir)?;

    // Library first: a missing DLL must fail before any window appears.
    let (resource_dir, exe_dir) = library_dirs(&app);
    let lib = {
        let mut engine = state.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
        engine.ensure_library(resource_dir, exe_dir)?
    };

    let main = main_window(&app)?;
    ensure_main_hooks(&app)?;
    let needs_client = with_engine(&state, |engine| Ok(!engine.is_open()))?;
    if needs_client {
        let host = match create_video_host(&app, &main).await {
            Ok(host) => Some(host),
            Err(error) => {
                log::warn!("no embedded video surface, mpv will open its own window: {error}");
                None
            }
        };
        let mut engine = state.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
        if let Some(previous) = engine.video_host.take() {
            let _ = app.run_on_main_thread(move || previous.destroy());
        }
        engine.video_host = host;
        engine.start_client(lib, host.map(|host| host.wid()), Box::new(TauriSink { app: app.clone() }))?;
    }

    let session = {
        let mut engine = state.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
        engine.open(OpenRequest {
            start_index: start_index.unwrap_or(0),
            start_seconds,
            work_name,
            episode_labels,
            titles: titles.unwrap_or_default(),
            external_id,
            episode_numbers: episode_numbers.unwrap_or_default(),
            filler_episodes: filler_episodes.unwrap_or_default(),
            queue,
            capture_dir,
        })?
    };
    let _ = app.emit(EVENT_SESSION, &session);
    if overlay.unwrap_or(true) {
        ensure_overlay_window(&app)?;
    } else {
        destroy_overlay_window(&app);
    }
    let app_for_bounds = app.clone();
    let _ = app.run_on_main_thread(move || {
        sync_video_bounds(&app_for_bounds);
        sync_overlay_bounds(&app_for_bounds);
    });
    Ok(session)
}

#[tauri::command]
pub fn player_toggle_pause(state: State<'_, PlayerEngineState>) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.toggle_pause())
}

#[tauri::command]
pub fn player_set_pause(state: State<'_, PlayerEngineState>, paused: bool) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.set_pause(paused))
}

#[tauri::command]
pub fn player_seek(state: State<'_, PlayerEngineState>, seconds: f64, relative: bool) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.seek(seconds, relative))
}

#[tauri::command]
pub fn player_next(state: State<'_, PlayerEngineState>) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.next())
}

#[tauri::command]
pub fn player_prev(state: State<'_, PlayerEngineState>) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.prev())
}

#[tauri::command]
pub fn player_play_index(state: State<'_, PlayerEngineState>, index: usize) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.play_index(index))
}

#[tauri::command]
pub fn player_set_track(state: State<'_, PlayerEngineState>, kind: String, id: Option<i64>) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.set_track(&kind, id))
}

#[tauri::command]
pub fn player_set_volume(state: State<'_, PlayerEngineState>, volume: f64) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.set_volume(volume))
}

#[tauri::command]
pub fn player_set_mute(state: State<'_, PlayerEngineState>, muted: bool) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.set_mute(muted))
}

#[tauri::command]
pub fn player_set_speed(state: State<'_, PlayerEngineState>, speed: f64) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.set_speed(speed))
}

#[tauri::command]
pub fn player_set_sub_delay(state: State<'_, PlayerEngineState>, seconds: f64) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.set_sub_delay(seconds))
}

#[tauri::command]
pub fn player_frame_step(state: State<'_, PlayerEngineState>, direction: String) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.frame_step(&direction))
}

#[tauri::command]
pub fn player_cycle_track(state: State<'_, PlayerEngineState>, kind: String) -> Result<(), PlayerError> {
    with_engine(&state, |engine| engine.cycle_track(&kind))
}

#[tauri::command]
pub fn player_screenshot(app: AppHandle, state: State<'_, PlayerEngineState>) -> Result<ScreenshotSaved, PlayerError> {
    let saved = with_engine(&state, |engine| engine.screenshot())?;
    let _ = app.emit(EVENT_SCREENSHOT, &saved);
    Ok(saved)
}

#[tauri::command]
pub fn player_get_status(state: State<'_, PlayerEngineState>) -> Result<Option<PlayerStatus>, PlayerError> {
    with_engine(&state, |engine| Ok(engine.is_open().then(|| engine.refresh_status())))
}

#[tauri::command]
pub fn player_get_session(state: State<'_, PlayerEngineState>) -> Result<Option<PlayerSessionInfo>, PlayerError> {
    with_engine(&state, |engine| Ok(engine.session().cloned()))
}

/// `reason` is echoed in `player://ended` ("stopped" by default).
#[tauri::command]
pub async fn player_stop_close(app: AppHandle, reason: Option<String>) -> Result<(), PlayerError> {
    teardown(&app, reason.as_deref().unwrap_or("stopped")).await;
    Ok(())
}

/// The player modal (components/player/PlayerStage) reports where its video
/// area sits inside the main window's client area, in CSS pixels; the native
/// surface and the overlay follow. A zero size hides both (modal closed,
/// layout collapsed).
#[tauri::command]
pub async fn player_set_video_bounds(
    app: AppHandle,
    state: State<'_, PlayerEngineState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), PlayerError> {
    let main = main_window(&app)?;
    let scale = main.scale_factor()?;
    let rect = (width > 0.0 && height > 0.0).then(|| {
        ((x * scale).round() as i32, (y * scale).round() as i32, (width * scale).round() as i32, (height * scale).round() as i32)
    });
    {
        let mut engine = state.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
        engine.video_rect = rect;
    }
    let app_for_bounds = app.clone();
    app.run_on_main_thread(move || {
        sync_video_bounds(&app_for_bounds);
        sync_overlay_bounds(&app_for_bounds);
    })?;
    Ok(())
}

#[tauri::command]
pub async fn player_set_fullscreen(app: AppHandle, fullscreen: bool) -> Result<(), PlayerError> {
    main_window(&app)?.set_fullscreen(fullscreen)?;
    Ok(())
}

#[tauri::command]
pub fn player_is_fullscreen(app: AppHandle) -> Result<bool, PlayerError> {
    Ok(main_window(&app)?.is_fullscreen()?)
}

/// Gives the overlay keyboard focus (the page hands it over when the video
/// area is clicked so shortcuts keep landing in one place).
#[tauri::command]
pub fn player_focus_overlay(app: AppHandle) -> Result<(), PlayerError> {
    if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
        overlay.set_focus()?;
    }
    Ok(())
}
