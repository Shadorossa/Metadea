// ROM folders configured per emulator platform (emulator_configs table).

use super::common::{synthetic_app_id, LocalGame};

// Which emulator_configs platform_id values group under which company-level
// launcher for Local's own sidebar (see frontend LAUNCHER_ORDER) — several
// consoles share one company tab (every Nintendo console groups under
// "nintendo", every PlayStation one under "playstation", etc), the same way
// EmulatorsTab.astro's own COMPANIES groups its platform pickers.
fn company_for_platform(platform_id: &str) -> &'static str {
    match platform_id {
        "gamecube" | "ds" | "wii" | "3ds" | "wiiu" | "switch" => "nintendo",
        "ps1" | "ps2" | "psp" | "ps3" | "psvita" | "ps4" | "ps5" => "playstation",
        "xbox" | "xbox360" | "xboxone" | "xboxseriesx" => "xbox",
        _ => "local",
    }
}

// Recognized ROM/disc-image extensions per platform_id — the union of every
// emulator EmulatorsTab.astro's own EMULATORS_DB lists for that platform,
// since one ROM folder isn't tied to exactly one of several possible
// emulators for the same console.
fn rom_extensions_for_platform(platform_id: &str) -> &'static [&'static str] {
    match platform_id {
        "gamecube" | "wii" => &[".elf", ".dol", ".gcm", ".tgc", ".ciso", ".gcz", ".iso", ".wad", ".dff", ".rvz", ".m3u"],
        "ds"                => &[".nds", ".zip", ".7z", ".rar", ".gz"],
        "3ds"               => &[".3ds", ".3dsx", ".cci", ".zcci", ".cxi", ".elf", ".cia"],
        "wiiu"              => &[".wud", ".wux", ".rpx", ".wua"],
        "switch"            => &[".nsp", ".xci", ".nso", ".nro", ".nca"],
        "ps1"               => &[".bin", ".img", ".exe", ".chd", ".psexe", ".m3u", ".cue", ".pbp", ".iso", ".zip"],
        "ps2"               => &[".bin", ".chd", ".cso", ".gz", ".img", ".iso", ".m3u", ".mdf", ".nrg"],
        "psp"               => &[".chd", ".cso", ".iso", ".pbp"],
        "ps3"               => &[".bin", ".iso"],
        "psvita"            => &[".vpk"],
        "ps4" | "ps5"       => &[".bin", ".iso"],
        "xbox"              => &[".iso", ".xiso"],
        "xbox360"           => &[".iso", ".xex", ".cci", ".cxi", ".elf", ".zar"],
        "xboxone" | "xboxseriesx" => &[".iso", ".xex"],
        _ => &[],
    }
}

fn push_if_rom_match(path: &std::path::Path, extensions: &[&str], launcher: &str, platform_id: &str, out: &mut Vec<LocalGame>) {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else { return };
    let ext_lower = format!(".{}", ext.to_lowercase());
    if !extensions.contains(&ext_lower.as_str()) {
        return;
    }
    let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { return };
    let install_path = path.to_string_lossy().to_string();
    out.push(LocalGame {
        name: stem.to_string(),
        launcher: launcher.to_string(),
        app_id: Some(synthetic_app_id("rom", &install_path)),
        external_id: None,
        install_path: Some(install_path),
        playtime_minutes: None,
        last_played: None,
        installed: Some(true),
        rom_platform: Some(platform_id.to_string()),
    });
}

// Top-level files, plus one level into subfolders (some ROM collections
// keep each game in its own subfolder alongside box art/saves/etc) — deep
// enough for how these folders are typically organized without risking a
// slow, unbounded walk of an arbitrarily large drive.
fn scan_rom_folder(folder: &str, extensions: &[&str], platform_id: &str) -> Vec<LocalGame> {
    let mut games = Vec::new();
    let root = std::path::Path::new(folder);
    if !root.is_dir() {
        return games;
    }
    let launcher = company_for_platform(platform_id);

    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                push_if_rom_match(&path, extensions, launcher, platform_id, &mut games);
            } else if path.is_dir() {
                if let Ok(sub_entries) = std::fs::read_dir(&path) {
                    for sub_entry in sub_entries.flatten() {
                        let sub_path = sub_entry.path();
                        if sub_path.is_file() {
                            push_if_rom_match(&sub_path, extensions, launcher, platform_id, &mut games);
                        }
                    }
                }
            }
        }
    }

    // A dump collection commonly has more than one file for the same game
    // (e.g. a "Game.3ds" AND a "Game.cia" side by side) — each valid
    // extension otherwise added its own separate LocalGame with the
    // identical display name. Keep just the first file found per
    // normalized name so it only shows up once.
    let mut seen_names = std::collections::HashSet::new();
    games.retain(|g| seen_names.insert(g.name.trim().to_lowercase()));

    games
}

// Every configured emulator (see emulators::EmulatorConfig) whose rom_folder
// is set gets scanned for files matching that platform's known ROM
// extensions — each match becomes its own LocalGame grouped under the
// console's company-level launcher (company_for_platform) so it shows up in
// Local > Videojuegos next to that platform's Steam/Epic/... installs
// instead of nowhere at all.
pub(super) fn scan_emulator_roms(conn: &rusqlite::Connection) -> Vec<LocalGame> {
    scan_rom_folders(&emulator_rom_folders(conn))
}

// (platform_id, rom_folder) for every configured emulator with a folder —
// the cheap DB half of scan_emulator_roms, so scan_all_games can drop the
// connection lock before the directory walk.
pub(super) fn emulator_rom_folders(conn: &rusqlite::Connection) -> Vec<(String, String)> {
    let mut stmt = match conn.prepare(
        "SELECT platform_id, rom_folder FROM emulator_configs WHERE rom_folder IS NOT NULL AND rom_folder != ''",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = match stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    rows.filter_map(|r| r.ok()).collect()
}

pub(super) fn scan_rom_folders(folders: &[(String, String)]) -> Vec<LocalGame> {
    let mut games = Vec::new();
    for (platform_id, rom_folder) in folders {
        let extensions = rom_extensions_for_platform(platform_id);
        if extensions.is_empty() {
            continue;
        }
        games.extend(scan_rom_folder(rom_folder, extensions, platform_id));
    }
    games
}
