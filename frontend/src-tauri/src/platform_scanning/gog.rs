// Installed GOG Galaxy titles: registry first, folder scan as fallback,
// playtime from Galaxy's local database.

use std::path::PathBuf;
use super::common::{synthetic_app_id, LocalGame};

// GOG Galaxy writes one subkey per installed game here regardless of where
// the user actually chose to install it — the folder-scan below only ever
// caught installs under 3 hardcoded parent directories, missing anything
// on a custom path (e.g. a Steam-library-style "D:\Games\GOG\..." the user
// picked themselves, or really any path other than those 3). Same registry-
// based approach scan_steam_games already relies on instead of guessing
// folders.
#[cfg(windows)]
fn gog_playtimes() -> std::collections::HashMap<String, u64> {
    use rusqlite::{Connection, OpenFlags};

    let database = std::env::var_os("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
        .join(r"GOG.com\Galaxy\storage\galaxy-2.0.db");
    let Ok(conn) = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return Default::default();
    };

    // Galaxy's local database is not a public API and has changed over time.
    // Inspect its table before querying so a missing/renamed column simply
    // means “playtime unavailable”, rather than breaking game discovery.
    let Ok(mut columns) = conn.prepare("PRAGMA table_info(GameTimes)") else {
        return Default::default();
    };
    let names: std::collections::HashSet<String> = columns
        .query_map([], |row| row.get::<_, String>(1))
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .collect();
    if !names.contains("releaseKey") || !names.contains("minutesInGame") {
        return Default::default();
    }

    let Ok(mut statement) = conn.prepare(
        "SELECT CAST(releaseKey AS TEXT), minutesInGame FROM GameTimes WHERE minutesInGame > 0",
    ) else {
        return Default::default();
    };
    let rows: Vec<(String, u64)> = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();
    let mut playtimes = std::collections::HashMap::new();
    for (release_key, minutes) in rows {
        playtimes.insert(release_key.clone(), minutes);
        if let Some(gog_id) = release_key.strip_prefix("gog_") {
            playtimes.insert(gog_id.to_string(), minutes);
        }
    }
    playtimes
}

#[cfg(not(windows))]
fn gog_playtimes() -> std::collections::HashMap<String, u64> {
    Default::default()
}

fn scan_gog_games_registry() -> Vec<LocalGame> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut games = Vec::new();
    let Ok(parent) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\GOG.com\\Games") else {
        return games;
    };

    let playtimes = gog_playtimes();
    for game_id in parent.enum_keys().flatten() {
        let Ok(key) = parent.open_subkey(&game_id) else { continue };
        let name: String = key.get_value("gameName").unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let path: Option<String> = key.get_value("path").ok();
        games.push(LocalGame {
            name,
            launcher: "gog".to_string(),
            playtime_minutes: playtimes.get(&game_id).copied(),
            app_id: Some(game_id),
            external_id: None,
            install_path: path,
            last_played: None,
            installed: Some(true),
            rom_platform: None,
        });
    }

    games
}

pub(super) fn scan_gog_games() -> Vec<LocalGame> {
    let mut games = scan_gog_games_registry();
    // Folder-scan fallback below still adds anything the registry missed
    // (e.g. a game installed by copying files rather than through Galaxy
    // itself) — deduped by name against what the registry already found.
    let registry_names: std::collections::HashSet<String> =
        games.iter().map(|g| g.name.clone()).collect();

    let gog_dirs: Vec<PathBuf> = ["C", "D", "E"]
        .iter()
        .flat_map(|drive| {
            vec![
                PathBuf::from(format!("{}:\\GOG Games", drive)),
                PathBuf::from(format!(
                    "{}:\\Program Files (x86)\\GOG Galaxy\\Games",
                    drive
                )),
                PathBuf::from(format!("{}:\\Games\\GOG", drive)),
            ]
        })
        .collect();

    for base_dir in &gog_dirs {
        if !base_dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let game_dir = entry.path();
                let gameinfo = game_dir.join("gameinfo");
                if gameinfo.exists() {
                    if let Ok(content) = std::fs::read_to_string(&gameinfo) {
                        let name = content
                            .lines()
                            .next()
                            .map(|s| s.trim().to_string())
                            .unwrap_or_default();
                        if !name.is_empty() && !registry_names.contains(&name) {
                            let install_path = game_dir.to_string_lossy().to_string();
                            games.push(LocalGame::installed(
                                name,
                                "gog",
                                Some(synthetic_app_id("gog", &install_path)),
                                Some(install_path),
                            ));
                        }
                    }
                } else if let Ok(sub) = std::fs::read_dir(&game_dir) {
                    for sub_entry in sub.flatten() {
                        let sfname = sub_entry.file_name();
                        let sfname = sfname.to_string_lossy();
                        if sfname.starts_with("goggame-") && sfname.ends_with(".info") {
                            if let Ok(content) = std::fs::read_to_string(sub_entry.path()) {
                                if let Ok(json) =
                                    serde_json::from_str::<serde_json::Value>(&content)
                                {
                                    let name = json["gameTitle"].as_str().unwrap_or("").to_string();
                                    let app_id = json["gameId"].as_str().map(|s| s.to_string());
                                    if !name.is_empty() && !registry_names.contains(&name) {
                                        games.push(LocalGame {
                                            name,
                                            launcher: "gog".to_string(),
                                            app_id,
                                            external_id: None,
                                            install_path: Some(
                                                game_dir.to_string_lossy().to_string(),
                                            ),
                                            playtime_minutes: None,
                                            last_played: None,
                                            installed: Some(true),
                                            rom_platform: None,
                                        });
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    games.dedup_by(|a, b| a.name == b.name);
    games
}
