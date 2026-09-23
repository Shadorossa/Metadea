//! Save manager for emulated games: every battery save and save state is
//! kept in one central folder (default `Documents\Metadea\Saves`), with
//! labels, a short version history and an optional Google Drive copy.
//!
//! How the files get there depends on the emulator (native.rs): RetroArch
//! is pointed at the central folder for the session (retroarch.rs), every
//! other supported emulator is mirrored around each session (mirror.rs).
//! The launcher calls `begin_session` before spawning the emulator and
//! `end_session` once it has exited (folders/emulator_launch.rs). See
//! docs/SAVES.md.

pub mod backup;
pub mod drive;
pub mod files;
pub mod games;
pub mod layout;
pub mod manifest;
pub mod mirror;
pub mod native;
pub mod retroarch;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};
use tauri::{Emitter, Manager};

use crate::error_codes::{self, with_detail};
use layout::{GameIdentity, SaveKind};
use manifest::GameManifest;
use native::{NativeContext, Profile, Strategy};

/// Machine-local (excluded from backups, kept across a restore): the root
/// path only makes sense on this PC.
pub(crate) const SETTINGS_FILE: &str = "saves-settings.json";
/// Temporary per-session files (RetroArch appended configs).
pub(crate) const SESSIONS_DIR: &str = "saves-sessions";
/// A restore of a backup from Drive waits at most this long for newer
/// incremental saves.
const PULL_AFTER_RESTORE_TIMEOUT: Duration = Duration::from_secs(120);
pub const CHANGED_EVENT: &str = "saves://changed";
const DEFAULT_HISTORY_KEEP: u32 = 5;
const MAX_HISTORY_KEEP: u32 = 50;
/// A launch waits at most this long for Drive to bring newer saves down.
const PULL_BEFORE_LAUNCH_TIMEOUT: Duration = Duration::from_secs(20);
const THUMBNAIL_MAX_BYTES: u64 = 1024 * 1024;
/// Entry ids of the platform's shared memory cards carry this prefix.
const SHARED_PREFIX: &str = "@shared/";

/// One operation on the saves folder at a time (sessions, imports, syncs,
/// label edits): each is a read-modify-write of manifests and files.
fn saves_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn io_error(error: impl std::fmt::Display) -> String {
    with_detail(error_codes::SAVES_IO, error)
}

// ─── Settings ─────────────────────────────────────────────────────────────────

fn default_history_keep() -> u32 {
    DEFAULT_HISTORY_KEEP
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavesSettings {
    /// None: the default folder.
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub drive_sync: bool,
    #[serde(default = "default_history_keep")]
    pub history_keep: u32,
    /// The full backup (local export and Drive upload) carries the saves.
    #[serde(default = "default_true")]
    pub include_in_backup: bool,
}

impl Default for SavesSettings {
    fn default() -> Self {
        Self { root: None, drive_sync: false, history_keep: DEFAULT_HISTORY_KEEP, include_in_backup: true }
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::backup::app_data_dir(app)?.join(SETTINGS_FILE))
}

fn load_settings(app: &tauri::AppHandle) -> SavesSettings {
    settings_path(app).map(|path| crate::backup::read_json_or_default(&path)).unwrap_or_default()
}

fn default_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().document_dir().or_else(|_| app.path().home_dir()).map_err(|e| with_detail(error_codes::SAVES_ROOT_INVALID, e))?;
    Ok(base.join("Metadea").join("Saves"))
}

fn effective_root(app: &tauri::AppHandle, settings: &SavesSettings) -> Result<PathBuf, String> {
    match settings.root.as_deref().map(str::trim).filter(|root| !root.is_empty()) {
        Some(root) => Ok(PathBuf::from(root)),
        None => default_root(app),
    }
}

/// A custom root must be an absolute folder that is not a drive root and
/// not inside Metadea's own data folder (a backup restore replaces that).
fn validate_root(root: &Path, app_data: &Path) -> Result<(), String> {
    let invalid = |detail: &str| with_detail(error_codes::SAVES_ROOT_INVALID, detail);
    if !root.is_absolute() || root.parent().is_none() {
        return Err(invalid("not an absolute folder"));
    }
    if root.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(invalid("relative segments"));
    }
    if layout::is_within(root, app_data) {
        return Err(invalid("inside the app data folder"));
    }
    if root.exists() && !root.is_dir() {
        return Err(invalid("not a folder"));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavesStatus {
    root: String,
    default_root: String,
    custom_root: bool,
    drive_sync: bool,
    history_keep: u32,
    include_in_backup: bool,
    drive_linked: bool,
    last_sync_at: Option<String>,
    last_sync_error: Option<String>,
}

fn status_of(app: &tauri::AppHandle, settings: &SavesSettings) -> Result<SavesStatus, String> {
    let root = effective_root(app, settings)?;
    let sync_state = drive::load_sync_state(&root);
    Ok(SavesStatus {
        root: root.to_string_lossy().into_owned(),
        default_root: default_root(app)?.to_string_lossy().into_owned(),
        custom_root: settings.root.as_deref().is_some_and(|root| !root.trim().is_empty()),
        drive_sync: settings.drive_sync,
        history_keep: settings.history_keep,
        include_in_backup: settings.include_in_backup,
        drive_linked: crate::google_drive::is_linked(app),
        last_sync_at: sync_state.last_sync_at,
        last_sync_error: sync_state.last_error,
    })
}

#[tauri::command]
pub async fn saves_get_settings(app_handle: tauri::AppHandle) -> Result<SavesStatus, String> {
    status_of(&app_handle, &load_settings(&app_handle))
}

#[tauri::command]
pub async fn saves_set_settings(app_handle: tauri::AppHandle, settings: SavesSettings) -> Result<SavesStatus, String> {
    let root = settings.root.as_deref().map(str::trim).filter(|root| !root.is_empty()).map(str::to_string);
    if let Some(root) = &root {
        let root = PathBuf::from(root);
        validate_root(&root, &crate::backup::app_data_dir(&app_handle)?)?;
        std::fs::create_dir_all(&root).map_err(|e| with_detail(error_codes::SAVES_ROOT_INVALID, e))?;
    }
    let settings = SavesSettings {
        root,
        drive_sync: settings.drive_sync,
        history_keep: settings.history_keep.clamp(1, MAX_HISTORY_KEEP),
        include_in_backup: settings.include_in_backup,
    };
    crate::backup::write_json_atomic(&settings_path(&app_handle)?, &settings).map_err(io_error)?;
    status_of(&app_handle, &settings)
}

// ─── Games ────────────────────────────────────────────────────────────────────

/// A game as the webview knows it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRef {
    pub platform_id: String,
    pub rom_path: String,
    #[serde(default)]
    pub title: Option<String>,
}

fn native_context(app: &tauri::AppHandle, exe_path: &str, rom_path: &str) -> NativeContext {
    NativeContext {
        exe_path: PathBuf::from(exe_path),
        rom_path: PathBuf::from(rom_path),
        documents: app.path().document_dir().ok(),
        roaming: app.path().data_dir().ok(),
        local: app.path().local_data_dir().ok(),
    }
}

/// The platform's emulator profile, when one is configured.
fn platform_profile(app: &tauri::AppHandle, platform_id: &str, rom_path: &str) -> Result<Option<(String, Profile)>, String> {
    let db = app.state::<crate::db::MetadeaDb>();
    let config = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::emulators::emulator_config_for_platform(&conn, platform_id)?
    };
    Ok(config.map(|config| {
        let profile = native::profile_for(&config.emulator_name, &native_context(app, &config.executable_path, rom_path));
        (config.emulator_name, profile)
    }))
}

fn identity_of(game: &GameRef) -> Result<GameIdentity, String> {
    if game.platform_id.trim().is_empty() || game.rom_path.trim().is_empty() {
        return Err(error_codes::SAVES_NOT_FOUND.into());
    }
    Ok(GameIdentity::new(&game.platform_id, &game.rom_path, game.title.as_deref()).with_header())
}

// ─── Listing ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVersion {
    id: String,
    modified_ms: i64,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEntry {
    /// `battery/…`, `states/…`, or `@shared/battery/…` for a shared card.
    id: String,
    kind: SaveKind,
    name: String,
    slot: Option<String>,
    size: u64,
    modified_ms: i64,
    label: Option<String>,
    /// `data:` URL of the state's screenshot (RetroArch/PPSSPP write one).
    thumbnail: Option<String>,
    is_folder: bool,
    shared: bool,
    versions: Vec<SaveVersion>,
    synced: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSaves {
    strategy: Strategy,
    emulator: Option<String>,
    root: String,
    /// The game's folder, once it exists.
    folder: Option<String>,
    drive_sync: bool,
    entries: Vec<SaveEntry>,
}

fn is_image(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".bmp"].iter().any(|ext| lower.ends_with(ext))
}

fn stem_of(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

/// The saves of one folder: what the manifest knows, plus anything else
/// sitting directly under battery/ and states/ (RetroArch writes there).
fn central_units(dir: &Path, manifest: &GameManifest) -> Vec<(String, SaveKind, PathBuf)> {
    let mut rels: Vec<String> = manifest.entries.keys().filter(|rel| layout::safe_relative(rel).is_ok_and(|p| dir.join(p).exists())).cloned().collect();
    for kind in [SaveKind::Battery, SaveKind::State] {
        let Ok(children) = std::fs::read_dir(dir.join(kind.dir_name())) else { continue };
        for child in children.flatten() {
            let name = child.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.ends_with(".metadea-tmp") {
                continue;
            }
            let rel = format!("{}/{name}", kind.dir_name());
            let container = format!("{rel}/");
            if rels.iter().any(|known| known == &rel || known.starts_with(&container)) {
                continue;
            }
            rels.push(rel);
        }
    }
    rels.sort();
    rels.dedup();
    rels.into_iter()
        .filter_map(|rel| {
            let kind = rel.split('/').next().and_then(SaveKind::from_dir_name)?;
            let path = dir.join(layout::safe_relative(&rel).ok()?);
            Some((rel, kind, path))
        })
        .collect()
}

fn thumbnail_data_url(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.len() > THUMBNAIL_MAX_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let lower = path.to_string_lossy().to_ascii_lowercase();
    let mime = if lower.ends_with(".png") { "image/png" } else if lower.ends_with(".bmp") { "image/bmp" } else { "image/jpeg" };
    Some(format!("data:{mime};base64,{}", crate::utils::base64_encode(&bytes)))
}

fn list_folder(dir: &Path, manifest: &GameManifest, shared: bool, sync_state: &drive::SyncState) -> Vec<SaveEntry> {
    let units = central_units(dir, manifest);
    let images: Vec<&(String, SaveKind, PathBuf)> = units.iter().filter(|(rel, kind, _)| *kind == SaveKind::State && is_image(rel)).collect();
    units
        .iter()
        .filter(|(rel, kind, _)| !(*kind == SaveKind::State && is_image(rel)))
        .filter_map(|(rel, kind, path)| {
            let fingerprint = files::fingerprint(path).ok()?;
            let name = rel.split_once('/').map_or(rel.as_str(), |(_, inner)| inner).to_string();
            let file_name = rel.rsplit('/').next().unwrap_or(rel);
            let thumbnail = (*kind == SaveKind::State)
                .then(|| {
                    images.iter().find(|(image_rel, _, _)| {
                        let image = image_rel.rsplit('/').next().unwrap_or(image_rel);
                        stem_of(image) == file_name || stem_of(image) == stem_of(file_name)
                    })
                })
                .flatten()
                .and_then(|(_, _, image_path)| thumbnail_data_url(image_path));
            let versions = files::history_versions(dir, rel)
                .into_iter()
                .filter_map(|version| {
                    let fp = files::fingerprint(&version.path).ok()?;
                    Some(SaveVersion { id: version.id, modified_ms: fp.mtime_ms, size: fp.size })
                })
                .collect();
            let entry = manifest.entries.get(rel);
            Some(SaveEntry {
                id: if shared { format!("{SHARED_PREFIX}{rel}") } else { rel.clone() },
                kind: *kind,
                name,
                slot: (*kind == SaveKind::State).then(|| layout::parse_slot(file_name)).flatten(),
                size: fingerprint.size,
                modified_ms: fingerprint.mtime_ms,
                label: entry.and_then(|entry| entry.label.clone()),
                thumbnail,
                is_folder: path.is_dir(),
                shared,
                versions,
                synced: drive::unit_synced(sync_state, &manifest.game_key, dir, rel),
            })
        })
        .collect()
}

fn game_saves(app: &tauri::AppHandle, game: &GameRef) -> Result<GameSaves, String> {
    let settings = load_settings(app);
    let root = effective_root(app, &settings)?;
    let identity = identity_of(game)?;
    let profile = platform_profile(app, &game.platform_id, &game.rom_path)?;
    let sync_state = drive::load_sync_state(&root);
    let mut entries = Vec::new();
    let mut folder = None;
    if let Some((dir, manifest)) = games::open_game(&root, &identity, false)? {
        entries.extend(list_folder(&dir, &manifest, false, &sync_state));
        folder = Some(dir.to_string_lossy().into_owned());
    }
    let uses_shared = profile.as_ref().is_some_and(|(_, profile)| profile.roots.iter().any(|root| root.shared != native::Shared::Never));
    if uses_shared {
        if let Some((dir, manifest)) = games::open_shared(&root, &game.platform_id, false)? {
            entries.extend(list_folder(&dir, &manifest, true, &sync_state));
        }
    }
    entries.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.shared.cmp(&b.shared)).then(b.modified_ms.cmp(&a.modified_ms)));
    Ok(GameSaves {
        strategy: profile.as_ref().map_or(Strategy::Unsupported, |(_, profile)| profile.strategy),
        emulator: profile.map(|(name, _)| name),
        root: root.to_string_lossy().into_owned(),
        folder,
        drive_sync: settings.drive_sync,
        entries,
    })
}

#[tauri::command]
pub async fn saves_list_game(app_handle: tauri::AppHandle, game: GameRef) -> Result<GameSaves, String> {
    let _lock = saves_lock().lock().await;
    let app = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || game_saves(&app, &game)).await.map_err(io_error)?
}

/// The folder (game or shared) and the `battery/…` / `states/…` path an
/// entry id points at, checked to stay inside that folder.
fn resolve_entry(root: &Path, identity: &GameIdentity, id: &str) -> Result<(PathBuf, GameManifest, String), String> {
    let (shared, rel) = match id.strip_prefix(SHARED_PREFIX) {
        Some(rel) => (true, rel),
        None => (false, id),
    };
    let relative = layout::safe_relative(rel)?;
    if !rel.split('/').next().is_some_and(|top| SaveKind::from_dir_name(top).is_some()) || rel.split('/').any(|s| s.starts_with('.')) {
        return Err(with_detail(error_codes::SAVES_PATH_UNSAFE, rel));
    }
    let found = if shared { games::open_shared(root, &identity.platform_id, false)? } else { games::open_game(root, identity, false)? };
    let (dir, manifest) = found.ok_or(error_codes::SAVES_NOT_FOUND)?;
    let path = dir.join(relative);
    if !layout::is_within(&path, &dir) || !path.exists() {
        return Err(error_codes::SAVES_NOT_FOUND.into());
    }
    Ok((dir, manifest, rel.to_string()))
}

#[tauri::command]
pub async fn saves_set_label(app_handle: tauri::AppHandle, game: GameRef, id: String, label: Option<String>) -> Result<GameSaves, String> {
    let _lock = saves_lock().lock().await;
    let app = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = effective_root(&app, &load_settings(&app))?;
        let identity = identity_of(&game)?;
        let (dir, mut manifest, rel) = resolve_entry(&root, &identity, &id)?;
        if !manifest.set_label(&rel, label.as_deref(), &chrono::Utc::now().to_rfc3339()) {
            return Err(error_codes::SAVES_LABEL_TOO_LONG.to_string());
        }
        manifest::write_manifest(&dir, &manifest)?;
        game_saves(&app, &game)
    })
    .await
    .map_err(io_error)?
}

fn touch_unit(path: &Path, time: SystemTime) {
    let targets: Vec<PathBuf> = if path.is_dir() { files::files_under(path).into_iter().map(|(_, file)| file).collect() } else { vec![path.to_path_buf()] };
    for target in targets {
        if let Ok(file) = std::fs::File::options().write(true).open(&target) {
            let _ = file.set_modified(time);
        }
    }
}

#[tauri::command]
pub async fn saves_restore_version(app_handle: tauri::AppHandle, game: GameRef, id: String, version: String) -> Result<GameSaves, String> {
    let _lock = saves_lock().lock().await;
    let app = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let settings = load_settings(&app);
        let root = effective_root(&app, &settings)?;
        let identity = identity_of(&game)?;
        let (dir, _, rel) = resolve_entry(&root, &identity, &id)?;
        let chosen = files::history_versions(&dir, &rel).into_iter().find(|candidate| candidate.id == version).ok_or(error_codes::SAVES_NOT_FOUND)?;
        let current = dir.join(layout::safe_relative(&rel)?);
        // The version is copied (it stays in history); the current copy
        // becomes a version itself. Marked as just written, so the next
        // launch puts it back into the emulator's folder.
        let staging = dir.join(format!(".restore-{}", layout::short_hash(&format!("{rel}/{version}"), 8)));
        let staged = staging.join(current.file_name().unwrap_or_default());
        files::copy_unit(&chosen.path, &staged).map_err(io_error)?;
        files::rotate_into_history(&dir, &rel, settings.history_keep).map_err(io_error)?;
        let moved = std::fs::rename(&staged, &current).map_err(io_error);
        let _ = std::fs::remove_dir_all(&staging);
        moved?;
        touch_unit(&current, SystemTime::now());
        let _ = app.emit(CHANGED_EVENT, ());
        game_saves(&app, &game)
    })
    .await
    .map_err(io_error)?
}

#[tauri::command]
pub async fn saves_archive(app_handle: tauri::AppHandle, game: GameRef, id: String) -> Result<GameSaves, String> {
    let _lock = saves_lock().lock().await;
    let app = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = effective_root(&app, &load_settings(&app))?;
        let identity = identity_of(&game)?;
        let (dir, mut manifest, rel) = resolve_entry(&root, &identity, &id)?;
        let source = dir.join(layout::safe_relative(&rel)?);
        let sha = files::fingerprint(&source).ok().map(|fp| fp.sha256);
        let stamp_dir = files::free_path(&dir.join(layout::ARCHIVE_DIR), &layout::stamp(SystemTime::now()));
        let target = stamp_dir.join(layout::safe_relative(&rel)?);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(io_error)?;
        }
        std::fs::rename(&source, &target).map_err(io_error)?;
        // A state's screenshot goes with it.
        if rel.starts_with("states/") {
            for ext in [".png", ".jpg"] {
                let mut name = source.file_name().unwrap_or_default().to_os_string();
                name.push(ext);
                let thumb = source.with_file_name(&name);
                if thumb.is_file() {
                    let _ = std::fs::rename(&thumb, target.with_file_name(&name));
                }
            }
        }
        let label = manifest.entries.remove(&rel).and_then(|entry| entry.label);
        manifest.archived.push(manifest::ArchivedEntry {
            rel: rel.clone(),
            archived_to: layout::to_slash(target.strip_prefix(&dir).unwrap_or(&target)),
            sha256: sha,
            label,
            archived_at: chrono::Utc::now().to_rfc3339(),
        });
        manifest::write_manifest(&dir, &manifest)?;
        let _ = app.emit(CHANGED_EVENT, ());
        game_saves(&app, &game)
    })
    .await
    .map_err(io_error)?
}

#[tauri::command]
pub async fn saves_open_folder(app_handle: tauri::AppHandle, game: Option<GameRef>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = effective_root(&app_handle, &load_settings(&app_handle))?;
    let target = match game {
        Some(game) => games::open_game(&root, &identity_of(&game)?, false)?.map(|(dir, _)| dir).unwrap_or_else(|| root.clone()),
        None => root.clone(),
    };
    std::fs::create_dir_all(&target).map_err(io_error)?;
    app_handle.opener().open_path(target.to_string_lossy(), None::<&str>).map_err(|e| with_detail(error_codes::SAVES_OPEN_FOLDER, e))
}

// ─── Import ───────────────────────────────────────────────────────────────────

#[derive(Debug, Default, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    games: u32,
    captured: u32,
    skipped: u32,
}

fn import_existing(app: &tauri::AppHandle, root: &Path, keep: u32) -> Result<ImportSummary, String> {
    let configs = {
        let db = app.state::<crate::db::MetadeaDb>();
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::platform_scanning::rom_library::rom_folder_configs(&conn)
    };
    let library = crate::platform_scanning::rom_library::scan_rom_games(&configs);
    let mut summary = ImportSummary::default();
    let mut shared_done: Vec<String> = Vec::new();
    for game in library {
        let Some((emulator, profile)) = platform_profile(app, &game.platform_id, &game.base.path)? else { continue };
        if profile.strategy == Strategy::Unsupported {
            continue;
        }
        let mut identity = GameIdentity::new(&game.platform_id, &game.base.path, None);
        identity.header_id = game.base.header_id.clone();
        let existing = games::open_game(root, &identity, false)?;
        let probe = existing.as_ref().map(|(_, manifest)| manifest.clone()).unwrap_or_else(|| GameManifest::new(&identity.game_key(), &identity.title, &identity.platform_id));
        let units: Vec<native::NativeUnit> = mirror::attributed_units(&profile, &identity, &probe, None).into_iter().filter(|unit| !unit.shared).collect();
        let shared_units: Vec<native::NativeUnit> = if shared_done.contains(&game.platform_id) {
            Vec::new()
        } else {
            shared_done.push(game.platform_id.clone());
            profile.existing_roots().iter().flat_map(native::list_units).filter(|unit| unit.shared).collect()
        };
        if units.is_empty() && shared_units.is_empty() {
            continue;
        }
        let (game_dir, mut game_manifest) = match existing {
            Some(found) => found,
            None if !units.is_empty() => games::open_game(root, &identity, true)?.ok_or(error_codes::SAVES_NOT_FOUND)?,
            None => (PathBuf::new(), probe),
        };
        let (shared_dir, mut shared_manifest) = if shared_units.is_empty() {
            (PathBuf::new(), GameManifest::new("", "", ""))
        } else {
            games::open_shared(root, &game.platform_id, true)?.ok_or(error_codes::SAVES_NOT_FOUND)?
        };
        let all: Vec<native::NativeUnit> = units.iter().chain(shared_units.iter()).cloned().collect();
        let report = mirror::capture_units(
            &all,
            mirror::CaptureTarget { dir: &game_dir, manifest: &mut game_manifest },
            mirror::CaptureTarget { dir: &shared_dir, manifest: &mut shared_manifest },
            &emulator,
            keep,
        );
        if !units.is_empty() {
            game_manifest.emulator.get_or_insert(emulator.clone());
            manifest::write_manifest(&game_dir, &game_manifest)?;
            if report.captured > 0 {
                summary.games += 1;
            }
        }
        if !shared_units.is_empty() {
            manifest::write_manifest(&shared_dir, &shared_manifest)?;
        }
        summary.captured += report.captured;
        summary.skipped += report.skipped;
    }
    Ok(summary)
}

/// Copies (never moves) the saves already in the emulators' folders for
/// every game of the ROM library into the central folder. Idempotent.
#[tauri::command]
pub async fn saves_import_existing(app_handle: tauri::AppHandle) -> Result<ImportSummary, String> {
    let _lock = saves_lock().lock().await;
    let settings = load_settings(&app_handle);
    let root = effective_root(&app_handle, &settings)?;
    std::fs::create_dir_all(&root).map_err(|e| with_detail(error_codes::SAVES_ROOT_INVALID, e))?;
    let app = app_handle.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || import_existing(&app, &root, settings.history_keep)).await.map_err(io_error)??;
    let _ = app_handle.emit(CHANGED_EVENT, ());
    Ok(summary)
}

// ─── Google Drive ─────────────────────────────────────────────────────────────

async fn with_sync_state<F, Fut>(app: &tauri::AppHandle, root: &Path, run: F) -> Result<drive::SyncReport, String>
where
    F: FnOnce(String, drive::SyncState) -> Fut,
    Fut: std::future::Future<Output = (drive::SyncState, Result<drive::SyncReport, String>)>,
{
    let (token, account) = crate::google_drive::token_for_saves(app).await?;
    let mut state = drive::load_sync_state(root);
    if state.account != account {
        state = drive::SyncState { account, ..Default::default() };
    }
    let (mut state, result) = run(token, state).await;
    match &result {
        Ok(_) => {
            state.last_sync_at = Some(chrono::Utc::now().to_rfc3339());
            state.last_error = None;
        }
        Err(error) => state.last_error = Some(error.clone()),
    }
    drive::save_sync_state(root, &state)?;
    result
}

async fn sync_game_folders(app: &tauri::AppHandle, root: &Path, folders: Vec<(PathBuf, String)>, direction: drive::Direction, keep: u32) -> Result<drive::SyncReport, String> {
    with_sync_state(app, root, |token, mut state| async move {
        let mut report = drive::SyncReport::default();
        for (dir, key) in folders {
            match drive::sync_one(&token, &dir, &key, direction, &mut state, keep).await {
                Ok(one) => report.add(one),
                Err(error) => return (state, Err(error)),
            }
        }
        (state, Ok(report))
    })
    .await
}

/// Syncs one game (and its platform's shared cards), or everything.
#[tauri::command]
pub async fn saves_sync_now(app_handle: tauri::AppHandle, game: Option<GameRef>) -> Result<drive::SyncReport, String> {
    let _lock = saves_lock().lock().await;
    let settings = load_settings(&app_handle);
    let root = effective_root(&app_handle, &settings)?;
    std::fs::create_dir_all(&root).map_err(|e| with_detail(error_codes::SAVES_ROOT_INVALID, e))?;
    let report = match game {
        Some(game) => {
            let identity = identity_of(&game)?;
            let (dir, manifest) = games::open_game(&root, &identity, true)?.ok_or(error_codes::SAVES_NOT_FOUND)?;
            let mut folders = vec![(dir, manifest.game_key)];
            if let Some((shared_dir, shared)) = games::open_shared(&root, &game.platform_id, false)? {
                folders.push((shared_dir, shared.game_key));
            }
            sync_game_folders(&app_handle, &root, folders, drive::Direction::Both, settings.history_keep).await?
        }
        None => {
            let keep = settings.history_keep;
            let root_for_sync = root.clone();
            with_sync_state(&app_handle, &root, |token, mut state| async move {
                let result = drive::sync_all(&token, &root_for_sync, &mut state, keep, drive::Direction::Both).await;
                (state, result)
            })
            .await?
        }
    };
    let _ = app_handle.emit(CHANGED_EVENT, ());
    Ok(report)
}

// ─── Full backup (src/backup) ─────────────────────────────────────────────────

/// What "Include game saves" adds to a backup.
#[tauri::command]
pub async fn saves_backup_estimate(app_handle: tauri::AppHandle) -> Result<backup::SavesEstimate, String> {
    let root = effective_root(&app_handle, &load_settings(&app_handle))?;
    tauri::async_runtime::spawn_blocking(move || backup::estimate(&root)).await.map_err(io_error)
}

/// The saves root a full backup carries, when "Include game saves" is on.
pub(crate) fn backup_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    let settings = load_settings(app);
    if !settings.include_in_backup {
        return None;
    }
    effective_root(app, &settings).ok().filter(|root| root.is_dir())
}

/// Where a restore puts the saves a backup carries, and the history size.
pub(crate) fn restore_target(app: &tauri::AppHandle) -> Option<(PathBuf, u32)> {
    let settings = load_settings(app);
    effective_root(app, &settings).ok().map(|root| (root, settings.history_keep))
}

/// Merges a restore's staged `saves/` into the root (blocking; see backup.rs).
pub(crate) fn merge_restored_saves(staged: &Path, root: &Path, keep: u32) -> Result<backup::MergeReport, String> {
    let _lock = saves_lock().blocking_lock();
    backup::merge_staged(staged, root, keep)
}

/// After a Drive backup was restored: saves synced to Drive since that
/// backup are newer; bring them down (download only, bounded).
pub(crate) async fn pull_after_drive_restore(app: &tauri::AppHandle) {
    if !crate::google_drive::is_linked(app) {
        return;
    }
    let settings = load_settings(app);
    let Ok(root) = effective_root(app, &settings) else { return };
    let _lock = saves_lock().lock().await;
    let keep = settings.history_keep;
    let root_for_sync = root.clone();
    let pull = with_sync_state(app, &root, |token, mut state| async move {
        let result = drive::sync_all(&token, &root_for_sync, &mut state, keep, drive::Direction::PullOnly).await;
        (state, result)
    });
    match tokio::time::timeout(PULL_AFTER_RESTORE_TIMEOUT, pull).await {
        Ok(Ok(report)) => log::info!("Saves pulled from Drive after restore: {report:?}"),
        Ok(Err(error)) => log::warn!("Saves: Drive pull after restore failed: {error}"),
        Err(_) => log::warn!("Saves: Drive pull after restore timed out"),
    }
}

// ─── Emulator sessions ────────────────────────────────────────────────────────

/// Prepared before an emulator starts; finished once it exits.
pub struct SaveSession {
    root: PathBuf,
    game_dir: PathBuf,
    game_key: String,
    identity: GameIdentity,
    emulator: String,
    profile: Profile,
    started_at: SystemTime,
    retroarch_cfg: Option<PathBuf>,
    settings: SavesSettings,
}

impl SaveSession {
    /// The emulator's arguments with Metadea's per-launch overrides added.
    pub fn apply_args(&self, args: Vec<String>) -> Vec<String> {
        match &self.retroarch_cfg {
            Some(cfg) => retroarch::inject_appendconfig(args, cfg),
            None => args,
        }
    }
}

fn drive_sync_enabled(app: &tauri::AppHandle, settings: &SavesSettings) -> bool {
    settings.drive_sync && crate::google_drive::is_linked(app)
}

fn prepare_session(app: &tauri::AppHandle, session: &mut SaveSession) -> Result<(), String> {
    let (game_dir, mut manifest) = games::open_game(&session.root, &session.identity, true)?.ok_or(error_codes::SAVES_NOT_FOUND)?;
    manifest.emulator = Some(session.emulator.clone());
    let keep = session.settings.history_keep;
    match session.profile.strategy {
        Strategy::Redirect => {
            let battery = game_dir.join(SaveKind::Battery.dir_name());
            let states = game_dir.join(SaveKind::State.dir_name());
            std::fs::create_dir_all(&battery).map_err(io_error)?;
            std::fs::create_dir_all(&states).map_err(io_error)?;
            // Saves RetroArch wrote before Metadea managed it (named after
            // the ROM in its own saves/states folders) come along the first
            // time; later they are older than the central copy and skipped.
            let earlier: Vec<native::NativeUnit> =
                mirror::attributed_units(&session.profile, &session.identity, &manifest, None).into_iter().filter(|unit| !unit.shared).collect();
            if !earlier.is_empty() {
                let mut no_shared = GameManifest::new("", "", "");
                let report = mirror::capture_units(
                    &earlier,
                    mirror::CaptureTarget { dir: &game_dir, manifest: &mut manifest },
                    mirror::CaptureTarget { dir: Path::new(""), manifest: &mut no_shared },
                    &session.emulator,
                    keep,
                );
                log::info!("Saves imported before a RetroArch session: {report:?}");
            }
            // The emulator overwrites these in place: keep the pre-session
            // copy of every battery save as a version.
            for (rel, kind, _) in central_units(&game_dir, &manifest) {
                if kind == SaveKind::Battery {
                    if let Err(error) = files::snapshot_into_history(&game_dir, &rel, keep) {
                        log::warn!("Save snapshot failed for {rel}: {error}");
                    }
                }
            }
            let sessions_dir = crate::backup::app_data_dir(app)?.join(SESSIONS_DIR);
            std::fs::create_dir_all(&sessions_dir).map_err(io_error)?;
            let cfg = sessions_dir.join(format!("retroarch-{}.cfg", layout::short_hash(&session.game_key, 12)));
            std::fs::write(&cfg, retroarch::appendconfig_contents(&battery, &states)).map_err(io_error)?;
            session.retroarch_cfg = Some(cfg);
        }
        Strategy::Mirror => {
            let report = mirror::reconcile_before_launch(&game_dir, &mut manifest, &session.profile, keep);
            if let Some((shared_dir, mut shared_manifest)) = games::open_shared(&session.root, &session.identity.platform_id, false)? {
                let shared = mirror::reconcile_before_launch(&shared_dir, &mut shared_manifest, &session.profile, keep);
                manifest::write_manifest(&shared_dir, &shared_manifest)?;
                log::info!("Shared saves before launch: {shared:?}");
            }
            log::info!("Saves before launch of {}: {report:?}", session.identity.title);
        }
        Strategy::Unsupported => {}
    }
    manifest::write_manifest(&game_dir, &manifest)?;
    session.game_dir = game_dir;
    session.game_key = manifest.game_key;
    Ok(())
}

/// Called by launch_game before the emulator starts. Never fails the
/// launch: any problem is logged and the game runs without save handling.
pub async fn begin_session(app: &tauri::AppHandle, platform_id: &str, rom_path: &str, title: &str) -> Option<SaveSession> {
    let (emulator, profile) = match platform_profile(app, platform_id, rom_path) {
        Ok(Some(found)) => found,
        Ok(None) => return None,
        Err(error) => {
            log::warn!("Saves: no emulator profile for {platform_id}: {error}");
            return None;
        }
    };
    if profile.strategy == Strategy::Unsupported {
        return None;
    }
    let settings = load_settings(app);
    let root = effective_root(app, &settings).ok()?;
    let _lock = saves_lock().lock().await;
    let game = GameRef { platform_id: platform_id.to_string(), rom_path: rom_path.to_string(), title: Some(title.to_string()) };
    let identity = identity_of(&game).ok()?;
    let mut session = SaveSession {
        game_key: identity.game_key(),
        root,
        game_dir: PathBuf::new(),
        identity,
        emulator,
        profile,
        started_at: SystemTime::now(),
        retroarch_cfg: None,
        settings,
    };

    // A new PC (or saves made on another one): bring newer copies down first.
    if drive_sync_enabled(app, &session.settings) {
        if let Ok(Some((dir, manifest))) = games::open_game(&session.root, &session.identity, true) {
            let mut folders = vec![(dir, manifest.game_key)];
            if let Ok(Some((shared_dir, shared))) = games::open_shared(&session.root, platform_id, false) {
                folders.push((shared_dir, shared.game_key));
            }
            let pull = sync_game_folders(app, &session.root, folders, drive::Direction::PullOnly, session.settings.history_keep);
            match tokio::time::timeout(PULL_BEFORE_LAUNCH_TIMEOUT, pull).await {
                Ok(Err(error)) => log::warn!("Saves: Drive pull before launch failed: {error}"),
                Err(_) => log::warn!("Saves: Drive pull before launch timed out"),
                Ok(Ok(_)) => {}
            }
        }
    }

    let app_for_prepare = app.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        let result = prepare_session(&app_for_prepare, &mut session);
        (session, result)
    })
    .await;
    match prepared {
        Ok((mut session, Ok(()))) => {
            session.started_at = SystemTime::now();
            Some(session)
        }
        Ok((_, Err(error))) => {
            log::warn!("Saves: preparing the session failed: {error}");
            None
        }
        Err(error) => {
            log::warn!("Saves: preparing the session panicked: {error}");
            None
        }
    }
}

fn capture_after_session(session: &SaveSession) -> Result<mirror::MirrorReport, String> {
    let keep = session.settings.history_keep;
    let Some((game_dir, mut manifest)) = games::open_game(&session.root, &session.identity, true)? else {
        return Err(error_codes::SAVES_NOT_FOUND.into());
    };
    if session.profile.strategy != Strategy::Mirror {
        return Ok(mirror::MirrorReport::default());
    }
    let units = mirror::attributed_units(&session.profile, &session.identity, &manifest, Some(session.started_at));
    let has_shared = units.iter().any(|unit| unit.shared);
    let (shared_dir, mut shared_manifest) = if has_shared {
        games::open_shared(&session.root, &session.identity.platform_id, true)?.ok_or(error_codes::SAVES_NOT_FOUND)?
    } else {
        (PathBuf::new(), GameManifest::new("", "", ""))
    };
    let report = mirror::capture_units(
        &units,
        mirror::CaptureTarget { dir: &game_dir, manifest: &mut manifest },
        mirror::CaptureTarget { dir: &shared_dir, manifest: &mut shared_manifest },
        &session.emulator,
        keep,
    );
    manifest::write_manifest(&game_dir, &manifest)?;
    if has_shared {
        manifest::write_manifest(&shared_dir, &shared_manifest)?;
    }
    Ok(report)
}

/// Called by launch_game once the emulator has exited: captures the
/// session's saves, then uploads them when Drive sync is on.
pub async fn end_session(app: &tauri::AppHandle, session: SaveSession) {
    let _lock = saves_lock().lock().await;
    if let Some(cfg) = &session.retroarch_cfg {
        let _ = std::fs::remove_file(cfg);
    }
    let session = std::sync::Arc::new(session);
    let for_capture = session.clone();
    match tauri::async_runtime::spawn_blocking(move || capture_after_session(&for_capture)).await {
        Ok(Ok(report)) => log::info!("Saves after session of {}: {report:?}", session.identity.title),
        Ok(Err(error)) => log::warn!("Saves: capture after session failed: {error}"),
        Err(error) => log::warn!("Saves: capture after session panicked: {error}"),
    }
    if drive_sync_enabled(app, &session.settings) {
        let mut folders = vec![(session.game_dir.clone(), session.game_key.clone())];
        if let Ok(Some((shared_dir, shared))) = games::open_shared(&session.root, &session.identity.platform_id, false) {
            folders.push((shared_dir, shared.game_key));
        }
        if let Err(error) = sync_game_folders(app, &session.root, folders, drive::Direction::Both, session.settings.history_keep).await {
            log::warn!("Saves: Drive sync after session failed: {error}");
        }
    }
    let _ = app.emit(CHANGED_EVENT, ());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_defaults_and_round_trip() {
        let settings: SavesSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings, SavesSettings::default());
        assert_eq!(settings.history_keep, DEFAULT_HISTORY_KEEP);
        let json = serde_json::to_string(&SavesSettings { root: Some(r"D:\Saves".into()), drive_sync: true, history_keep: 9, include_in_backup: false }).unwrap();
        assert!(json.contains("\"driveSync\":true"));
        let back: SavesSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.history_keep, 9);
        assert!(!back.include_in_backup);
        assert!(serde_json::from_str::<SavesSettings>(r#"{"driveSync":true}"#).unwrap().include_in_backup);
    }

    #[test]
    fn custom_roots_are_validated() {
        let app_data = crate::backup::layout::tempdir("saves-root-appdata");
        assert!(validate_root(Path::new("relative/dir"), &app_data).is_err());
        assert!(validate_root(&app_data.join("Saves"), &app_data).is_err());
        let elsewhere = crate::backup::layout::tempdir("saves-root-ok");
        assert!(validate_root(&elsewhere, &app_data).is_ok());
        let file = elsewhere.join("file.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(validate_root(&file, &app_data).is_err());
        #[cfg(windows)]
        assert!(validate_root(Path::new(r"C:\"), &app_data).is_err());
        let _ = std::fs::remove_dir_all(app_data);
        let _ = std::fs::remove_dir_all(elsewhere);
    }

    #[test]
    fn central_listing_pairs_thumbnails_and_skips_containers() {
        let dir = crate::backup::layout::tempdir("saves-listing");
        for rel in [
            "battery/Game.srm",
            "battery/USA/Card A/01-GALE-x.gci",
            "battery/.history/Game.srm/2026-09-23 10-00-00/Game.srm",
            "states/Game.state1",
            "states/Game.state1.png",
            "states/Game.state.auto",
        ] {
            let path = dir.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"x").unwrap();
        }
        let mut manifest = GameManifest::new("snes:game", "Game", "snes");
        manifest.set_label("states/Game.state1", Some("Before final boss"), "2026-09-23T10:00:00Z");
        manifest.entry_mut("battery/USA/Card A/01-GALE-x.gci");
        let rels: Vec<String> = central_units(&dir, &manifest).into_iter().map(|(rel, _, _)| rel).collect();
        assert_eq!(rels, vec!["battery/Game.srm", "battery/USA/Card A/01-GALE-x.gci", "states/Game.state.auto", "states/Game.state1", "states/Game.state1.png"]);
        let entries = list_folder(&dir, &manifest, false, &drive::SyncState::default());
        assert_eq!(entries.len(), 4);
        let state1 = entries.iter().find(|entry| entry.id == "states/Game.state1").unwrap();
        assert_eq!(state1.slot.as_deref(), Some("1"));
        assert_eq!(state1.label.as_deref(), Some("Before final boss"));
        assert!(state1.thumbnail.as_deref().is_some_and(|url| url.starts_with("data:image/png;base64,")));
        let srm = entries.iter().find(|entry| entry.id == "battery/Game.srm").unwrap();
        assert_eq!(srm.versions.len(), 1);
        assert!(!srm.synced);
        let _ = std::fs::remove_dir_all(dir);
    }
}
