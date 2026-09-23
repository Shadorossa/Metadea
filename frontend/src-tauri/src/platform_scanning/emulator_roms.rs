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
    // Files folded into this entry that are not disc-merge material (Switch
    // update/DLC dumps, an alternate dump of the same ROM, the same file
    // reached through an overlapping ROM folder): each may once have been a
    // card of its own, so its old identity counts as this game from now on.
    let launcher = company_for_platform(&game.platform_id);
    let aliases = game.updates.iter().chain(game.dlc.iter()).map(|file| &file.path)
        .chain(game.alias_paths.iter())
        .map(|path| (launcher.to_string(), synthetic_app_id("rom", path)))
        .chain(game.alias_platforms.iter().map(|platform| (company_for_platform(platform).to_string(), synthetic_app_id("rom", &game.base.path))))
        .collect();
    LocalGame {
        name: game.title_stem.clone().unwrap_or_else(|| game.base.stem.clone()),
        discs: if game.discs.len() > 1 { game.discs.iter().map(|d| d.path.clone()).collect() } else { Vec::new() },
        disc_playlist: game.playlist,
        replaced_app_ids,
        aliases,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform_scanning::rom_library::{group_rom_files, RomFile};
    use crate::platform_scanning::synthetic_app_id;

    fn switch_file(path: &str) -> RomFile {
        let p = std::path::Path::new(path);
        let stem = p.file_stem().unwrap().to_string_lossy().to_string();
        let (title_id, kind) = crate::platform_scanning::rom_library::switch_title_id_and_kind(&stem);
        RomFile { path: path.into(), file_name: p.file_name().unwrap().to_string_lossy().to_string(), stem, extension: "nsp".into(), title_id, kind, ..Default::default() }
    }

    // The owner's Switch folder: the update and DLC dumps used to be cards of
    // their own (rom_66b9…, rom_0ad0… in local_games_seen); grouped under the
    // base game, their old identities must count as that game.
    #[test]
    fn grouped_update_and_dlc_dumps_are_aliases_of_their_base_game() {
        let update = "D:/Switch/Pokémon Scarlet [0100A3D008C5C800][v786432].nsp";
        let dlc = "D:/Switch/Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001].nsp";
        let base = "D:/Switch/Pokemon Scarlet [0100A3D008C5C000].nsp";
        let games = group_rom_files("switch", vec![switch_file(update), switch_file(dlc), switch_file(base)]);
        assert_eq!(games.len(), 1);
        let game = to_local_game(games.into_iter().next().unwrap());
        assert_eq!(game.app_id.as_deref(), Some(synthetic_app_id("rom", base).as_str()));
        assert!(game.aliases.contains(&("nintendo".to_string(), synthetic_app_id("rom", update))));
        assert!(game.aliases.contains(&("nintendo".to_string(), synthetic_app_id("rom", dlc))));
    }
}
