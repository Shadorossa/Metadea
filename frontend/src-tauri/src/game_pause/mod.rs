//! Controller pause menu for emulated games launched from Metadea.
//!
//! While an emulator session from the game session registry
//! (game_sessions.rs) is running, a background thread reads the pads
//! through XInput every 16 ms (gamepad.rs); with no such session it sleeps
//! until the registry changes. Holding Select/Back + Start for 1.5 s while
//! the game is in front (combo.rs):
//!   1. suspends the emulator process(es) of that session — only PIDs whose
//!      image is the configured emulator executable (process_control.rs);
//!   2. brings Metadea's window to the front (restored, focused, topmost)
//!      and emits OPENED_EVENT for the frontend's pause overlay.
//!
//! The overlay answers with Continue (resume, drop topmost, refocus the
//! emulator), Quit game (resume, WM_CLOSE its windows, 5 s, terminate; the
//! launcher's session watcher then ends the session normally — playtime,
//! saves, captures — through game_sessions.rs) or Save state (RetroArch
//! network commands only, retroarch.rs).
//!
//! Never left frozen: a failed suspend resumes what was suspended; an
//! overlay that does not acknowledge within ACK_TIMEOUT resumes the game;
//! a session that ends while paused closes the menu; Metadea's exit
//! (`resume_all`, RunEvent::Exit) and a panic resume it too, and every
//! OwnedProcess resumes itself when dropped.

mod combo;
mod gamepad;
mod process_control;
mod retroarch;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::error_codes::{self, with_detail};
use crate::game_sessions::{self, ActiveSession};
use combo::{ComboHold, COMBO_HOLD_MS};
use gamepad::PadPoller;
use process_control::{next_quit_action, OwnedProcess, QuitAction, QuitProgress, QUIT_TIMEOUT};

pub const OPENED_EVENT: &str = "game-pause://opened";
pub const CLOSED_EVENT: &str = "game-pause://closed";
const POLL_EVERY: Duration = Duration::from_millis(16);
const PAUSED_CHECK_EVERY: Duration = Duration::from_millis(100);
/// Safety net only: the registry's change event wakes the watcher.
const IDLE_WAKE: Duration = Duration::from_secs(30);
/// The overlay must acknowledge an opened pause this fast, or the game resumes.
const ACK_TIMEOUT: Duration = Duration::from_secs(5);
/// How long RetroArch runs to act on SAVE_STATE before it is suspended again.
const SAVE_STATE_RUN: Duration = Duration::from_millis(700);
const SETTINGS_FILE: &str = "game-pause.json";
const MAIN_WINDOW: &str = "main";

/// What the overlay shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseInfo {
    pub session_id: String,
    pub external_id: String,
    pub title: String,
    pub cover_url: Option<String>,
    pub platform: Option<String>,
    pub app_id: Option<String>,
    pub session_seconds: i64,
    pub can_save_state: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClosedPayload {
    session_id: String,
    external_id: String,
    /// "continue", "quit" or "ended" (the game exited on its own).
    reason: &'static str,
}

struct Paused {
    sequence: u64,
    info: PauseInfo,
    processes: Vec<OwnedProcess>,
    acked: bool,
    save_state_port: Option<u16>,
}

static PAUSED: Mutex<Option<Paused>> = Mutex::new(None);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static ENABLED: AtomicBool = AtomicBool::new(true);
static WATCHER: OnceLock<std::thread::Thread> = OnceLock::new();

fn paused() -> MutexGuard<'static, Option<Paused>> {
    PAUSED.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn wake() {
    if let Some(thread) = WATCHER.get() {
        thread.unpark();
    }
}

// ─── Settings ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePauseSettings {
    pub enabled: bool,
    /// How long the combo is held (read-only, for the settings text).
    #[serde(default)]
    pub hold_ms: u64,
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join(SETTINGS_FILE))
}

fn load_settings(app: &AppHandle) {
    let enabled = settings_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|json| serde_json::from_str::<GamePauseSettings>(&json).ok())
        .map(|settings| settings.enabled)
        .unwrap_or(true);
    ENABLED.store(enabled, Ordering::Relaxed);
}

fn current_settings() -> GamePauseSettings {
    GamePauseSettings { enabled: ENABLED.load(Ordering::Relaxed), hold_ms: COMBO_HOLD_MS }
}

#[tauri::command]
pub fn get_game_pause_settings() -> GamePauseSettings {
    current_settings()
}

#[tauri::command]
pub fn set_game_pause_enabled(app: AppHandle, enabled: bool) -> Result<GamePauseSettings, String> {
    let path = settings_path(&app).ok_or(error_codes::GAME_PAUSE_SETTINGS)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| with_detail(error_codes::GAME_PAUSE_SETTINGS, e))?;
    }
    let settings = GamePauseSettings { enabled, hold_ms: COMBO_HOLD_MS };
    let json = serde_json::to_string_pretty(&settings).map_err(|e| with_detail(error_codes::GAME_PAUSE_SETTINGS, e))?;
    std::fs::write(&path, json).map_err(|e| with_detail(error_codes::GAME_PAUSE_SETTINGS, e))?;
    ENABLED.store(enabled, Ordering::Relaxed);
    wake();
    Ok(settings)
}

// ─── Watcher ─────────────────────────────────────────────────────────────────

/// Called once from setup (after the session registry is managed).
pub fn start(app: &AppHandle) {
    load_settings(app);
    install_panic_resume();
    let handle = app.clone();
    match std::thread::Builder::new().name("game-pause".into()).spawn(move || watch(handle)) {
        Ok(thread) => {
            let _ = WATCHER.set(thread.thread().clone());
        }
        Err(e) => log::warn!("Controller pause menu unavailable: {e}"),
    }
    app.listen(game_sessions::SESSIONS_CHANGED_EVENT, |_| wake());
}

/// Resumes a paused game (Metadea is exiting).
pub fn resume_all() {
    paused().take();
}

fn install_panic_resume() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Ok(mut guard) = PAUSED.try_lock() {
            guard.take();
        }
        previous(info);
    }));
}

fn sessions(app: &AppHandle) -> Vec<ActiveSession> {
    app.try_state::<game_sessions::GameSessionsState>().map(|state| state.snapshot()).unwrap_or_default()
}

// The newest running emulator session with processes to act on.
fn eligible_session(app: &AppHandle) -> Option<ActiveSession> {
    sessions(app).into_iter().find(|session| {
        session.running
            && session.platform.is_some()
            && !session.pids.is_empty()
            && session.exe_path.as_deref().is_some_and(|exe| !exe.trim().is_empty())
    })
}

// Only while the game itself is in front: in Metadea the same buttons
// belong to Big Picture.
fn game_in_front(session: &ActiveSession) -> bool {
    process_control::foreground_pid().is_some_and(|pid| session.pids.contains(&pid))
}

fn watch(app: AppHandle) {
    let clock = Instant::now();
    let mut combo = ComboHold::default();
    let mut pads = PadPoller::default();
    loop {
        let paused_session = paused().as_ref().map(|p| p.info.session_id.clone());
        if let Some(session_id) = paused_session {
            if !sessions(&app).iter().any(|s| s.session_id == session_id) {
                close_after_exit(&app);
            }
            combo.require_release();
            std::thread::sleep(PAUSED_CHECK_EVERY);
            continue;
        }
        let target = if ENABLED.load(Ordering::Relaxed) { eligible_session(&app) } else { None };
        let Some(session) = target else {
            combo = ComboHold::default();
            std::thread::park_timeout(IDLE_WAKE);
            continue;
        };
        let now = clock.elapsed().as_millis() as u64;
        let held = pads.combo_held(now);
        if combo.update(held, now, COMBO_HOLD_MS) && game_in_front(&session) {
            if let Err(e) = pause(&app, &session) {
                log::warn!("Pause menu: could not pause {}: {e}", session.title);
            }
        }
        std::thread::sleep(POLL_EVERY);
    }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

fn pause(app: &AppHandle, session: &ActiveSession) -> Result<(), String> {
    let exe = session.exe_path.clone().unwrap_or_default();
    // Checked by image path, then opened (and checked again through the
    // handle that is kept, so the PID cannot be reused meanwhile).
    let owned = process_control::owned_pids(&session.pids, &exe, process_control::process_image);
    let mut processes: Vec<OwnedProcess> = owned.iter().filter_map(|pid| OwnedProcess::open_verified(*pid, &exe)).collect();
    if processes.is_empty() {
        return Err("no running process of the emulator executable".into());
    }
    for process in processes.iter_mut() {
        if !process.suspend() {
            // `processes` drops here and resumes the ones already suspended.
            return Err(format!("could not suspend process {}", process.pid));
        }
    }
    let save_state_port = retroarch::save_state_port(&exe);
    let info = PauseInfo {
        session_id: session.session_id.clone(),
        external_id: session.external_id.clone(),
        title: session.title.clone(),
        cover_url: session.cover_url.clone(),
        platform: session.platform.clone(),
        app_id: session.app_id.clone(),
        session_seconds: game_sessions::active_seconds(session, game_sessions::now_unix()),
        can_save_state: save_state_port.is_some(),
    };
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    *paused() = Some(Paused { sequence, info: info.clone(), processes, acked: false, save_state_port });
    game_sessions::set_paused(app, &info.session_id, true);
    bring_metadea_to_front(app);
    let _ = app.emit(OPENED_EVENT, &info);

    // No overlay answered (page without it, webview busy): resume.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(ACK_TIMEOUT);
        let unanswered = paused().as_ref().is_some_and(|p| p.sequence == sequence && !p.acked);
        if unanswered {
            log::warn!("Pause menu was not shown; resuming the game");
            let _ = continue_game(&handle);
        }
    });
    Ok(())
}

fn bring_metadea_to_front(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else { return };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        process_control::force_foreground(hwnd.0 as isize);
    }
}

fn release_metadea_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.set_always_on_top(false);
    }
}

fn emit_closed(app: &AppHandle, info: &PauseInfo, reason: &'static str) {
    let _ = app.emit(CLOSED_EVENT, ClosedPayload { session_id: info.session_id.clone(), external_id: info.external_id.clone(), reason });
}

fn continue_game(app: &AppHandle) -> Result<(), String> {
    let taken = paused().take().ok_or(error_codes::GAME_PAUSE_NOT_PAUSED)?;
    let pids: Vec<u32> = taken.processes.iter().map(|p| p.pid).collect();
    let info = taken.info.clone();
    // Dropping the processes resumes them.
    drop(taken);
    game_sessions::set_paused(app, &info.session_id, false);
    release_metadea_window(app);
    if let Some(window) = process_control::top_level_windows(&pids).first() {
        process_control::force_foreground(*window);
    }
    emit_closed(app, &info, "continue");
    Ok(())
}

fn quit_game(app: &AppHandle) -> Result<(), String> {
    let mut taken = paused().take().ok_or(error_codes::GAME_PAUSE_NOT_PAUSED)?;
    for process in taken.processes.iter_mut() {
        process.resume();
    }
    game_sessions::set_paused(app, &taken.info.session_id, false);
    release_metadea_window(app);
    let pids: Vec<u32> = taken.processes.iter().map(|p| p.pid).collect();
    let started = Instant::now();
    let mut progress = QuitProgress::default();
    loop {
        progress.exited = taken.processes.iter().all(|p| !p.is_alive());
        progress.elapsed = started.elapsed();
        match next_quit_action(&progress, QUIT_TIMEOUT) {
            QuitAction::Done => break,
            QuitAction::SendClose => {
                progress.windows_closed = process_control::post_close(&process_control::top_level_windows(&pids));
                progress.close_sent = true;
            }
            QuitAction::Wait => std::thread::sleep(Duration::from_millis(100)),
            QuitAction::Terminate => {
                for process in taken.processes.iter().filter(|p| p.is_alive()) {
                    if !process.terminate() {
                        log::warn!("Could not terminate emulator process {}", process.pid);
                    }
                }
                break;
            }
        }
    }
    // The launcher's own watcher sees the exit and ends the session
    // (playtime, saves, captures) exactly as for a normal exit.
    emit_closed(app, &taken.info, "quit");
    Ok(())
}

fn save_state() -> Result<(), String> {
    let mut guard = paused();
    let paused = guard.as_mut().ok_or(error_codes::GAME_PAUSE_NOT_PAUSED)?;
    let port = paused.save_state_port.ok_or(error_codes::GAME_PAUSE_SAVE_STATE)?;
    for process in paused.processes.iter_mut() {
        process.resume();
    }
    let sent = retroarch::send_command(port, "SAVE_STATE");
    std::thread::sleep(SAVE_STATE_RUN);
    for process in paused.processes.iter_mut().filter(|p| p.is_alive()) {
        process.suspend();
    }
    sent.map_err(|e| with_detail(error_codes::GAME_PAUSE_SAVE_STATE, e))
}

// The game exited while its menu was open (crash, closed from the taskbar).
fn close_after_exit(app: &AppHandle) {
    let Some(taken) = paused().take() else { return };
    let info = taken.info.clone();
    drop(taken);
    game_sessions::set_paused(app, &info.session_id, false);
    release_metadea_window(app);
    emit_closed(app, &info, "ended");
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// The open pause, if any; the overlay calls this when it shows, which
/// acknowledges it (see ACK_TIMEOUT).
#[tauri::command]
pub fn game_pause_current() -> Option<PauseInfo> {
    let mut guard = paused();
    let paused = guard.as_mut()?;
    paused.acked = true;
    Some(paused.info.clone())
}

async fn blocking(app: AppHandle, action: fn(&AppHandle) -> Result<(), String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || action(&app))
        .await
        .map_err(|e| with_detail(error_codes::GAME_PAUSE_FAILED, e))?
}

#[tauri::command]
pub async fn game_pause_continue(app: AppHandle) -> Result<(), String> {
    blocking(app, continue_game).await
}

#[tauri::command]
pub async fn game_pause_quit(app: AppHandle) -> Result<(), String> {
    blocking(app, quit_game).await
}

#[tauri::command]
pub async fn game_pause_save_state(app: AppHandle) -> Result<(), String> {
    blocking(app, |_| save_state()).await
}
