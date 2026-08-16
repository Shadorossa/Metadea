// Durable (launcher, link_key) -> catalog external_id overrides for locally
// scanned games (see platform_scanning.rs's scan_all_games), plus the
// "was this game actually seen recently" bookkeeping that decides when a
// link is stale and when a previously-scanned game should still show up
// even though no live source currently reports it. Split out of folders.rs,
// which was otherwise a mix of file-browsing, VLC playback, and this.
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
    conn.execute(
        "INSERT INTO local_game_links (launcher, link_key, external_id, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(launcher, link_key) DO UPDATE SET
             external_id = excluded.external_id,
             updated_at  = excluded.updated_at",
        rusqlite::params![launcher, link_key, external_id, now],
    )
    .map(|_| ())
    .str_err()
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
pub fn restore_missing_seen_games(
    conn: &rusqlite::Connection,
    already_present: &std::collections::HashSet<(String, String)>,
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
        .filter(|(launcher, link_key, _)| !already_present.contains(&(launcher.clone(), link_key.clone())))
        .map(|(launcher, link_key, name)| {
            let app_id = if launcher == "steam" { Some(link_key.clone()) } else { None };
            crate::platform_scanning::LocalGame {
                name, launcher, app_id, external_id: None,
                install_path: None, playtime_minutes: None, last_played: None,
                installed: Some(false),
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
