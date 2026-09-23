// The typed ROM library scan behind Local's emulated-game cards and the
// automatic file clean-up (rom_rename.rs). Walks every configured ROM
// folder (emulator_configs), looking only at that platform's rom_extensions,
// skipping the emulator's own directory subtree, dotfiles and temp files,
// and groups Switch update/DLC dumps under their base game by title id so
// a game never shows up as three cards. emulator_roms.rs flattens the
// result into scan_all_games' LocalGame list.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::common::synthetic_app_id;
use super::rom_header::{read_rom_header, RomHeader};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RomFolderConfig {
    pub platform_id: String,
    pub rom_folder: String,
    pub executable_path: String,
    pub rom_extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RomFile {
    pub path: String,
    pub file_name: String,
    pub stem: String,
    pub extension: String,
    // Switch only: the 16-hex title id in the file name, and the kind it
    // implies ("base" / "update" / "dlc").
    pub title_id: Option<String>,
    pub kind: String,
    // Same-stem companions (.sav, .ml1, save states...) renamed together
    // with the ROM by the clean-up.
    pub sidecars: Vec<String>,
    pub header_id: Option<String>,
    pub header_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RomGame {
    pub platform_id: String,
    pub app_id: String,
    pub base: RomFile,
    pub updates: Vec<RomFile>,
    pub dlc: Vec<RomFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RomScanResult {
    pub games: Vec<RomGame>,
    pub folders: Vec<RomFolderConfig>,
}

const SIDECAR_EXTENSIONS: &[&str] = &["sav", "ml1", "ml2", "srm", "cht", "ips"];

pub fn is_sidecar_extension(ext: &str) -> bool {
    let ext = ext.to_ascii_lowercase();
    SIDECAR_EXTENSIONS.contains(&ext.as_str()) || ext.starts_with("state")
}

// (platform_id, rom_folder, emulator exe, extensions) for every configured
// emulator with a folder — the cheap DB half, so the directory walk can run
// with the connection lock released.
pub(crate) fn rom_folder_configs(conn: &rusqlite::Connection) -> Vec<RomFolderConfig> {
    let mut stmt = match conn.prepare(
        "SELECT platform_id, rom_folder, executable_path, rom_extensions FROM emulator_configs
         WHERE rom_folder IS NOT NULL AND rom_folder != ''",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |r| {
        let platform_id: String = r.get(0)?;
        let stored: Option<String> = r.get(3)?;
        Ok(RomFolderConfig {
            rom_extensions: crate::emulators::effective_rom_extensions(&platform_id, stored.as_deref().unwrap_or("")),
            platform_id,
            rom_folder: r.get(1)?,
            executable_path: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
        })
    });
    match rows {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => Vec::new(),
    }
}

// The directory whose whole subtree the scanner ignores: where the
// configured emulator executable lives (Dolphin-x64/, MelonDs/...). Never
// the ROM folder itself — that would hide the entire library.
pub fn emulator_dir(cfg: &RomFolderConfig) -> Option<PathBuf> {
    if cfg.executable_path.is_empty() {
        return None;
    }
    let dir = Path::new(&cfg.executable_path).parent()?.to_path_buf();
    let root = Path::new(&cfg.rom_folder);
    if same_path(&dir, root) { None } else { Some(dir) }
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

pub fn is_within(path: &Path, ancestor: &Path) -> bool {
    match (path.canonicalize(), ancestor.canonicalize()) {
        (Ok(p), Ok(a)) => p.starts_with(a),
        _ => path.starts_with(ancestor),
    }
}

fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.') || name.starts_with(".xdp-") || name.ends_with(".tmp") || name.ends_with(".part")
}

// One directory: the ROM files it holds (by extension) with their
// same-stem sidecars attached.
fn rom_files_in_dir(dir: &Path, extensions: &[String], out: &mut Vec<RomFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut roms: Vec<PathBuf> = Vec::new();
    let mut others: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if is_ignored_name(name) {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_ascii_lowercase();
        if extensions.contains(&ext) {
            roms.push(path);
        } else if is_sidecar_extension(&ext) {
            others.entry(stem).or_default().push(path);
        }
    }
    roms.sort();
    for path in roms {
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
        let sidecars = others
            .get(&stem.to_ascii_lowercase())
            .map(|list| list.iter().map(|p| p.to_string_lossy().to_string()).collect())
            .unwrap_or_default();
        let (title_id, kind) = switch_title_id_and_kind(&stem);
        out.push(RomFile {
            path: path.to_string_lossy().to_string(),
            file_name: path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string(),
            extension: path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_string(),
            stem,
            title_id,
            kind,
            sidecars,
            header_id: None,
            header_title: None,
        });
    }
}

// Top-level files plus one level of subfolders (a collection that keeps
// each game in its own folder) — the same bounded depth the scanner has
// always used, so a huge drive is never walked unbounded.
pub fn scan_rom_folder_files(cfg: &RomFolderConfig) -> Vec<RomFile> {
    let root = Path::new(&cfg.rom_folder);
    let mut files = Vec::new();
    if !root.is_dir() || cfg.rom_extensions.is_empty() {
        return files;
    }
    let skip_dir = emulator_dir(cfg);
    let skipped = |dir: &Path| skip_dir.as_ref().is_some_and(|s| is_within(dir, s));
    if !skipped(root) {
        rom_files_in_dir(root, &cfg.rom_extensions, &mut files);
    }
    if let Ok(entries) = std::fs::read_dir(root) {
        let mut subdirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        subdirs.sort();
        for sub in subdirs {
            let name = sub.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            if is_ignored_name(name) || skipped(&sub) {
                continue;
            }
            rom_files_in_dir(&sub, &cfg.rom_extensions, &mut files);
        }
    }
    files
}

// "[010055D009F78000]" anywhere in the stem, plus the kind the Switch
// title id suffix implies (…000 base, …800 update, anything else DLC),
// overridden by an explicit [Base]/[UPD]/[Update]/[DLC] tag.
pub fn switch_title_id_and_kind(stem: &str) -> (Option<String>, String) {
    let bytes = stem.as_bytes();
    let mut title_id = None;
    let mut i = 0;
    while i + 18 <= bytes.len() {
        if bytes[i] == b'[' && bytes[i + 17] == b']' && bytes[i + 1..i + 17].iter().all(|b| b.is_ascii_hexdigit()) {
            title_id = Some(stem[i + 1..i + 17].to_ascii_uppercase());
            break;
        }
        i += 1;
    }
    let lower = stem.to_ascii_lowercase();
    let kind = if lower.contains("[base]") {
        "base"
    } else if lower.contains("[dlc]") {
        "dlc"
    } else if lower.contains("[upd]") || lower.contains("[update]") {
        "update"
    } else {
        match title_id.as_deref().map(|id| &id[13..]) {
            Some("000") | None => "base",
            Some("800") => "update",
            Some(_) => "dlc",
        }
    };
    (title_id, kind.to_string())
}

// The base game's title id for any Switch title id: updates are base +
// 0x800, DLC ids are base + 0x1000 + n (so the 13-hex prefix differs from
// the base by one).
pub fn switch_base_title_id(title_id: &str, kind: &str) -> String {
    let Ok(id) = u64::from_str_radix(title_id, 16) else { return title_id.to_string() };
    let base = match kind {
        "dlc" => (id.saturating_sub(0x1000)) & !0xFFF,
        _ => id & !0xFFF,
    };
    format!("{base:016X}")
}

pub fn group_rom_files(platform_id: &str, files: Vec<RomFile>) -> Vec<RomGame> {
    let mut games: Vec<RomGame> = Vec::new();
    let mut by_base_id: HashMap<String, usize> = HashMap::new();
    let mut seen_stems: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut orphans: Vec<RomFile> = Vec::new();

    let make_game = |file: RomFile| RomGame {
        platform_id: platform_id.to_string(),
        app_id: synthetic_app_id("rom", &file.path),
        base: file,
        updates: Vec::new(),
        dlc: Vec::new(),
    };

    for file in files {
        let Some(title_id) = file.title_id.clone().filter(|_| platform_id == "switch") else {
            // A dump collection commonly has the same game twice ("Game.3ds"
            // and "Game.cia") — keep the first per stem.
            if seen_stems.insert(file.stem.trim().to_ascii_lowercase()) {
                games.push(make_game(file));
            }
            continue;
        };
        let base_id = switch_base_title_id(&title_id, &file.kind);
        if file.kind == "base" {
            if let Some(&idx) = by_base_id.get(&base_id) {
                if games[idx].base.kind != "base" {
                    // An update/DLC arrived before its base: promote.
                    let previous = std::mem::replace(&mut games[idx].base, file);
                    games[idx].app_id = synthetic_app_id("rom", &games[idx].base.path);
                    if previous.kind == "update" { games[idx].updates.push(previous) } else { games[idx].dlc.push(previous) }
                }
                continue;
            }
            by_base_id.insert(base_id, games.len());
            games.push(make_game(file));
        } else if let Some(&idx) = by_base_id.get(&base_id) {
            if file.kind == "update" { games[idx].updates.push(file) } else { games[idx].dlc.push(file) }
        } else {
            orphans.push(file);
        }
    }
    // Updates/DLC whose base never showed up in this folder: still listed,
    // never silently dropped (an orphan update is still a playable file
    // the user put there on purpose).
    for file in orphans {
        let base_id = switch_base_title_id(&file.title_id.clone().unwrap_or_default(), &file.kind);
        match by_base_id.get(&base_id) {
            Some(&idx) => {
                if file.kind == "update" { games[idx].updates.push(file) } else { games[idx].dlc.push(file) }
            }
            None => {
                by_base_id.insert(base_id, games.len());
                games.push(make_game(file));
            }
        }
    }
    games
}

// ── ROM header cache ──────────────────────────────────────────────────────────
// read_rom_header opens every base ROM on every scan (a few hundred bytes at
// fixed offsets, but one file open per ROM — on a NAS or a spinning drive
// that dominates the scan). The header of a dump never changes unless the
// file itself does, so it's memoised per path keyed by (size, mtime) and
// persisted as JSON next to the metadata index
// (<app_data>/metadata/rom_headers.json — see set_rom_header_cache_path) so
// the very next app session benefits too. A file whose size/mtime moved is
// simply re-read.

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct CachedRomHeader {
    pub size: u64,
    pub mtime: u128,
    pub game_id: Option<String>,
    pub title: Option<String>,
    pub format: Option<String>,
}

fn static_rom_format(format: &str) -> &'static str {
    match format {
        "wii" => "wii",
        "gamecube" => "gamecube",
        "nds" => "nds",
        "3ds" => "3ds",
        _ => "unknown",
    }
}

#[derive(Default)]
pub(crate) struct RomHeaderCache {
    pub entries: HashMap<String, CachedRomHeader>,
    pub dirty: bool,
}

impl RomHeaderCache {
    pub(crate) fn from_json(json: &str) -> Self {
        Self { entries: serde_json::from_str(json).unwrap_or_default(), dirty: false }
    }

    pub(crate) fn to_json(&self) -> String {
        serde_json::to_string(&self.entries).unwrap_or_else(|_| "{}".to_string())
    }

    // The memoised header when (size, mtime) still match, else a fresh
    // `read` whose result (hit or miss) is memoised for next time.
    pub(crate) fn header_for(&mut self, path: &Path, read: impl FnOnce(&Path) -> Option<RomHeader>) -> Option<RomHeader> {
        let key = path.to_string_lossy().to_string();
        let (size, mtime) = match std::fs::metadata(path) {
            Ok(meta) => (
                meta.len(),
                meta.modified().ok().and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0),
            ),
            Err(_) => return read(path),
        };
        if let Some(hit) = self.entries.get(&key) {
            if hit.size == size && hit.mtime == mtime {
                return hit.game_id.clone().map(|game_id| RomHeader {
                    game_id,
                    title: hit.title.clone(),
                    format: static_rom_format(hit.format.as_deref().unwrap_or("")),
                });
            }
        }
        let header = read(path);
        self.entries.insert(key, CachedRomHeader {
            size,
            mtime,
            game_id: header.as_ref().map(|h| h.game_id.clone()),
            title: header.as_ref().and_then(|h| h.title.clone()),
            format: header.as_ref().map(|h| h.format.to_string()),
        });
        self.dirty = true;
        header
    }
}

static ROM_HEADER_CACHE: std::sync::Mutex<Option<(Option<PathBuf>, RomHeaderCache)>> = std::sync::Mutex::new(None);

// Where the cache persists. Loaded lazily on the first scan after it's set;
// a scan that runs before any path is known (scan_rom_library from the
// settings page) still memoises in memory.
pub(crate) fn set_rom_header_cache_path(path: PathBuf) {
    if let Ok(mut guard) = ROM_HEADER_CACHE.lock() {
        match guard.as_mut() {
            Some((current, _)) if current.as_ref() == Some(&path) => {}
            _ => {
                let json = std::fs::read_to_string(&path).unwrap_or_default();
                *guard = Some((Some(path), RomHeaderCache::from_json(&json)));
            }
        }
    }
}

fn with_rom_header_cache<T>(f: impl FnOnce(&mut RomHeaderCache) -> T) -> T {
    let mut guard = ROM_HEADER_CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (path, cache) = guard.get_or_insert_with(|| (None, RomHeaderCache::default()));
    let out = f(cache);
    if cache.dirty {
        if let Some(path) = path {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if std::fs::write(path, cache.to_json()).is_ok() {
                cache.dirty = false;
            }
        }
    }
    out
}

// Cheap change signature for the ROM half of scan_all_games (see
// scan_cache.rs): every configured folder's own listing plus each game
// subfolder's mtime, and the config itself (a changed extension list or
// emulator dir must rescan too).
pub(crate) fn rom_scan_signature(configs: &[RomFolderConfig]) -> Option<String> {
    Some(super::scan_cache::join_signatures(configs.iter().flat_map(|cfg| {
        [
            format!("{}|{}|{}|{}", cfg.platform_id, cfg.rom_folder, cfg.executable_path, cfg.rom_extensions.join(",")),
            super::scan_cache::dir_tree_signature(Path::new(&cfg.rom_folder)),
        ]
    })))
}

pub fn scan_rom_games(configs: &[RomFolderConfig]) -> Vec<RomGame> {
    let mut games = Vec::new();
    for cfg in configs {
        let files = scan_rom_folder_files(cfg);
        let mut grouped = group_rom_files(&cfg.platform_id, files);
        with_rom_header_cache(|cache| {
            for game in &mut grouped {
                if let Some(header) = cache.header_for(Path::new(&game.base.path), read_rom_header) {
                    game.base.header_id = Some(header.game_id);
                    game.base.header_title = header.title;
                }
            }
        });
        games.extend(grouped);
    }
    games
}

#[tauri::command]
pub async fn scan_rom_library(
    local_db: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<RomScanResult, String> {
    use crate::db::ToStringErr;
    let folders = {
        let conn = local_db.conn.lock().str_err()?;
        rom_folder_configs(&conn)
    };
    let scan_folders = folders.clone();
    let games = tokio::task::spawn_blocking(move || scan_rom_games(&scan_folders)).await.str_err()?;
    Ok(RomScanResult { games, folders })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str) -> RomFile {
        let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name).to_string();
        let (title_id, kind) = switch_title_id_and_kind(&stem);
        RomFile {
            path: format!("C:\\Roms\\{name}"),
            file_name: name.to_string(),
            extension: name.rsplit_once('.').map(|(_, e)| e).unwrap_or("").to_string(),
            stem,
            title_id,
            kind,
            sidecars: Vec::new(),
            header_id: None,
            header_title: None,
        }
    }

    #[test]
    fn switch_kind_follows_the_title_id_suffix_or_explicit_tags() {
        assert_eq!(switch_title_id_and_kind("Fire Emblem™꞉ Three Houses [010055D009F78000][v0][Base]"), (Some("010055D009F78000".into()), "base".into()));
        assert_eq!(switch_title_id_and_kind("Pokémon Scarlet [0100A3D008C5C800][v786432][US](nsw2u.com)"), (Some("0100A3D008C5C800".into()), "update".into()));
        assert_eq!(switch_title_id_and_kind("Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001][v0][DLC]"), (Some("0100A3D008C5D001".into()), "dlc".into()));
        assert_eq!(switch_title_id_and_kind("Pokemon Scarlet [0100A3D008C5C000]"), (Some("0100A3D008C5C000".into()), "base".into()));
        assert_eq!(switch_title_id_and_kind("Plain Name"), (None, "base".into()));
    }

    #[test]
    fn base_title_id_is_derived_for_updates_and_dlc() {
        assert_eq!(switch_base_title_id("0100A3D008C5C800", "update"), "0100A3D008C5C000");
        assert_eq!(switch_base_title_id("0100A3D008C5D001", "dlc"), "0100A3D008C5C000");
        assert_eq!(switch_base_title_id("0100A3D008C5C000", "base"), "0100A3D008C5C000");
    }

    #[test]
    fn switch_updates_and_dlc_group_under_their_base_regardless_of_order() {
        let files = vec![
            file("Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001][v0][DLC].nsp"),
            file("Pokémon Scarlet [0100A3D008C5C800][v786432][US](nsw2u.com).nsp"),
            file("Pokemon Scarlet [0100A3D008C5C000].xci"),
            file("Fire Emblem™꞉ Three Houses [010055D009F78000][v0][Base].nsp"),
        ];
        let games = group_rom_files("switch", files);
        assert_eq!(games.len(), 2);
        let scarlet = games.iter().find(|g| g.base.stem.starts_with("Pokemon Scarlet [0100")).unwrap();
        assert_eq!(scarlet.base.kind, "base");
        assert_eq!(scarlet.updates.len(), 1);
        assert_eq!(scarlet.dlc.len(), 1);
        assert_eq!(scarlet.app_id, synthetic_app_id("rom", &scarlet.base.path));
    }

    #[test]
    fn an_orphan_update_is_still_listed() {
        let games = group_rom_files("switch", vec![file("Some Game [0100000000001800][v65536].nsp")]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].base.kind, "update");
    }

    #[test]
    fn non_switch_platforms_dedupe_by_stem_only() {
        let games = group_rom_files("3ds", vec![file("Game.3ds"), file("game.cia"), file("Other.3ds")]);
        assert_eq!(games.iter().map(|g| g.base.file_name.as_str()).collect::<Vec<_>>(), vec!["Game.3ds", "Other.3ds"]);
    }

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("metadea-rom-library-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_uses_only_the_configured_extensions_and_skips_the_emulator_dir() {
        let root = temp_root("ds");
        let emu = root.join("MelonDs");
        std::fs::create_dir_all(&emu).unwrap();
        std::fs::write(emu.join("melonDS.exe"), b"").unwrap();
        std::fs::write(emu.join("bundled.nds"), b"").unwrap();
        std::fs::write(root.join("5288 - Layton.nds"), b"").unwrap();
        std::fs::write(root.join("5288 - Layton.sav"), b"").unwrap();
        std::fs::write(root.join("5288 - Layton.ml1"), b"").unwrap();
        std::fs::write(root.join(".xdp-5288 - Layton.ml1-eKJMoY"), b"").unwrap();
        std::fs::write(root.join("rtc.bin"), b"").unwrap();
        std::fs::write(root.join("melonDS.toml"), b"").unwrap();
        let cfg = RomFolderConfig {
            platform_id: "ds".into(),
            rom_folder: root.to_string_lossy().to_string(),
            executable_path: emu.join("melonDS.exe").to_string_lossy().to_string(),
            rom_extensions: vec!["nds".into()],
        };
        let files = scan_rom_folder_files(&cfg);
        assert_eq!(files.len(), 1, "{files:?}");
        assert_eq!(files[0].file_name, "5288 - Layton.nds");
        assert_eq!(files[0].sidecars.len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn header_cache_rereads_only_when_size_or_mtime_moved() {
        let root = temp_root("headers");
        let rom = root.join("game.nds");
        std::fs::write(&rom, b"x").unwrap();
        let mut cache = RomHeaderCache::default();
        let reads = std::cell::Cell::new(0);
        let reader = |_: &Path| { reads.set(reads.get() + 1); Some(RomHeader { game_id: "BLFS".into(), title: Some("LAYTON".into()), format: "nds" }) };
        assert_eq!(cache.header_for(&rom, reader).unwrap().game_id, "BLFS");
        let hit = cache.header_for(&rom, reader).unwrap();
        assert_eq!((hit.game_id.as_str(), hit.format, hit.title.as_deref()), ("BLFS", "nds", Some("LAYTON")));
        assert_eq!(reads.get(), 1, "an unchanged file is served from the cache");
        assert!(cache.dirty);

        // Round-trips through JSON (the persisted form) with the same answer.
        let mut reloaded = RomHeaderCache::from_json(&cache.to_json());
        assert_eq!(reloaded.header_for(&rom, reader).unwrap().game_id, "BLFS");
        assert_eq!(reads.get(), 1);

        // A miss is memoised too, and a size change invalidates it.
        let other = root.join("other.iso");
        std::fs::write(&other, b"y").unwrap();
        let misses = std::cell::Cell::new(0);
        let miss_reader = |_: &Path| { misses.set(misses.get() + 1); None };
        assert!(reloaded.header_for(&other, miss_reader).is_none());
        assert!(reloaded.header_for(&other, miss_reader).is_none());
        assert_eq!(misses.get(), 1);
        std::fs::write(&other, b"yy longer").unwrap();
        assert!(reloaded.header_for(&other, miss_reader).is_none());
        assert_eq!(misses.get(), 2, "a changed size re-reads the header");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rom_scan_signature_tracks_folder_and_config_changes() {
        let root = temp_root("signature");
        let cfg = RomFolderConfig { platform_id: "ds".into(), rom_folder: root.to_string_lossy().to_string(), executable_path: String::new(), rom_extensions: vec!["nds".into()] };
        let before = rom_scan_signature(std::slice::from_ref(&cfg)).unwrap();
        assert_eq!(before, rom_scan_signature(std::slice::from_ref(&cfg)).unwrap());
        let mut changed = cfg.clone();
        changed.rom_extensions.push("cia".into());
        assert_ne!(before, rom_scan_signature(std::slice::from_ref(&changed)).unwrap());
        std::fs::create_dir_all(root.join("Sub")).unwrap();
        assert_ne!(before, rom_scan_signature(std::slice::from_ref(&cfg)).unwrap());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn emulator_dir_equal_to_the_rom_folder_is_not_skipped() {
        let root = temp_root("same");
        let cfg = RomFolderConfig {
            platform_id: "gamecube".into(),
            rom_folder: root.to_string_lossy().to_string(),
            executable_path: root.join("dolphin.exe").to_string_lossy().to_string(),
            rom_extensions: vec!["iso".into()],
        };
        assert_eq!(emulator_dir(&cfg), None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
