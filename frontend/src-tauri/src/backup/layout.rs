//! What a backup contains: everything under the app data directory that
//! cannot be rebuilt, and nothing that can.
//!
//! The rules are an exclusion list on purpose. A new folder of user-authored
//! data (custom images, skins, whatever comes next) is backed up without
//! anyone remembering to add it here; only caches have to be named.

use std::fs;
use std::path::{Path, PathBuf};

/// The live database. It is never copied as-is (a copy of the file plus its
/// WAL taken while the app writes is not a consistent database); the archive
/// carries a `VACUUM INTO` snapshot under this same name instead.
pub const DATABASE_NAME: &str = "metadea.db";

/// Top-level entries left out of every backup, with the reason the manifest
/// records. Keep in sync with `docs/BACKUPS.md`.
pub const EXCLUDED_TOP_LEVEL: &[(&str, &str)] = &[
    // IGDB/Steam metadata, cover cache, comic page cache, continue-watching
    // frames, theme video/preview cache, ROM header cache: all re-downloaded
    // or regenerated on demand.
    ("metadata", "regenerable cache"),
    ("metadea.db", "replaced by a consistent snapshot"),
    ("metadea.db-wal", "live database journal"),
    ("metadea.db-shm", "live database journal"),
    ("metadea.db-journal", "live database journal"),
    ("logs", "logs"),
    ("EBWebView", "webview cache"),
    // Machine-local state: the Drive link's tokens only decrypt for this
    // Windows user, and "last backup" facts describe this install.
    (crate::google_drive::STATE_FILE_NAME, "machine-local state"),
    (super::LOCAL_STATE_FILE_NAME, "machine-local state"),
    (super::MARKER_NAME, "internal"),
    // Emulator saves: "saves/" is where the archive carries the central
    // saves root (added from there, not from here); the saves settings hold
    // this PC's folder path; session files are temporary.
    (crate::saves::backup::ARCHIVE_PREFIX, "reserved for game saves"),
    (crate::saves::SETTINGS_FILE, "machine-local state"),
    (crate::saves::SESSIONS_DIR, "temporary files"),
];

/// Top-level name prefixes left out (copies the migration code keeps next to
/// the database, and restore staging folders).
const EXCLUDED_PREFIXES: &[(&str, &str)] = &[
    ("metadea.db.backup_", "pre-migration database copy"),
    ("metadea-restore-staging-", "internal"),
];

/// File suffixes left out at any depth: partial downloads and temp files.
const EXCLUDED_SUFFIXES: &[&str] = &[".part", ".tmp", ".log"];

/// Entries a restore takes from the install being replaced when the backup
/// does not carry them: caches (so a same-machine restore does not
/// re-download everything) and the machine-local state files.
pub const CARRY_OVER_ON_RESTORE: &[&str] = &[
    "metadata",
    "logs",
    crate::google_drive::STATE_FILE_NAME,
    super::LOCAL_STATE_FILE_NAME,
    crate::saves::SETTINGS_FILE,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFile {
    /// `/`-separated path inside the archive.
    pub archive_path: String,
    pub disk_path: PathBuf,
    pub size: u64,
}

/// Why `relative` (a path under the data dir) is not backed up, if it is not.
pub fn exclusion_reason(relative: &Path) -> Option<&'static str> {
    let first = relative.components().next()?.as_os_str().to_string_lossy().to_string();
    if let Some((_, reason)) = EXCLUDED_TOP_LEVEL.iter().find(|(name, _)| first.eq_ignore_ascii_case(name)) {
        return Some(reason);
    }
    if let Some((_, reason)) = EXCLUDED_PREFIXES.iter().find(|(prefix, _)| first.starts_with(prefix)) {
        return Some(reason);
    }
    let name = relative.file_name()?.to_string_lossy().to_ascii_lowercase();
    if EXCLUDED_SUFFIXES.iter().any(|suffix| name.ends_with(suffix)) {
        return Some("temporary file");
    }
    None
}

/// Walks `data_dir` and returns the files a backup carries (without the
/// database, which the caller adds as a snapshot) plus the excluded paths
/// for the manifest. Symlinks are skipped: a backup never follows a link out
/// of the data directory.
pub fn collect_files(data_dir: &Path) -> Result<(Vec<SourceFile>, Vec<String>), String> {
    let mut files = Vec::new();
    let mut excluded = Vec::new();
    walk(data_dir, data_dir, &mut files, &mut excluded)?;
    files.sort_by(|a, b| a.archive_path.cmp(&b.archive_path));
    excluded.sort();
    Ok((files, excluded))
}

fn walk(root: &Path, current: &Path, files: &mut Vec<SourceFile>, excluded: &mut Vec<String>) -> Result<(), String> {
    let entries = match fs::read_dir(current) {
        Ok(entries) => entries,
        Err(error) if current == root && error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?.to_path_buf();
        let archive_path = relative.to_string_lossy().replace('\\', "/");
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if let Some(reason) = exclusion_reason(&relative) {
            let suffix = if metadata.is_dir() { "/" } else { "" };
            excluded.push(format!("{archive_path}{suffix} ({reason})"));
            continue;
        }
        if metadata.is_dir() {
            walk(root, &path, files, excluded)?;
        } else if metadata.is_file() {
            files.push(SourceFile { archive_path, disk_path: path, size: metadata.len() });
        }
    }
    Ok(())
}

/// A fresh, uniquely named folder under the system temp dir (tests only).
#[cfg(test)]
pub(crate) fn tempdir(tag: &str) -> PathBuf {
    let mut bytes = [0u8; 8];
    getrandom::getrandom(&mut bytes).unwrap();
    let dir = std::env::temp_dir().join(format!("metadea-test-{tag}-{}-{}", std::process::id(), u64::from_le_bytes(bytes)));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_caches_live_database_and_partial_files() {
        for path in [
            "metadata",
            "metadata/1030300/info.json",
            "metadea.db",
            "metadea.db-wal",
            "metadea.db.backup_20260823_124747",
            "user_metadata/custom_image/game/a.webp.part",
            crate::google_drive::STATE_FILE_NAME,
        ] {
            assert!(exclusion_reason(Path::new(path)).is_some(), "{path} should be excluded");
        }
    }

    #[test]
    fn keeps_user_authored_data() {
        for path in [
            "user_metadata/avatar/me.webp",
            "user_metadata/custom_image/game/cover.webp",
            "ui_themes/midnight/theme.json",
            "something_new/notes.txt",
        ] {
            assert_eq!(exclusion_reason(Path::new(path)), None, "{path} should be kept");
        }
    }

    #[test]
    fn collects_files_with_forward_slash_paths() {
        let dir = tempdir("layout-collect");
        fs::create_dir_all(dir.join("user_metadata/avatar")).unwrap();
        fs::create_dir_all(dir.join("metadata/covers")).unwrap();
        fs::write(dir.join("user_metadata/avatar/me.webp"), b"img").unwrap();
        fs::write(dir.join("metadata/covers/x.webp"), b"cache").unwrap();
        fs::write(dir.join("metadea.db"), b"live").unwrap();
        let (files, excluded) = collect_files(&dir).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].archive_path, "user_metadata/avatar/me.webp");
        assert_eq!(files[0].size, 3);
        assert!(excluded.iter().any(|e| e.starts_with("metadata/")));
        assert!(excluded.iter().any(|e| e.starts_with("metadea.db ")));
        let _ = fs::remove_dir_all(dir);
    }
}
