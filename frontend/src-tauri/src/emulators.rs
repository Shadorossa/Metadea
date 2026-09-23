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
    // platform. Empty in the database means "use default_rom_extensions";
    // what the frontend receives is always the effective list.
    #[serde(default)]
    pub rom_extensions: Vec<String>,
    // Where this platform's emulator writes screenshots. Empty means
    // "detect from the executable's layout" (default_screenshots_dirs).
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
}

// Where each emulator writes screenshots when screenshots_dir is empty,
// most specific first; the first candidate that exists on disk wins
// (resolve_screenshots_dir). The portable layout is the folder next to the
// configured executable; the user layout is the emulator's per-user data.
//
// | Emulator            | Portable (next to the exe)   | User layout                                   |
// |---------------------|------------------------------|-----------------------------------------------|
// | Dolphin             | User/ScreenShots/<GameID>/   | <Documents>/Dolphin Emulator/ScreenShots/<GameID>/ (Linux: <data>/dolphin-emu/ScreenShots/) |
// | PCSX2               | snaps/                       | <Documents>/PCSX2/snaps/                      |
// | DuckStation         | screenshots/                 | <Documents>/DuckStation/screenshots/          |
// | melonDS             | screenshots/, then the exe dir itself | <data>/melonDS/screenshots/          |
// | RetroArch           | screenshots/                 | <data>/RetroArch/screenshots/                 |
// | Citron / Yuzu / Suyu| user/screenshots/            | <data>/<emulator>/screenshots/                |
// | PPSSPP              | memstick/PSP/SCREENSHOT/     | <Documents>/PPSSPP/PSP/SCREENSHOT/            |
// | Cemu                | screenshots/                 | —                                             |
// | RPCS3               | screenshots/                 | —                                             |
//
// Dolphin's <GameID> subfolder is joined by the listing (the ROM header's
// game id); this table stops at the folder that holds those subfolders.
pub fn default_screenshots_dirs(emulator_name: &str, executable_path: &str, dirs: &UserDirs) -> Vec<PathBuf> {
    let exe_dir = Path::new(executable_path).parent().filter(|dir| !dir.as_os_str().is_empty());
    let name = emulator_name.to_ascii_lowercase();
    let portable = |relative: &str| exe_dir.map(|dir| dir.join(relative));
    let documents = |relative: &str| dirs.documents.as_ref().map(|dir| dir.join(relative));
    let data = |relative: &str| dirs.data.as_ref().map(|dir| dir.join(relative));

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
    } else if name.contains("cemu") || name.contains("rpcs3") {
        vec![portable("screenshots")]
    } else {
        Vec::new()
    };
    candidates.into_iter().flatten().collect()
}

// The folder to list for a platform: the configured one as-is (the
// listing reports it empty when it does not exist), else the first
// auto-detected candidate present on disk.
pub fn resolve_screenshots_dir(config: &EmulatorConfig, dirs: &UserDirs) -> Option<PathBuf> {
    let configured = config.screenshots_dir.trim();
    if !configured.is_empty() {
        return Some(PathBuf::from(configured));
    }
    default_screenshots_dirs(&config.emulator_name, &config.executable_path, dirs)
        .into_iter()
        .find(|dir| dir.is_dir())
}

pub fn emulator_config_for_platform(
    conn: &rusqlite::Connection,
    platform_id: &str,
) -> Result<Option<EmulatorConfig>, String> {
    conn.query_row(
        "SELECT emulator_name, executable_path, launch_args, rom_folder, rom_extensions, screenshots_dir
         FROM emulator_configs WHERE platform_id = ?1",
        [platform_id],
        |r| {
            let stored_extensions = r.get::<_, Option<String>>(4)?.unwrap_or_default();
            Ok(EmulatorConfig {
                emulator_name: r.get(0)?,
                executable_path: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                launch_args: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                rom_folder: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                tracking_mode: "process".to_string(),
                rom_extensions: effective_rom_extensions(platform_id, &stored_extensions),
                screenshots_dir: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            })
        },
    )
    .optional()
    .str_err()
}

// The ROM/disc-image extensions the scanner looks at when the user has not
// customised the list. Deliberately narrow (owner's call): a Nintendo DS
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

// "  .NSP, xci ;Iso" -> ["nsp", "xci", "iso"]: the settings field is a
// free-form comma list typed by the user.
pub fn normalize_extensions(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for token in raw.split([',', ';', ' ', '\n', '\t']) {
        let ext = token.trim().trim_start_matches('.').to_ascii_lowercase();
        if !ext.is_empty() && !out.contains(&ext) {
            out.push(ext);
        }
    }
    out
}

pub fn effective_rom_extensions(platform_id: &str, stored: &str) -> Vec<String> {
    let custom = normalize_extensions(stored);
    if custom.is_empty() {
        default_rom_extensions(platform_id).iter().map(|e| e.to_string()).collect()
    } else {
        custom
    }
}

fn emulators_from_db(db: &crate::db::MetadeaDb) -> Result<HashMap<String, EmulatorConfig>, String> {
    let conn = db.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT platform_id, emulator_name, executable_path, launch_args, rom_folder, rom_extensions, screenshots_dir
             FROM emulator_configs"
        )
        .str_err()?;
    let mut configs = HashMap::new();
    let rows = stmt
        .query_map([], |r| {
            let platform_id = r.get::<_, String>(0)?;
            let stored_extensions = r.get::<_, Option<String>>(5)?.unwrap_or_default();
            Ok((
                platform_id.clone(),
                EmulatorConfig {
                    emulator_name: r.get(1)?,
                    executable_path: r.get(2)?,
                    launch_args: r.get(3)?,
                    rom_folder: r.get(4)?,
                    // Retained in the serialized config/database for compatibility,
                    // but monitoring is no longer a user-selectable mode.
                    tracking_mode: "process".to_string(),
                    rom_extensions: effective_rom_extensions(&platform_id, &stored_extensions),
                    screenshots_dir: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
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
        // The default list is stored as '' so a future change to the
        // defaults reaches users who never customised theirs.
        let extensions = normalize_extensions(&config.rom_extensions.join(","));
        let stored_extensions = if extensions == default_rom_extensions(&platform_id) {
            String::new()
        } else {
            extensions.join(",")
        };
        tx.execute(
            "INSERT INTO emulator_configs (platform_id, emulator_name, executable_path, launch_args, rom_folder, tracking_mode, rom_extensions, screenshots_dir, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(platform_id) DO UPDATE SET
                emulator_name = excluded.emulator_name,
                executable_path = excluded.executable_path,
                launch_args = excluded.launch_args,
                rom_folder = excluded.rom_folder,
                tracking_mode = excluded.tracking_mode,
                rom_extensions = excluded.rom_extensions,
                screenshots_dir = excluded.screenshots_dir,
                updated_at = excluded.updated_at",
            rusqlite::params![
                platform_id,
                config.emulator_name,
                config.executable_path,
                config.launch_args,
                config.rom_folder,
                "process",
                stored_extensions,
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
    fn normalizes_a_free_form_extension_list() {
        assert_eq!(normalize_extensions("  .NSP, xci ;Iso\n nsp"), vec!["nsp", "xci", "iso"]);
        assert!(normalize_extensions(" , ;").is_empty());
    }

    #[test]
    fn empty_stored_list_falls_back_to_the_platform_default() {
        assert_eq!(effective_rom_extensions("ds", ""), vec!["nds"]);
        assert_eq!(effective_rom_extensions("ds", "nds, zip"), vec!["nds", "zip"]);
        assert!(effective_rom_extensions("unknown", "").is_empty());
    }

    fn dirs() -> UserDirs {
        UserDirs { documents: Some(PathBuf::from("/docs")), data: Some(PathBuf::from("/data")) }
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
        assert!(candidates("Ryujinx").is_empty());
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
    fn resolve_prefers_the_configured_folder_and_else_an_existing_candidate() {
        let temp = std::env::temp_dir().join(format!("metadea-emu-shots-{}", std::process::id()));
        let exe_dir = temp.join("bin");
        std::fs::create_dir_all(exe_dir.join("snaps")).unwrap();
        let exe = exe_dir.join("pcsx2.exe").to_string_lossy().into_owned();
        let mut config = EmulatorConfig {
            emulator_name: "PCSX2".into(), executable_path: exe, launch_args: String::new(),
            rom_folder: String::new(), tracking_mode: "process".into(), rom_extensions: vec![],
            screenshots_dir: String::new(),
        };
        assert_eq!(resolve_screenshots_dir(&config, &UserDirs::default()), Some(exe_dir.join("snaps")));

        config.screenshots_dir = "  /custom/shots ".into();
        assert_eq!(resolve_screenshots_dir(&config, &UserDirs::default()), Some(PathBuf::from("/custom/shots")));

        config.screenshots_dir.clear();
        config.emulator_name = "Ryujinx".into();
        assert_eq!(resolve_screenshots_dir(&config, &UserDirs::default()), None);
        let _ = std::fs::remove_dir_all(&temp);
    }
}
