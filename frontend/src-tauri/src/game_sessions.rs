//! Game sessions: the one owner of "a game launched from Metadea is running".
//!
//! Both launch paths register here: ROMs from `folders::launch_game` (the
//! emulator child process) and everything else from
//! `folders::start_playtime_session` (Steam/Epic/GOG/exe, found by polling).
//! When the process ends, [`finish`] records the playtime in SQLite itself
//! (user_library + game_sessions_log, one transaction) and emits
//! `game-session-ended` / `game-sessions-changed`. The frontend never writes
//! playtime; it only reads [`get_active_game_sessions`] to restore the
//! Discord / Now-playing presence after every page load.
//!
//! The registry is mirrored to `active_game_sessions` with a heartbeat every
//! 60 s, so a Metadea restart mid-game re-attaches to the still-running
//! process ([`start`]) or closes the session at its last heartbeat.
//!
//! # API for other launch-path code (pause menu, multi-disc…)
//! - [`active_session_for_pid`]: the session a process belongs to.
//! - [`pids_for_session`]: the PIDs currently tracked for a session (for a
//!   ROM, the emulator; it follows launcher-wrapper hand-offs).
//! - Normal end ("Quit game"): kill those PIDs and let the session's watcher
//!   notice the exit; or call [`finish`] with [`now_unix`] directly. `finish`
//!   is idempotent: the first call records, every later one is a no-op.
//! - [`set_paused`]: call with `true` when the game is suspended (pause
//!   menu) and `false` on resume. Paused intervals are excluded from the
//!   break reminder's running time ([`active_seconds`]); playtime still
//!   counts wall time from start to exit.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{MetadeaDb, ToStringErr};

pub const SESSION_ENDED_EVENT: &str = "game-session-ended";
pub const SESSIONS_CHANGED_EVENT: &str = "game-sessions-changed";
const HEARTBEAT_EVERY: Duration = Duration::from_secs(60);
const EXIT_POLL_EVERY: Duration = Duration::from_secs(2);
/// Shorter sessions are not logged (same threshold addPlaytimeHours had).
const MIN_COUNTED_SECONDS: i64 = 15;

/// A game launched from Metadea that has not ended yet.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ActiveSession {
    pub session_id: String,
    /// Library id playtime is recorded against; empty = track only.
    pub external_id: String,
    pub title: String,
    pub cover_url: Option<String>,
    /// The ROM's platform id (`gba`, `nds`…); None for PC games.
    pub platform: Option<String>,
    pub launcher: String,
    pub app_id: Option<String>,
    pub install_path: Option<String>,
    /// The watched executable (the emulator for ROMs).
    pub exe_path: Option<String>,
    pub pids: Vec<u32>,
    /// Unix seconds playtime counts from (process seen, for store launchers).
    pub started_unix: i64,
    pub last_heartbeat_unix: i64,
    /// False while a store launcher is still starting the game.
    pub running: bool,
    /// Seconds spent suspended by the pause menu, closed intervals only.
    pub paused_seconds: i64,
    /// Unix seconds the current pause started, while paused.
    pub paused_since: Option<i64>,
}

/// What a launch path knows when it registers a session.
#[derive(Debug, Clone, Default)]
pub struct NewSession {
    pub external_id: String,
    pub title: String,
    pub cover_url: Option<String>,
    pub platform: Option<String>,
    pub launcher: String,
    pub app_id: Option<String>,
    pub install_path: Option<String>,
    pub exe_path: Option<String>,
    pub pids: Vec<u32>,
    pub running: bool,
}

pub enum Registration {
    New(String),
    /// The same game already has a session; its watcher keeps covering it.
    Duplicate,
}

/// Result of closing a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionOutcome {
    pub seconds: i64,
    pub minutes_added: i64,
    /// Whether the library entry was written.
    pub recorded: bool,
}

#[derive(Clone, Serialize)]
struct SessionEndedPayload {
    external_id: String,
    hours: f64,
    recorded: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GamePlayStats {
    pub total_minutes: f64,
    pub sessions_count: i64,
    pub last_played_unix: Option<i64>,
    pub average_session_minutes: Option<f64>,
}

/// Managed state: the in-memory registry, keyed by session id.
#[derive(Default)]
pub struct GameSessionsState {
    sessions: Mutex<HashMap<String, ActiveSession>>,
}

impl GameSessionsState {
    fn map(&self) -> MutexGuard<'_, HashMap<String, ActiveSession>> {
        self.sessions.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn insert(&self, session: ActiveSession) {
        self.map().insert(session.session_id.clone(), session);
    }

    /// Removes the session; only the first caller gets it back, which is
    /// what keeps a session from being recorded twice.
    fn take(&self, session_id: &str) -> Option<ActiveSession> {
        self.map().remove(session_id)
    }

    fn get(&self, session_id: &str) -> Option<ActiveSession> {
        self.map().get(session_id).cloned()
    }

    fn update<F: FnOnce(&mut ActiveSession)>(&self, session_id: &str, change: F) -> Option<ActiveSession> {
        let mut map = self.map();
        let session = map.get_mut(session_id)?;
        change(session);
        Some(session.clone())
    }

    fn duplicate_of(&self, new: &NewSession) -> Option<String> {
        self.map().values().find(|s| is_same_game(s, new)).map(|s| s.session_id.clone())
    }

    fn touch_all(&self, now: i64) -> bool {
        let mut map = self.map();
        for session in map.values_mut() {
            session.last_heartbeat_unix = now;
        }
        !map.is_empty()
    }

    /// Newest first.
    pub fn snapshot(&self) -> Vec<ActiveSession> {
        let mut all: Vec<ActiveSession> = self.map().values().cloned().collect();
        all.sort_by(|a, b| b.started_unix.cmp(&a.started_unix).then(a.session_id.cmp(&b.session_id)));
        all
    }

    /// The session whose tracked processes include `pid`.
    #[allow(dead_code)] // public API for the pause menu (module docs)
    pub fn active_session_for_pid(&self, pid: u32) -> Option<ActiveSession> {
        self.map().values().find(|s| s.pids.contains(&pid)).cloned()
    }

    /// The PIDs tracked for `session_id` (empty when unknown or not started).
    #[allow(dead_code)] // public API for the pause menu (module docs)
    pub fn pids_for_session(&self, session_id: &str) -> Vec<u32> {
        self.map().get(session_id).map(|s| s.pids.clone()).unwrap_or_default()
    }
}

fn is_same_game(existing: &ActiveSession, new: &NewSession) -> bool {
    if !new.external_id.trim().is_empty() {
        return existing.external_id == new.external_id;
    }
    existing.external_id.is_empty() && existing.title == new.title && existing.install_path == new.install_path
}

pub fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

// ─── public registry API ─────────────────────────────────────────────────────

/// The session `pid` belongs to (e.g. the running emulator), if any.
#[allow(dead_code)] // public API for the pause menu (module docs)
pub fn active_session_for_pid(app: &AppHandle, pid: u32) -> Option<ActiveSession> {
    app.state::<GameSessionsState>().active_session_for_pid(pid)
}

/// The PIDs currently tracked for a session (kill/suspend targets).
#[allow(dead_code)] // public API for the pause menu (module docs)
pub fn pids_for_session(app: &AppHandle, session_id: &str) -> Vec<u32> {
    app.state::<GameSessionsState>().pids_for_session(session_id)
}

/// Whether the session is still in the registry (not finished/cancelled).
pub fn is_active(app: &AppHandle, session_id: &str) -> bool {
    app.state::<GameSessionsState>().get(session_id).is_some()
}

/// Starts a session now. A second launch of a game that already has a
/// session returns `Duplicate` and must not start another watcher.
pub fn register(app: &AppHandle, new: NewSession) -> Registration {
    let state = app.state::<GameSessionsState>();
    if state.duplicate_of(&new).is_some() {
        return Registration::Duplicate;
    }
    let now = now_unix();
    let session = ActiveSession {
        session_id: crate::db::generate_id(),
        external_id: new.external_id.trim().to_string(),
        title: new.title,
        cover_url: new.cover_url.filter(|url| !url.trim().is_empty()),
        platform: new.platform,
        launcher: new.launcher,
        app_id: new.app_id,
        install_path: new.install_path,
        exe_path: new.exe_path,
        pids: new.pids,
        started_unix: now,
        last_heartbeat_unix: now,
        running: new.running,
        paused_seconds: 0,
        paused_since: None,
    };
    let id = session.session_id.clone();
    state.insert(session.clone());
    persist(app, &session);
    emit_changed(app);
    Registration::New(id)
}

/// The game's process was seen: playtime counts from `started_unix`.
pub fn mark_running(app: &AppHandle, session_id: &str, pids: Vec<u32>, exe_path: Option<String>, started_unix: i64) {
    let updated = app.state::<GameSessionsState>().update(session_id, |s| {
        s.running = true;
        s.pids = pids;
        if exe_path.is_some() {
            s.exe_path = exe_path;
        }
        s.started_unix = started_unix;
        s.last_heartbeat_unix = s.last_heartbeat_unix.max(started_unix);
    });
    if let Some(session) = updated {
        persist(app, &session);
        emit_changed(app);
    }
}

/// The pause menu suspended (`true`) or resumed (`false`) the game. Repeated
/// calls with the same value are no-ops.
#[allow(dead_code)] // public API for the pause menu (module docs)
pub fn set_paused(app: &AppHandle, session_id: &str, paused: bool) {
    let now = now_unix();
    let mut changed = false;
    let updated = app.state::<GameSessionsState>().update(session_id, |s| {
        changed = apply_pause(s, paused, now);
    });
    if let (Some(session), true) = (updated, changed) {
        persist(app, &session);
        emit_changed(app);
    }
}

/// Replaces the tracked PIDs (a wrapper handed off to the real process).
pub fn set_pids(app: &AppHandle, session_id: &str, pids: Vec<u32>) {
    let state = app.state::<GameSessionsState>();
    if state.get(session_id).map(|s| s.pids == pids).unwrap_or(true) {
        return;
    }
    if let Some(session) = state.update(session_id, |s| s.pids = pids) {
        persist(app, &session);
    }
}

/// Drops a session that never started (launcher timeout) without recording.
pub fn cancel(app: &AppHandle, session_id: &str) {
    if app.state::<GameSessionsState>().take(session_id).is_none() {
        return;
    }
    if let Ok(conn) = app.state::<MetadeaDb>().conn.lock() {
        let _ = delete_active_in(&conn, session_id);
    }
    emit_changed(app);
}

/// Ends a session at `ended_unix`: records playtime (once) and notifies the
/// frontend. Returns None when the session was already finished.
pub fn finish(app: &AppHandle, session_id: &str, ended_unix: i64) -> Option<SessionOutcome> {
    let session = app.state::<GameSessionsState>().take(session_id)?;
    let outcome = {
        let db = app.state::<MetadeaDb>();
        let result = match db.conn.lock() {
            Ok(mut conn) => record_session_end_in(&mut conn, &session, ended_unix),
            Err(e) => Err(e.to_string()),
        };
        match result {
            Ok(outcome) => outcome,
            Err(e) => {
                log::error!("Could not record the game session for {}: {e}", session.external_id);
                SessionOutcome { seconds: session_seconds(&session, ended_unix), minutes_added: 0, recorded: false }
            }
        }
    };
    if !session.external_id.is_empty() {
        let _ = app.emit(SESSION_ENDED_EVENT, SessionEndedPayload {
            external_id: session.external_id.clone(),
            hours: outcome.seconds as f64 / 3600.0,
            recorded: outcome.recorded,
        });
    }
    emit_changed(app);
    Some(outcome)
}

/// Polls every 2 s, without a cap, until no process matching `matcher` is
/// alive other than the ones in `preexisting` (instances that were already
/// running before the launch). Keeps the session's PIDs current, and returns
/// the unix time the game was last seen alive (now, when it is already gone).
pub async fn follow_until_exit(app: &AppHandle, session_id: &str, matcher: &ProcessMatcher, preexisting: &HashSet<u32>) -> i64 {
    let mut last_seen = now_unix();
    let mut sys = System::new();
    loop {
        tokio::time::sleep(EXIT_POLL_EVERY).await;
        if app.state::<GameSessionsState>().get(session_id).is_none() {
            return last_seen;
        }
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let pids = exclude_preexisting(matching_pids(&sys, matcher), preexisting);
        if pids.is_empty() {
            return last_seen;
        }
        last_seen = now_unix();
        set_pids(app, session_id, pids);
    }
}

/// Startup: re-attach or close the sessions a previous run left behind, then
/// keep the heartbeat going. Call once from `setup`, after both
/// `MetadeaDb` and `GameSessionsState` are managed.
pub fn start(app: &AppHandle) {
    resume_persisted_sessions(app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(HEARTBEAT_EVERY).await;
            let now = now_unix();
            if !handle.state::<GameSessionsState>().touch_all(now) {
                continue;
            }
            if let Ok(conn) = handle.state::<MetadeaDb>().conn.lock() {
                let _ = heartbeat_in(&conn, now);
            }
        }
    });
}

fn resume_persisted_sessions(app: &AppHandle) {
    let db = app.state::<MetadeaDb>();
    let persisted = match db.conn.lock() {
        Ok(conn) => load_active_in(&conn).unwrap_or_default(),
        Err(_) => return,
    };
    if persisted.is_empty() {
        return;
    }
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    for mut session in persisted {
        let alive = alive_session_pids(&sys, &session);
        match decide_orphan(&session, &alive) {
            OrphanAction::Discard => {
                if let Ok(conn) = db.conn.lock() {
                    let _ = delete_active_in(&conn, &session.session_id);
                }
            }
            OrphanAction::Close { ended_unix } => {
                if let Ok(mut conn) = db.conn.lock() {
                    if let Err(e) = record_session_end_in(&mut conn, &session, ended_unix) {
                        log::error!("Could not close the interrupted game session for {}: {e}", session.external_id);
                    }
                }
            }
            OrphanAction::Reattach(pids) => {
                session.pids = pids;
                let Some(exe) = session.exe_path.clone() else { continue };
                let id = session.session_id.clone();
                app.state::<GameSessionsState>().insert(session.clone());
                persist(app, &session);
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let matcher = ProcessMatcher::exact(Path::new(&exe));
                    let ended = follow_until_exit(&handle, &id, &matcher, &HashSet::new()).await;
                    finish(&handle, &id, ended);
                });
            }
        }
    }
}

fn persist(app: &AppHandle, session: &ActiveSession) {
    if let Ok(conn) = app.state::<MetadeaDb>().conn.lock() {
        if let Err(e) = persist_in(&conn, session) {
            log::warn!("Could not persist the game session for {}: {e}", session.external_id);
        }
    }
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit(SESSIONS_CHANGED_EVENT, app.state::<GameSessionsState>().snapshot());
}

// ─── commands ────────────────────────────────────────────────────────────────

/// The running sessions, newest first (presence restore on page load).
#[tauri::command]
pub fn get_active_game_sessions(state: tauri::State<'_, GameSessionsState>) -> Vec<ActiveSession> {
    state.snapshot()
}

/// "Time played · Last played · N sessions" for a library id.
#[tauri::command]
pub fn get_game_play_stats(db: tauri::State<'_, MetadeaDb>, external_id: String) -> Result<GamePlayStats, String> {
    let conn = db.conn.lock().str_err()?;
    play_stats_in(&conn, &external_id).str_err()
}

// ─── process matching ────────────────────────────────────────────────────────

pub fn normalize_exe_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    let trimmed = s.strip_prefix(r"\\?\").unwrap_or(&s);
    trimmed.replace('/', "\\").to_lowercase()
}

/// Which running processes count as "the game".
#[derive(Debug, Clone)]
pub struct ProcessMatcher {
    /// Matches by file name too (`melonDS.exe`), for emulators.
    file_name: Option<String>,
    exe_norm: String,
}

impl ProcessMatcher {
    /// An emulator: same file name, or the same executable path.
    pub fn executable(path: &Path) -> Self {
        Self {
            file_name: path.file_name().map(|n| n.to_string_lossy().to_string()).filter(|n| !n.is_empty()),
            exe_norm: normalize_exe_path(path),
        }
    }

    /// Only this exact executable path.
    pub fn exact(path: &Path) -> Self {
        Self { file_name: None, exe_norm: normalize_exe_path(path) }
    }

    pub fn matches(&self, name: &str, exe: Option<&Path>) -> bool {
        if let Some(file_name) = &self.file_name {
            if name.eq_ignore_ascii_case(file_name) {
                return true;
            }
        }
        match exe {
            Some(exe) if !self.exe_norm.is_empty() => {
                let exe = normalize_exe_path(exe);
                if self.file_name.is_some() {
                    exe == self.exe_norm || exe.ends_with(&self.exe_norm) || self.exe_norm.ends_with(&exe)
                } else {
                    exe == self.exe_norm
                }
            }
            _ => false,
        }
    }
}

pub fn matching_pids(sys: &System, matcher: &ProcessMatcher) -> Vec<u32> {
    let mut pids: Vec<u32> = sys
        .processes()
        .iter()
        .filter(|(_, p)| matcher.matches(&p.name().to_string_lossy(), p.exe()))
        .map(|(pid, _)| pid.as_u32())
        .collect();
    pids.sort_unstable();
    pids
}

/// PIDs matching `matcher` right now: taken before a launch, so an instance
/// that was already running is never mistaken for the launched game.
pub fn snapshot_matching_pids(matcher: &ProcessMatcher) -> HashSet<u32> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    matching_pids(&sys, matcher).into_iter().collect()
}

/// `pids` minus the pre-launch snapshot, sorted.
pub fn exclude_preexisting(pids: impl IntoIterator<Item = u32>, preexisting: &HashSet<u32>) -> Vec<u32> {
    let mut kept: Vec<u32> = pids.into_iter().filter(|pid| !preexisting.contains(pid)).collect();
    kept.sort_unstable();
    kept.dedup();
    kept
}

/// The persisted PIDs that are still alive AND still the same executable
/// (a reused PID from another program does not count).
fn alive_session_pids(sys: &System, session: &ActiveSession) -> Vec<u32> {
    let Some(exe) = session.exe_path.as_deref().filter(|e| !e.is_empty()) else { return Vec::new() };
    let expected = normalize_exe_path(Path::new(exe));
    session
        .pids
        .iter()
        .copied()
        .filter(|pid| {
            sys.process(sysinfo::Pid::from_u32(*pid))
                .and_then(|p| p.exe())
                .map(|path| normalize_exe_path(path) == expected)
                .unwrap_or(false)
        })
        .collect()
}

// ─── pure decisions ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OrphanAction {
    /// Still running: watch these PIDs again.
    Reattach(Vec<u32>),
    /// Gone: record it as having ended at its last heartbeat.
    Close { ended_unix: i64 },
    /// Never started (launcher still loading when Metadea closed).
    Discard,
}

pub(crate) fn decide_orphan(session: &ActiveSession, alive_pids: &[u32]) -> OrphanAction {
    if !session.running {
        return OrphanAction::Discard;
    }
    if !alive_pids.is_empty() && session.exe_path.is_some() {
        return OrphanAction::Reattach(alive_pids.to_vec());
    }
    OrphanAction::Close { ended_unix: session.last_heartbeat_unix.max(session.started_unix) }
}

/// Opens or closes a pause interval; false when nothing changed.
pub(crate) fn apply_pause(session: &mut ActiveSession, paused: bool, now: i64) -> bool {
    match (paused, session.paused_since) {
        (true, None) => {
            session.paused_since = Some(now);
            true
        }
        (false, Some(since)) => {
            session.paused_seconds += (now - since).max(0);
            session.paused_since = None;
            true
        }
        _ => false,
    }
}

/// Running time at `now` without paused intervals (the open one included).
pub fn active_seconds(session: &ActiveSession, now: i64) -> i64 {
    let open_pause = session.paused_since.map(|since| (now - since).max(0)).unwrap_or(0);
    (now - session.started_unix - session.paused_seconds - open_pause).max(0)
}

/// Minutes a session adds: rounded, and at least 1 once it lasted ≥ 15 s.
pub(crate) fn minutes_to_add(seconds: i64) -> i64 {
    let rounded = (seconds as f64 / 60.0).round() as i64;
    if rounded > 0 {
        rounded
    } else if seconds >= MIN_COUNTED_SECONDS {
        1
    } else {
        0
    }
}

/// Library `progress` for games is hours, 2 decimals.
pub(crate) fn progress_hours(minutes: f64) -> f64 {
    ((minutes / 60.0) * 100.0).round() / 100.0
}

// Time in the pause menu (game suspended) is not playtime.
fn session_seconds(session: &ActiveSession, ended_unix: i64) -> i64 {
    active_seconds(session, ended_unix)
}

// ─── SQL ─────────────────────────────────────────────────────────────────────

fn pids_to_text(pids: &[u32]) -> String {
    pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",")
}

fn pids_from_text(text: &str) -> Vec<u32> {
    text.split(',').filter_map(|p| p.trim().parse().ok()).collect()
}

fn persist_in(conn: &Connection, s: &ActiveSession) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO active_game_sessions (
            session_id, external_id, title, cover_url, platform, launcher, app_id,
            install_path, exe_path, pids, started_unix, last_heartbeat_unix, running,
            paused_seconds, paused_since
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![
            s.session_id, s.external_id, s.title, s.cover_url, s.platform, s.launcher, s.app_id,
            s.install_path, s.exe_path, pids_to_text(&s.pids), s.started_unix, s.last_heartbeat_unix,
            s.running as i32, s.paused_seconds, s.paused_since,
        ],
    )
    .map(|_| ())
}

fn delete_active_in(conn: &Connection, session_id: &str) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM active_game_sessions WHERE session_id = ?1", [session_id])
}

fn heartbeat_in(conn: &Connection, now: i64) -> rusqlite::Result<usize> {
    conn.execute("UPDATE active_game_sessions SET last_heartbeat_unix = MAX(last_heartbeat_unix, ?1)", [now])
}

fn load_active_in(conn: &Connection) -> rusqlite::Result<Vec<ActiveSession>> {
    let mut stmt = conn.prepare(
        "SELECT session_id, external_id, title, cover_url, platform, launcher, app_id,
                install_path, exe_path, pids, started_unix, last_heartbeat_unix, running,
                paused_seconds, paused_since
         FROM active_game_sessions",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ActiveSession {
            session_id: r.get(0)?,
            external_id: r.get(1)?,
            title: r.get(2)?,
            cover_url: r.get(3)?,
            platform: r.get(4)?,
            launcher: r.get(5)?,
            app_id: r.get(6)?,
            install_path: r.get(7)?,
            exe_path: r.get(8)?,
            pids: pids_from_text(&r.get::<_, String>(9)?),
            started_unix: r.get(10)?,
            last_heartbeat_unix: r.get(11)?,
            running: r.get::<_, i32>(12)? != 0,
            paused_seconds: r.get(13)?,
            paused_since: r.get(14)?,
        })
    })?;
    rows.collect()
}

/// Closes a session in one transaction: drops its persisted row, logs it
/// and adds its minutes to the library entry (creating a game / in_progress
/// entry when missing). Sessions shorter than 15 s, never started, or with
/// no library id are dropped without a trace.
pub(crate) fn record_session_end_in(conn: &mut Connection, session: &ActiveSession, ended_unix: i64) -> Result<SessionOutcome, String> {
    let tx = conn.transaction().str_err()?;
    delete_active_in(&tx, &session.session_id).str_err()?;
    let seconds = session_seconds(session, ended_unix);
    let counts = session.running && !session.external_id.is_empty() && seconds >= MIN_COUNTED_SECONDS;
    let mut outcome = SessionOutcome { seconds, minutes_added: 0, recorded: false };
    if counts {
        tx.execute(
            "INSERT INTO game_sessions_log (external_id, started_at, ended_at, seconds, platform) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![session.external_id, session.started_unix, ended_unix, seconds, session.platform],
        )
        .str_err()?;
        let minutes = minutes_to_add(seconds);
        outcome.recorded = add_playtime_minutes_in(&tx, &session.external_id, minutes)?;
        if outcome.recorded {
            outcome.minutes_added = minutes;
        }
    }
    tx.commit().str_err()?;
    Ok(outcome)
}

/// `minutes_spent += minutes` (the old addPlaytimeHours semantics). Skips
/// works hidden from Metadea and bundles, which save_library_entry refuses.
fn add_playtime_minutes_in(conn: &Connection, external_id: &str, minutes: i64) -> Result<bool, String> {
    if minutes <= 0 {
        return Ok(false);
    }
    let catalog: Option<(Option<String>, bool)> = conn
        .query_row(
            "SELECT format, blocked_at IS NOT NULL FROM media_catalog WHERE external_id = ?1",
            [external_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .str_err()?;
    if let Some((format, blocked)) = &catalog {
        if *blocked || format.as_deref() == Some("BUNDLE") {
            return Ok(false);
        }
    }
    let now = chrono::Utc::now();
    let now_text = now.to_rfc3339();
    let existing: Option<(Option<f64>, Option<f64>)> = conn
        .query_row(
            "SELECT minutes_spent, progress FROM user_library WHERE external_id = ?1",
            [external_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .str_err()?;
    match existing {
        Some((spent, progress)) => {
            let spent = spent.unwrap_or(0.0);
            let current = if spent > 0.0 { spent } else { (progress.unwrap_or(0.0) * 60.0).round() };
            let total = current + minutes as f64;
            conn.execute(
                "UPDATE user_library SET minutes_spent = ?1, progress = ?2, updated_at = ?3 WHERE external_id = ?4",
                rusqlite::params![total, progress_hours(total), now_text, external_id],
            )
            .str_err()?;
        }
        None => {
            let total = minutes as f64;
            conn.execute(
                "INSERT INTO user_library (
                    id, user_id, external_id, type, status, progress, progress_2, minutes_spent,
                    is_favorite, is_platinum, added_at, updated_at, started_at
                ) VALUES (?1, 'local', ?2, 'game', 'in_progress', ?3, 0, ?4, 0, 0, ?5, ?5, ?6)",
                rusqlite::params![
                    crate::db::generate_id(), external_id, progress_hours(total), total, now_text,
                    now.format("%Y-%m-%d").to_string(),
                ],
            )
            .str_err()?;
        }
    }
    Ok(true)
}

pub(crate) fn play_stats_in(conn: &Connection, external_id: &str) -> rusqlite::Result<GamePlayStats> {
    let (count, total_seconds, last): (i64, i64, Option<i64>) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(seconds), 0), MAX(ended_at) FROM game_sessions_log WHERE external_id = ?1",
        [external_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let library: Option<(Option<f64>, Option<f64>)> = conn
        .query_row(
            "SELECT minutes_spent, progress FROM user_library WHERE external_id = ?1",
            [external_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let total_minutes = match library {
        Some((Some(spent), _)) if spent > 0.0 => spent,
        Some((_, Some(progress))) if progress > 0.0 => (progress * 60.0).round(),
        _ => (total_seconds as f64 / 60.0).round(),
    };
    Ok(GamePlayStats {
        total_minutes,
        sessions_count: count,
        last_played_unix: last,
        average_session_minutes: (count > 0).then(|| total_seconds as f64 / count as f64 / 60.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(external_id: &str, started: i64) -> ActiveSession {
        ActiveSession {
            session_id: format!("s-{external_id}-{started}"),
            external_id: external_id.into(),
            title: "Pokémon Emerald".into(),
            cover_url: None,
            platform: Some("gba".into()),
            launcher: "emulator".into(),
            app_id: None,
            install_path: Some(r"C:\Roms\emerald.gba".into()),
            exe_path: Some(r"C:\Emus\mGBA\mGBA.exe".into()),
            pids: vec![100],
            started_unix: started,
            last_heartbeat_unix: started,
            running: true,
            paused_seconds: 0,
            paused_since: None,
        }
    }

    fn db() -> MetadeaDb {
        MetadeaDb::open_in_memory().unwrap()
    }

    fn library_row(conn: &Connection, id: &str) -> Option<(f64, f64, String, String)> {
        conn.query_row(
            "SELECT minutes_spent, progress, type, status FROM user_library WHERE external_id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .unwrap()
    }

    fn log_count(conn: &Connection, id: &str) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM game_sessions_log WHERE external_id = ?1", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn minutes_round_and_short_sessions_count_one_minute() {
        assert_eq!(minutes_to_add(0), 0);
        assert_eq!(minutes_to_add(14), 0);
        assert_eq!(minutes_to_add(15), 1);
        assert_eq!(minutes_to_add(29), 1);
        assert_eq!(minutes_to_add(30), 1);
        assert_eq!(minutes_to_add(89), 1);
        assert_eq!(minutes_to_add(90), 2);
        assert_eq!(minutes_to_add(3600), 60);
    }

    #[test]
    fn progress_is_hours_with_two_decimals() {
        assert_eq!(progress_hours(60.0), 1.0);
        assert_eq!(progress_hours(90.0), 1.5);
        assert_eq!(progress_hours(100.0), 1.67);
        assert_eq!(progress_hours(1.0), 0.02);
    }

    #[test]
    fn finishing_creates_a_game_entry_when_missing() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        let s = session("igdb:1", 1_000);
        persist_in(&conn, &s).unwrap();
        let outcome = record_session_end_in(&mut conn, &s, 1_000 + 5_400).unwrap();
        assert_eq!(outcome, SessionOutcome { seconds: 5_400, minutes_added: 90, recorded: true });
        let (minutes, progress, kind, status) = library_row(&conn, "igdb:1").unwrap();
        assert_eq!((minutes, progress, kind.as_str(), status.as_str()), (90.0, 1.5, "game", "in_progress"));
        assert_eq!(log_count(&conn, "igdb:1"), 1);
        assert!(load_active_in(&conn).unwrap().is_empty());
    }

    #[test]
    fn finishing_adds_to_existing_minutes_or_derives_them_from_progress() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO user_library (id, user_id, external_id, type, status, progress, minutes_spent) VALUES ('a', 'local', 'igdb:2', 'game', 'completed', 2.0, 0)",
            [],
        ).unwrap();
        record_session_end_in(&mut conn, &session("igdb:2", 0), 1_800).unwrap();
        let (minutes, progress, _, status) = library_row(&conn, "igdb:2").unwrap();
        assert_eq!((minutes, progress, status.as_str()), (150.0, 2.5, "completed"));

        record_session_end_in(&mut conn, &session("igdb:2", 10_000), 10_020).unwrap();
        assert_eq!(library_row(&conn, "igdb:2").unwrap().0, 151.0);
    }

    #[test]
    fn short_unstarted_or_untracked_sessions_record_nothing() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        let outcome = record_session_end_in(&mut conn, &session("igdb:3", 0), 10).unwrap();
        assert!(!outcome.recorded);
        let mut pending = session("igdb:3", 0);
        pending.running = false;
        assert!(!record_session_end_in(&mut conn, &pending, 600).unwrap().recorded);
        assert!(library_row(&conn, "igdb:3").is_none());
        assert_eq!(log_count(&conn, "igdb:3"), 0);

        let untracked = session("", 0);
        assert!(!record_session_end_in(&mut conn, &untracked, 600).unwrap().recorded);
        assert_eq!(log_count(&conn, ""), 0);
    }

    #[test]
    fn bundles_are_logged_but_never_written_to_the_library() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        conn.execute("INSERT INTO media_catalog (id, external_id, type, title_main, format) VALUES ('m9', 'igdb:9', 'game', 'Bundle', 'BUNDLE')", []).unwrap();
        let outcome = record_session_end_in(&mut conn, &session("igdb:9", 0), 600).unwrap();
        assert!(!outcome.recorded);
        assert!(library_row(&conn, "igdb:9").is_none());
    }

    #[test]
    fn a_session_is_only_recorded_once() {
        let state = GameSessionsState::default();
        let s = session("igdb:4", 0);
        state.insert(s.clone());
        assert!(state.take(&s.session_id).is_some());
        assert!(state.take(&s.session_id).is_none(), "a second finish must be a no-op");

        let db = db();
        let mut conn = db.conn.lock().unwrap();
        persist_in(&conn, &s).unwrap();
        record_session_end_in(&mut conn, &s, 600).unwrap();
        // The persisted row is gone with the same commit, so a restart can't
        // close it a second time.
        assert!(load_active_in(&conn).unwrap().is_empty());
        assert_eq!(library_row(&conn, "igdb:4").unwrap().0, 10.0);
    }

    #[test]
    fn duplicate_launches_share_one_session() {
        let state = GameSessionsState::default();
        let s = session("igdb:5", 0);
        state.insert(s.clone());
        let again = NewSession { external_id: "igdb:5".into(), ..Default::default() };
        assert_eq!(state.duplicate_of(&again), Some(s.session_id.clone()));
        let other = NewSession { external_id: "igdb:6".into(), ..Default::default() };
        assert_eq!(state.duplicate_of(&other), None);
    }

    #[test]
    fn registry_lookups_by_pid_and_session() {
        let state = GameSessionsState::default();
        let mut s = session("igdb:7", 0);
        s.pids = vec![42, 43];
        state.insert(s.clone());
        assert_eq!(state.active_session_for_pid(43).map(|x| x.session_id), Some(s.session_id.clone()));
        assert!(state.active_session_for_pid(44).is_none());
        assert_eq!(state.pids_for_session(&s.session_id), vec![42, 43]);
        assert!(state.pids_for_session("missing").is_empty());
    }

    #[test]
    fn orphans_reattach_close_at_heartbeat_or_discard() {
        let mut s = session("igdb:8", 1_000);
        s.last_heartbeat_unix = 4_600;
        assert_eq!(decide_orphan(&s, &[100]), OrphanAction::Reattach(vec![100]));
        assert_eq!(decide_orphan(&s, &[]), OrphanAction::Close { ended_unix: 4_600 });
        s.last_heartbeat_unix = 500;
        assert_eq!(decide_orphan(&s, &[]), OrphanAction::Close { ended_unix: 1_000 });
        s.running = false;
        assert_eq!(decide_orphan(&s, &[100]), OrphanAction::Discard);
    }

    #[test]
    fn heartbeat_persists_and_closing_uses_it() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        let s = session("igdb:10", 1_000);
        persist_in(&conn, &s).unwrap();
        heartbeat_in(&conn, 1_000 + 3_600).unwrap();
        heartbeat_in(&conn, 900).unwrap();
        let loaded = load_active_in(&conn).unwrap();
        assert_eq!(loaded, vec![ActiveSession { last_heartbeat_unix: 4_600, ..s.clone() }]);
        let OrphanAction::Close { ended_unix } = decide_orphan(&loaded[0], &[]) else { panic!() };
        record_session_end_in(&mut conn, &loaded[0], ended_unix).unwrap();
        assert_eq!(library_row(&conn, "igdb:10").unwrap().0, 60.0);
    }

    #[test]
    fn preexisting_instances_are_excluded() {
        let pre: HashSet<u32> = [10, 11].into_iter().collect();
        assert_eq!(exclude_preexisting([11, 30, 10, 20, 20], &pre), vec![20, 30]);
        assert!(exclude_preexisting([10, 11], &pre).is_empty());
    }

    #[test]
    fn matcher_by_name_or_path() {
        let emulator = ProcessMatcher::executable(Path::new(r"C:\Emus\melonDS\melonDS.exe"));
        assert!(emulator.matches("MELONDS.EXE", None));
        assert!(emulator.matches("other.exe", Some(Path::new(r"\\?\C:/Emus/melonDS/melonDS.exe"))));
        assert!(!emulator.matches("mGBA.exe", Some(Path::new(r"C:\Emus\mGBA\mGBA.exe"))));
        let exact = ProcessMatcher::exact(Path::new(r"C:\Games\Hades\Hades.exe"));
        assert!(!exact.matches("Hades.exe", None));
        assert!(exact.matches("x", Some(Path::new(r"c:\games\hades\hades.exe"))));
    }

    #[test]
    fn paused_intervals_are_excluded_from_active_time() {
        let mut s = session("igdb:12", 1_000);
        assert_eq!(active_seconds(&s, 2_000), 1_000);
        assert!(apply_pause(&mut s, true, 1_500));
        assert!(!apply_pause(&mut s, true, 1_600), "already paused");
        assert_eq!(active_seconds(&s, 1_800), 500);
        assert!(apply_pause(&mut s, false, 1_900));
        assert!(!apply_pause(&mut s, false, 1_950), "already running");
        assert_eq!(s.paused_seconds, 400);
        assert_eq!(active_seconds(&s, 2_000), 600);
    }

    #[test]
    fn play_stats_combine_library_minutes_and_the_log() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        assert_eq!(
            play_stats_in(&conn, "igdb:11").unwrap(),
            GamePlayStats { total_minutes: 0.0, sessions_count: 0, last_played_unix: None, average_session_minutes: None },
        );
        record_session_end_in(&mut conn, &session("igdb:11", 0), 1_200).unwrap();
        record_session_end_in(&mut conn, &session("igdb:11", 5_000), 8_600).unwrap();
        let stats = play_stats_in(&conn, "igdb:11").unwrap();
        assert_eq!(stats.total_minutes, 80.0);
        assert_eq!(stats.sessions_count, 2);
        assert_eq!(stats.last_played_unix, Some(8_600));
        assert_eq!(stats.average_session_minutes, Some(40.0));
    }
}
