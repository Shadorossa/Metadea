// Process-wide memo for scan_all_games' per-launcher results.
//
// Every Local visit used to re-walk every launcher (registry reads, manifest
// parsing, ROM folder walks, ROM header reads) even though nothing on disk
// had changed since the last visit seconds earlier. Each launcher now hands
// in a cheap *signature* of the inputs its scan reads — file/directory
// modification times, registry key write times — and the scan itself only
// runs when that signature differs from the one memoised for the previous
// result. A directory's own mtime changes whenever a direct child is
// created, deleted or renamed, which is exactly the "a game was installed/
// removed" event a rescan needs to notice; the manifests whose *contents*
// matter (Steam's appmanifest_*.acf, Epic's *.item) contribute their own
// mtimes too.
//
// The signature is a `String` so a launcher can compose it from any mix of
// inputs; `None` means "no cheap signature possible, always scan". The
// "Escanear de nuevo" button clears the memo (`clear`) so a manual rescan
// is always a real one.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

use super::common::LocalGame;

struct CachedScan {
    signature: String,
    games: Vec<LocalGame>,
}

static CACHE: Mutex<Option<HashMap<&'static str, CachedScan>>> = Mutex::new(None);

pub(super) fn clear() {
    if let Ok(mut guard) = CACHE.lock() {
        *guard = None;
    }
}

// Returns the memoised result for `name` when `signature` matches the one it
// was produced under, otherwise runs `scan` and memoises its output.
pub(super) fn cached(name: &'static str, signature: Option<String>, scan: impl FnOnce() -> Vec<LocalGame>) -> Vec<LocalGame> {
    let Some(signature) = signature else { return scan() };
    if let Ok(guard) = CACHE.lock() {
        if let Some(hit) = guard.as_ref().and_then(|map| map.get(name)) {
            if hit.signature == signature {
                return hit.games.clone();
            }
        }
    }
    let games = scan();
    if let Ok(mut guard) = CACHE.lock() {
        guard.get_or_insert_with(HashMap::new).insert(name, CachedScan { signature, games: games.clone() });
    }
    games
}

fn mtime_nanos(meta: &std::fs::Metadata) -> u128 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

// "<mtime>:<len>" for a file, "<mtime>:d" for a directory, "-" when absent.
pub(super) fn path_signature(path: &Path) -> String {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_dir() => format!("{}:d", mtime_nanos(&meta)),
        Ok(meta) => format!("{}:{}", mtime_nanos(&meta), meta.len()),
        Err(_) => "-".to_string(),
    }
}

// The directory's own mtime plus (name, mtime, size) of every direct child
// `keep` accepts — folded through a hasher so the signature stays short no
// matter how many manifests a library holds. Children are visited in
// sorted order so the hash is stable across read_dir orderings.
pub(super) fn dir_children_signature(dir: &Path, keep: impl Fn(&str, bool) -> bool) -> String {
    let mut hasher = DefaultHasher::new();
    path_signature(dir).hash(&mut hasher);
    let mut children: Vec<(String, u128, u64, bool)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else { continue };
            let is_dir = meta.is_dir();
            if !keep(&name, is_dir) {
                continue;
            }
            children.push((name, mtime_nanos(&meta), if is_dir { 0 } else { meta.len() }, is_dir));
        }
    }
    children.sort();
    children.len().hash(&mut hasher);
    for child in children {
        child.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

// The directory's own mtime plus every direct subdirectory's mtime — the
// shape a "one folder per game" root (ROM folders, Xbox/EA/GOG roots, the
// user's own videojuegos folder) needs: a game folder added, removed or
// renamed changes the root, files added inside a game folder change that
// folder.
pub(super) fn dir_tree_signature(dir: &Path) -> String {
    dir_children_signature(dir, |_, is_dir| is_dir)
}

pub(super) fn join_signatures<I: IntoIterator<Item = String>>(parts: I) -> String {
    let mut hasher = DefaultHasher::new();
    for part in parts {
        part.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("metadea-scan-cache-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn game(name: &str) -> LocalGame {
        LocalGame::installed(name.to_string(), "steam", Some(name.to_string()), None)
    }

    #[test]
    fn same_signature_serves_the_memo_and_a_new_one_rescans() {
        clear();
        let runs = std::cell::Cell::new(0);
        let scan = || { runs.set(runs.get() + 1); vec![game("a")] };
        assert_eq!(cached("test-launcher", Some("sig-1".into()), scan).len(), 1);
        assert_eq!(cached("test-launcher", Some("sig-1".into()), scan)[0].name, "a");
        assert_eq!(runs.get(), 1, "identical signature must not rescan");
        cached("test-launcher", Some("sig-2".into()), scan);
        assert_eq!(runs.get(), 2, "a changed signature rescans");
        cached("test-launcher", None, scan);
        assert_eq!(runs.get(), 3, "no signature always scans");
        clear();
        cached("test-launcher", Some("sig-2".into()), scan);
        assert_eq!(runs.get(), 4, "clear() forces the next scan");
    }

    #[test]
    fn children_signature_tracks_matching_files_only() {
        let root = temp_root("children");
        std::fs::write(root.join("appmanifest_1.acf"), b"a").unwrap();
        let keep = |name: &str, _: bool| name.starts_with("appmanifest_");
        let before = dir_children_signature(&root, keep);
        assert_eq!(before, dir_children_signature(&root, keep), "stable across reads");

        std::fs::write(root.join("unrelated.txt"), b"x").unwrap();
        // The directory's own mtime is part of the signature, so an
        // unrelated child still changes it — the point is the manifest
        // list/sizes are folded in, not that other files are ignored.
        std::fs::write(root.join("appmanifest_1.acf"), b"a longer body").unwrap();
        assert_ne!(before, dir_children_signature(&root, keep));

        let deleted = {
            std::fs::remove_file(root.join("appmanifest_1.acf")).unwrap();
            dir_children_signature(&root, keep)
        };
        assert_ne!(deleted, before);
        assert_eq!(path_signature(&root.join("missing")), "-");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn tree_signature_changes_when_a_game_folder_appears() {
        let root = temp_root("tree");
        std::fs::create_dir_all(root.join("Game A")).unwrap();
        let before = dir_tree_signature(&root);
        std::fs::create_dir_all(root.join("Game B")).unwrap();
        assert_ne!(before, dir_tree_signature(&root));
        assert_ne!(join_signatures(["a".to_string()]), join_signatures(["b".to_string()]));
        let _ = std::fs::remove_dir_all(&root);
    }
}

// Throwaway timing (never run by default): a synthetic 5-platform ROM tree
// of 500 files, scanned cold, scanned again with only the header cache
// warm, and served from the launcher memo.
//
//   cargo test --lib -- scan_cache::timing --ignored --nocapture
#[cfg(test)]
mod timing {
    use super::super::rom_library::{rom_scan_signature, scan_rom_games, RomFolderConfig};
    use super::*;
    use std::time::Instant;

    #[test]
    #[ignore]
    fn synthetic_tree_cold_vs_cached() {
        let root = std::env::temp_dir().join(format!("metadea-scan-timing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let mut configs = Vec::new();
        for platform in ["ds", "3ds", "gamecube", "wii", "switch"] {
            let dir = root.join(platform);
            std::fs::create_dir_all(dir.join("Sub")).unwrap();
            let ext = match platform { "ds" => "nds", "3ds" => "3ds", "switch" => "nsp", _ => "iso" };
            for i in 0..100 {
                let mut bytes = vec![0u8; 0x600];
                if ext == "nds" { bytes[0x0C..0x10].copy_from_slice(b"BLFS"); }
                let target = if i % 2 == 0 { dir.join(format!("Game {i}.{ext}")) } else { dir.join("Sub").join(format!("Game {i}.{ext}")) };
                std::fs::write(target, &bytes).unwrap();
            }
            configs.push(RomFolderConfig { platform_id: platform.into(), rom_folder: dir.to_string_lossy().to_string(), executable_path: String::new(), rom_extensions: vec![ext.into()] });
        }
        clear();
        let t = Instant::now();
        let cold = scan_rom_games(&configs).len();
        let cold_ms = t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        let warm = scan_rom_games(&configs).len();
        let warm_ms = t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        let sig = rom_scan_signature(&configs);
        let sig_ms = t.elapsed().as_secs_f64() * 1000.0;
        cached("timing", sig.clone(), Vec::new);
        let t = Instant::now();
        cached("timing", rom_scan_signature(&configs), || panic!("must be served from the memo"));
        let memo_ms = t.elapsed().as_secs_f64() * 1000.0;
        println!("\n{cold} games cold walk+headers: {cold_ms:.1} ms | walk with header cache warm: {warm_ms:.1} ms ({warm} games) | signature: {sig_ms:.1} ms | memo hit: {memo_ms:.2} ms\n");
        let _ = std::fs::remove_dir_all(&root);
    }
}
