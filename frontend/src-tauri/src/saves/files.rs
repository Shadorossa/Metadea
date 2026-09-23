//! File operations on save units (a single file, or a whole save folder
//! like PPSSPP's `SAVEDATA/ULUS10041DATA00`): content hashes, copies that
//! keep modification times, and the per-save version history.
//!
//! Nothing here deletes a user's file: replaced central copies move into
//! `.history`, replaced native files get a `.metadea-bak` sibling (folders
//! a copy under the game's `.native-backups`).

use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::layout::{self, HISTORY_DIR};

/// Content hash, latest modification time and total size of a unit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    pub sha256: String,
    pub mtime_ms: i64,
    pub size: u64,
}

pub fn system_time_ms(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(error) => -(error.duration().as_millis() as i64),
    }
}

pub fn ms_to_system_time(ms: i64) -> SystemTime {
    if ms >= 0 {
        UNIX_EPOCH + Duration::from_millis(ms as u64)
    } else {
        UNIX_EPOCH - Duration::from_millis(ms.unsigned_abs())
    }
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Hashes are cached per (path, size, mtime): listing a game's saves
/// re-reads nothing that has not changed since the last listing.
type HashCache = std::collections::HashMap<PathBuf, (u64, SystemTime, String)>;
static HASH_CACHE: std::sync::OnceLock<std::sync::Mutex<HashCache>> = std::sync::OnceLock::new();
const HASH_CACHE_MAX: usize = 20_000;

pub fn hash_file(path: &Path) -> io::Result<String> {
    let metadata = fs::metadata(path)?;
    let modified = metadata.modified()?;
    let cache = HASH_CACHE.get_or_init(Default::default);
    if let Ok(cache) = cache.lock() {
        if let Some((size, mtime, sha)) = cache.get(path) {
            if *size == metadata.len() && *mtime == modified {
                return Ok(sha.clone());
            }
        }
    }
    let sha = hash_file_uncached(path)?;
    if let Ok(mut cache) = cache.lock() {
        if cache.len() >= HASH_CACHE_MAX {
            cache.clear();
        }
        cache.insert(path.to_path_buf(), (metadata.len(), modified, sha.clone()));
    }
    Ok(sha)
}

/// Drops a path from the hash cache (after Metadea itself rewrote it).
pub fn forget_hash(path: &Path) {
    if let Some(cache) = HASH_CACHE.get() {
        if let Ok(mut cache) = cache.lock() {
            cache.remove(path);
        }
    }
}

fn hash_file_uncached(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

fn is_skipped_name(name: &str) -> bool {
    name.ends_with(".tmp") || name.ends_with(".part") || name.ends_with(layout::NATIVE_BACKUP_SUFFIX) || name.ends_with(".metadea-tmp")
}

/// Every file under `dir` (sorted, `/`-relative), skipping temp files and
/// our own backups.
pub fn files_under(dir: &Path) -> Vec<(String, PathBuf)> {
    fn walk(base: &Path, dir: &Path, depth: u32, out: &mut Vec<(String, PathBuf)>) {
        if depth > 16 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_skipped_name(&name) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else { continue };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                walk(base, &path, depth + 1, out);
            } else if file_type.is_file() {
                if let Ok(rel) = path.strip_prefix(base) {
                    out.push((layout::to_slash(rel), path.clone()));
                }
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, 0, &mut out);
    out.sort();
    out
}

/// A file's hash, or for a folder a hash over its files' relative paths
/// and hashes; mtime is the newest file's.
pub fn fingerprint(path: &Path) -> io::Result<Fingerprint> {
    let metadata = fs::metadata(path)?;
    if metadata.is_file() {
        return Ok(Fingerprint {
            sha256: hash_file(path)?,
            mtime_ms: system_time_ms(metadata.modified()?),
            size: metadata.len(),
        });
    }
    let mut hasher = Sha256::new();
    let mut newest = 0i64;
    let mut size = 0u64;
    for (rel, file) in files_under(path) {
        let meta = fs::metadata(&file)?;
        newest = newest.max(system_time_ms(meta.modified()?));
        size += meta.len();
        hasher.update(rel.as_bytes());
        hasher.update([0u8]);
        hasher.update(hash_file(&file)?.as_bytes());
        hasher.update([0u8]);
    }
    Ok(Fingerprint { sha256: hex(&hasher.finalize()), mtime_ms: newest, size })
}

/// Newest modification time under a unit (without hashing).
pub fn newest_mtime(path: &Path) -> Option<SystemTime> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.is_file() {
        return metadata.modified().ok();
    }
    files_under(path).iter().filter_map(|(_, file)| fs::metadata(file).and_then(|m| m.modified()).ok()).max()
}

fn set_mtime(path: &Path, time: SystemTime) {
    if let Ok(file) = fs::File::options().write(true).open(path) {
        let _ = file.set_modified(time);
    }
}

/// Copies one file through a temp name + rename (a crash never leaves a
/// half-written save under the real name), keeping its modification time.
pub fn copy_file_atomic(source: &Path, destination: &Path) -> io::Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let modified = fs::metadata(source)?.modified()?;
    let mut temp_name = destination.file_name().unwrap_or_default().to_os_string();
    temp_name.push(".metadea-tmp");
    let temp = destination.with_file_name(temp_name);
    fs::copy(source, &temp)?;
    set_mtime(&temp, modified);
    if destination.exists() {
        // Windows rename does not replace an existing file.
        fs::remove_file(destination)?;
    }
    forget_hash(destination);
    fs::rename(&temp, destination).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })
}

/// Copies a unit (file or folder). Folders are merged: files are added or
/// overwritten, files only in the destination are left alone.
pub fn copy_unit(source: &Path, destination: &Path) -> io::Result<()> {
    if fs::metadata(source)?.is_file() {
        return copy_file_atomic(source, destination);
    }
    fs::create_dir_all(destination)?;
    for (rel, file) in files_under(source) {
        let target = destination.join(layout::safe_relative(&rel).map_err(io::Error::other)?);
        copy_file_atomic(&file, &target)?;
    }
    Ok(())
}

/// A name under `dir` that does not exist yet: `name`, `name (2)`, …
pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    (2u32..).map(|n| dir.join(format!("{name} ({n})"))).find(|p| !p.exists()).unwrap_or(first)
}

/// `<category>/.history/<rel within category>`: one folder per save, one
/// stamped subfolder per version holding the save under its own name.
pub fn history_dir(game_dir: &Path, rel: &str) -> Option<PathBuf> {
    let (category, inner) = rel.split_once('/')?;
    Some(game_dir.join(category).join(HISTORY_DIR).join(layout::safe_relative(inner).ok()?))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryVersion {
    /// The stamped folder name (`2026-09-23 10-00-00`).
    pub id: String,
    pub path: PathBuf,
}

/// Versions of one save, newest first.
pub fn history_versions(game_dir: &Path, rel: &str) -> Vec<HistoryVersion> {
    let Some(dir) = history_dir(game_dir, rel) else { return Vec::new() };
    let name = rel.rsplit('/').next().unwrap_or(rel).to_string();
    let mut versions: Vec<HistoryVersion> = fs::read_dir(&dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .filter_map(|entry| {
                    let path = entry.path().join(&name);
                    path.exists().then(|| HistoryVersion { id: entry.file_name().to_string_lossy().into_owned(), path })
                })
                .collect()
        })
        .unwrap_or_default();
    versions.sort_by(|a, b| b.id.cmp(&a.id));
    versions
}

/// Moves the central copy of `rel` into its history (stamped with its own
/// modification time) and prunes the history to `keep` versions. Returns
/// the version's path; None when there was nothing to move.
pub fn rotate_into_history(game_dir: &Path, rel: &str, keep: u32) -> io::Result<Option<PathBuf>> {
    let current = game_dir.join(layout::safe_relative(rel).map_err(io::Error::other)?);
    if !current.exists() {
        return Ok(None);
    }
    let dir = history_dir(game_dir, rel).ok_or_else(|| io::Error::other("bad save path"))?;
    fs::create_dir_all(&dir)?;
    let taken_at = newest_mtime(&current).unwrap_or_else(SystemTime::now);
    let version_dir = free_path(&dir, &layout::stamp(taken_at));
    fs::create_dir_all(&version_dir)?;
    let name = current.file_name().ok_or_else(|| io::Error::other("bad save path"))?;
    let target = version_dir.join(name);
    fs::rename(&current, &target)?;
    prune_history(game_dir, rel, keep);
    Ok(Some(target))
}

/// Copies (not moves) the central copy into history, unless the newest
/// version already has the same content. Used before a session that writes
/// straight into the central folder (RetroArch).
pub fn snapshot_into_history(game_dir: &Path, rel: &str, keep: u32) -> io::Result<bool> {
    let current = game_dir.join(layout::safe_relative(rel).map_err(io::Error::other)?);
    if !current.exists() {
        return Ok(false);
    }
    let current_hash = fingerprint(&current)?.sha256;
    if let Some(latest) = history_versions(game_dir, rel).first() {
        if fingerprint(&latest.path).map(|f| f.sha256).ok().as_deref() == Some(current_hash.as_str()) {
            return Ok(false);
        }
    }
    let dir = history_dir(game_dir, rel).ok_or_else(|| io::Error::other("bad save path"))?;
    let taken_at = newest_mtime(&current).unwrap_or_else(SystemTime::now);
    let version_dir = free_path(&dir, &layout::stamp(taken_at));
    let name = current.file_name().ok_or_else(|| io::Error::other("bad save path"))?;
    copy_unit(&current, &version_dir.join(name))?;
    prune_history(game_dir, rel, keep);
    Ok(true)
}

/// Moves `source` (a downloaded file) into the history of `rel` as a
/// version stamped `taken_at`, without touching the current copy.
pub fn add_history_version(game_dir: &Path, rel: &str, source: &Path, taken_at: SystemTime, keep: u32) -> io::Result<PathBuf> {
    let dir = history_dir(game_dir, rel).ok_or_else(|| io::Error::other("bad save path"))?;
    let version_dir = free_path(&dir, &layout::stamp(taken_at));
    fs::create_dir_all(&version_dir)?;
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let target = version_dir.join(name);
    fs::rename(source, &target).or_else(|_| fs::copy(source, &target).map(|_| ()).and_then(|_| fs::remove_file(source)))?;
    prune_history(game_dir, rel, keep);
    Ok(target)
}

/// Keeps the newest `keep` versions. Older ones are removed: they are
/// Metadea's own copies, never the user's only copy of anything.
pub fn prune_history(game_dir: &Path, rel: &str, keep: u32) {
    let versions = history_versions(game_dir, rel);
    for old in versions.iter().skip(keep.max(1) as usize) {
        if let Some(version_dir) = old.path.parent() {
            let _ = fs::remove_dir_all(version_dir);
        }
    }
}

/// Keeps a copy of a native file about to be replaced: `<file>.metadea-bak`
/// next to it, or for a folder a copy under the game's `.native-backups`
/// (a stray folder inside an emulator's save list could confuse it).
pub fn backup_native(native: &Path, game_dir: &Path, rel: &str) -> io::Result<Option<PathBuf>> {
    let Ok(metadata) = fs::metadata(native) else { return Ok(None) };
    if metadata.is_file() {
        let mut name = native.file_name().unwrap_or_default().to_os_string();
        name.push(layout::NATIVE_BACKUP_SUFFIX);
        let backup = native.with_file_name(name);
        fs::copy(native, &backup)?;
        return Ok(Some(backup));
    }
    let stamp = layout::stamp(SystemTime::now());
    let target = free_path(&game_dir.join(layout::NATIVE_BACKUPS_DIR), &stamp).join(layout::safe_relative(rel).map_err(io::Error::other)?);
    copy_unit(native, &target)?;
    Ok(Some(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, bytes: &[u8], mtime_ms: i64) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
        set_mtime(path, ms_to_system_time(mtime_ms));
    }

    #[test]
    fn fingerprints_files_and_folders() {
        let dir = crate::backup::layout::tempdir("saves-fp");
        write(&dir.join("a.sav"), b"one", 1_700_000_000_000);
        let file = fingerprint(&dir.join("a.sav")).unwrap();
        assert_eq!(file.size, 3);
        assert_eq!(file.mtime_ms, 1_700_000_000_000);
        write(&dir.join("folder/x.bin"), b"x", 1_700_000_000_000);
        write(&dir.join("folder/sub/y.bin"), b"y", 1_700_000_100_000);
        write(&dir.join("folder/z.bin.metadea-bak"), b"ignored", 1_800_000_000_000);
        let folder = fingerprint(&dir.join("folder")).unwrap();
        assert_eq!(folder.mtime_ms, 1_700_000_100_000);
        assert_eq!(folder.size, 2);
        fs::write(dir.join("folder/sub/y.bin"), b"Y").unwrap();
        assert_ne!(fingerprint(&dir.join("folder")).unwrap().sha256, folder.sha256);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn copies_keep_modification_times() {
        let dir = crate::backup::layout::tempdir("saves-copy");
        write(&dir.join("src/a.sav"), b"one", 1_700_000_000_000);
        copy_unit(&dir.join("src/a.sav"), &dir.join("dst/a.sav")).unwrap();
        assert_eq!(fingerprint(&dir.join("dst/a.sav")).unwrap(), fingerprint(&dir.join("src/a.sav")).unwrap());
        // Folder copies merge: an extra destination file survives.
        write(&dir.join("dst/folder/extra"), b"keep", 1);
        write(&dir.join("src/folder/data"), b"d", 1_700_000_000_000);
        copy_unit(&dir.join("src/folder"), &dir.join("dst/folder")).unwrap();
        assert!(dir.join("dst/folder/extra").exists());
        assert_eq!(fs::read(dir.join("dst/folder/data")).unwrap(), b"d");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn history_rotates_and_keeps_the_last_n() {
        let game = crate::backup::layout::tempdir("saves-history");
        let rel = "battery/Game.srm";
        for version in 0..7i64 {
            write(&game.join("battery/Game.srm"), format!("v{version}").as_bytes(), 1_700_000_000_000 + version * 60_000);
            let moved = rotate_into_history(&game, rel, 5).unwrap();
            assert!(moved.is_some());
            assert!(!game.join("battery/Game.srm").exists());
        }
        let versions = history_versions(&game, rel);
        assert_eq!(versions.len(), 5);
        assert_eq!(fs::read(&versions[0].path).unwrap(), b"v6");
        assert_eq!(fs::read(&versions[4].path).unwrap(), b"v2");
        assert!(rotate_into_history(&game, rel, 5).unwrap().is_none());

        // Snapshots skip a copy identical to the newest version.
        write(&game.join("battery/Game.srm"), b"v6", 1_700_000_900_000);
        assert!(!snapshot_into_history(&game, rel, 5).unwrap());
        write(&game.join("battery/Game.srm"), b"v7", 1_700_000_960_000);
        assert!(snapshot_into_history(&game, rel, 5).unwrap());
        assert!(game.join("battery/Game.srm").exists());
        assert_eq!(history_versions(&game, rel).len(), 5);
        let _ = fs::remove_dir_all(game);
    }

    #[test]
    fn native_backups_never_touch_the_original() {
        let dir = crate::backup::layout::tempdir("saves-native-bak");
        write(&dir.join("emu/memcards/Game_1.mcd"), b"card", 1_700_000_000_000);
        let backup = backup_native(&dir.join("emu/memcards/Game_1.mcd"), &dir.join("game"), "battery/Game_1.mcd").unwrap().unwrap();
        assert!(backup.ends_with("Game_1.mcd.metadea-bak"));
        assert_eq!(fs::read(dir.join("emu/memcards/Game_1.mcd")).unwrap(), b"card");
        write(&dir.join("emu/SAVEDATA/ULUS10041/DATA.BIN"), b"d", 1_700_000_000_000);
        let folder_backup = backup_native(&dir.join("emu/SAVEDATA/ULUS10041"), &dir.join("game"), "battery/ULUS10041").unwrap().unwrap();
        assert!(folder_backup.join("DATA.BIN").exists());
        assert!(folder_backup.starts_with(dir.join("game").join(layout::NATIVE_BACKUPS_DIR)));
        let _ = fs::remove_dir_all(dir);
    }
}
