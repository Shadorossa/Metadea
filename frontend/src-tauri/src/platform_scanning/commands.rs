// The commands that run every scanner and reconcile the result with the
// saved links/seen/hidden tables.

use tauri::Manager;
use crate::db::ToStringErr;
use super::common::{apply_game_link, dedupe_scanned_games, game_link_key, LiveGames, LocalGame};
use super::ea::{ea_scan_signature, scan_ea_games};
use super::emulator_roms::{emulator_rom_folders, scan_emulator_roms, scan_rom_folders};
use super::epic::{epic_scan_signature, scan_epic_games};
use super::gog::{gog_scan_signature, scan_gog_games};
use super::local_folders::{local_folder_signature, scan_local_folder, scan_vn_folder};
use super::rom_library::{rom_scan_signature, set_rom_header_cache_path};
use super::scan_cache;
use super::steam_library::{scan_steam_games, steam_scan_signature};
use super::xbox::{scan_xbox_games, xbox_scan_signature};

fn read_local_route(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT path FROM local_routes WHERE key = ?1", [key], |r| r.get(0))
        .ok()
}

// Every launcher's scan, each behind scan_cache (see that module): a Local
// revisit only re-walks the launchers whose inputs actually changed.
// `force` (the "Escanear de nuevo" button) drops every memo first.
fn scan_all_launchers(rom_folders: &[super::rom_library::RomFolderConfig], videojuegos_path: Option<String>, vn_path: Option<String>, force: bool) -> Vec<LocalGame> {
    if force {
        scan_cache::clear();
    }
    let mut all: Vec<LocalGame> = Vec::new();
    all.extend(scan_cache::cached("steam", steam_scan_signature(), scan_steam_games));
    all.extend(scan_cache::cached("epic", epic_scan_signature(), scan_epic_games));
    all.extend(scan_cache::cached("gog", gog_scan_signature(), scan_gog_games));
    all.extend(scan_cache::cached("xbox", xbox_scan_signature(), scan_xbox_games));
    all.extend(scan_cache::cached("ea", ea_scan_signature(), scan_ea_games));
    all.extend(scan_cache::cached("roms", rom_scan_signature(rom_folders), || scan_rom_folders(rom_folders)));
    // The VN folder before the plain videojuegos folder: when both routes
    // reach the same game folder, the entry that knows its executable (and
    // that it is a visual novel) is the one dedupe_scanned_games keeps.
    if let Some(folder) = vn_path.filter(|f| !f.is_empty()) {
        all.extend(scan_cache::cached("vn-folder", local_folder_signature(&folder), || scan_vn_folder(&folder)));
    }
    if let Some(folder) = videojuegos_path.filter(|f| !f.is_empty()) {
        all.extend(scan_cache::cached("videojuegos-folder", local_folder_signature(&folder), || scan_local_folder(&folder)));
    }
    dedupe_scanned_games(all)
}

#[tauri::command]
pub async fn scan_all_games(
    app_handle: tauri::AppHandle,
    local_db: tauri::State<'_, crate::db::MetadeaDb>,
    force: Option<bool>,
) -> Result<Vec<LocalGame>, String> {
    // Only the folder config comes from the DB; the launcher registry reads
    // and directory walks are synchronous disk work, so they run on the
    // blocking pool with the connection lock released, and the lock is
    // taken again below just for the link/seen/hidden round trips.
    let (rom_folders, videojuegos_path, vn_path) = {
        let conn = local_db.conn.lock().str_err()?;
        (
            emulator_rom_folders(&conn),
            read_local_route(&conn, "videojuegos"),
            read_local_route(&conn, "visual-novel"),
        )
    };
    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        set_rom_header_cache_path(data_dir.join("metadata").join("rom_headers.json"));
    }

    let force = force.unwrap_or(false);
    let mut all: Vec<LocalGame> = tokio::task::spawn_blocking(move || {
        scan_all_launchers(&rom_folders, videojuegos_path, vn_path, force)
    })
    .await
    .str_err()?;

    let conn = local_db.conn.lock().str_err()?;

    // Old per-disc / per-.bin entries fold into their multi-disc set first,
    // so the links read below already reflect the merge.
    let meta_root = app_handle.path().app_data_dir().ok().map(|dir| dir.join("metadata"));
    crate::rom_disc_merge::merge_replaced_entries(&conn, meta_root.as_deref(), &all);

    // Populate external_id from local_game_links
    let links = crate::game_links::lookup_game_links(&conn);
    let mut seen: Vec<(String, String, String)> = Vec::with_capacity(all.len());
    for game in &mut all {
        apply_game_link(game, &links);
        seen.push((game.launcher.clone(), game_link_key(game), game.name.clone()));
    }
    crate::game_links::touch_games_seen(&conn, &seen);
    crate::game_links::prune_stale_game_links(&conn);

    // Anything ever scanned before that no live source (this scan, or
    // Steam's owned-games API on the frontend) still knows about — see
    // restore_missing_seen_games's own comment for why this can't just rely
    // on "was it in `all`" alone.
    // A seen row counts as present too when this scan shows the same game
    // under a new identity (LiveGames::supersedes) — otherwise a renamed,
    // moved or regrouped game came back as a second, "not installed" card.
    let live = LiveGames::from_games(&all);
    let mut restored = crate::game_links::restore_missing_seen_games(&conn, &live);
    for game in &mut restored {
        apply_game_link(game, &links);
    }
    all.extend(restored);

    // Anything the user explicitly removed (see remove_local_game) stays
    // gone even though its own live source (a ROM file still on disk, an
    // actual install) keeps reporting it every single scan — checked last,
    // against every game regardless of where it came from above.
    let hidden = crate::game_links::lookup_hidden_games(&conn);
    all.retain(|g| !hidden.contains(&(g.launcher.clone(), game_link_key(g))));

    Ok(all)
}

#[tauri::command]
pub async fn debug_scan_info(local_db: tauri::State<'_, crate::db::MetadeaDb>) -> Result<String, String> {
    let steam = scan_steam_games();
    let epic = scan_epic_games();
    let gog = scan_gog_games();
    let xbox = scan_xbox_games();
    let ea = scan_ea_games();
    let roms = {
        let conn = local_db.conn.lock().str_err()?;
        scan_emulator_roms(&conn)
    };
    Ok(format!(
        "Steam: {} | Epic: {} | GOG: {} | Xbox: {} | EA: {} | ROMs: {}",
        steam.len(),
        epic.len(),
        gog.len(),
        xbox.len(),
        ea.len(),
        roms.len()
    ))
}
