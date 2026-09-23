// The typed ROM library scan behind Local's emulated-game cards and the
// automatic file clean-up (rom_rename.rs). Walks every configured ROM
// folder (emulator_configs), looking only at that platform's rom_extensions
// (the chosen emulator's compatible list, see emulators::scan_rom_extensions)
// minus what is never a game (accepts_rom_file: executables, BIOS/firmware
// dumps, zips outside arcade emulators, tiny .elf stubs), skipping the
// emulator's own directory subtree, BIOS/firmware/system folders, dotfiles
// and temp files,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RomGame {
    pub platform_id: String,
    pub app_id: String,
    pub base: RomFile,
    pub updates: Vec<RomFile>,
    pub dlc: Vec<RomFile>,
    // Multi-disc sets (multi_disc.rs): every disc in boot order, `base`
    // being the first; empty for a single-file game.
    #[serde(default)]
    pub discs: Vec<RomFile>,
    // The set's .m3u (existing or generated), when there is one.
    #[serde(default)]
    pub playlist: Option<String>,
    // A set's name without the disc tag ("Final Fantasy VII (USA)").
    #[serde(default)]
    pub title_stem: Option<String>,
    // Paths that used to be entries of their own and now belong to this
    // one (other discs, absorbed .bin tracks...), for rom_disc_merge.rs.
    #[serde(skip)]
    pub replaced_paths: Vec<String>,
    // Other dumps of this same game dropped by the stem dedupe ("Game.iso"
    // next to "Game.chd"); see emulator_roms.rs's aliases.
    #[serde(skip)]
    pub alias_paths: Vec<String>,
    // Platforms whose (overlapping) ROM folder also reached this very file;
    // the scan keeps it once, under the most specific folder.
    #[serde(skip)]
    pub alias_platforms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RomScanResult {
    pub games: Vec<RomGame>,
    pub folders: Vec<RomFolderConfig>,
}

const SIDECAR_EXTENSIONS: &[&str] = &["sav", "ml1", "ml2", "srm", "cht", "ips"];

const ARCHIVE_EXTENSIONS: &[&str] = &["zip", "7z", "rar"];

fn is_archive_extension(ext: &str) -> bool {
    ARCHIVE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

pub fn is_sidecar_extension(ext: &str) -> bool {
    let ext = ext.to_ascii_lowercase();
    SIDECAR_EXTENSIONS.contains(&ext.as_str()) || ext.starts_with("state")
}

// (platform_id, rom_folder, emulator exe, extensions) for every configured
// emulator with a folder — the cheap DB half, so the directory walk can run
// with the connection lock released.
pub(crate) fn rom_folder_configs(conn: &rusqlite::Connection) -> Vec<RomFolderConfig> {
    let mut stmt = match conn.prepare(
        "SELECT platform_id, rom_folder, executable_path, emulator_name FROM emulator_configs
         WHERE rom_folder IS NOT NULL AND rom_folder != ''",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |r| {
        let platform_id: String = r.get(0)?;
        let emulator_name: Option<String> = r.get(3)?;
        Ok(RomFolderConfig {
            rom_extensions: crate::emulators::scan_rom_extensions(&platform_id, emulator_name.as_deref().unwrap_or("")),
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

// ─── Scan safeguards ─────────────────────────────────────────────────────────
// The compatible lists that drive the scan are what the emulator can OPEN,
// which is broader than what a game dump looks like (.zip, .bin, .exe,
// .elf...). These rules keep the rest out without touching real games.

// Platforms whose games genuinely are Windows/DOS executables. None of the
// consoles in the catalog is (Xbox uses .xbe/.xex, the PS1 .psexe).
const EXECUTABLE_PLATFORMS: &[&str] = &["pc", "dos", "windows"];
const EXECUTABLE_EXTENSIONS: &[&str] = &["exe", "dll", "sys"];

// Arcade platforms, whose ROM sets are always zipped.
const ARCADE_PLATFORMS: &[&str] = &["arcade", "mame", "fbneo", "neogeo", "cps1", "cps2", "cps3"];

// Emulators that launch zipped ROMs directly, by executable name.
const ZIP_LAUNCHING_EMULATORS: &[&str] = &["retroarch", "mame", "fbneo", "fba", "finalburn"];

// Smaller .elf files are loaders/stubs and homebrew test binaries, not games.
const MIN_ELF_BYTES: u64 = 64 * 1024;

// Folder names that hold BIOS/firmware, never games (compared lowercase).
const SYSTEM_FOLDERS: &[&str] = &["bios", "firmware", "system"];

// Exact BIOS/firmware file names (lowercase).
const BIOS_FILE_NAMES: &[&str] = &[
    "dc_boot.bin", "dc_flash.bin", "gba_bios.bin", "bios7.bin", "bios9.bin", "firmware.bin",
    "neogeo.zip", "ps1_rom.bin", "ps2_rom.bin", "pgm.zip", "naomi.zip", "awbios.zip", "skns.zip",
];

pub(crate) fn is_system_folder(name: &str) -> bool {
    SYSTEM_FOLDERS.contains(&name.to_ascii_lowercase().as_str())
}

// scph1001.bin, SCPH-70012.BIN, bios_CD_U.bin, ps2-0230a-20080220.bin,
// syscard3.pce, dc_boot.bin, neogeo.zip...
pub(crate) fn is_bios_file_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if BIOS_FILE_NAMES.contains(&lower.as_str()) {
        return true;
    }
    let (stem, ext) = lower.rsplit_once('.').unwrap_or((lower.as_str(), ""));
    match ext {
        "bin" | "rom" => stem.starts_with("scph") || stem.starts_with("ps2-") || stem.contains("bios"),
        "pce" => stem.starts_with("syscard"),
        _ => false,
    }
}

// Whether the emulator at `executable_path` launches zipped ROMs as they are.
pub(crate) fn launches_zipped_roms(platform_id: &str, executable_path: &str) -> bool {
    if ARCADE_PLATFORMS.contains(&platform_id) {
        return true;
    }
    let exe = Path::new(executable_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    !exe.is_empty() && ZIP_LAUNCHING_EMULATORS.iter().any(|name| exe.contains(name))
}

// The per-file decision on top of the extension list: `ext` lowercase,
// `size` in bytes.
pub(crate) fn accepts_rom_file(platform_id: &str, zipped_roms: bool, name: &str, ext: &str, size: u64) -> bool {
    if EXECUTABLE_EXTENSIONS.contains(&ext) && !EXECUTABLE_PLATFORMS.contains(&platform_id) {
        return false;
    }
    if is_bios_file_name(name) {
        return false;
    }
    match ext {
        "zip" => zipped_roms,
        "elf" => size > MIN_ELF_BYTES,
        _ => true,
    }
}

// One directory: the ROM files it holds (by extension, minus what
// accepts_rom_file rejects) with their same-stem sidecars attached.
fn rom_files_in_dir(dir: &Path, cfg: &RomFolderConfig, zipped_roms: bool, out: &mut Vec<RomFile>) {
    let extensions = &cfg.rom_extensions;
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
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if accepts_rom_file(&cfg.platform_id, zipped_roms, name, &ext, size) {
                roms.push(path);
            }
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
    let zipped_roms = launches_zipped_roms(&cfg.platform_id, &cfg.executable_path);
    if !skipped(root) {
        rom_files_in_dir(root, cfg, zipped_roms, &mut files);
    }
    if let Ok(entries) = std::fs::read_dir(root) {
        let mut subdirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        subdirs.sort();
        for sub in subdirs {
            let name = sub.file_name().and_then(|n| n.to_str()).unwrap_or_default();
            if is_ignored_name(name) || is_system_folder(name) || skipped(&sub) {
                continue;
            }
            rom_files_in_dir(&sub, cfg, zipped_roms, &mut files);
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
    let mut by_stem: HashMap<String, usize> = HashMap::new();
    let mut orphans: Vec<RomFile> = Vec::new();

    let make_game = |file: RomFile| RomGame {
        platform_id: platform_id.to_string(),
        app_id: synthetic_app_id("rom", &file.path),
        base: file,
        updates: Vec::new(),
        dlc: Vec::new(),
        discs: Vec::new(),
        playlist: None,
        title_stem: None,
        replaced_paths: Vec::new(),
        alias_paths: Vec::new(),
        alias_platforms: Vec::new(),
    };

    for file in files {
        let Some(title_id) = file.title_id.clone().filter(|_| platform_id == "switch") else {
            // A dump collection commonly has the same game twice ("Game.3ds"
            // and "Game.cia", "Game.iso" and "Game.chd") — one entry per
            // stem: the first, unless it is an archive and the other is the
            // extracted dump. The dropped file's identity stays an alias.
            let stem_key = file.stem.trim().to_ascii_lowercase();
            match by_stem.get(&stem_key) {
                None => {
                    by_stem.insert(stem_key, games.len());
                    games.push(make_game(file));
                }
                Some(&idx) => {
                    let game = &mut games[idx];
                    if is_archive_extension(&game.base.extension) && !is_archive_extension(&file.extension) {
                        let archive = std::mem::replace(&mut game.base, file);
                        game.app_id = synthetic_app_id("rom", &game.base.path);
                        game.alias_paths.push(archive.path);
                    } else {
                        game.alias_paths.push(file.path);
                    }
                }
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

// One platform's scanned files -> its games: multi-disc sets first (never
// for Switch, whose dumps group by title id), then the regular grouping.
pub fn rom_games_from_files(platform_id: &str, files: Vec<RomFile>, fs: &dyn super::multi_disc::DiscFs) -> Vec<RomGame> {
    if platform_id == "switch" {
        return group_rom_files(platform_id, files);
    }
    let stacked = super::multi_disc::stack_multi_disc(files, fs);
    let mut games = group_rom_files(platform_id, stacked.singles);
    for game in &mut games {
        if let Some(tracks) = stacked.absorbed.get(&game.base.path) {
            game.replaced_paths.extend(tracks.iter().cloned());
        }
    }
    for set in stacked.sets {
        let base = set.discs[0].clone();
        games.push(RomGame {
            platform_id: platform_id.to_string(),
            app_id: synthetic_app_id("rom", &base.path),
            base,
            updates: Vec::new(),
            dlc: Vec::new(),
            discs: set.discs,
            playlist: set.playlist,
            title_stem: Some(set.title_stem),
            replaced_paths: set.replaced,
            alias_paths: Vec::new(),
            alias_platforms: Vec::new(),
        });
    }
    games
}

pub fn scan_rom_games(configs: &[RomFolderConfig]) -> Vec<RomGame> {
    let mut ranked = Vec::new();
    for cfg in configs {
        let files = scan_rom_folder_files(cfg);
        let mut grouped = rom_games_from_files(&cfg.platform_id, files, &super::multi_disc::RealFs);
        let formats: Vec<Option<&'static str>> = with_rom_header_cache(|cache| {
            grouped.iter_mut().map(|game| {
                let header = cache.header_for(Path::new(&game.base.path), read_rom_header)?;
                game.base.header_id = Some(header.game_id);
                game.base.header_title = header.title;
                Some(header.format)
            }).collect()
        });
        for (game, format) in grouped.into_iter().zip(formats) {
            let rank = folder_rank(cfg, &game.base.path, format);
            ranked.push((game, rank));
        }
    }
    dedupe_overlapping_folders(ranked)
}

// How well a configured folder owns a file it reached: the deeper the
// folder the more specific it is (a "Roms" folder configured for one
// platform also reaches "Roms/PS2" configured for another), then whether
// the file's own header names that platform (Dolphin's Wii and GameCube
// entries pointed at one shared folder).
pub(crate) fn folder_rank(cfg: &RomFolderConfig, file_path: &str, header_format: Option<&str>) -> (usize, bool) {
    let folder = super::common::normalized_path(&cfg.rom_folder);
    let depth = if super::common::normalized_path(file_path).starts_with(&format!("{folder}/")) { folder.len() } else { 0 };
    let header_matches = header_format.is_some_and(|format| format == cfg.platform_id || (format == "nds" && cfg.platform_id == "ds"));
    (depth, header_matches)
}

// Overlapping ROM folders (a parent and its subfolder, or one folder set on
// two platforms) reach the same file twice: one entry per file, kept under
// the best-ranked platform, the others recorded as aliases so their old
// identities never come back as ghosts. Order otherwise preserved.
pub(crate) fn dedupe_overlapping_folders(ranked: Vec<(RomGame, (usize, bool))>) -> Vec<RomGame> {
    let mut kept: Vec<(RomGame, (usize, bool))> = Vec::with_capacity(ranked.len());
    let mut by_path: HashMap<String, usize> = HashMap::new();
    for (game, rank) in ranked {
        let key = super::common::normalized_path(&game.base.path);
        let Some(&idx) = by_path.get(&key) else {
            by_path.insert(key, kept.len());
            kept.push((game, rank));
            continue;
        };
        let (current, current_rank) = &mut kept[idx];
        let (mut winner, loser) = if rank > *current_rank {
            *current_rank = rank;
            (game, std::mem::take(current))
        } else {
            (std::mem::take(current), game)
        };
        if loser.platform_id != winner.platform_id && !winner.alias_platforms.contains(&loser.platform_id) {
            winner.alias_platforms.push(loser.platform_id);
        }
        winner.alias_platforms.extend(loser.alias_platforms);
        winner.alias_paths.extend(loser.alias_paths);
        *current = winner;
    }
    kept.into_iter().map(|(game, _)| game).collect()
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
    fn windows_executables_are_never_console_roms() {
        // DuckStation lists .exe (PS-X EXE homebrew), but a Windows binary
        // in a PS1 folder is a tool or a launcher, not a game.
        assert!(!accepts_rom_file("ps1", false, "DuckStation Updater.exe", "exe", 5_000_000));
        assert!(!accepts_rom_file("xbox360", false, "xenia.dll", "dll", 1_000_000));
        assert!(!accepts_rom_file("ps2", false, "driver.sys", "sys", 20_000));
        assert!(accepts_rom_file("xbox360", false, "default.xex", "xex", 9_000_000));
        assert!(accepts_rom_file("ps1", false, "Crash Bandicoot (USA).psexe", "psexe", 900_000));
        assert!(accepts_rom_file("pc", false, "DOOM.EXE", "exe", 700_000));
    }

    #[test]
    fn bios_and_firmware_dumps_are_ignored() {
        for name in [
            "scph1001.bin", "SCPH-70012.BIN", "bios_CD_U.bin", "BIOS.bin", "ps2-0230a-20080220.bin",
            "dc_boot.bin", "dc_flash.bin", "gba_bios.bin", "bios7.bin", "bios9.bin", "firmware.bin",
            "syscard3.pce", "neogeo.zip", "ps1_rom.bin", "sega_101_bios.rom",
        ] {
            assert!(is_bios_file_name(name), "{name}");
            assert!(!accepts_rom_file("ps1", true, name, name.rsplit_once('.').unwrap().1.to_ascii_lowercase().as_str(), 512 * 1024), "{name}");
        }
        for name in ["Crash Bandicoot (USA) (Track 1).bin", "Final Fantasy VII (USA) (Disc 1).bin", "Biohazard (Japan).bin", "Street Fighter Alpha 3.zip"] {
            assert!(!is_bios_file_name(name), "{name}");
        }
        assert!(is_system_folder("BIOS") && is_system_folder("firmware") && is_system_folder("System"));
        assert!(!is_system_folder("Systemic Shock"));
    }

    #[test]
    fn zips_only_for_emulators_that_launch_them() {
        assert!(!launches_zipped_roms("ds", "C:/Emus/melonDS/melonDS.exe"));
        assert!(!launches_zipped_roms("ps1", "C:/Emus/ePSXe/ePSXe.exe"));
        assert!(!launches_zipped_roms("ds", ""));
        assert!(launches_zipped_roms("ds", "C:/Emus/RetroArch-Win64/retroarch.exe"));
        assert!(launches_zipped_roms("arcade", ""));
        assert!(launches_zipped_roms("gba", "D:/mame/mame64.exe"));
        assert!(!accepts_rom_file("ds", false, "Pokemon Platinum (USA).zip", "zip", 60_000_000));
        assert!(accepts_rom_file("ds", true, "Pokemon Platinum (USA).zip", "zip", 60_000_000));
    }

    #[test]
    fn tiny_elf_stubs_are_skipped() {
        assert!(!accepts_rom_file("gamecube", false, "boot.elf", "elf", 12 * 1024));
        assert!(!accepts_rom_file("gamecube", false, "stub.elf", "elf", 64 * 1024));
        assert!(accepts_rom_file("gamecube", false, "Swiss.elf", "elf", 2 * 1024 * 1024));
    }

    #[test]
    fn scan_applies_the_safeguards_on_disk() {
        let root = temp_root("guards");
        let emu = std::env::temp_dir().join("metadea-rom-library-guards-emu");
        std::fs::write(root.join("Crash Bandicoot (USA).cue"), "FILE \"Crash Bandicoot (USA).bin\" BINARY\n  TRACK 01 MODE2/2352\n").unwrap();
        std::fs::write(root.join("Crash Bandicoot (USA).bin"), b"x").unwrap();
        std::fs::write(root.join("scph1001.bin"), b"x").unwrap();
        std::fs::write(root.join("Spyro (USA).zip"), b"x").unwrap();
        std::fs::write(root.join("DuckStation Updater.exe"), b"x").unwrap();
        std::fs::create_dir_all(root.join("BIOS")).unwrap();
        std::fs::write(root.join("BIOS").join("SCPH-5501.bin"), b"x").unwrap();
        std::fs::write(root.join("BIOS").join("Tekken 3 (USA).bin"), b"x").unwrap();
        std::fs::create_dir_all(root.join("Silent Hill (USA)")).unwrap();
        std::fs::write(root.join("Silent Hill (USA)").join("Silent Hill (USA).chd"), b"x").unwrap();
        let cfg = RomFolderConfig {
            platform_id: "ps1".into(),
            rom_folder: root.to_string_lossy().to_string(),
            executable_path: emu.join("duckstation-qt-x64-ReleaseLTCG.exe").to_string_lossy().to_string(),
            rom_extensions: crate::emulators::scan_rom_extensions("ps1", "DuckStation"),
        };
        let files = scan_rom_folder_files(&cfg);
        let mut names: Vec<_> = files.iter().map(|f| f.file_name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["Crash Bandicoot (USA).bin", "Crash Bandicoot (USA).cue", "Silent Hill (USA).chd"]);

        // The .cue claims its .bin: one game, whose file is the .cue.
        let games = rom_games_from_files("ps1", files, &crate::platform_scanning::multi_disc::RealFs);
        let mut bases: Vec<_> = games.iter().map(|g| g.base.file_name.clone()).collect();
        bases.sort();
        assert_eq!(bases, vec!["Crash Bandicoot (USA).cue", "Silent Hill (USA).chd"]);
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

    #[test]
    fn the_same_rom_in_two_formats_is_one_game_and_the_other_stays_an_alias() {
        let games = group_rom_files("ps2", vec![file("Okami.chd"), file("Okami.iso")]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].base.file_name, "Okami.chd");
        assert_eq!(games[0].alias_paths, vec![file("Okami.iso").path]);
    }

    #[test]
    fn an_extracted_dump_wins_over_its_archive() {
        let games = group_rom_files("arcade", vec![file("Metal Slug.7z"), file("Metal Slug.zip"), file("Metal Slug.iso")]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].base.file_name, "Metal Slug.iso");
        assert_eq!(games[0].app_id, synthetic_app_id("rom", &games[0].base.path));
        assert_eq!(games[0].alias_paths.len(), 2);
    }

    #[test]
    fn two_regions_of_one_rom_stay_two_games() {
        let games = group_rom_files("ps2", vec![file("Okami (USA).iso"), file("Okami (Europe).iso")]);
        assert_eq!(games.len(), 2);
    }

    #[test]
    fn overlapping_rom_folders_list_a_file_once_under_the_most_specific_folder() {
        let root = temp_root("overlap");
        let ps2_dir = root.join("PlayStation 2");
        std::fs::create_dir_all(&ps2_dir).unwrap();
        std::fs::write(ps2_dir.join("Okami.iso"), vec![0u8; 16]).unwrap();
        let cfg = |platform: &str, folder: &Path| RomFolderConfig {
            platform_id: platform.into(),
            rom_folder: folder.to_string_lossy().to_string(),
            executable_path: String::new(),
            rom_extensions: vec!["iso".into()],
        };
        // The parent folder configured for PSP also reaches the PS2 folder.
        let games = scan_rom_games(&[cfg("psp", &root), cfg("ps2", &ps2_dir)]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].platform_id, "ps2");
        assert_eq!(games[0].alias_platforms, vec!["psp".to_string()]);
        // One folder set on two platforms: kept once, under the first.
        let games = scan_rom_games(&[cfg("ps2", &ps2_dir), cfg("psp", &ps2_dir)]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].platform_id, "ps2");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_shared_folder_prefers_the_platform_the_header_names() {
        let cfg = |platform: &str| RomFolderConfig {
            platform_id: platform.into(),
            rom_folder: "D:\\Dolphin Games".into(),
            executable_path: String::new(),
            rom_extensions: vec!["rvz".into()],
        };
        let path = "D:\\Dolphin Games\\Fire Emblem - Radiant Dawn.rvz";
        assert!(folder_rank(&cfg("wii"), path, Some("wii")) > folder_rank(&cfg("gamecube"), path, Some("wii")));
        assert!(folder_rank(&cfg("ds"), "D:\\Dolphin Games\\x.nds", Some("nds")).1);
    }
}
