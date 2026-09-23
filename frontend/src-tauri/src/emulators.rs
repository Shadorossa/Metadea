use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::Manager;
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmulatorConfig {
    pub emulator_name: String,
    pub executable_path: String,
    pub launch_args: String,
    pub rom_folder: String,
    pub tracking_mode: String,
    // Extensions (lowercase, no dot) the ROM scanner considers for this
    // platform: always the chosen emulator's compatible list
    // (scan_rom_extensions). Read-only: a value sent by the frontend (or an
    // old custom list still in the database column) is ignored.
    #[serde(default)]
    pub rom_extensions: Vec<String>,
    // Override of the folder the emulator itself writes screenshots to (the
    // SOURCE the capture watcher moves from), for emulators the
    // default_screenshots_dirs table does not know. Empty = auto-detect.
    // Captures always end up in $PICTURES/Metadea/<game>/, which is not
    // configurable.
    #[serde(default)]
    pub screenshots_dir: String,
}

// The per-user folders default_screenshots_dirs needs, resolved by the
// caller (tauri's path resolver in the command, fixed paths in tests).
#[derive(Debug, Default, Clone)]
pub struct UserDirs {
    pub documents: Option<PathBuf>,
    // %APPDATA% on Windows, ~/Library/Application Support on macOS,
    // ~/.local/share on Linux.
    pub data: Option<PathBuf>,
    // The user's Pictures folder.
    pub pictures: Option<PathBuf>,
}

// Where each emulator writes screenshots when screenshots_dir is empty,
// most specific first. These are only ever SOURCES: while a ROM runs,
// folders::emulator_captures moves every new capture out of them into
// $PICTURES/Metadea/<game>/. The portable layout is the folder next to the
// configured executable; the user layout is the emulator's per-user data.
//
// Paths were checked in each emulator's source unless marked (docs) or (?).
// Several emulators resolve a relative folder against the WORKING directory
// (xemu, shadPS4, Snes9x, DeSmuME, RMG); the table assumes it is the exe's.
//
// | Emulator             | Portable (next to the exe)        | User layout                                        |
// |----------------------|-----------------------------------|----------------------------------------------------|
// | Dolphin              | User/ScreenShots/<GameID>/        | <Documents>/Dolphin Emulator/ScreenShots/<GameID>/ (Linux: <data>/dolphin-emu/ScreenShots/) |
// | PCSX2                | snaps/                            | <Documents>/PCSX2/snaps/                           |
// | DuckStation          | screenshots/                      | <Documents>/DuckStation/screenshots/               |
// | melonDS              | screenshots/, then the exe dir itself | <data>/melonDS/screenshots/                    |
// | RetroArch            | screenshots/                      | <data>/RetroArch/screenshots/                      |
// | Citron / Yuzu / Suyu | user/screenshots/                 | <data>/<emulator>/screenshots/                     |
// | Eden / Sudachi       | user/screenshots/                 | <data>/eden|sudachi/screenshots/ (Sudachi: (?), Yuzu layout assumed) |
// | Azahar / Lime3DS / Citra | user/screenshots/             | <data>/Azahar|Lime3DS|Citra/screenshots/ (Azahar also the two older ones it migrates from) |
// | Ryujinx / Ryubing    | portable/screenshots/             | <Pictures>/Ryujinx/                                |
// | Vita3K               | portable/screenshots/<Title>/, screenshots/<Title>/ | — (always next to the exe on Windows) |
// | Xenia / Xenia Canary | screenshots/<TITLEID>/            | — (original Xenia: (?), Canary's layout assumed)   |
// | xemu                 | the exe dir (default "." = working dir) | —                                            |
// | shadPS4              | user/screenshots/                 | <data>/shadPS4/screenshots/                        |
// | PPSSPP               | memstick/PSP/SCREENSHOT/          | <Documents>/PPSSPP/PSP/SCREENSHOT/                 |
// | Cemu / RPCS3         | screenshots/                      | —                                                  |
// | DeSmuME              | Screenshots/                      | —                                                  |
// | Snes9x / Project64   | Screenshots/                      | —                                                  |
// | Mednafen             | snaps/ (docs; base dir = exe dir without MEDNAFEN_HOME/HOME) | —                       |
// | mupen64plus / simple64 | —                               | <data>/Mupen64Plus/screenshot/                     |
// | RMG                  | Screenshots/                      | <data>/RMG/Screenshots/                            |
// | Flycast              | —                                 | <Pictures>/Screenshots/ (Windows' FOLDERID_Screenshots) |
// | mGBA                 | next to the ROM, "<rom stem>-<n>.png": a ROM-folder source (screenshot_sources) |      |
//
// Dolphin's <GameID>, Vita3K's <Title> and Xenia's <TITLEID> subfolders are
// read by the watcher/import (see ScreenshotSource::per_game_subfolders);
// this table stops at the folder that holds them.
pub fn default_screenshots_dirs(emulator_name: &str, executable_path: &str, dirs: &UserDirs) -> Vec<PathBuf> {
    let exe_dir = Path::new(executable_path).parent().filter(|dir| !dir.as_os_str().is_empty());
    let name = emulator_name.to_ascii_lowercase();
    let portable = |relative: &str| exe_dir.map(|dir| dir.join(relative));
    let documents = |relative: &str| dirs.documents.as_ref().map(|dir| dir.join(relative));
    let data = |relative: &str| dirs.data.as_ref().map(|dir| dir.join(relative));
    let pictures = |relative: &str| dirs.pictures.as_ref().map(|dir| dir.join(relative));

    let candidates: Vec<Option<PathBuf>> = if name.contains("dolphin") {
        vec![
            portable("User/ScreenShots"),
            documents("Dolphin Emulator/ScreenShots"),
            data("dolphin-emu/ScreenShots"),
        ]
    } else if name.contains("pcsx2") {
        vec![portable("snaps"), documents("PCSX2/snaps")]
    } else if name.contains("duckstation") {
        vec![portable("screenshots"), documents("DuckStation/screenshots")]
    } else if name.contains("melonds") {
        vec![portable("screenshots"), exe_dir.map(Path::to_path_buf), data("melonDS/screenshots")]
    } else if name.contains("retroarch") {
        vec![portable("screenshots"), data("RetroArch/screenshots")]
    } else if name.contains("citron") || name.contains("yuzu") || name.contains("suyu") {
        let user_data = if name.contains("citron") { "citron/screenshots" }
            else if name.contains("suyu") { "suyu/screenshots" }
            else { "yuzu/screenshots" };
        vec![portable("user/screenshots"), data(user_data)]
    } else if name.contains("ppsspp") {
        vec![portable("memstick/PSP/SCREENSHOT"), documents("PPSSPP/PSP/SCREENSHOT")]
    } else if name.contains("eden") || name.contains("sudachi") {
        let user_data = if name.contains("sudachi") { "sudachi/screenshots" } else { "eden/screenshots" };
        vec![portable("user/screenshots"), data(user_data)]
    } else if name.contains("azahar") {
        vec![
            portable("user/screenshots"),
            data("Azahar/screenshots"),
            data("Lime3DS/screenshots"),
            data("Citra/screenshots"),
        ]
    } else if name.contains("lime3ds") {
        vec![portable("user/screenshots"), data("Lime3DS/screenshots")]
    } else if name.contains("citra") {
        vec![portable("user/screenshots"), data("Citra/screenshots")]
    } else if name.contains("ryujinx") || name.contains("ryubing") {
        vec![portable("portable/screenshots"), pictures("Ryujinx")]
    } else if name.contains("vita3k") {
        vec![portable("portable/screenshots"), portable("screenshots")]
    } else if name.contains("xenia") {
        vec![portable("screenshots")]
    } else if name.contains("xemu") {
        vec![exe_dir.map(Path::to_path_buf)]
    } else if name.contains("shadps4") {
        vec![portable("user/screenshots"), data("shadPS4/screenshots")]
    } else if name.contains("mupen64plus") || name.contains("simple64") {
        vec![data("Mupen64Plus/screenshot")]
    } else if name == "rmg" || name.contains("rosalie") {
        vec![portable("Screenshots"), data("RMG/Screenshots")]
    } else if name.contains("mednafen") {
        vec![portable("snaps")]
    } else if name.contains("flycast") {
        vec![pictures("Screenshots")]
    } else if name.contains("cemu") || name.contains("rpcs3") {
        vec![portable("screenshots")]
    } else if name.contains("desmume") || name.contains("snes9x") || name.contains("project64") {
        vec![portable("Screenshots")]
    } else {
        Vec::new()
    };
    candidates.into_iter().flatten().collect()
}

// One folder the emulator may write captures to. Dolphin files them under
// a per-game subfolder (<GameID>/), so its folders are read one level deep.
// A ROM-folder source (emulators that save captures next to the ROM, see
// saves_captures_next_to_rom) only ever looks at files named after that ROM:
// `name_prefix` is the ROM's file stem, matched by is_rom_capture_name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenshotSource {
    pub dir: PathBuf,
    pub per_game_subfolders: bool,
    pub name_prefix: Option<String>,
}

// Emulators that file captures under one subfolder per game: Dolphin
// (<GameID>/), Vita3K (<Title>/), Xenia Canary (<TITLEID>/).
pub fn captures_in_per_game_subfolders(emulator_name: &str) -> bool {
    let name = emulator_name.to_ascii_lowercase();
    name.contains("dolphin") || name.contains("vita3k") || name.contains("xenia")
}

// mGBA's default screenshot folder is the ROM's own ("<rom stem>-<n>.png",
// mCoreTakeScreenshot); with a screenshot folder set in mGBA the user sets
// the same folder as the override here.
pub fn saves_captures_next_to_rom(emulator_name: &str) -> bool {
    emulator_name.to_ascii_lowercase().contains("mgba")
}

// "Pokemon Emerald (USA)-0.png" for the ROM "Pokemon Emerald (USA).gba": the
// stem, a dash and the emulator's counter, nothing else (case-insensitive).
// Box art or a manual scan next to the ROM ("Pokemon Emerald (USA).png",
// "Pokemon Emerald (USA) - map.png") never matches.
pub fn is_rom_capture_name(file_name: &str, rom_stem: &str) -> bool {
    let Some((stem, _)) = file_name.rsplit_once('.') else { return false };
    if rom_stem.is_empty() || stem.len() <= rom_stem.len() || !stem.is_char_boundary(rom_stem.len()) {
        return false;
    }
    let (head, rest) = stem.split_at(rom_stem.len());
    head.eq_ignore_ascii_case(rom_stem)
        && rest.strip_prefix('-').is_some_and(|counter| !counter.is_empty() && counter.chars().all(|c| c.is_ascii_digit()))
}

// Every folder a platform's emulator may write captures to: the configured
// override alone when there is one, else the whole auto-detected table
// (the capture watcher watches all of them, since a folder the emulator has
// not created yet may appear mid-session; the import filters to the ones
// that exist), plus the ROM's own folder for emulators that save captures
// next to the ROM (only when the ROM being played is known).
pub fn screenshot_sources(config: &EmulatorConfig, dirs: &UserDirs, rom_path: Option<&str>) -> Vec<ScreenshotSource> {
    let per_game_subfolders = captures_in_per_game_subfolders(&config.emulator_name);
    let configured = config.screenshots_dir.trim();
    let mut folders = if configured.is_empty() {
        default_screenshots_dirs(&config.emulator_name, &config.executable_path, dirs)
    } else {
        vec![PathBuf::from(configured)]
    };
    let mut seen = std::collections::HashSet::new();
    folders.retain(|dir| seen.insert(dir.clone()));
    let mut sources: Vec<ScreenshotSource> = folders
        .into_iter()
        .map(|dir| ScreenshotSource { dir, per_game_subfolders, name_prefix: None })
        .collect();
    if configured.is_empty() && saves_captures_next_to_rom(&config.emulator_name) {
        let rom = rom_path.map(Path::new);
        let rom_dir = rom.and_then(Path::parent).filter(|dir| !dir.as_os_str().is_empty());
        let rom_stem = rom.and_then(Path::file_stem).and_then(|stem| stem.to_str()).filter(|stem| !stem.is_empty());
        if let (Some(dir), Some(stem)) = (rom_dir, rom_stem) {
            sources.push(ScreenshotSource { dir: dir.to_path_buf(), per_game_subfolders: false, name_prefix: Some(stem.to_string()) });
        }
    }
    sources
}

pub fn emulator_config_for_platform(
    conn: &rusqlite::Connection,
    platform_id: &str,
) -> Result<Option<EmulatorConfig>, String> {
    conn.query_row(
        "SELECT emulator_name, executable_path, launch_args, rom_folder, screenshots_dir
         FROM emulator_configs WHERE platform_id = ?1",
        [platform_id],
        |r| {
            let emulator_name: String = r.get(0)?;
            Ok(EmulatorConfig {
                rom_extensions: scan_rom_extensions(platform_id, &emulator_name),
                emulator_name,
                executable_path: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                launch_args: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                rom_folder: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                tracking_mode: "process".to_string(),
                screenshots_dir: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            })
        },
    )
    .optional()
    .str_err()
}

// The ROM/disc-image extensions the scanner looks at when no known emulator
// is chosen for the platform. Deliberately narrow (owner's call): a Nintendo DS
// folder holds .sav/.ml1/.ml2 saves and emulator configs next to the .nds
// files, and the only way none of those ever show up as a "game" is to
// never look at them at all.
pub fn default_rom_extensions(platform_id: &str) -> &'static [&'static str] {
    match platform_id {
        "gamecube" => &["rvz", "iso", "gcm", "gcz"],
        "wii" => &["rvz", "iso", "wbfs", "gcz"],
        "ds" => &["nds"],
        "3ds" => &["3ds", "cia", "cci"],
        "wiiu" => &["wud", "wux", "wua", "rpx"],
        "switch" => &["nsp", "xci"],
        "ps1" => &["chd", "cue", "pbp", "iso", "bin", "m3u"],
        "ps2" => &["iso", "chd", "bin", "cue", "cso"],
        "psp" => &["iso", "cso", "chd", "pbp"],
        "ps3" => &["iso"],
        "psvita" => &["vpk"],
        "ps4" | "ps5" => &["iso", "bin"],
        "xbox" => &["iso", "xiso"],
        "xbox360" => &["iso", "xex"],
        "xboxone" | "xboxseriesx" => &["iso", "xex"],
        _ => &[],
    }
}

// What each known emulator opens: a mirror of EMULATORS_DB in
// src/lib/local/emulator-catalog.ts, which Settings › Emulators shows as the
// "Compatible" list. None for an emulator this table does not know.
pub fn emulator_rom_extensions(platform_id: &str, emulator_name: &str) -> Option<&'static [&'static str]> {
    const DOLPHIN: &[&str] = &["elf", "dol", "gcm", "tgc", "ciso", "gcz", "iso", "wad", "dff", "rvz", "m3u"];
    const YUZU_LIKE: &[&str] = &["nso", "nro", "nca", "xci", "nsp"];
    const SHADPS4: &[&str] = &["bin", "iso"];
    const XENIA_EDGE: &[&str] = &["iso", "xex"];
    let extensions: &'static [&'static str] = match (platform_id, emulator_name) {
        ("gamecube" | "wii", "Dolphin") => DOLPHIN,
        ("ds", "melonDS") => &["nds", "zip"],
        ("ds", "DeSmuME") => &["nds", "zip", "7z", "rar", "gz"],
        ("3ds", "Citra") => &["3ds", "3dsx", "cci", "zcci", "cxi", "elf", "cia"],
        ("3ds", "Lime3DS") => &["3ds", "3dsx", "cci", "cxi", "elf", "cia"],
        ("wiiu", "Cemu") => &["wud", "wux", "rpx", "wua"],
        ("switch", "Ryujinx") => &["nsp", "xci"],
        ("switch", "Yuzu" | "Suyu") => YUZU_LIKE,
        ("ps1", "DuckStation") => &["bin", "img", "exe", "chd", "psexe", "m3u", "cue", "pbp", "iso"],
        ("ps1", "ePSXe") => &["bin", "iso", "img", "pbp", "zip", "cue"],
        ("ps1", "PCSXR-PGXP") => &["bin", "cue", "img", "iso"],
        ("ps2", "PCSX2") => &["bin", "chd", "cso", "gz", "img", "iso", "m3u", "mdf", "nrg"],
        ("psp", "PPSSPP") => &["chd", "cso", "iso", "pbp"],
        ("ps3", "RPCS3") => &["bin", "iso"],
        ("psvita", "Vita3K") => &["vpk"],
        ("ps4" | "ps5", "shadPS4") => SHADPS4,
        ("xbox", "Xemu") => &["iso", "xiso"],
        ("xbox360", "Xenia") => &["iso", "xex", "cci", "cxi", "elf", "zar"],
        ("xboxone" | "xboxseriesx", "Xenia Edge") => XENIA_EDGE,
        _ => return None,
    };
    Some(extensions)
}

// The extensions the ROM scanner uses for a platform: the chosen emulator's
// compatible list, or the platform default when no known emulator is set.
// The old per-platform custom list (emulator_configs.rom_extensions) is no
// longer read; the column stays so older databases open unchanged.
pub fn scan_rom_extensions(platform_id: &str, emulator_name: &str) -> Vec<String> {
    emulator_rom_extensions(platform_id, emulator_name)
        .unwrap_or_else(|| default_rom_extensions(platform_id))
        .iter()
        .map(|e| e.to_string())
        .collect()
}

fn emulators_from_db(db: &crate::db::MetadeaDb) -> Result<HashMap<String, EmulatorConfig>, String> {
    let conn = db.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT platform_id, emulator_name, executable_path, launch_args, rom_folder, screenshots_dir
             FROM emulator_configs"
        )
        .str_err()?;
    let mut configs = HashMap::new();
    let rows = stmt
        .query_map([], |r| {
            let platform_id = r.get::<_, String>(0)?;
            let emulator_name: String = r.get(1)?;
            Ok((
                platform_id.clone(),
                EmulatorConfig {
                    rom_extensions: scan_rom_extensions(&platform_id, &emulator_name),
                    emulator_name,
                    executable_path: r.get(2)?,
                    launch_args: r.get(3)?,
                    rom_folder: r.get(4)?,
                    // Retained in the serialized config/database for compatibility,
                    // but monitoring is no longer a user-selectable mode.
                    tracking_mode: "process".to_string(),
                    screenshots_dir: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                },
            ))
        })
        .str_err()?;

    for (platform_id, config) in rows.flatten() {
        configs.insert(platform_id, config);
    }
    Ok(configs)
}

#[tauri::command]
pub async fn read_emulators_config(
    app_handle: tauri::AppHandle,
) -> Result<HashMap<String, EmulatorConfig>, String> {
    let db = app_handle.state::<crate::db::MetadeaDb>();
    emulators_from_db(&db)
}

#[tauri::command]
pub async fn write_emulators_config(
    app_handle: tauri::AppHandle,
    configs: HashMap<String, EmulatorConfig>,
) -> Result<String, String> {
    let db = app_handle.state::<crate::db::MetadeaDb>();
    let mut conn = db.conn.lock().str_err()?;
    let now = chrono::Utc::now().to_rfc3339();
    // Saved as one configuration; a partial write leaves some platforms
    // pointing at the previous emulator and others at the new one.
    let tx = conn.transaction().str_err()?;

    for (platform_id, config) in configs {
        // rom_extensions is derived from the emulator (scan_rom_extensions),
        // so it is not written; an old custom value in the column is left
        // untouched and simply no longer read.
        tx.execute(
            "INSERT INTO emulator_configs (platform_id, emulator_name, executable_path, launch_args, rom_folder, tracking_mode, screenshots_dir, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(platform_id) DO UPDATE SET
                emulator_name = excluded.emulator_name,
                executable_path = excluded.executable_path,
                launch_args = excluded.launch_args,
                rom_folder = excluded.rom_folder,
                tracking_mode = excluded.tracking_mode,
                screenshots_dir = excluded.screenshots_dir,
                updated_at = excluded.updated_at",
            rusqlite::params![
                platform_id,
                config.emulator_name,
                config.executable_path,
                config.launch_args,
                config.rom_folder,
                "process",
                config.screenshots_dir.trim(),
                now
            ],
        )
        .str_err()?;
    }
    tx.commit().str_err()?;
    Ok("ok".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_uses_the_chosen_emulators_compatible_list() {
        assert_eq!(scan_rom_extensions("ds", "melonDS"), vec!["nds", "zip"]);
        assert_eq!(scan_rom_extensions("ps4", "shadPS4"), vec!["bin", "iso"]);
        assert_eq!(scan_rom_extensions("wii", "Dolphin"), scan_rom_extensions("gamecube", "Dolphin"));
    }

    #[test]
    fn scan_falls_back_to_the_platform_default_without_a_known_emulator() {
        assert_eq!(scan_rom_extensions("ds", ""), vec!["nds"]);
        assert_eq!(scan_rom_extensions("ds", "SomeFork"), vec!["nds"]);
        assert!(scan_rom_extensions("unknown", "").is_empty());
    }

    #[test]
    fn a_config_sent_without_rom_extensions_still_deserializes() {
        let config: EmulatorConfig = serde_json::from_str(
            r#"{"emulator_name":"PCSX2","executable_path":"","launch_args":"","rom_folder":"","tracking_mode":"process"}"#,
        ).unwrap();
        assert!(config.rom_extensions.is_empty());
    }

    fn dirs() -> UserDirs {
        UserDirs { documents: Some(PathBuf::from("/docs")), data: Some(PathBuf::from("/data")), pictures: Some(PathBuf::from("/pics")) }
    }

    fn candidates(emulator: &str) -> Vec<String> {
        default_screenshots_dirs(emulator, "/emu/bin/emu.exe", &dirs())
            .iter()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect()
    }

    #[test]
    fn screenshot_dir_table_puts_the_portable_layout_first() {
        assert_eq!(candidates("Dolphin"), vec![
            "/emu/bin/User/ScreenShots", "/docs/Dolphin Emulator/ScreenShots", "/data/dolphin-emu/ScreenShots",
        ]);
        assert_eq!(candidates("PCSX2"), vec!["/emu/bin/snaps", "/docs/PCSX2/snaps"]);
        assert_eq!(candidates("DuckStation"), vec!["/emu/bin/screenshots", "/docs/DuckStation/screenshots"]);
        assert_eq!(candidates("melonDS"), vec!["/emu/bin/screenshots", "/emu/bin", "/data/melonDS/screenshots"]);
        assert_eq!(candidates("RetroArch"), vec!["/emu/bin/screenshots", "/data/RetroArch/screenshots"]);
        assert_eq!(candidates("Citron"), vec!["/emu/bin/user/screenshots", "/data/citron/screenshots"]);
        assert_eq!(candidates("Yuzu"), vec!["/emu/bin/user/screenshots", "/data/yuzu/screenshots"]);
        assert_eq!(candidates("PPSSPP"), vec!["/emu/bin/memstick/PSP/SCREENSHOT", "/docs/PPSSPP/PSP/SCREENSHOT"]);
        assert_eq!(candidates("Cemu"), vec!["/emu/bin/screenshots"]);
    }

    #[test]
    fn screenshot_dir_table_covers_the_remaining_emulators() {
        assert_eq!(candidates("Azahar"), vec![
            "/emu/bin/user/screenshots", "/data/Azahar/screenshots", "/data/Lime3DS/screenshots", "/data/Citra/screenshots",
        ]);
        assert_eq!(candidates("Lime3DS"), vec!["/emu/bin/user/screenshots", "/data/Lime3DS/screenshots"]);
        assert_eq!(candidates("Citra"), vec!["/emu/bin/user/screenshots", "/data/Citra/screenshots"]);
        assert_eq!(candidates("Ryujinx"), vec!["/emu/bin/portable/screenshots", "/pics/Ryujinx"]);
        assert_eq!(candidates("Ryubing"), vec!["/emu/bin/portable/screenshots", "/pics/Ryujinx"]);
        assert_eq!(candidates("Vita3K"), vec!["/emu/bin/portable/screenshots", "/emu/bin/screenshots"]);
        assert_eq!(candidates("Xenia"), vec!["/emu/bin/screenshots"]);
        assert_eq!(candidates("Xenia Edge"), vec!["/emu/bin/screenshots"]);
        assert_eq!(candidates("Xemu"), vec!["/emu/bin"]);
        assert_eq!(candidates("shadPS4"), vec!["/emu/bin/user/screenshots", "/data/shadPS4/screenshots"]);
        assert_eq!(candidates("DeSmuME"), vec!["/emu/bin/Screenshots"]);
        assert_eq!(candidates("Snes9x"), vec!["/emu/bin/Screenshots"]);
        assert_eq!(candidates("Project64"), vec!["/emu/bin/Screenshots"]);
        assert_eq!(candidates("Mednafen"), vec!["/emu/bin/snaps"]);
        assert_eq!(candidates("Flycast"), vec!["/pics/Screenshots"]);
        assert_eq!(candidates("mupen64plus"), vec!["/data/Mupen64Plus/screenshot"]);
        assert_eq!(candidates("simple64"), vec!["/data/Mupen64Plus/screenshot"]);
        assert_eq!(candidates("RMG"), vec!["/emu/bin/Screenshots", "/data/RMG/Screenshots"]);
        assert_eq!(candidates("Eden"), vec!["/emu/bin/user/screenshots", "/data/eden/screenshots"]);
        assert_eq!(candidates("Sudachi"), vec!["/emu/bin/user/screenshots", "/data/sudachi/screenshots"]);
        // mGBA writes next to the ROM (a ROM-folder source), not to a fixed folder.
        assert!(candidates("mGBA").is_empty());
        assert!(candidates("Unknown Emu").is_empty());
    }

    #[test]
    fn per_game_subfolder_emulators() {
        for name in ["Dolphin", "Vita3K", "Xenia", "Xenia Edge"] {
            assert!(captures_in_per_game_subfolders(name), "{name}");
        }
        for name in ["PCSX2", "Ryujinx", "mGBA"] {
            assert!(!captures_in_per_game_subfolders(name), "{name}");
        }
    }

    #[test]
    fn screenshot_dir_table_skips_layouts_whose_base_is_unknown() {
        let none = UserDirs::default();
        assert_eq!(default_screenshots_dirs("Dolphin", "", &none), Vec::<PathBuf>::new());
        assert_eq!(
            default_screenshots_dirs("PCSX2", "/emu/pcsx2.exe", &none),
            vec![PathBuf::from("/emu").join("snaps")],
        );
    }

    #[test]
    fn sources_are_the_override_alone_or_the_whole_detected_table() {
        let mut config = EmulatorConfig {
            emulator_name: "PCSX2".into(), executable_path: "/emu/pcsx2.exe".into(), launch_args: String::new(),
            rom_folder: String::new(), tracking_mode: "process".into(), rom_extensions: vec![],
            screenshots_dir: String::new(),
        };
        let sources = screenshot_sources(&config, &dirs(), None);
        assert_eq!(sources, vec![
            ScreenshotSource { dir: PathBuf::from("/emu").join("snaps"), per_game_subfolders: false, name_prefix: None },
            ScreenshotSource { dir: PathBuf::from("/docs").join("PCSX2/snaps"), per_game_subfolders: false, name_prefix: None },
        ]);

        config.screenshots_dir = "  /custom/shots ".into();
        assert_eq!(screenshot_sources(&config, &dirs(), None), vec![
            ScreenshotSource { dir: PathBuf::from("/custom/shots"), per_game_subfolders: false, name_prefix: None },
        ]);

        config.screenshots_dir.clear();
        config.emulator_name = "Some Unknown Emulator".into();
        assert!(screenshot_sources(&config, &dirs(), None).is_empty());
    }

    #[test]
    fn dolphin_sources_are_read_per_game_subfolder() {
        let config = EmulatorConfig {
            emulator_name: "Dolphin".into(), executable_path: "/emu/Dolphin.exe".into(), launch_args: String::new(),
            rom_folder: String::new(), tracking_mode: "process".into(), rom_extensions: vec![],
            screenshots_dir: String::new(),
        };
        let sources = screenshot_sources(&config, &dirs(), None);
        assert_eq!(sources.len(), 3);
        assert!(sources.iter().all(|source| source.per_game_subfolders));
    }

    #[test]
    fn rom_capture_names_are_the_stem_a_dash_and_a_counter() {
        assert!(is_rom_capture_name("Pokemon Emerald (USA)-0.png", "Pokemon Emerald (USA)"));
        assert!(is_rom_capture_name("POKEMON EMERALD (USA)-17.PNG", "Pokemon Emerald (USA)"));
        assert!(!is_rom_capture_name("Pokemon Emerald (USA).png", "Pokemon Emerald (USA)"));
        assert!(!is_rom_capture_name("Pokemon Emerald (USA)-.png", "Pokemon Emerald (USA)"));
        assert!(!is_rom_capture_name("Pokemon Emerald (USA) - map.png", "Pokemon Emerald (USA)"));
        assert!(!is_rom_capture_name("Pokemon Emerald (USA)-0-edit.png", "Pokemon Emerald (USA)"));
        assert!(!is_rom_capture_name("Pokemon Ruby (USA)-0.png", "Pokemon Emerald (USA)"));
        assert!(!is_rom_capture_name("Pokémon-0.png", "Pokém"));
        assert!(!is_rom_capture_name("anything-0.png", ""));
    }

    #[test]
    fn mgba_adds_the_roms_own_folder_filtered_to_that_rom() {
        let mut config = EmulatorConfig {
            emulator_name: "mGBA".into(), executable_path: "/emu/mGBA/mGBA.exe".into(), launch_args: String::new(),
            rom_folder: String::new(), tracking_mode: "process".into(), rom_extensions: vec![],
            screenshots_dir: String::new(),
        };
        let rom_source = ScreenshotSource {
            dir: PathBuf::from("/roms/gba"), per_game_subfolders: false, name_prefix: Some("Pokemon Emerald (USA)".into()),
        };
        let sources = screenshot_sources(&config, &dirs(), Some("/roms/gba/Pokemon Emerald (USA).gba"));
        assert_eq!(sources.last(), Some(&rom_source));
        assert!(sources[..sources.len() - 1].iter().all(|source| source.name_prefix.is_none()));

        // Without the ROM (settings, import of an unknown game) there is no
        // ROM-folder source; an override replaces it like every other.
        assert!(screenshot_sources(&config, &dirs(), None).iter().all(|source| source.name_prefix.is_none()));
        config.screenshots_dir = "/shots".into();
        assert_eq!(screenshot_sources(&config, &dirs(), Some("/roms/gba/Pokemon Emerald (USA).gba")), vec![
            ScreenshotSource { dir: PathBuf::from("/shots"), per_game_subfolders: false, name_prefix: None },
        ]);

        // Other emulators never get one.
        config.screenshots_dir.clear();
        config.emulator_name = "PCSX2".into();
        assert!(screenshot_sources(&config, &dirs(), Some("/roms/ps2/Game.iso")).iter().all(|source| source.name_prefix.is_none()));
    }

    #[test]
    fn melonds_sources_do_not_repeat_a_folder() {
        let config = EmulatorConfig {
            emulator_name: "melonDS".into(), executable_path: "/data/melonDS/screenshots/melonDS.exe".into(),
            launch_args: String::new(), rom_folder: String::new(), tracking_mode: "process".into(),
            rom_extensions: vec![], screenshots_dir: String::new(),
        };
        let dirs: Vec<_> = screenshot_sources(&config, &dirs(), None).into_iter().map(|source| source.dir).collect();
        let unique: std::collections::HashSet<_> = dirs.iter().collect();
        assert_eq!(unique.len(), dirs.len());
    }
}
