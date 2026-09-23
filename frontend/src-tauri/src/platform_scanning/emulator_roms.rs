// ROM folders configured per emulator platform (emulator_configs table),
// flattened into scan_all_games' LocalGame list. The actual walk, the
// per-platform extension filter and the Switch update/DLC grouping live in
// rom_library.rs — only a game's BASE file becomes a card here, so a Switch
// title with an update and two DLC dumps is still one entry.

use super::common::LocalGame;
use super::rom_library::{rom_folder_configs, scan_rom_games, RomFolderConfig, RomGame};

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

// `name` stays the raw file stem: the frontend's rom-name-parser turns it
// into the clean title for display and IGDB matching, and local_games_seen
// keeps whatever was scanned. app_id is the same synthetic id the typed
// scan reports, so links/covers keyed by it resolve from either path. A
// multi-disc set is named without its disc tag (so IGDB matches the game,
// not "Disc 1") and carries its discs and playlist.
fn to_local_game(game: RomGame) -> LocalGame {
    use super::common::synthetic_app_id;
    let replaced_app_ids = game.replaced_paths.iter().map(|path| synthetic_app_id("rom", path)).collect();
    LocalGame {
        name: game.title_stem.clone().unwrap_or_else(|| game.base.stem.clone()),
        discs: if game.discs.len() > 1 { game.discs.iter().map(|d| d.path.clone()).collect() } else { Vec::new() },
        disc_playlist: game.playlist,
        replaced_app_ids,
        launcher: company_for_platform(&game.platform_id).to_string(),
        app_id: Some(game.app_id),
        external_id: None,
        install_path: Some(game.base.path),
        playtime_minutes: None,
        last_played: None,
        installed: Some(true),
        rom_platform: Some(game.platform_id),
    }
}

// Every configured emulator (see emulators::EmulatorConfig) whose rom_folder
// is set gets scanned for files matching that platform's ROM extensions —
// each base game becomes its own LocalGame grouped under the console's
// company-level launcher (company_for_platform) so it shows up in Local >
// Videojuegos next to that platform's Steam/Epic/... installs.
pub(super) fn scan_emulator_roms(conn: &rusqlite::Connection) -> Vec<LocalGame> {
    scan_rom_folders(&emulator_rom_folders(conn))
}

// The cheap DB half of scan_emulator_roms, so scan_all_games can drop the
// connection lock before the directory walk.
pub(super) fn emulator_rom_folders(conn: &rusqlite::Connection) -> Vec<RomFolderConfig> {
    rom_folder_configs(conn)
}

pub(super) fn scan_rom_folders(folders: &[RomFolderConfig]) -> Vec<LocalGame> {
    scan_rom_games(folders).into_iter().map(to_local_game).collect()
}
