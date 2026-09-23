// The commands that run every scanner and reconcile the result with the
// saved links/seen/hidden tables.

use crate::db::ToStringErr;
use super::common::{apply_game_link, game_link_key, LocalGame};
use super::ea::scan_ea_games;
use super::emulator_roms::{emulator_rom_folders, scan_emulator_roms, scan_rom_folders};
use super::epic::scan_epic_games;
use super::gog::scan_gog_games;
use super::local_folders::{scan_local_folder, scan_vn_folder};
use super::steam_library::scan_steam_games;
use super::xbox::scan_xbox_games;

fn read_local_route(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT path FROM local_routes WHERE key = ?1", [key], |r| r.get(0))
        .ok()
}

#[tauri::command]
pub async fn scan_all_games(
    local_db: tauri::State<'_, crate::db::MetadeaDb>,
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

    let mut all: Vec<LocalGame> = tokio::task::spawn_blocking(move || {
        let mut all: Vec<LocalGame> = Vec::new();
        all.extend(scan_steam_games());
        all.extend(scan_epic_games());
        all.extend(scan_gog_games());
        all.extend(scan_xbox_games());
        all.extend(scan_ea_games());
        all.extend(scan_rom_folders(&rom_folders));
        if let Some(folder) = videojuegos_path {
            if !folder.is_empty() {
                all.extend(scan_local_folder(&folder));
            }
        }
        if let Some(folder) = vn_path {
            if !folder.is_empty() {
                all.extend(scan_vn_folder(&folder));
            }
        }
        all
    })
    .await
    .str_err()?;

    let conn = local_db.conn.lock().str_err()?;

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
    let present: std::collections::HashSet<(String, String)> =
        seen.iter().map(|(l, k, _)| (l.clone(), k.clone())).collect();
    let mut restored = crate::game_links::restore_missing_seen_games(&conn, &present);
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
