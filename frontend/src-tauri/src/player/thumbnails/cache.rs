// On-disk cache of finished seek-bar sprites:
//
//   $APPCACHE/thumbnails/<key>/sheet_0.jpg, sheet_1.jpg, index.json
//
// `<key>` hashes the path, size and modification time, so an edited or
// replaced file gets new thumbnails and the old entry simply ages out.
// `index.json` is written last (via a rename) and marks the entry
// complete; its mtime doubles as the "last used" stamp for the LRU cap.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Total size the cache may grow to before the least recently used
/// entries are removed. Not a setting on purpose.
pub const CACHE_CAP_BYTES: u64 = 500 * 1024 * 1024;
pub const MANIFEST_FILE: &str = "index.json";
const MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailManifest {
    pub version: u32,
    pub duration_secs: f64,
    pub interval_secs: f64,
    pub count: u32,
    pub tile_width: u32,
    pub tile_height: u32,
    pub columns: u32,
    pub rows: u32,
    /// File names inside the entry directory, one per sheet, in order.
    pub sheets: Vec<String>,
    /// Frames that could not be decoded (their tile is left blank).
    #[serde(default)]
    pub missing: Vec<u32>,
}

impl ThumbnailManifest {
    pub fn new(duration_secs: f64, interval_secs: f64, count: u32, tile_width: u32, tile_height: u32) -> Self {
        ThumbnailManifest {
            version: MANIFEST_VERSION,
            duration_secs,
            interval_secs,
            count,
            tile_width,
            tile_height,
            columns: super::plan::SHEET_COLUMNS,
            rows: super::plan::SHEET_ROWS,
            sheets: Vec::new(),
            missing: Vec::new(),
        }
    }
}

/// Stable key for one version of one file.
pub fn cache_key(path: &str, size: u64, modified_nanos: u128) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"metadea-thumbnails-v1\0");
    hasher.update(path.as_bytes());
    hasher.update(b"\0");
    hasher.update(size.to_le_bytes());
    hasher.update(modified_nanos.to_le_bytes());
    let digest = hasher.finalize();
    digest.iter().take(16).map(|byte| format!("{byte:02x}")).collect()
}

/// The key for a local file as it is on disk right now; `None` for
/// anything that is not a readable regular file (network streams, a
/// vanished file).
pub fn cache_key_for_file(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok().filter(|metadata| metadata.is_file())?;
    let modified = metadata.modified().ok()?.duration_since(UNIX_EPOCH).map(|since| since.as_nanos()).unwrap_or(0);
    Some(cache_key(&path.to_string_lossy(), metadata.len(), modified))
}

/// Only plain local paths get thumbnails: a URL (`http://…`, `smb://…`)
/// would mean a second full network read just to seek around.
pub fn is_local_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return false;
    }
    match trimmed.find("://") {
        // A drive letter ("C:/…") never contains "://"; anything else with
        // a scheme is a stream unless it is file://.
        Some(_) => trimmed.to_ascii_lowercase().starts_with("file://"),
        None => true,
    }
}

pub fn entry_dir(root: &Path, key: &str) -> PathBuf {
    root.join(key)
}

/// The complete entry for `key`, if every sheet it lists is present.
pub fn read_manifest(dir: &Path) -> Option<ThumbnailManifest> {
    let text = fs::read_to_string(dir.join(MANIFEST_FILE)).ok()?;
    let manifest: ThumbnailManifest = serde_json::from_str(&text).ok()?;
    if manifest.version != MANIFEST_VERSION || manifest.count == 0 {
        return None;
    }
    manifest.sheets.iter().all(|sheet| dir.join(sheet).is_file()).then_some(manifest)
}

/// Writes the sheets, then the manifest (temp file + rename) so a crash
/// mid-write never leaves an entry that looks complete.
pub fn write_entry(dir: &Path, manifest: &ThumbnailManifest, sheets: &[Vec<u8>]) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    for (name, bytes) in manifest.sheets.iter().zip(sheets) {
        fs::write(dir.join(name), bytes)?;
    }
    let json = serde_json::to_vec(manifest).map_err(io::Error::other)?;
    let temp = dir.join(format!("{MANIFEST_FILE}.tmp"));
    fs::write(&temp, json)?;
    fs::rename(&temp, dir.join(MANIFEST_FILE))
}

/// Marks an entry as just used (the LRU stamp is the manifest's mtime).
pub fn touch(dir: &Path) {
    if let Ok(file) = fs::OpenOptions::new().write(true).open(dir.join(MANIFEST_FILE)) {
        let _ = file.set_modified(SystemTime::now());
    }
}

#[derive(Debug)]
struct EntryInfo {
    dir: PathBuf,
    name: String,
    size: u64,
    last_used: SystemTime,
    complete: bool,
}

fn dir_size(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| entry.metadata().ok())
                .filter(|metadata| metadata.is_file())
                .map(|metadata| metadata.len())
                .sum()
        })
        .unwrap_or(0)
}

fn scan(root: &Path) -> Vec<EntryInfo> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| {
            let dir = entry.path();
            let manifest = fs::metadata(dir.join(MANIFEST_FILE)).ok();
            let last_used = manifest
                .as_ref()
                .and_then(|metadata| metadata.modified().ok())
                .or_else(|| entry.metadata().ok().and_then(|metadata| metadata.modified().ok()))
                .unwrap_or(UNIX_EPOCH);
            EntryInfo {
                name: entry.file_name().to_string_lossy().into_owned(),
                size: dir_size(&dir),
                last_used,
                complete: manifest.is_some(),
                dir,
            }
        })
        .collect()
}

/// Removes least recently used entries until the cache fits in `cap`.
/// `keep` (the entry being written/shown) is never removed. Returns the
/// number of entries removed.
pub fn evict_lru(root: &Path, cap: u64, keep: Option<&str>) -> usize {
    let mut entries = scan(root);
    let mut total: u64 = entries.iter().map(|entry| entry.size).sum();
    if total <= cap {
        return 0;
    }
    entries.sort_by_key(|entry| entry.last_used);
    let mut removed = 0;
    for entry in entries {
        if total <= cap {
            break;
        }
        if keep == Some(entry.name.as_str()) {
            continue;
        }
        if fs::remove_dir_all(&entry.dir).is_ok() {
            total = total.saturating_sub(entry.size);
            removed += 1;
        }
    }
    removed
}

/// Startup pass: drops half-written entries (no manifest — a crash or a
/// kill mid-write) and enforces the cap.
pub fn startup_cleanup(root: &Path, cap: u64) -> usize {
    let mut removed = 0;
    for entry in scan(root).into_iter().filter(|entry| !entry.complete) {
        if fs::remove_dir_all(&entry.dir).is_ok() {
            removed += 1;
        }
    }
    removed + evict_lru(root, cap, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("metadea-thumb-cache-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn make_entry(root: &Path, key: &str, bytes: usize, age_secs: u64) {
        let dir = entry_dir(root, key);
        let mut manifest = ThumbnailManifest::new(100.0, 10.0, 10, 240, 136);
        manifest.sheets = vec!["sheet_0.jpg".into()];
        write_entry(&dir, &manifest, &[vec![0u8; bytes]]).unwrap();
        let stamp = SystemTime::now() - Duration::from_secs(age_secs);
        fs::OpenOptions::new().write(true).open(dir.join(MANIFEST_FILE)).unwrap().set_modified(stamp).unwrap();
    }

    #[test]
    fn key_changes_with_path_size_and_mtime_and_is_stable() {
        let base = cache_key("C:/v/a.mkv", 100, 5);
        assert_eq!(base, cache_key("C:/v/a.mkv", 100, 5));
        assert_eq!(base.len(), 32);
        assert!(base.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(base, cache_key("C:/v/b.mkv", 100, 5));
        assert_ne!(base, cache_key("C:/v/a.mkv", 101, 5));
        assert_ne!(base, cache_key("C:/v/a.mkv", 100, 6));
    }

    #[test]
    fn key_for_file_needs_a_real_file() {
        let root = temp_root("key");
        let file = root.join("clip.mkv");
        fs::write(&file, b"abc").unwrap();
        assert!(cache_key_for_file(&file).is_some());
        assert!(cache_key_for_file(&root).is_none());
        assert!(cache_key_for_file(&root.join("missing.mkv")).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn only_local_paths_get_thumbnails() {
        assert!(is_local_path("C:\\Videos\\a.mkv"));
        assert!(is_local_path("/home/u/a.mkv"));
        assert!(is_local_path("\\\\nas\\share\\a.mkv"));
        assert!(is_local_path("file:///C:/a.mkv"));
        assert!(!is_local_path("https://example.com/a.m3u8"));
        assert!(!is_local_path("smb://nas/a.mkv"));
        assert!(!is_local_path("  "));
    }

    #[test]
    fn manifest_round_trips_and_requires_its_sheets() {
        let root = temp_root("manifest");
        make_entry(&root, "abc", 10, 0);
        let dir = entry_dir(&root, "abc");
        let manifest = read_manifest(&dir).unwrap();
        assert_eq!(manifest.count, 10);
        assert_eq!(manifest.sheets, vec!["sheet_0.jpg".to_string()]);
        fs::remove_file(dir.join("sheet_0.jpg")).unwrap();
        assert!(read_manifest(&dir).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lru_eviction_removes_the_oldest_entries_first_and_spares_keep() {
        let root = temp_root("lru");
        make_entry(&root, "oldest", 1000, 300);
        make_entry(&root, "older", 1000, 200);
        make_entry(&root, "recent", 1000, 10);
        // Manifests add a few hundred bytes each; a 2.5 kB cap fits two.
        let removed = evict_lru(&root, 2500, None);
        assert_eq!(removed, 1);
        assert!(!entry_dir(&root, "oldest").exists());
        assert!(entry_dir(&root, "older").exists());
        assert!(entry_dir(&root, "recent").exists());

        // `keep` survives even when it is the oldest.
        touch(&entry_dir(&root, "recent"));
        let removed = evict_lru(&root, 1200, Some("older"));
        assert_eq!(removed, 1);
        assert!(entry_dir(&root, "older").exists());
        assert!(!entry_dir(&root, "recent").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn startup_cleanup_drops_incomplete_entries() {
        let root = temp_root("startup");
        make_entry(&root, "done", 10, 0);
        let partial = entry_dir(&root, "partial");
        fs::create_dir_all(&partial).unwrap();
        fs::write(partial.join("sheet_0.jpg"), b"x").unwrap();
        assert_eq!(startup_cleanup(&root, CACHE_CAP_BYTES), 1);
        assert!(!partial.exists());
        assert!(entry_dir(&root, "done").exists());
        assert_eq!(startup_cleanup(&root.join("nope"), CACHE_CAP_BYTES), 0);
        let _ = fs::remove_dir_all(&root);
    }
}
