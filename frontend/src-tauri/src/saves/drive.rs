//! Optional Google Drive copy of the central saves folder.
//!
//! It reuses the Drive link of Settings › Backup (same account, token
//! refresh, retries/backoff in google_drive::api). That link's scope is
//! `drive.appdata`, so the files live in the app's private Drive folder
//! (not browsable in drive.google.com), next to the full backups, named
//! after their path: `Saves/<Platform>/<Game>/battery/…`. A `game` property (a hash of
//! the game key) groups a game's files whatever its folder is called on
//! each PC.
//!
//! What happened since the last sync is known from `.metadea-sync.json` at
//! the root (the hash each file had when last in sync): only one side
//! changed → copy it over; both changed → conflict: the newer copy stays
//! active and the older one goes to that save's history. Manifests are
//! merged instead (labels from both PCs survive).

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::files;
use super::games;
use super::layout::{self, MANIFEST_NAME};
use super::manifest;
use crate::backup::progress::ProgressSink;
use crate::google_drive::api::{self, RemoteSave, SaveUploadMeta};

pub const SYNC_STATE_NAME: &str = ".metadea-sync.json";
/// Next to the backups in Metadea's private Drive folder.
const REMOTE_PREFIX: &str = "Saves";
/// Pause between two transfers, on top of api.rs' backoff on 429/5xx.
const TRANSFER_PAUSE: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncState {
    /// The Drive account this state describes; another account starts over.
    #[serde(default)]
    pub account: Option<String>,
    /// `<game hash>/<rel>` → sha256 the file had when last in sync.
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    #[serde(default)]
    pub last_sync_at: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
}

pub fn load_sync_state(root: &Path) -> SyncState {
    crate::backup::read_json_or_default(&root.join(SYNC_STATE_NAME))
}

pub fn save_sync_state(root: &Path, state: &SyncState) -> Result<(), String> {
    crate::backup::write_json_atomic(&root.join(SYNC_STATE_NAME), state)
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::SAVES_IO, e))
}

pub fn game_hash(game_key: &str) -> String {
    layout::short_hash(game_key, 16)
}

pub fn state_key(game_hash: &str, rel: &str) -> String {
    format!("{game_hash}/{rel}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileState {
    pub sha256: String,
    pub mtime_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveAction {
    Nothing,
    Upload,
    Download,
    /// Both changed, the local copy is newer: the remote one goes to
    /// history, then the local one is uploaded.
    ConflictKeepLocal,
    /// Both changed, the remote copy is newer: the local one goes to
    /// history, then the remote one is downloaded.
    ConflictKeepRemote,
}

/// What to do with one file. `last_synced`: its hash when last in sync.
/// `archived`: the local copy was archived and the remote one has not
/// changed since, so it is not brought back.
pub fn decide(local: Option<&FileState>, remote: Option<&FileState>, last_synced: Option<&str>, archived: bool) -> DriveAction {
    match (local, remote) {
        (None, None) => DriveAction::Nothing,
        (Some(_), None) => DriveAction::Upload,
        (None, Some(_)) if archived => DriveAction::Nothing,
        (None, Some(_)) => DriveAction::Download,
        (Some(local), Some(remote)) => {
            if local.sha256 == remote.sha256 {
                DriveAction::Nothing
            } else if last_synced == Some(local.sha256.as_str()) {
                DriveAction::Download
            } else if last_synced == Some(remote.sha256.as_str()) {
                DriveAction::Upload
            } else if remote.mtime_ms > local.mtime_ms {
                DriveAction::ConflictKeepRemote
            } else {
                DriveAction::ConflictKeepLocal
            }
        }
    }
}

pub fn remote_name(platform_folder: &str, game_folder: &str, rel: &str) -> String {
    format!("{REMOTE_PREFIX}/{platform_folder}/{game_folder}/{rel}")
}

/// `Saves/<Platform>/<Game>/<rel>` → (platform, game, rel), rel
/// checked to stay inside the game folder.
pub fn parse_remote_name(name: &str) -> Option<(String, String, String)> {
    let rest = name.strip_prefix(REMOTE_PREFIX)?.strip_prefix('/')?;
    let mut parts = rest.splitn(3, '/');
    let platform = parts.next()?.to_string();
    let game = parts.next()?.to_string();
    let rel = parts.next()?.to_string();
    if platform.is_empty() || game.is_empty() || layout::safe_relative(&rel).is_err() || !is_synced_rel(&rel) {
        return None;
    }
    Some((platform, game, rel))
}

/// The manifest and what is under battery/ and states/, minus history,
/// archives and temp files (any segment starting with a dot).
pub fn is_synced_rel(rel: &str) -> bool {
    if rel == MANIFEST_NAME {
        return true;
    }
    let mut segments = rel.split('/');
    let top_ok = matches!(segments.next(), Some("battery" | "states"));
    top_ok && rel.split('/').count() >= 2 && !rel.split('/').any(|segment| segment.starts_with('.') || segment.ends_with(".metadea-tmp"))
}

/// The files of a game folder that are synced, by `/`-relative path.
pub fn local_files(game_dir: &Path) -> BTreeMap<String, PathBuf> {
    files::files_under(game_dir).into_iter().filter(|(rel, _)| is_synced_rel(rel)).collect()
}

struct SilentProgress;

impl ProgressSink for SilentProgress {
    fn report(&self, _phase: &str, _percent: f64) {}
    fn cancelled(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Both,
    /// Before a launch: only bring newer saves down; uploads wait for the
    /// end of the session.
    PullOnly,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub uploaded: u32,
    pub downloaded: u32,
    pub conflicts: u32,
    pub failed: u32,
}

impl SyncReport {
    pub fn add(&mut self, other: SyncReport) {
        self.uploaded += other.uploaded;
        self.downloaded += other.downloaded;
        self.conflicts += other.conflicts;
        self.failed += other.failed;
    }
}

fn temp_path(target: &Path) -> PathBuf {
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".metadea-tmp");
    target.with_file_name(name)
}

/// Downloads a remote file next to `target` and checks its hash; returns
/// the temp path.
async fn download_verified(token: &str, remote: &RemoteSave, target: &Path) -> Result<PathBuf, String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| crate::error_codes::with_detail(crate::error_codes::SAVES_IO, e))?;
    }
    let temp = temp_path(target);
    api::download(token, &remote.id, remote.size, &temp, &SilentProgress).await?;
    let sha = files::hash_file(&temp).map_err(|e| crate::error_codes::with_detail(crate::error_codes::SAVES_IO, e))?;
    if remote.sha256.as_deref().is_some_and(|expected| expected != sha) {
        let _ = std::fs::remove_file(&temp);
        return Err(crate::error_codes::with_detail(crate::error_codes::SAVES_IO, "downloaded save does not match its hash"));
    }
    if let Some(mtime) = remote.mtime_ms {
        if let Ok(file) = std::fs::File::options().write(true).open(&temp) {
            let _ = file.set_modified(files::ms_to_system_time(mtime));
        }
    }
    Ok(temp)
}

fn install_download(game_dir: &Path, rel: &str, temp: &Path, target: &Path, keep: u32) -> Result<(), String> {
    let io = |e: std::io::Error| crate::error_codes::with_detail(crate::error_codes::SAVES_IO, e);
    if target.exists() {
        files::rotate_into_history(game_dir, rel, keep).map_err(io)?;
    }
    files::forget_hash(target);
    std::fs::rename(temp, target).map_err(io)
}

struct GameSync<'a> {
    token: &'a str,
    game_dir: &'a Path,
    platform_folder: String,
    game_folder: String,
    hash: String,
    direction: Direction,
    keep: u32,
}

impl GameSync<'_> {
    fn name(&self, rel: &str) -> String {
        remote_name(&self.platform_folder, &self.game_folder, rel)
    }

    async fn upload(&self, path: &Path, rel: &str, existing: Option<&RemoteSave>) -> Result<String, String> {
        let io = |e: std::io::Error| crate::error_codes::with_detail(crate::error_codes::SAVES_IO, e);
        let fingerprint = files::fingerprint(path).map_err(io)?;
        let meta = SaveUploadMeta { name: &self.name(rel), game: &self.hash, sha256: &fingerprint.sha256, mtime_ms: fingerprint.mtime_ms };
        api::upload_save(self.token, path, meta, existing.map(|remote| remote.id.as_str()), &SilentProgress).await?;
        Ok(fingerprint.sha256)
    }

    /// The manifest first: merged, so labels from both sides survive.
    async fn sync_manifest(&self, remote: Option<&RemoteSave>, state: &mut SyncState, report: &mut SyncReport) -> Result<(), String> {
        let local_path = manifest::manifest_path(self.game_dir);
        let local_sha = files::hash_file(&local_path).ok();
        if let Some(remote) = remote {
            if remote.sha256.is_some() && remote.sha256 != local_sha {
                let temp = download_verified(self.token, remote, &local_path).await?;
                let downloaded = std::fs::read(&temp).ok().and_then(|bytes| manifest::parse_manifest(&bytes));
                let _ = std::fs::remove_file(&temp);
                if let Some(theirs) = downloaded {
                    let merged = match manifest::read_manifest(self.game_dir) {
                        Some(mine) => mine.merge(&theirs),
                        None => theirs,
                    };
                    manifest::write_manifest(self.game_dir, &merged)?;
                    report.downloaded += 1;
                }
            }
        }
        let key = state_key(&self.hash, MANIFEST_NAME);
        let current = files::hash_file(&local_path).ok();
        if current.is_some() && current != remote.and_then(|r| r.sha256.clone()) {
            if self.direction == Direction::Both {
                let sha = self.upload(&local_path, MANIFEST_NAME, remote).await?;
                state.files.insert(key, sha);
                report.uploaded += 1;
            }
        } else if let Some(sha) = current {
            state.files.insert(key, sha);
        }
        Ok(())
    }

    async fn sync_file(&self, rel: &str, local: Option<&PathBuf>, remote: Option<&RemoteSave>, archived: bool, state: &mut SyncState, report: &mut SyncReport) -> Result<(), String> {
        let io = |e: std::io::Error| crate::error_codes::with_detail(crate::error_codes::SAVES_IO, e);
        let key = state_key(&self.hash, rel);
        let local_state = match local {
            Some(path) => Some(files::fingerprint(path).map(|fp| FileState { sha256: fp.sha256, mtime_ms: fp.mtime_ms }).map_err(io)?),
            None => None,
        };
        let remote_state = remote.and_then(|r| r.sha256.clone().map(|sha256| FileState { sha256, mtime_ms: r.mtime_ms.unwrap_or(0) }));
        if remote.is_some() && remote_state.is_none() {
            // Not written by this sync (no hash): left alone.
            return Ok(());
        }
        let archived = archived && remote_state.as_ref().is_some_and(|r| state.files.get(&key) == Some(&r.sha256));
        let action = decide(local_state.as_ref(), remote_state.as_ref(), state.files.get(&key).map(String::as_str), archived);
        let target = self.game_dir.join(layout::safe_relative(rel)?);
        let pull_only = self.direction == Direction::PullOnly;
        match action {
            DriveAction::Nothing => {
                if let (Some(local), Some(_)) = (&local_state, &remote_state) {
                    state.files.insert(key, local.sha256.clone());
                }
            }
            DriveAction::Upload | DriveAction::ConflictKeepLocal if pull_only => {}
            DriveAction::Upload => {
                let sha = self.upload(&target, rel, remote).await?;
                state.files.insert(key, sha);
                report.uploaded += 1;
            }
            DriveAction::Download | DriveAction::ConflictKeepRemote => {
                let remote = remote.expect("download needs a remote file");
                let temp = download_verified(self.token, remote, &target).await?;
                install_download(self.game_dir, rel, &temp, &target, self.keep)?;
                state.files.insert(key, remote_state.expect("checked above").sha256);
                report.downloaded += 1;
                if action == DriveAction::ConflictKeepRemote {
                    report.conflicts += 1;
                }
            }
            DriveAction::ConflictKeepLocal => {
                let remote_file = remote.expect("conflict needs a remote file");
                let temp = download_verified(self.token, remote_file, &target).await?;
                let taken_at = files::ms_to_system_time(remote_file.mtime_ms.unwrap_or(0));
                files::add_history_version(self.game_dir, rel, &temp, taken_at, self.keep).map_err(io)?;
                let sha = self.upload(&target, rel, remote).await?;
                state.files.insert(key, sha);
                report.uploaded += 1;
                report.conflicts += 1;
            }
        }
        Ok(())
    }
}

fn newest_per_rel(remote: Vec<RemoteSave>) -> BTreeMap<String, RemoteSave> {
    let mut out: BTreeMap<String, RemoteSave> = BTreeMap::new();
    for file in remote {
        let Some((_, _, rel)) = parse_remote_name(&file.name) else { continue };
        let newer = out.get(&rel).map_or(true, |existing| file.mtime_ms.unwrap_or(0) > existing.mtime_ms.unwrap_or(0));
        if newer {
            out.insert(rel, file);
        }
    }
    out
}

/// Syncs one game folder against its remote files.
pub async fn sync_game_dir(
    token: &str,
    game_dir: &Path,
    remote: Vec<RemoteSave>,
    direction: Direction,
    state: &mut SyncState,
    keep: u32,
) -> Result<SyncReport, String> {
    let manifest = manifest::read_manifest(game_dir).ok_or(crate::error_codes::SAVES_NOT_FOUND)?;
    let name_of = |path: Option<&Path>| path.and_then(Path::file_name).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let sync = GameSync {
        token,
        game_dir,
        platform_folder: name_of(game_dir.parent()),
        game_folder: name_of(Some(game_dir)),
        hash: game_hash(&manifest.game_key),
        direction,
        keep,
    };
    let mut remote = newest_per_rel(remote);
    let mut report = SyncReport::default();
    sync.sync_manifest(remote.remove(MANIFEST_NAME).as_ref(), state, &mut report).await?;
    // Tombstones come from the merged manifest.
    let manifest = manifest::read_manifest(game_dir).unwrap_or(manifest);
    let local = local_files(game_dir);
    let rels: BTreeSet<String> = local.keys().filter(|rel| rel.as_str() != MANIFEST_NAME).cloned().chain(remote.keys().cloned()).collect();
    for rel in rels {
        let archived = manifest.archived.iter().any(|entry| rel == entry.rel || rel.starts_with(&format!("{}/", entry.rel)));
        let outcome = sync.sync_file(&rel, local.get(&rel), remote.get(&rel), archived, state, &mut report).await;
        if let Err(error) = outcome {
            log::warn!("Save sync failed for {}/{rel}: {error}", game_dir.display());
            if error.starts_with(crate::error_codes::GDRIVE_AUTH) || error.starts_with(crate::error_codes::GDRIVE_NOT_LINKED) {
                return Err(error);
            }
            report.failed += 1;
        }
        tokio::time::sleep(TRANSFER_PAUSE).await;
    }
    Ok(report)
}

/// A game only on Drive (a new PC): its manifest is downloaded first, then
/// its folder is found by key or created under the remote folder's name.
async fn adopt_remote_game(token: &str, root: &Path, files: &[RemoteSave]) -> Result<Option<PathBuf>, String> {
    let Some(remote_manifest) = files.iter().find(|file| parse_remote_name(&file.name).is_some_and(|(_, _, rel)| rel == MANIFEST_NAME)) else {
        return Ok(None);
    };
    let Some((platform, folder, _)) = parse_remote_name(&remote_manifest.name) else { return Ok(None) };
    let staging = root.join(".metadea-incoming.json");
    let temp = download_verified(token, remote_manifest, &staging).await?;
    let parsed = std::fs::read(&temp).ok().and_then(|bytes| manifest::parse_manifest(&bytes));
    let _ = std::fs::remove_file(&temp);
    let Some(theirs) = parsed else { return Ok(None) };
    let platform_folder = if theirs.platform_id.is_empty() { layout::sanitize_name(&platform) } else { layout::platform_folder_name(&theirs.platform_id) };
    if let Some((dir, _)) = games::find_game_dir(root, &platform_folder, &theirs.game_key, &theirs.aliases) {
        return Ok(Some(dir));
    }
    let dir = games::plan_game_dir(root, &platform_folder, &folder, &theirs.game_key);
    manifest::write_manifest(&dir, &theirs)?;
    Ok(Some(dir))
}

/// Syncs every game folder under the root, and brings down the games that
/// are only on Drive.
pub async fn sync_all(token: &str, root: &Path, state: &mut SyncState, keep: u32, direction: Direction) -> Result<SyncReport, String> {
    let remote = api::list_saves(token, None).await?;
    let mut by_game: BTreeMap<String, Vec<RemoteSave>> = BTreeMap::new();
    for file in remote {
        if let Some(game) = file.game.clone() {
            by_game.entry(game).or_default().push(file);
        }
    }
    let mut report = SyncReport::default();
    for (dir, manifest) in games::all_game_dirs(root) {
        let files = by_game.remove(&game_hash(&manifest.game_key)).unwrap_or_default();
        report.add(sync_game_dir(token, &dir, files, direction, state, keep).await?);
    }
    for (_, files) in by_game {
        if let Some(dir) = adopt_remote_game(token, root, &files).await? {
            report.add(sync_game_dir(token, &dir, files, direction, state, keep).await?);
        }
    }
    Ok(report)
}

/// Syncs one game (after a session, or before a launch with PullOnly).
pub async fn sync_one(token: &str, game_dir: &Path, game_key: &str, direction: Direction, state: &mut SyncState, keep: u32) -> Result<SyncReport, String> {
    let remote = api::list_saves(token, Some(&game_hash(game_key))).await?;
    sync_game_dir(token, game_dir, remote, direction, state, keep).await
}

/// Per-file sync status of a save unit for the UI: every file under it
/// has the hash it had when last synced.
pub fn unit_synced(state: &SyncState, game_key: &str, game_dir: &Path, rel: &str) -> bool {
    let hash = game_hash(game_key);
    let Ok(relative) = layout::safe_relative(rel) else { return false };
    let path = game_dir.join(relative);
    let files: Vec<(String, PathBuf)> = if path.is_dir() {
        files::files_under(&path).into_iter().map(|(inner, file)| (format!("{rel}/{inner}"), file)).collect()
    } else {
        vec![(rel.to_string(), path)]
    };
    !files.is_empty()
        && files.iter().all(|(file_rel, file)| {
            files::hash_file(file).ok().is_some_and(|sha| state.files.get(&state_key(&hash, file_rel)) == Some(&sha))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fs(sha: &str, mtime_ms: i64) -> FileState {
        FileState { sha256: sha.into(), mtime_ms }
    }

    #[test]
    fn one_sided_changes_copy_over() {
        assert_eq!(decide(None, None, None, false), DriveAction::Nothing);
        assert_eq!(decide(Some(&fs("a", 1)), None, None, false), DriveAction::Upload);
        assert_eq!(decide(None, Some(&fs("a", 1)), None, false), DriveAction::Download);
        assert_eq!(decide(Some(&fs("a", 1)), Some(&fs("a", 9)), None, false), DriveAction::Nothing);
        // Only the remote changed since the last sync.
        assert_eq!(decide(Some(&fs("a", 50)), Some(&fs("b", 10)), Some("a"), false), DriveAction::Download);
        // Only the local copy changed.
        assert_eq!(decide(Some(&fs("b", 10)), Some(&fs("a", 50)), Some("a"), false), DriveAction::Upload);
    }

    #[test]
    fn conflicts_keep_the_newer_copy_active() {
        // Never synced (a new PC with its own saves) or both changed.
        assert_eq!(decide(Some(&fs("a", 10)), Some(&fs("b", 20)), None, false), DriveAction::ConflictKeepRemote);
        assert_eq!(decide(Some(&fs("a", 30)), Some(&fs("b", 20)), Some("c"), false), DriveAction::ConflictKeepLocal);
        assert_eq!(decide(Some(&fs("a", 20)), Some(&fs("b", 20)), Some("c"), false), DriveAction::ConflictKeepLocal);
    }

    #[test]
    fn archived_saves_are_not_brought_back() {
        assert_eq!(decide(None, Some(&fs("a", 1)), Some("a"), true), DriveAction::Nothing);
        assert_eq!(decide(None, Some(&fs("b", 1)), Some("a"), false), DriveAction::Download);
    }

    #[test]
    fn remote_names_round_trip_and_stay_inside_the_game() {
        let name = remote_name("PS2", "Final Fantasy X", "battery/Mcd001.ps2");
        assert_eq!(name, "Saves/PS2/Final Fantasy X/battery/Mcd001.ps2");
        assert_eq!(parse_remote_name(&name), Some(("PS2".into(), "Final Fantasy X".into(), "battery/Mcd001.ps2".into())));
        assert_eq!(parse_remote_name("Saves/PS2/FFX/metadea-saves.json").unwrap().2, MANIFEST_NAME);
        for bad in [
            "Saves/PS2/FFX/../../x",
            "Saves/PS2/FFX/battery/.history/x/y",
            "Saves/PS2/FFX/other/x",
            "Saves/PS2/FFX/battery",
            "metadea-backup-2026.7z",
            "Saves/PS2",
        ] {
            assert_eq!(parse_remote_name(bad), None, "{bad}");
        }
    }

    #[test]
    fn local_files_skip_history_archives_and_temp_files() {
        let game = crate::backup::layout::tempdir("saves-drive-local");
        for rel in [
            MANIFEST_NAME,
            "battery/Game.srm",
            "battery/ULUS10041DATA00/DATA.BIN",
            "battery/.history/Game.srm/2026-09-23 10-00-00/Game.srm",
            "states/Game.state1",
            "states/Game.state1.png",
            "states/Game.state2.metadea-tmp",
            ".archive/2026/battery/Old.srm",
            "notes.txt",
        ] {
            let path = game.join(rel);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"x").unwrap();
        }
        let rels: Vec<String> = local_files(&game).into_keys().collect();
        assert_eq!(rels, vec!["battery/Game.srm", "battery/ULUS10041DATA00/DATA.BIN", MANIFEST_NAME, "states/Game.state1", "states/Game.state1.png"]);
        let _ = std::fs::remove_dir_all(game);
    }

    #[test]
    fn sync_state_round_trips() {
        let root = crate::backup::layout::tempdir("saves-drive-state");
        let mut state = load_sync_state(&root);
        assert_eq!(state, SyncState::default());
        state.account = Some("me@example.com".into());
        state.files.insert(state_key("abc", "battery/x"), "sha".into());
        save_sync_state(&root, &state).unwrap();
        assert_eq!(load_sync_state(&root), state);
        let _ = std::fs::remove_dir_all(root);
    }
}
