// Durable (launcher, link_key) -> catalog external_id overrides for locally
// scanned games (see platform_scanning.rs's scan_all_games), plus the
// "was this game actually seen recently" bookkeeping that decides when a
// link is stale and when a previously-scanned game should still show up
// even though no live source currently reports it. Split out of folders.rs,
// which was otherwise a mix of file-browsing, playback, and this.
use crate::db::ToStringErr;

#[tauri::command]
pub async fn save_game_link(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    launcher: String,
    link_key: String,
    external_id: String,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    // A pick made in the IGDB picker is manual: it wins over every
    // automatic match on every future scan (see save_auto_game_link).
    conn.execute(
        "INSERT INTO local_game_links (launcher, link_key, external_id, updated_at, manual)
         VALUES (?1, ?2, ?3, ?4, 1)
         ON CONFLICT(launcher, link_key) DO UPDATE SET
             external_id = excluded.external_id,
             updated_at  = excluded.updated_at,
             manual      = 1",
        rusqlite::params![launcher, link_key, external_id, now],
    )
    .map(|_| ())
    .str_err()
}

// The automatic counterpart, used when an emulated ROM resolves through
// IGDB matching on its own (igdb_get_cover_by_steam_id): recorded so the
// game keeps its catalog identity across scans, but never over a manual
// pick — a rescan must not undo what the user corrected by hand.
pub fn save_auto_game_link(
    conn: &rusqlite::Connection,
    launcher: &str,
    link_key: &str,
    external_id: &str,
) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO local_game_links (launcher, link_key, external_id, updated_at, manual)
         VALUES (?1, ?2, ?3, ?4, 0)
         ON CONFLICT(launcher, link_key) DO UPDATE SET
             external_id = excluded.external_id,
             updated_at  = excluded.updated_at
         WHERE local_game_links.manual = 0",
        rusqlite::params![launcher, link_key, external_id, now],
    )
    .map(|_| ())
}

// Single-row counterpart to lookup_game_links (which pulls the whole table
// for scan_all_games' bulk pass) — used by the metadata-fetch path, which
// only ever needs one game's link at a time.
pub fn get_game_link(
    conn: &rusqlite::Connection,
    launcher: &str,
    link_key: &str,
) -> Option<String> {
    conn.query_row(
        "SELECT external_id FROM local_game_links WHERE launcher = ?1 AND link_key = ?2",
        rusqlite::params![launcher, link_key],
        |r| r.get(0),
    )
    .ok()
}

pub fn lookup_game_links(
    conn: &rusqlite::Connection,
) -> std::collections::HashMap<(String, String), String> {
    let mut map = std::collections::HashMap::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT launcher, link_key, external_id FROM local_game_links")
    {
        let _ = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        }).map(|rows| {
            for row in rows.flatten() {
                map.insert((row.0, row.1), row.2);
            }
        });
    }
    map
}

// Marks every currently-scanned game as seen right now — called at the end
// of scan_all_games, right before prune_stale_game_links below. Also keeps
// `name` fresh so restore_missing_seen_games (below) has something to show
// once a game later drops out of every live source.
pub fn touch_games_seen(conn: &rusqlite::Connection, games: &[(String, String, String)]) {
    let now = chrono::Utc::now().to_rfc3339();
    for (launcher, link_key, name) in games {
        let _ = conn.execute(
            "INSERT INTO local_games_seen (launcher, link_key, last_seen_at, name) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(launcher, link_key) DO UPDATE SET last_seen_at = excluded.last_seen_at, name = excluded.name",
            rusqlite::params![launcher, link_key, now, name],
        );
    }
}

// A game scan_all_games' live sources (install-folder scans, Steam's owned-
// games API on the frontend) no longer find at all used to just vanish from
// the grid — worst with Family Sharing titles, which Steam's owned-games API
// never lists even while installed, so uninstalling one left literally no
// live source aware it exists. local_games_seen remembers every game ever
// scanned (name included, see touch_games_seen), so anything in there that
// isn't part of *this* scan gets re-added as an explicitly not-installed
// stub — same as how an owned-but-uninstalled Steam game already behaves,
// just sourced from our own history instead of Steam's API. No expiry here:
// unlike local_game_links' 14-day grace period (a different concern — losing
// the catalog *link*), staying listed doesn't hurt anything, so this keeps
// showing a game indefinitely until the user removes it.
//
// "Isn't part of this scan" means under any identity: `live` also knows the
// aliases and the paths/titles a game's key used to be derived from, so a
// ROM renamed by the clean-up, a Switch update now grouped under its base or
// a row keyed by a raw path from before synthetic ids existed never comes
// back as a duplicate "not installed" card next to the live entry.
pub fn restore_missing_seen_games(
    conn: &rusqlite::Connection,
    live: &crate::platform_scanning::LiveGames,
) -> Vec<crate::platform_scanning::LocalGame> {
    let mut stmt = match conn.prepare("SELECT launcher, link_key, name FROM local_games_seen WHERE name != ''") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
    });
    let rows = match rows {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    rows.filter_map(|r| r.ok())
        .filter(|(launcher, link_key, name)| !live.supersedes(launcher, link_key, name))
        .map(|(launcher, link_key, name)| {
            // Ignore legacy path-based keys so they aren't treated as unsafe app_id cache paths.
            let app_id = if link_key.contains(['\\', '/', ':']) { None } else { Some(link_key.clone()) };
            crate::platform_scanning::LocalGame {
                name, launcher, app_id, external_id: None,
                install_path: None, playtime_minutes: None, last_played: None,
                installed: Some(false), rom_platform: None,
                discs: Vec::new(), disc_playlist: None, replaced_app_ids: Vec::new(), aliases: Vec::new(),
            }
        })
        .collect()
}

// A link a user made once (see save_game_link) used to just sit in
// local_game_links forever, even long after the game was uninstalled —
// most visible with Family Sharing titles, which get installed/uninstalled
// far more often than an owned game. Grace period (not "gone from this one
// scan = delete now") so a temporarily-unplugged external drive holding a
// GOG/EA library doesn't wipe out its links just because one scan missed it.
const GAME_LINK_GRACE_DAYS: i64 = 14;

// Lets the user manually drop a game off the grid for good — local_games_seen's
// own doc comment above anticipated this for ghosts ("staying listed doesn't
// hurt anything ... until the user removes it"), but a game a live source
// (a ROM file still on disk, a real install) keeps reporting every scan
// would just come right back if this only cleared seen/links. Recorded in
// local_hidden_games instead, which scan_all_games filters its whole output
// against unconditionally — durable regardless of whether the source is a
// ghost or something still genuinely there.
#[tauri::command]
pub async fn remove_local_game(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    launcher: String,
    link_key: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT OR IGNORE INTO local_hidden_games (launcher, link_key) VALUES (?1, ?2)",
        rusqlite::params![launcher, link_key],
    )
    .str_err()?;
    conn.execute(
        "DELETE FROM local_games_seen WHERE launcher = ?1 AND link_key = ?2",
        rusqlite::params![launcher, link_key],
    )
    .str_err()?;
    conn.execute(
        "DELETE FROM local_game_links WHERE launcher = ?1 AND link_key = ?2",
        rusqlite::params![launcher, link_key],
    )
    .str_err()?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct HiddenGameKey {
    pub launcher: String,
    pub link_key: String,
}

// Exposes local_hidden_games to the frontend — needed because Steam's
// owned-games API result (steamGetOwnedGames) gets merged into the game list
// entirely on the frontend, AFTER scan_all_games has already returned and
// applied this same filter server-side (see steam-merge.ts's `uninstalled`
// list) — that merge step had no way to know which of those owned-but-
// uninstalled games the user had already removed via remove_local_game, so
// they kept reappearing on every rescan/reload despite being hidden.
#[tauri::command]
pub async fn get_hidden_local_games(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<HiddenGameKey>, String> {
    let conn = state.conn.lock().str_err()?;
    Ok(lookup_hidden_games(&conn)
        .into_iter()
        .map(|(launcher, link_key)| HiddenGameKey { launcher, link_key })
        .collect())
}

pub fn lookup_hidden_games(conn: &rusqlite::Connection) -> std::collections::HashSet<(String, String)> {
    let mut set = std::collections::HashSet::new();
    if let Ok(mut stmt) = conn.prepare("SELECT launcher, link_key FROM local_hidden_games") {
        let _ = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map(|rows| {
                for row in rows.flatten() {
                    set.insert(row);
                }
            });
    }
    set
}

// The automatic clean-up (rom_rename.rs) changes a ROM's path, and a ROM's
// link_key/app_id is a hash of that path — every row keyed by the old id
// follows the file to its new name, so links, seen-history and "removed"
// state all survive the rename (and its undo, which calls this in reverse).
pub fn move_game_link_key(conn: &rusqlite::Connection, old_key: &str, new_key: &str) -> rusqlite::Result<()> {
    for table in ["local_game_links", "local_games_seen", "local_hidden_games"] {
        conn.execute(
            &format!("UPDATE OR REPLACE {table} SET link_key = ?2 WHERE link_key = ?1"),
            rusqlite::params![old_key, new_key],
        )?;
    }
    Ok(())
}

pub fn prune_stale_game_links(conn: &rusqlite::Connection) {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(GAME_LINK_GRACE_DAYS)).to_rfc3339();
    let _ = conn.execute(
        "DELETE FROM local_game_links
         WHERE NOT EXISTS (
             SELECT 1 FROM local_games_seen lgs
             WHERE lgs.launcher = local_game_links.launcher
               AND lgs.link_key = local_game_links.link_key
               AND lgs.last_seen_at >= ?1
         )",
        [cutoff],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform_scanning::{synthetic_app_id, LiveGames, LocalGame};

    fn seen(conn: &rusqlite::Connection, launcher: &str, key: &str, name: &str) {
        conn.execute(
            "INSERT INTO local_games_seen (launcher, link_key, last_seen_at, name) VALUES (?1, ?2, 'then', ?3)",
            rusqlite::params![launcher, key, name],
        )
        .unwrap();
    }

    fn live_rom(name: &str, path: &str) -> LocalGame {
        LocalGame {
            name: name.into(),
            launcher: "nintendo".into(),
            app_id: Some(synthetic_app_id("rom", path)),
            install_path: Some(path.into()),
            installed: Some(true),
            ..Default::default()
        }
    }

    // Rows copied from the owner's database: the renamed 3DS dump under its
    // pre-synthetic-id path key, the Switch update now grouped under its
    // base, a Steam game that really is uninstalled, and the live ROM itself.
    #[test]
    fn only_games_missing_under_every_identity_come_back_as_not_installed() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let inazuma = "D:/videojuegos/Nintendo 3Ds/Inazuma Eleven GO - Chrono Stones - Thunderflash.3ds";
        let scarlet = "D:/videojuegos/Nintendo Switch/Pokemon Scarlet [0100A3D008C5C000].xci";
        let update = "D:/videojuegos/Nintendo Switch/Pokémon Scarlet [0100A3D008C5C800][v786432].nsp";
        seen(&conn, "nintendo", &synthetic_app_id("rom", inazuma), "Inazuma Eleven GO - Chrono Stones - Thunderflash");
        seen(
            &conn,
            "nintendo",
            "D:/videojuegos/Nintendo 3Ds/Inazuma Eleven GO - Chrono Stones - Thunderflash (Europe) (En,Fr,De,Es,It).3ds",
            "Inazuma Eleven GO - Chrono Stones - Thunderflash (Europe) (En,Fr,De,Es,It)",
        );
        seen(&conn, "nintendo", &synthetic_app_id("rom", update), "Pokémon Scarlet [0100A3D008C5C800][v786432]");
        seen(&conn, "steam", "1245620", "ELDEN RING");

        let mut scarlet_game = live_rom("Pokemon Scarlet [0100A3D008C5C000]", scarlet);
        scarlet_game.aliases.push(("nintendo".into(), synthetic_app_id("rom", update)));
        let live = LiveGames::from_games(&[live_rom("Inazuma Eleven GO - Chrono Stones - Thunderflash", inazuma), scarlet_game]);

        let restored = restore_missing_seen_games(&conn, &live);
        let names: Vec<&str> = restored.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, vec!["ELDEN RING"]);
        assert_eq!(restored[0].installed, Some(false));
    }
}
