//! Game saves inside Metadea's full backup (`.7z`, backup module).
//!
//! The archive carries the central saves root under `saves/`: every game
//! folder's `metadea-saves.json`, `battery/` and `states/` (the same set the
//! Drive sync carries; `.history`, `.archive` and temp files stay out), plus
//! `saves/.metadea-backup-index.json` with each file's modification time
//! (7z extraction does not restore it, and the conflict rule needs it).
//!
//! Restoring merges into this PC's configured root and never overwrites a
//! newer local file: same content → nothing; the backup's copy newer → the
//! local one moves into that save's `.history` first; the local copy newer
//! → it stays active and the backup's copy goes into `.history`. Manifests
//! are merged (labels from both survive). Game folders are matched by game
//! key, so a folder called differently on this PC is found.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::drive::{self, FileState};
use super::files;
use super::games;
use super::layout::{self, MANIFEST_NAME};
use super::manifest;
use crate::backup::layout::SourceFile;
use crate::error_codes::{self, with_detail};

/// Folder of the saves inside the archive (and inside the staging folder).
pub const ARCHIVE_PREFIX: &str = "saves";
/// Modification times of the archived saves, by `/`-path under the root.
pub const INDEX_NAME: &str = ".metadea-backup-index.json";

#[derive(Debug, Default, Serialize, Deserialize)]
struct BackupIndex {
    #[serde(default)]
    mtimes: BTreeMap<String, i64>,
}

/// Every file a backup takes from the saves root: `(path under the root, file)`.
fn root_files(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    for (dir, _) in games::all_game_dirs(root) {
        let Ok(game_rel) = dir.strip_prefix(root) else { continue };
        let game_rel = layout::to_slash(game_rel);
        for (rel, path) in drive::local_files(&dir) {
            out.push((format!("{game_rel}/{rel}"), path));
        }
    }
    out
}

/// `files`: saves (manifests not counted); `bytes`: everything added.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavesEstimate {
    pub files: usize,
    pub bytes: u64,
}

fn is_manifest(path: &str) -> bool {
    path == MANIFEST_NAME || path.ends_with(&format!("/{MANIFEST_NAME}"))
}

/// What "Include game saves" adds to a backup (before compression).
pub fn estimate(root: &Path) -> SavesEstimate {
    summarize(root_files(root).iter().filter_map(|(rel, path)| fs::metadata(path).ok().map(|m| (rel.as_str(), m.len()))))
}

/// The archive sources for the saves root, plus the index written into
/// `work_dir`. Empty when the root has no saves.
pub fn backup_sources(root: &Path, work_dir: &Path) -> Result<Vec<SourceFile>, String> {
    let files = root_files(root);
    if files.is_empty() {
        return Ok(Vec::new());
    }
    let mut index = BackupIndex::default();
    let mut sources = Vec::with_capacity(files.len() + 1);
    for (rel, path) in files {
        let Ok(metadata) = fs::metadata(&path) else { continue };
        if let Ok(modified) = metadata.modified() {
            index.mtimes.insert(rel.clone(), files::system_time_ms(modified));
        }
        sources.push(SourceFile { archive_path: format!("{ARCHIVE_PREFIX}/{rel}"), disk_path: path, size: metadata.len() });
    }
    let index_path = work_dir.join(INDEX_NAME);
    fs::write(&index_path, serde_json::to_vec(&index).map_err(|e| e.to_string())?).map_err(|e| with_detail(error_codes::SAVES_IO, e))?;
    let size = fs::metadata(&index_path).map(|m| m.len()).unwrap_or(0);
    sources.push(SourceFile { archive_path: format!("{ARCHIVE_PREFIX}/{INDEX_NAME}"), disk_path: index_path, size });
    Ok(sources)
}

/// Saves count and size of `(path under the root, size)` pairs.
fn summarize<'a>(files: impl Iterator<Item = (&'a str, u64)>) -> SavesEstimate {
    let mut estimate = SavesEstimate::default();
    for (path, size) in files {
        if path == INDEX_NAME {
            continue;
        }
        estimate.bytes += size;
        if !is_manifest(path) {
            estimate.files += 1;
        }
    }
    estimate
}

/// Saves count and size recorded in a backup's manifest (`inspect_backup`);
/// None when the backup carries no saves.
pub fn summarize_archive<'a>(files: impl Iterator<Item = (&'a str, u64)>) -> Option<SavesEstimate> {
    let prefix = format!("{ARCHIVE_PREFIX}/");
    let mut any = false;
    let summary = summarize(files.filter_map(|(path, size)| path.strip_prefix(prefix.as_str()).map(|inner| (inner, size))).inspect(|_| any = true));
    any.then_some(summary)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestoreAction {
    /// Nothing local: the backup's copy goes in.
    Place,
    Same,
    /// The backup's copy is newer: the local one moves to history first.
    ReplaceLocal,
    /// The local copy is newer (or as new): it stays, the backup's copy
    /// goes to history.
    KeepLocal,
}

pub fn decide_restore(backup: &FileState, local: Option<&FileState>) -> RestoreAction {
    match local {
        None => RestoreAction::Place,
        Some(local) if local.sha256 == backup.sha256 => RestoreAction::Same,
        Some(local) if backup.mtime_ms > local.mtime_ms => RestoreAction::ReplaceLocal,
        Some(_) => RestoreAction::KeepLocal,
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct MergeReport {
    pub restored: u32,
    pub conflicts: u32,
    pub failed: u32,
}

fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    files::forget_hash(to);
    fs::rename(from, to).or_else(|_| files::copy_file_atomic(from, to))
}

/// The local folder a staged game folder merges into: the one with the same
/// game key, else a folder named like the backup's (suffixed if another
/// game already uses that name).
fn target_game_dir(root: &Path, platform: &str, folder: &str, staged_game: &Path) -> PathBuf {
    let platform_folder = layout::sanitize_name(platform);
    match manifest::read_manifest(staged_game) {
        Some(theirs) => games::find_game_dir(root, &platform_folder, &theirs.game_key, &theirs.aliases)
            .map(|(dir, _)| dir)
            .unwrap_or_else(|| games::plan_game_dir(root, &platform_folder, folder, &theirs.game_key)),
        None => root.join(platform_folder).join(layout::sanitize_name(folder)),
    }
}

fn merge_game(staged_game: &Path, target: &Path, mtimes: &BTreeMap<String, i64>, game_rel: &str, keep: u32, report: &mut MergeReport) {
    // Manifest first: merged, never replaced.
    if let Some(theirs) = manifest::read_manifest(staged_game) {
        let merged = match manifest::read_manifest(target) {
            Some(mine) => mine.merge(&theirs),
            None => theirs,
        };
        if manifest::write_manifest(target, &merged).is_err() {
            report.failed += 1;
        }
    }
    for (rel, staged) in drive::local_files(staged_game) {
        if rel == MANIFEST_NAME {
            continue;
        }
        let outcome = (|| -> std::io::Result<Option<bool>> {
            if let Some(mtime) = mtimes.get(&format!("{game_rel}/{rel}")) {
                let file = fs::File::options().write(true).open(&staged)?;
                file.set_modified(files::ms_to_system_time(*mtime))?;
            }
            let backup_fp = files::fingerprint(&staged)?;
            let backup_state = FileState { sha256: backup_fp.sha256, mtime_ms: backup_fp.mtime_ms };
            let destination = target.join(layout::safe_relative(&rel).map_err(std::io::Error::other)?);
            let local_state = files::fingerprint(&destination).ok().map(|fp| FileState { sha256: fp.sha256, mtime_ms: fp.mtime_ms });
            match decide_restore(&backup_state, local_state.as_ref()) {
                RestoreAction::Same => Ok(None),
                RestoreAction::Place => move_file(&staged, &destination).map(|_| Some(false)),
                RestoreAction::ReplaceLocal => {
                    files::rotate_into_history(target, &rel, keep)?;
                    move_file(&staged, &destination).map(|_| Some(true))
                }
                RestoreAction::KeepLocal => {
                    files::add_history_version(target, &rel, &staged, files::ms_to_system_time(backup_state.mtime_ms), keep)?;
                    Ok(Some(true))
                }
            }
        })();
        match outcome {
            Ok(Some(conflict)) => {
                report.restored += 1;
                if conflict {
                    report.conflicts += 1;
                }
            }
            Ok(None) => {}
            Err(error) => {
                log::warn!("Restoring save {game_rel}/{rel} failed: {error}");
                report.failed += 1;
            }
        }
    }
}

/// Merges the staged `saves/` folder of a restore into `root` (see the
/// module comment). The staged folder is consumed.
pub fn merge_staged(staged: &Path, root: &Path, keep: u32) -> Result<MergeReport, String> {
    let index: BackupIndex = crate::backup::read_json_or_default(&staged.join(INDEX_NAME));
    fs::create_dir_all(root).map_err(|e| with_detail(error_codes::SAVES_ROOT_INVALID, e))?;
    let mut report = MergeReport::default();
    let platforms = fs::read_dir(staged).map_err(|e| with_detail(error_codes::SAVES_IO, e))?;
    for platform in platforms.flatten().filter(|entry| entry.path().is_dir()) {
        let platform_name = platform.file_name().to_string_lossy().into_owned();
        let Ok(game_dirs) = fs::read_dir(platform.path()) else { continue };
        for game in game_dirs.flatten().filter(|entry| entry.path().is_dir()) {
            let folder = game.file_name().to_string_lossy().into_owned();
            let target = target_game_dir(root, &platform_name, &folder, &game.path());
            if !layout::is_within(&target, root) {
                report.failed += 1;
                continue;
            }
            merge_game(&game.path(), &target, &index.mtimes, &format!("{platform_name}/{folder}"), keep, &mut report);
        }
    }
    let _ = fs::remove_dir_all(staged);
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::saves::manifest::GameManifest;
    use std::time::{Duration, SystemTime};

    fn write(path: &Path, bytes: &[u8], mtime: SystemTime) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
        fs::File::options().write(true).open(path).unwrap().set_modified(mtime).unwrap();
    }

    fn game(root: &Path, folder: &str, key: &str) -> PathBuf {
        let dir = root.join("PS2").join(folder);
        manifest::write_manifest(&dir, &GameManifest::new(key, folder, "ps2")).unwrap();
        dir
    }

    #[test]
    fn restore_decisions_never_lose_the_newer_copy() {
        let backup = FileState { sha256: "b".into(), mtime_ms: 100 };
        assert_eq!(decide_restore(&backup, None), RestoreAction::Place);
        assert_eq!(decide_restore(&backup, Some(&FileState { sha256: "b".into(), mtime_ms: 1 })), RestoreAction::Same);
        assert_eq!(decide_restore(&backup, Some(&FileState { sha256: "l".into(), mtime_ms: 50 })), RestoreAction::ReplaceLocal);
        assert_eq!(decide_restore(&backup, Some(&FileState { sha256: "l".into(), mtime_ms: 200 })), RestoreAction::KeepLocal);
        assert_eq!(decide_restore(&backup, Some(&FileState { sha256: "l".into(), mtime_ms: 100 })), RestoreAction::KeepLocal);
    }

    #[test]
    fn sources_estimate_and_summary_agree() {
        let dir = crate::backup::layout::tempdir("saves-backup-sources");
        let root = dir.join("Saves");
        let ffx = game(&root, "Final Fantasy X", "ps2:id-slus20312");
        write(&ffx.join("battery/Mcd001.ps2"), b"card", SystemTime::now());
        write(&ffx.join("states/SLUS-20312.01.p2s"), b"state!", SystemTime::now());
        write(&ffx.join("battery/.history/Mcd001.ps2/2026-01-01 00-00-00/Mcd001.ps2"), b"old", SystemTime::now());
        let work = dir.join("work");
        fs::create_dir_all(&work).unwrap();
        let sources = backup_sources(&root, &work).unwrap();
        let mut paths: Vec<&str> = sources.iter().map(|s| s.archive_path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec![
            "saves/.metadea-backup-index.json",
            "saves/PS2/Final Fantasy X/battery/Mcd001.ps2",
            "saves/PS2/Final Fantasy X/metadea-saves.json",
            "saves/PS2/Final Fantasy X/states/SLUS-20312.01.p2s",
        ]);
        let expected = SavesEstimate { files: 2, bytes: 4 + 6 + fs::metadata(ffx.join(MANIFEST_NAME)).unwrap().len() };
        assert_eq!(estimate(&root), expected);
        assert_eq!(summarize_archive(sources.iter().map(|s| (s.archive_path.as_str(), s.size))), Some(expected));
        assert_eq!(summarize_archive([("metadea.db", 10u64)].into_iter()), None);
        assert!(backup_sources(&dir.join("empty"), &work).unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn merge_keeps_the_newer_copy_active_and_the_older_in_history() {
        let dir = crate::backup::layout::tempdir("saves-backup-merge");
        let old = SystemTime::now() - Duration::from_secs(7200);
        let new = SystemTime::now() - Duration::from_secs(60);

        // What the backup carries (as staged by the restore), with its index.
        let staged = dir.join("stage/saves");
        let staged_game = staged.join("PS2/FFX (backup name)");
        manifest::write_manifest(&staged_game, &{
            let mut m = GameManifest::new("ps2:id-slus20312", "FFX", "ps2");
            m.set_label("states/s1.p2s", Some("Before Yunalesca"), "2026-09-01T00:00:00Z");
            m
        })
        .unwrap();
        for (rel, bytes) in [("battery/card.ps2", b"backup-card".as_slice()), ("states/s1.p2s", b"backup-s1"), ("states/s2.p2s", b"backup-s2"), ("states/same.p2s", b"same")] {
            write(&staged_game.join(rel), bytes, SystemTime::now());
        }
        let index = BackupIndex {
            mtimes: [
                ("PS2/FFX (backup name)/battery/card.ps2", new),
                ("PS2/FFX (backup name)/states/s1.p2s", old),
                ("PS2/FFX (backup name)/states/s2.p2s", old),
                ("PS2/FFX (backup name)/states/same.p2s", old),
            ]
            .into_iter()
            .map(|(k, t)| (k.to_string(), files::system_time_ms(t)))
            .collect(),
        };
        fs::write(staged.join(INDEX_NAME), serde_json::to_vec(&index).unwrap()).unwrap();

        // This PC: same game under another folder name, older card, newer s1.
        let root = dir.join("Saves");
        let local = game(&root, "Final Fantasy X", "ps2:id-slus20312");
        write(&local.join("battery/card.ps2"), b"local-card", old);
        write(&local.join("states/s1.p2s"), b"local-s1", new);
        write(&local.join("states/same.p2s"), b"same", new);

        let report = merge_staged(&staged, &root, 5).unwrap();
        assert_eq!(report, MergeReport { restored: 3, conflicts: 2, failed: 0 });
        assert!(!staged.exists());
        assert!(!root.join("PS2/FFX (backup name)").exists());
        // Backup newer: active, local copy in history.
        assert_eq!(fs::read(local.join("battery/card.ps2")).unwrap(), b"backup-card");
        let card_history = files::history_versions(&local, "battery/card.ps2");
        assert_eq!(fs::read(&card_history[0].path).unwrap(), b"local-card");
        // Local newer: stays, backup copy in history.
        assert_eq!(fs::read(local.join("states/s1.p2s")).unwrap(), b"local-s1");
        let s1_history = files::history_versions(&local, "states/s1.p2s");
        assert_eq!(fs::read(&s1_history[0].path).unwrap(), b"backup-s1");
        // Missing locally: placed, with the backup's time.
        assert_eq!(fs::read(local.join("states/s2.p2s")).unwrap(), b"backup-s2");
        assert_eq!(files::fingerprint(&local.join("states/s2.p2s")).unwrap().mtime_ms, files::system_time_ms(old));
        // Labels come along.
        let merged = manifest::read_manifest(&local).unwrap();
        assert_eq!(merged.entries["states/s1.p2s"].label.as_deref(), Some("Before Yunalesca"));
        let _ = fs::remove_dir_all(dir);
    }
}
