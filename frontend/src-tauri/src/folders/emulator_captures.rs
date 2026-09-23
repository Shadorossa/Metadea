// Emulator screenshots end up exactly where the built-in player's F12
// captures do: `$PICTURES/Metadea/<work>/`, listed by get_local_screenshots.
//
// The emulator keeps writing to its own folder (emulators::screenshot_sources:
// the per-emulator table, or the user's override for an unknown emulator).
// While a ROM session runs, CaptureSession watches those folders and MOVES
// each new image (copy, verify, then delete the original — left in place if
// it cannot be deleted) to `<Title> - <YYYY-MM-DD HH-MM-SS>.<ext>`, raising
// the native capture toast (toast_window.rs). When the session ends it
// sweeps once more for captures the polling missed. import_emulator_screenshots
// does the same move for a game's captures taken before this existed (or
// outside Metadea), named after each file's modification time.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use crate::emulators::ScreenshotSource;
use super::screenshots::{metadea_capture_dir, sanitize_capture_folder_name};
use super::toast_window::{show_screenshot_toast, ScreenshotToastPayload};

const POLL_INTERVAL: Duration = Duration::from_millis(250);
// Polls in a row a capture must keep the same non-zero size before it is
// moved: emulators write PNGs in several chunks (and some re-open the file
// to add metadata).
const STABLE_CHECKS: u8 = 2;
// A capture the emulator keeps locked is retried for about ten seconds, then
// left where it is (the end-of-session sweep gets one more try).
const MAX_MOVE_ATTEMPTS: u8 = 40;
// Clock/filesystem timestamp granularity when deciding whether a file the
// end-of-session sweep finds was written during the session.
const SESSION_START_SLACK: Duration = Duration::from_secs(2);
// The import leaves alone anything written this recently: it may be a
// capture a running session is still writing (and will move itself).
const IMPORT_MIN_AGE: Duration = Duration::from_secs(5);
// Same cap the player's screenshot_file_name puts on the work name.
const TITLE_MAX_CHARS: usize = 100;

pub(crate) fn is_capture_image(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| matches!(extension.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp"))
}

fn capture_extension(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| "png".to_string())
}

fn local_time(time: SystemTime) -> chrono::DateTime<chrono::Local> {
    chrono::DateTime::<chrono::Local>::from(time)
}

pub(crate) fn capture_timestamp(time: SystemTime) -> String {
    local_time(time).format("%Y-%m-%d %H-%M-%S").to_string()
}

/// `<Title> - <YYYY-MM-DD HH-MM-SS>.<ext>`, the title sanitized and capped
/// exactly like the player's captures.
pub(crate) fn capture_file_name(title: &str, taken_at: SystemTime, extension: &str) -> String {
    let title: String = sanitize_capture_folder_name(title).chars().take(TITLE_MAX_CHARS).collect();
    format!("{title} - {}.{extension}", capture_timestamp(taken_at))
}

// `name.png`, then `name (2).png`, `name (3).png`… — the candidates a capture
// named `file_name` may occupy, in order.
fn collision_candidate(directory: &Path, file_name: &str, attempt: u32) -> PathBuf {
    if attempt < 2 {
        return directory.join(file_name);
    }
    let path = Path::new(file_name);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    match path.extension() {
        Some(extension) => directory.join(format!("{stem} ({attempt}).{}", extension.to_string_lossy())),
        None => directory.join(format!("{stem} ({attempt})")),
    }
}

pub(crate) fn available_capture_path(directory: &Path, file_name: &str) -> PathBuf {
    (1u32..)
        .map(|attempt| collision_candidate(directory, file_name, attempt))
        .find(|candidate| !candidate.exists())
        .unwrap_or_else(|| directory.join(file_name))
}

fn same_contents(a: &Path, b: &Path) -> bool {
    let (Ok(mut left), Ok(mut right)) = (std::fs::File::open(a), std::fs::File::open(b)) else {
        return false;
    };
    let (mut left_buffer, mut right_buffer) = ([0u8; 64 * 1024], [0u8; 64 * 1024]);
    loop {
        let Ok(read) = left.read(&mut left_buffer) else { return false };
        if read == 0 {
            return right.read(&mut right_buffer).map(|n| n == 0).unwrap_or(false);
        }
        if right.read_exact(&mut right_buffer[..read]).is_err() || left_buffer[..read] != right_buffer[..read] {
            return false;
        }
    }
}

// An identical copy already sitting under this capture's name (or one of its
// `(n)` variants): the source was moved before but could not be deleted.
fn identical_existing(directory: &Path, file_name: &str, source: &Path, size: u64) -> Option<PathBuf> {
    (1u32..)
        .map(|attempt| collision_candidate(directory, file_name, attempt))
        .take_while(|candidate| candidate.exists())
        .find(|candidate| {
            std::fs::metadata(candidate).map(|m| m.len()).ok() == Some(size) && same_contents(candidate, source)
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MovedCapture {
    pub destination: PathBuf,
    pub taken_at: SystemTime,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MoveOutcome {
    Moved(MovedCapture),
    // A byte-identical copy was already in the Metadea folder.
    AlreadyPresent,
}

/// Moves `source` into `dest_dir` under the capture naming scheme, keeping
/// its modification time. The original is deleted only once the copy has
/// been read back identical; a failed delete leaves it where it was.
pub(crate) fn move_capture(source: &Path, dest_dir: &Path, title: &str) -> std::io::Result<MoveOutcome> {
    let metadata = std::fs::metadata(source)?;
    let size = metadata.len();
    if size == 0 {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "empty capture"));
    }
    let taken_at = metadata.modified().unwrap_or_else(|_| SystemTime::now());
    std::fs::create_dir_all(dest_dir)?;
    let file_name = capture_file_name(title, taken_at, &capture_extension(source));

    if identical_existing(dest_dir, &file_name, source, size).is_some() {
        let _ = std::fs::remove_file(source);
        return Ok(MoveOutcome::AlreadyPresent);
    }

    let destination = available_capture_path(dest_dir, &file_name);
    std::fs::copy(source, &destination)?;
    if !same_contents(source, &destination) {
        let _ = std::fs::remove_file(&destination);
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "capture copy does not match its source"));
    }
    if let Ok(file) = std::fs::File::options().write(true).open(&destination) {
        let _ = file.set_modified(taken_at);
    }
    let _ = std::fs::remove_file(source);
    Ok(MoveOutcome::Moved(MovedCapture { destination, taken_at }))
}

// ── Session watcher ───────────────────────────────────────────────────────

fn modified_time(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|metadata| metadata.modified()).ok()
}

// The images in `dir`; with a ROM-folder source's `name_prefix`, only the
// ones named after that ROM (emulators::is_rom_capture_name).
fn images_in(dir: &Path, name_prefix: Option<&str>, out: &mut Vec<(PathBuf, Option<SystemTime>)>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let named_ok = name_prefix.map_or(true, |prefix| {
            path.file_name().and_then(|name| name.to_str()).is_some_and(|name| crate::emulators::is_rom_capture_name(name, prefix))
        });
        if named_ok && is_capture_image(&path) {
            let modified = entry.metadata().and_then(|metadata| metadata.modified()).ok();
            out.push((path, modified));
        }
    }
}

// Every image in the sources right now (Dolphin-style sources one level
// deep as well), with its modification time.
fn source_images(sources: &[ScreenshotSource]) -> Vec<(PathBuf, Option<SystemTime>)> {
    let mut images = Vec::new();
    for source in sources {
        images_in(&source.dir, source.name_prefix.as_deref(), &mut images);
        if source.per_game_subfolders {
            if let Ok(entries) = std::fs::read_dir(&source.dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        images_in(&path, None, &mut images);
                    }
                }
            }
        }
    }
    images
}

#[derive(Debug)]
struct PendingCapture {
    path: PathBuf,
    size: u64,
    stable_checks: u8,
    attempts: u8,
}

impl PendingCapture {
    fn new(path: PathBuf) -> Self {
        Self { path, size: 0, stable_checks: 0, attempts: 0 }
    }

    /// Feeds one size reading; true once the file has kept the same
    /// non-zero size for STABLE_CHECKS readings in a row.
    fn observe(&mut self, current: Option<u64>) -> bool {
        match current {
            Some(size) if size > 0 && size == self.size => self.stable_checks = self.stable_checks.saturating_add(1),
            other => {
                self.size = other.unwrap_or(0);
                self.stable_checks = 0;
            }
        }
        self.stable_checks >= STABLE_CHECKS
    }
}

pub(crate) struct CaptureSession {
    sources: Vec<ScreenshotSource>,
    dest_dir: PathBuf,
    title: String,
    started_at: SystemTime,
    // Images that are not to be moved, with the modification time they had
    // when last looked at: what was there before the session, and originals
    // left behind by a failed delete. A known file whose time changes (an
    // emulator reusing one file name) counts as a new capture.
    known: HashMap<PathBuf, Option<SystemTime>>,
    pending: Vec<PendingCapture>,
}

impl CaptureSession {
    pub(crate) fn start(sources: Vec<ScreenshotSource>, dest_dir: PathBuf, title: String, started_at: SystemTime) -> Self {
        let known = source_images(&sources).into_iter().collect();
        Self { sources, dest_dir, title, started_at, known, pending: Vec::new() }
    }

    fn is_pending(&self, path: &Path) -> bool {
        self.pending.iter().any(|capture| capture.path == path)
    }

    fn discover(&mut self, only_since_start: bool) {
        for (path, modified) in source_images(&self.sources) {
            if self.is_pending(&path) || self.known.get(&path) == Some(&modified) {
                continue;
            }
            let during_session = modified.is_some_and(|time| time + SESSION_START_SLACK >= self.started_at);
            if only_since_start && !during_session {
                continue;
            }
            self.known.remove(&path);
            self.pending.push(PendingCapture::new(path));
        }
    }

    // Tries to move pending[index]; it leaves the queue unless the move
    // failed and is to be retried. An original still on disk afterwards (a
    // failed delete, or a capture given up on) becomes known, so it is not
    // picked up again.
    fn settle(&mut self, index: usize, final_attempt: bool) -> Option<MovedCapture> {
        let moved = match move_capture(&self.pending[index].path, &self.dest_dir, &self.title) {
            Ok(MoveOutcome::Moved(moved)) => Some(moved),
            Ok(MoveOutcome::AlreadyPresent) => None,
            Err(error) => {
                let capture = &mut self.pending[index];
                capture.attempts = capture.attempts.saturating_add(1);
                capture.stable_checks = 0;
                if !final_attempt && capture.attempts < MAX_MOVE_ATTEMPTS {
                    return None;
                }
                log::warn!("Could not move emulator capture {}: {error}", capture.path.display());
                None
            }
        };
        let capture = self.pending.remove(index);
        if capture.path.exists() {
            self.known.insert(capture.path.clone(), modified_time(&capture.path));
        }
        moved
    }

    /// One poll: picks up new captures and moves the ones done being written.
    pub(crate) fn tick(&mut self) -> Vec<MovedCapture> {
        self.discover(false);
        let mut moved = Vec::new();
        let mut index = 0;
        while index < self.pending.len() {
            let current = std::fs::metadata(&self.pending[index].path).ok().map(|metadata| metadata.len());
            if current.is_none() {
                // Gone (a temporary name the emulator renamed): the final
                // name shows up on its own.
                self.pending.remove(index);
                continue;
            }
            if !self.pending[index].observe(current) {
                index += 1;
                continue;
            }
            let before = self.pending.len();
            if let Some(capture) = self.settle(index, false) {
                moved.push(capture);
            }
            if self.pending.len() == before {
                index += 1;
            }
        }
        moved
    }

    /// The session is over (the emulator has exited, so nothing is still
    /// being written): one last sweep for captures written during the
    /// session that polling missed, and every queued capture moved now.
    pub(crate) fn finish(mut self) -> Vec<MovedCapture> {
        self.discover(true);
        let mut moved = Vec::new();
        while !self.pending.is_empty() {
            if let Some(capture) = self.settle(0, true) {
                moved.push(capture);
            }
        }
        moved
    }
}

/// Polls `session` until `stop` is raised, then finishes it; `on_moved`
/// runs for every capture moved. Returns how many were.
pub(crate) async fn run_capture_session<F: FnMut(&MovedCapture)>(
    mut session: CaptureSession,
    stop: Arc<AtomicBool>,
    poll_every: Duration,
    mut on_moved: F,
) -> usize {
    let mut count = 0;
    while !stop.load(Ordering::Acquire) {
        tokio::time::sleep(poll_every).await;
        for capture in session.tick() {
            on_moved(&capture);
            count += 1;
        }
    }
    for capture in session.finish() {
        on_moved(&capture);
        count += 1;
    }
    count
}

/// The watcher of one emulator session; `stop` ends it (after its final sweep).
pub(super) struct EmulatorCaptureWatcher {
    stop: Arc<AtomicBool>,
    task: tauri::async_runtime::JoinHandle<usize>,
}

impl EmulatorCaptureWatcher {
    pub(super) async fn stop(self) {
        self.stop.store(true, Ordering::Release);
        let _ = self.task.await;
    }
}

fn user_dirs(app_handle: &tauri::AppHandle) -> crate::emulators::UserDirs {
    use tauri::Manager;
    crate::emulators::UserDirs {
        documents: app_handle.path().document_dir().ok(),
        data: app_handle.path().data_dir().ok(),
        pictures: app_handle.path().picture_dir().ok(),
    }
}

fn platform_config(app_handle: &tauri::AppHandle, platform_id: &str) -> Result<Option<crate::emulators::EmulatorConfig>, String> {
    use tauri::Manager;
    let db = app_handle.state::<crate::db::MetadeaDb>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::emulators::emulator_config_for_platform(&conn, platform_id)
}

/// What a capture's title falls back to when the launch did not name the game.
pub(super) fn rom_title(rom_path: &str) -> String {
    Path::new(rom_path)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Starts watching the platform emulator's capture folders for the session
/// that was just launched. None when the emulator's folders are unknown.
pub(super) fn start_emulator_capture_watcher(
    app_handle: &tauri::AppHandle,
    platform_id: &str,
    rom_path: &str,
    title: &str,
) -> Option<EmulatorCaptureWatcher> {
    let config = platform_config(app_handle, platform_id).ok().flatten()?;
    let sources = crate::emulators::screenshot_sources(&config, &user_dirs(app_handle), Some(rom_path));
    if sources.is_empty() {
        return None;
    }
    let dest_dir = metadea_capture_dir(app_handle, title).ok()?;
    let session = CaptureSession::start(sources, dest_dir, title.to_string(), SystemTime::now());

    let stop = Arc::new(AtomicBool::new(false));
    let app = app_handle.clone();
    let work_name = title.to_string();
    let emulator_name = config.emulator_name;
    let task = tauri::async_runtime::spawn(run_capture_session(session, stop.clone(), POLL_INTERVAL, move |capture| {
        show_screenshot_toast(&app, ScreenshotToastPayload {
            work_name: work_name.clone(),
            episode_label: emulator_name.clone(),
            timecode: local_time(capture.taken_at).format("%H:%M:%S").to_string(),
        });
    }));
    Some(EmulatorCaptureWatcher { stop, task })
}

// ── One-time import of earlier captures ───────────────────────────────────

// Lowercase alphanumerics only, so "Zelda - Twilight Princess" matches
// "zelda_twilight_princess_20240101.png" whatever separators either uses.
fn normalized_key(text: &str) -> String {
    text.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

// What a capture's file name may start with to be this game's: the ROM's
// file stem (whole, and without its "(USA) [v1.1]" tags), the display title
// and the header id/title. Under 3 characters would match nearly anything.
pub(crate) fn game_match_keys(rom_path: &str, title: Option<&str>, header_id: Option<&str>, header_title: Option<&str>) -> Vec<String> {
    let rom_stem = Path::new(rom_path).file_stem().and_then(|stem| stem.to_str());
    let bare_stem = rom_stem.map(|stem| stem.split(['(', '[']).next().unwrap_or(stem));
    let mut keys: Vec<String> = [rom_stem, bare_stem, title, header_id, header_title]
        .into_iter()
        .flatten()
        .map(normalized_key)
        .filter(|key| key.chars().count() >= 3)
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

// Moving is not undoable from the app, so the match is strict: a key, then
// nothing but the emulator's own counter/timestamp digits. "Mario_0001"
// is Mario's; "Mario Kart_0001" is not.
pub(crate) fn capture_belongs_to_game(file_name: &str, keys: &[String]) -> bool {
    let stem = file_name.rsplit_once('.').map_or(file_name, |(stem, _)| stem);
    let normalized = normalized_key(stem);
    keys.iter().any(|key| {
        normalized
            .strip_prefix(key.as_str())
            .is_some_and(|rest| rest.chars().all(|character| character.is_ascii_digit()))
    })
}

/// The earlier captures of one game in the emulator's folders: all of a
/// Dolphin-style `<GameID>/` subfolder, the flat folder's images named after
/// the game, and a ROM-folder source's `<rom stem>-<n>` images. Never
/// "recent captures" of other games.
pub(crate) fn import_candidates(sources: &[ScreenshotSource], keys: &[String], header_id: Option<&str>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for source in sources {
        if let Some(prefix) = source.name_prefix.as_deref() {
            let mut images = Vec::new();
            images_in(&source.dir, Some(prefix), &mut images);
            candidates.extend(images.into_iter().map(|(path, _)| path));
            continue;
        }
        if let Some(game_dir) = header_id.filter(|id| !id.is_empty()).map(|id| source.dir.join(id)).filter(|dir| dir.is_dir()) {
            let mut images = Vec::new();
            images_in(&game_dir, None, &mut images);
            candidates.extend(images.into_iter().map(|(path, _)| path));
        }
        let mut images = Vec::new();
        images_in(&source.dir, None, &mut images);
        candidates.extend(images.into_iter().map(|(path, _)| path).filter(|path| {
            path.file_name().and_then(|name| name.to_str()).is_some_and(|name| capture_belongs_to_game(name, keys))
        }));
    }
    candidates.sort();
    candidates.dedup();
    candidates
}

/// Moves every import candidate older than IMPORT_MIN_AGE into `dest_dir`;
/// returns how many were moved.
pub(crate) fn import_game_captures(candidates: &[PathBuf], dest_dir: &Path, title: &str, now: SystemTime) -> usize {
    candidates
        .iter()
        .filter(|path| {
            modified_time(path).is_some_and(|modified| now.duration_since(modified).is_ok_and(|age| age >= IMPORT_MIN_AGE))
        })
        .filter(|path| matches!(move_capture(path, dest_dir, title), Ok(MoveOutcome::Moved(_))))
        .count()
}

/// Moves this game's captures already sitting in the emulator's folder into
/// `$PICTURES/Metadea/<title>/` (named after each file's modification time).
/// Idempotent: a moved capture is gone from the source, so opening the game
/// again finds nothing more to do.
#[tauri::command]
pub async fn import_emulator_screenshots(
    app_handle: tauri::AppHandle,
    platform_id: String,
    rom_path: String,
    title: String,
    header_id: Option<String>,
) -> Result<usize, String> {
    let Some(config) = platform_config(&app_handle, &platform_id)? else {
        return Ok(0);
    };
    let sources: Vec<ScreenshotSource> = crate::emulators::screenshot_sources(&config, &user_dirs(&app_handle), Some(&rom_path))
        .into_iter()
        .filter(|source| source.dir.is_dir())
        .collect();
    if sources.is_empty() {
        return Ok(0);
    }
    let title = if title.trim().is_empty() { rom_title(&rom_path) } else { title };
    let dest_dir = metadea_capture_dir(&app_handle, &title)?;

    tauri::async_runtime::spawn_blocking(move || {
        // The header id/title come from the ROM itself when the caller has
        // none (Dolphin's per-game folder is named after the disc's game id).
        let header = if header_id.is_none() {
            crate::platform_scanning::rom_header::read_rom_header(Path::new(&rom_path))
        } else {
            None
        };
        let header_id = header_id.or_else(|| header.as_ref().map(|h| h.game_id.clone()));
        let header_title = header.as_ref().and_then(|h| h.title.clone());
        let keys = game_match_keys(&rom_path, Some(&title), header_id.as_deref(), header_title.as_deref());
        let candidates = import_candidates(&sources, &keys, header_id.as_deref());
        import_game_captures(&candidates, &dest_dir, &title, SystemTime::now())
    })
    .await
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("metadea-emu-captures-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn local(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> SystemTime {
        SystemTime::from(chrono::Local.with_ymd_and_hms(y, mo, d, h, mi, s).unwrap())
    }

    fn write(path: &Path, bytes: &[u8], modified: SystemTime) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, bytes).unwrap();
        std::fs::File::options().write(true).open(path).unwrap().set_modified(modified).unwrap();
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .map(|entries| entries.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect())
            .unwrap_or_default();
        names.sort();
        names
    }

    fn flat(dir: &Path) -> Vec<ScreenshotSource> {
        vec![ScreenshotSource { dir: dir.to_path_buf(), per_game_subfolders: false, name_prefix: None }]
    }

    // ── Naming ──

    #[test]
    fn file_name_is_title_then_local_timestamp_with_the_original_extension() {
        let taken = local(2024, 1, 2, 3, 4, 5);
        assert_eq!(capture_file_name("Metroid Prime", taken, "png"), "Metroid Prime - 2024-01-02 03-04-05.png");
        assert_eq!(capture_file_name("Zelda: TP?", taken, "jpg"), "Zelda_ TP_ - 2024-01-02 03-04-05.jpg");
        assert_eq!(capture_file_name("", taken, "png"), "Obra - 2024-01-02 03-04-05.png");
        let long = "x".repeat(150);
        assert!(capture_file_name(&long, taken, "png").starts_with(&format!("{} - ", "x".repeat(100))));
    }

    #[test]
    fn collisions_get_a_parenthesised_counter() {
        let temp = TempDir::new("collision");
        let name = "Game - 2024-01-02 03-04-05.png";
        assert_eq!(available_capture_path(&temp.0, name), temp.0.join(name));
        std::fs::write(temp.0.join(name), b"a").unwrap();
        assert_eq!(available_capture_path(&temp.0, name), temp.0.join("Game - 2024-01-02 03-04-05 (2).png"));
        std::fs::write(temp.0.join("Game - 2024-01-02 03-04-05 (2).png"), b"b").unwrap();
        assert_eq!(available_capture_path(&temp.0, name), temp.0.join("Game - 2024-01-02 03-04-05 (3).png"));
    }

    #[test]
    fn move_keeps_the_time_deletes_the_source_and_suffixes_same_second_captures() {
        let temp = TempDir::new("move");
        let source_dir = temp.0.join("emu");
        let dest = temp.0.join("Metadea").join("Game");
        let taken = local(2024, 5, 6, 7, 8, 9);
        write(&source_dir.join("a.png"), b"first", taken);
        write(&source_dir.join("b.PNG"), b"second", taken);

        let first = move_capture(&source_dir.join("a.png"), &dest, "Game").unwrap();
        let second = move_capture(&source_dir.join("b.PNG"), &dest, "Game").unwrap();
        assert_eq!(first, MoveOutcome::Moved(MovedCapture { destination: dest.join("Game - 2024-05-06 07-08-09.png"), taken_at: taken }));
        assert_eq!(second, MoveOutcome::Moved(MovedCapture { destination: dest.join("Game - 2024-05-06 07-08-09 (2).png"), taken_at: taken }));
        assert!(names(&source_dir).is_empty());
        assert_eq!(std::fs::read(dest.join("Game - 2024-05-06 07-08-09 (2).png")).unwrap(), b"second");
        assert_eq!(modified_time(&dest.join("Game - 2024-05-06 07-08-09.png")), Some(taken));
    }

    #[test]
    fn a_source_already_copied_is_not_duplicated() {
        let temp = TempDir::new("identical");
        let dest = temp.0.join("dest");
        let taken = local(2024, 5, 6, 7, 8, 9);
        write(&dest.join("Game - 2024-05-06 07-08-09.png"), b"same", taken);
        write(&temp.0.join("left-behind.png"), b"same", taken);
        assert_eq!(move_capture(&temp.0.join("left-behind.png"), &dest, "Game").unwrap(), MoveOutcome::AlreadyPresent);
        assert_eq!(names(&dest), vec!["Game - 2024-05-06 07-08-09.png"]);
        assert!(!temp.0.join("left-behind.png").exists());
    }

    #[test]
    fn empty_files_are_not_moved() {
        let temp = TempDir::new("empty");
        std::fs::write(temp.0.join("zero.png"), b"").unwrap();
        assert!(move_capture(&temp.0.join("zero.png"), &temp.0.join("dest"), "Game").is_err());
        assert!(temp.0.join("zero.png").exists());
    }

    // ── Stable-size detection ──

    #[test]
    fn a_capture_is_ready_only_after_its_size_holds_still() {
        let mut capture = PendingCapture::new(PathBuf::from("x.png"));
        assert!(!capture.observe(Some(0)));
        assert!(!capture.observe(Some(100)));
        assert!(!capture.observe(Some(4096)));
        assert!(!capture.observe(Some(4096)));
        assert!(capture.observe(Some(4096)));
        // Growing again (a second write pass) starts the count over.
        assert!(!capture.observe(Some(8192)));
        assert!(!capture.observe(Some(8192)));
        assert!(capture.observe(Some(8192)));
    }

    #[test]
    fn a_zero_size_or_vanished_file_never_becomes_ready() {
        let mut capture = PendingCapture::new(PathBuf::from("x.png"));
        for _ in 0..5 {
            assert!(!capture.observe(Some(0)));
        }
        for _ in 0..5 {
            assert!(!capture.observe(None));
        }
    }

    // ── Session lifecycle ──

    #[test]
    fn session_moves_only_captures_taken_after_it_started() {
        let temp = TempDir::new("session");
        let source = temp.0.join("snaps");
        let dest = temp.0.join("Metadea").join("Game");
        write(&source.join("old.png"), b"old", SystemTime::now() - Duration::from_secs(3600));

        let mut session = CaptureSession::start(flat(&source), dest.clone(), "Game".into(), SystemTime::now());
        assert!(session.tick().is_empty());

        std::fs::write(source.join("new.png"), b"partial").unwrap();
        assert!(session.tick().is_empty(), "first sighting");
        std::fs::write(source.join("new.png"), b"partial+rest").unwrap();
        assert!(session.tick().is_empty(), "still growing");
        assert!(session.tick().is_empty(), "stable once");
        let moved = session.tick();
        assert_eq!(moved.len(), 1);
        assert_eq!(std::fs::read(&moved[0].destination).unwrap(), b"partial+rest");
        assert_eq!(names(&source), vec!["old.png"]);
        assert!(session.finish().is_empty());
        assert_eq!(names(&source), vec!["old.png"]);
    }

    #[test]
    fn finish_sweeps_captures_polling_never_settled() {
        let temp = TempDir::new("sweep");
        let source = temp.0.join("shots");
        let dest = temp.0.join("dest");
        std::fs::create_dir_all(&source).unwrap();
        let mut session = CaptureSession::start(flat(&source), dest.clone(), "Game".into(), SystemTime::now());
        std::fs::write(source.join("late.png"), b"late").unwrap();
        assert!(session.tick().is_empty());
        // Written between the last poll and the emulator exiting.
        std::fs::write(source.join("last.jpg"), b"last").unwrap();
        let moved = session.finish();
        assert_eq!(moved.len(), 2);
        assert!(names(&source).is_empty());
        assert_eq!(names(&dest).len(), 2);
        assert!(names(&dest).iter().any(|name| name.ends_with(".jpg")));
    }

    #[test]
    fn dolphin_game_subfolders_created_mid_session_are_watched() {
        let temp = TempDir::new("dolphin");
        let source = temp.0.join("ScreenShots");
        std::fs::create_dir_all(source.join("GZ2E01")).unwrap();
        write(&source.join("GZ2E01").join("GZ2E01-1.png"), b"before", SystemTime::now() - Duration::from_secs(60));
        let sources = vec![ScreenshotSource { dir: source.clone(), per_game_subfolders: true, name_prefix: None }];
        let session = CaptureSession::start(sources, temp.0.join("dest"), "Game".into(), SystemTime::now());
        std::fs::create_dir_all(source.join("GM8E01")).unwrap();
        std::fs::write(source.join("GM8E01").join("GM8E01-1.png"), b"during").unwrap();
        let moved = session.finish();
        assert_eq!(moved.len(), 1);
        assert_eq!(names(&source.join("GZ2E01")), vec!["GZ2E01-1.png"]);
        assert!(names(&source.join("GM8E01")).is_empty());
    }

    #[test]
    fn a_reused_file_name_counts_as_a_new_capture() {
        let temp = TempDir::new("reuse");
        let source = temp.0.join("shots");
        write(&source.join("screenshot.png"), b"old", SystemTime::now() - Duration::from_secs(3600));
        let session = CaptureSession::start(flat(&source), temp.0.join("dest"), "Game".into(), SystemTime::now());
        write(&source.join("screenshot.png"), b"new!", SystemTime::now());
        let moved = session.finish();
        assert_eq!(moved.len(), 1);
        assert_eq!(std::fs::read(&moved[0].destination).unwrap(), b"new!");
    }

    #[test]
    fn missing_source_folders_are_tolerated_and_picked_up_once_created() {
        let temp = TempDir::new("missing");
        let source = temp.0.join("not-yet");
        let session = CaptureSession::start(flat(&source), temp.0.join("dest"), "Game".into(), SystemTime::now());
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("a.png"), b"a").unwrap();
        assert_eq!(session.finish().len(), 1);
    }

    #[test]
    fn the_runner_polls_until_stopped_then_sweeps() {
        let temp = TempDir::new("runner");
        let source = temp.0.join("shots");
        std::fs::create_dir_all(&source).unwrap();
        let session = CaptureSession::start(flat(&source), temp.0.join("dest"), "Game".into(), SystemTime::now());
        let stop = Arc::new(AtomicBool::new(false));
        let runtime = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        let source_for_writer = source.clone();
        let stop_for_writer = stop.clone();
        let mut toasts = Vec::new();
        let count = runtime.block_on(async {
            let writer = async move {
                std::fs::write(source_for_writer.join("one.png"), b"one").unwrap();
                tokio::time::sleep(Duration::from_millis(200)).await;
                std::fs::write(source_for_writer.join("two.png"), b"two").unwrap();
                stop_for_writer.store(true, Ordering::Release);
            };
            let runner = run_capture_session(session, stop, Duration::from_millis(20), |capture| toasts.push(capture.clone()));
            let (count, ()) = futures_join(runner, writer).await;
            count
        });
        assert_eq!(count, 2);
        assert_eq!(toasts.len(), 2);
        assert!(names(&source).is_empty());
    }

    // Minimal join of two futures on the current-thread runtime (tokio's
    // `join!` needs the macros feature, which the crate does not enable).
    async fn futures_join<A: std::future::Future, B: std::future::Future>(a: A, b: B) -> (A::Output, B::Output) {
        let mut a = std::pin::pin!(a);
        let mut b = std::pin::pin!(b);
        let mut a_out = None;
        let mut b_out = None;
        std::future::poll_fn(|cx| {
            use std::task::Poll;
            if a_out.is_none() {
                if let Poll::Ready(out) = a.as_mut().poll(cx) {
                    a_out = Some(out);
                }
            }
            if b_out.is_none() {
                if let Poll::Ready(out) = b.as_mut().poll(cx) {
                    b_out = Some(out);
                }
            }
            if a_out.is_some() && b_out.is_some() { Poll::Ready(()) } else { Poll::Pending }
        })
        .await;
        (a_out.unwrap(), b_out.unwrap())
    }

    // ── One-time import ──

    #[test]
    fn match_keys_cover_the_whole_and_bare_rom_stem_title_and_header() {
        let keys = game_match_keys(r"C:\roms\Zelda - Twilight Princess (USA).rvz", Some("The Legend of Zelda"), Some("GZ2E01"), Some("ZELDA"));
        assert_eq!(keys, vec!["gz2e01", "thelegendofzelda", "zelda", "zeldatwilightprincess", "zeldatwilightprincessusa"]);
        assert!(game_match_keys("/roms/ab.nds", Some("ab"), None, None).is_empty());
    }

    #[test]
    fn a_capture_belongs_to_a_game_only_when_digits_follow_its_key() {
        let keys = game_match_keys("/roms/Zelda - Twilight Princess (USA).rvz", Some("Mario"), None, None);
        assert!(capture_belongs_to_game("zelda_twilight_princess_2024-01-01.png", &keys));
        assert!(capture_belongs_to_game("Zelda - Twilight Princess (USA)-240101-120000.PNG", &keys));
        assert!(capture_belongs_to_game("Mario_0001.png", &keys));
        assert!(capture_belongs_to_game("Mario.png", &keys));
        assert!(!capture_belongs_to_game("Mario Kart_0001.png", &keys));
        assert!(!capture_belongs_to_game("Metroid Prime-1.png", &keys));
        assert!(!capture_belongs_to_game(".png", &keys));
    }

    #[test]
    fn import_moves_this_games_captures_by_mtime_and_leaves_the_rest() {
        let temp = TempDir::new("import");
        let source = temp.0.join("ScreenShots");
        let dest = temp.0.join("Metadea").join("Twilight Princess");
        let old = local(2023, 12, 24, 20, 15, 0);
        write(&source.join("GZ2E01").join("GZ2E01-1.png"), b"sub-1", old);
        write(&source.join("GZ2E01").join("GZ2E01-2.png"), b"sub-2", old);
        write(&source.join("Zelda - Twilight Princess_0001.png"), b"flat", local(2024, 2, 1, 9, 0, 0));
        write(&source.join("Metroid Prime_0001.png"), b"other", old);
        write(&source.join("notes.txt"), b"not an image", old);

        let sources = vec![ScreenshotSource { dir: source.clone(), per_game_subfolders: true, name_prefix: None }];
        let keys = game_match_keys("/roms/Zelda - Twilight Princess.rvz", Some("Twilight Princess"), Some("GZ2E01"), None);
        let candidates = import_candidates(&sources, &keys, Some("GZ2E01"));
        assert_eq!(candidates.len(), 3);

        assert_eq!(import_game_captures(&candidates, &dest, "Twilight Princess", SystemTime::now()), 3);
        assert_eq!(names(&dest), vec![
            "Twilight Princess - 2023-12-24 20-15-00 (2).png",
            "Twilight Princess - 2023-12-24 20-15-00.png",
            "Twilight Princess - 2024-02-01 09-00-00.png",
        ]);
        assert_eq!(names(&source), vec!["GZ2E01", "Metroid Prime_0001.png", "notes.txt"]);
        assert!(names(&source.join("GZ2E01")).is_empty());

        // Opening the game again: nothing left to import.
        let again = import_candidates(&sources, &keys, Some("GZ2E01"));
        assert!(again.is_empty());
        assert_eq!(import_game_captures(&again, &dest, "Twilight Princess", SystemTime::now()), 0);
    }

    #[test]
    fn import_skips_captures_a_running_session_may_still_be_writing() {
        let temp = TempDir::new("import-fresh");
        write(&temp.0.join("Game_0001.png"), b"fresh", SystemTime::now());
        let keys = game_match_keys("/roms/Game.iso", None, None, None);
        let candidates = import_candidates(&flat(&temp.0), &keys, None);
        assert_eq!(candidates.len(), 1);
        assert_eq!(import_game_captures(&candidates, &temp.0.join("dest"), "Game", SystemTime::now()), 0);
        assert!(temp.0.join("Game_0001.png").exists());
    }

    #[test]
    fn a_rom_folder_source_only_sees_that_roms_numbered_captures() {
        let temp = TempDir::new("rom-dir");
        let old = SystemTime::now() - Duration::from_secs(3600);
        for name in [
            "Pokemon Emerald (USA)-0.png", "pokemon emerald (usa)-12.png", "Pokemon Emerald (USA).png",
            "Pokemon Emerald (USA) - map.png", "Pokemon Emerald (USA)-final.png", "Pokemon Ruby (USA)-0.png",
        ] {
            write(&temp.0.join(name), name.as_bytes(), old);
        }
        std::fs::write(temp.0.join("Pokemon Emerald (USA).gba"), b"rom").unwrap();
        let sources = vec![ScreenshotSource { dir: temp.0.clone(), per_game_subfolders: false, name_prefix: Some("Pokemon Emerald (USA)".into()) }];

        let seen: Vec<String> = source_images(&sources)
            .into_iter()
            .map(|(path, _)| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        assert_eq!(seen, vec!["Pokemon Emerald (USA)-0.png", "pokemon emerald (usa)-12.png"]);

        // The import takes exactly those, whatever the match keys say.
        let candidates = import_candidates(&sources, &[], None);
        assert_eq!(candidates.len(), 2);
        let dest = temp.0.join("dest");
        assert_eq!(import_game_captures(&candidates, &dest, "Pokemon Emerald", SystemTime::now()), 2);
        assert!(temp.0.join("Pokemon Emerald (USA).png").exists(), "box art next to the ROM stays");
        assert!(temp.0.join("Pokemon Ruby (USA)-0.png").exists(), "another ROM's capture stays");
    }

    #[test]
    fn rom_title_is_the_file_stem() {
        assert_eq!(rom_title(r"C:\roms\Metroid Prime (USA).iso"), "Metroid Prime (USA)");
        assert_eq!(rom_title(""), "");
    }
}
