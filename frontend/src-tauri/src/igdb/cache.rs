// On-disk metadata cache under <app_data>/metadata: per-game cover/banner
// webp files plus info.json, and the index.json the library grid reads.

use tauri::Manager;
use crate::db::ToStringErr;
use crate::igdb_env::load_env_config;
use crate::igdb_matching::resolve_igdb_game;
use super::auth::get_twitch_token;
use super::client::{igdb_query, IGDB_API_GAMES, IGDB_GAME_FIELDS, IGDB_IMAGE_1080P, IGDB_IMAGE_COVER_BIG};
use super::images::{download_as_webp, fetch_landscape_image_id};
use super::mapping::extract_cover_and_game;

// The IGDB game id is read straight off `igdb_game["id"]` — every resolver
// derives it from the same value via `extract_cover_and_game`.
async fn download_game_metadata(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    game_dir: &std::path::Path,
    igdb_game: &serde_json::Value,
    cover_image_id: &str,
    app_id: &str,
) -> Result<(), String> {
    let banner_id = if let Some(gid) = igdb_game["id"].as_u64() {
        fetch_landscape_image_id(client, client_id, token, gid).await
    } else {
        None
    };
    download_game_files(client, game_dir, igdb_game, cover_image_id, banner_id.as_deref(), app_id).await
}

// The disk half of download_game_metadata, with the banner already
// resolved — shared with the batched fetch (batch.rs), which looks banner
// candidates up for ten games per request instead of two requests per game.
pub(super) async fn download_game_files(
    client: &reqwest::Client,
    game_dir: &std::path::Path,
    igdb_game: &serde_json::Value,
    cover_image_id: &str,
    banner_id: Option<&str>,
    app_id: &str,
) -> Result<(), String> {
    std::fs::create_dir_all(game_dir).str_err()?;

    let cover_path = game_dir.join(format!("{}_cover.webp", cover_image_id));
    let banner_path = banner_id.map(|bid| game_dir.join(format!("{}_banner.webp", bid)));

    let cover_fut = async {
        if cover_path.exists() {
            return;
        }
        download_as_webp(
            client,
            &format!("{}/{}.jpg", IGDB_IMAGE_COVER_BIG, cover_image_id),
            &cover_path,
        )
        .await;
    };
    let banner_fut = async {
        if let (Some(bid), Some(bpath)) = (banner_id, &banner_path) {
            if bpath.exists() {
                return;
            }
            download_as_webp(client, &format!("{}/{}.jpg", IGDB_IMAGE_1080P, bid), bpath).await;
        }
    };
    futures::join!(cover_fut, banner_fut);

    if !igdb_game.is_null() {
        let _ = save_game_info(game_dir, igdb_game, app_id);
    }

    Ok(())
}

// ── index.json ────────────────────────────────────────────────────────────────
// One entry per app_id: the cover/banner paths plus, since INDEX_META_VERSION
// 2, the two facts read_metadata_index used to dig out of every game's own
// info.json on every Local open (igdb_id, is_vn). Entries written before
// that carry no `meta_v` and are backfilled from info.json the first time
// they're read, so the per-game file reads happen once more at most.

pub(super) const INDEX_META_VERSION: u64 = 2;

pub(super) fn is_visual_novel_info(info: &serde_json::Value) -> bool {
    info["genres"]
        .as_array()
        .map(|genres| genres.iter().any(|g| g.as_str() == Some("Visual Novel")))
        .unwrap_or(false)
}

// `igdb_game` is the raw IGDB row (genres as {name} objects) — the same
// genre names save_game_info persists, so this classifies exactly like the
// info.json read it replaces.
fn is_visual_novel_game(igdb_game: &serde_json::Value) -> bool {
    igdb_game["genres"]
        .as_array()
        .map(|genres| genres.iter().any(|g| g["name"].as_str() == Some("Visual Novel")))
        .unwrap_or(false)
}

pub(super) fn find_banner_file(game_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(game_dir)
        .ok()?
        .flatten()
        .find(|e| e.file_name().to_string_lossy().ends_with("_banner.webp"))
        .map(|e| e.path())
}

pub(super) fn build_index_entry(
    game_dir: &std::path::Path,
    game_name: &str,
    cover_path: &std::path::Path,
    igdb_game: &serde_json::Value,
) -> serde_json::Value {
    let mut entry = serde_json::json!({
        "name": game_name,
        "cover": cover_path.to_string_lossy(),
        "meta_v": INDEX_META_VERSION,
    });
    // Banner filename uses image_id hash, not igdb_game_id number.
    // Scan for any *_banner.webp file in the game directory.
    if let Some(banner_path) = find_banner_file(game_dir) {
        entry["banner"] = serde_json::Value::String(banner_path.to_string_lossy().to_string());
    }
    if let Some(igdb_id) = igdb_game["id"].as_u64() {
        entry["igdb_id"] = serde_json::Value::Number(igdb_id.into());
    }
    if is_visual_novel_game(igdb_game) {
        entry["is_vn"] = serde_json::Value::Bool(true);
    }
    entry
}

pub(super) fn read_index(meta_root: &std::path::Path) -> serde_json::Value {
    std::fs::read_to_string(meta_root.join("index.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(|v: &serde_json::Value| v.is_object())
        .unwrap_or_else(|| serde_json::json!({}))
}

pub(super) fn write_index(meta_root: &std::path::Path, index: &serde_json::Value) {
    let _ = std::fs::create_dir_all(meta_root);
    let _ = std::fs::write(
        meta_root.join("index.json"),
        serde_json::to_string_pretty(index).unwrap_or_default(),
    );
}

// Applies `updates` to the index as it is on disk *now*, not to a copy read
// earlier: a batch downloads for minutes, and writing back its own early
// snapshot would drop whatever a per-game fetch or manual pick wrote in the
// meantime — leaving those games' files on disk with no index entry, so the
// grid never shows their cover and every later batch counts them "cached".
pub(super) fn merge_index_updates(meta_root: &std::path::Path, updates: Vec<(String, serde_json::Value)>) {
    if updates.is_empty() {
        return;
    }
    let mut index = read_index(meta_root);
    if let Some(obj) = index.as_object_mut() {
        for (app_id, entry) in updates {
            obj.insert(app_id, entry);
        }
    }
    write_index(meta_root, &index);
}

// True when read_metadata_index would hand the grid both a cover and a
// banner for this entry (the frontend's own "basic metadata done" test).
pub(super) fn index_entry_is_complete(entry: Option<&serde_json::Value>) -> bool {
    let Some(entry) = entry else { return false };
    let projected = project_index_entry(entry, None);
    projected["cover_path"].is_string() && projected["banner_path"].is_string()
}

// An index entry rebuilt from files already on disk (cover, banner,
// info.json), for a game whose downloads survived but whose index entry did
// not. None without a cover file.
pub(super) fn index_entry_from_disk(game_dir: &std::path::Path, game_name: &str) -> Option<serde_json::Value> {
    let cover_path = std::fs::read_dir(game_dir)
        .ok()?
        .flatten()
        .find(|e| e.file_name().to_string_lossy().ends_with("_cover.webp"))
        .map(|e| e.path())?;
    let info: serde_json::Value = std::fs::read_to_string(game_dir.join("info.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    // info.json keeps genres as plain names; build_index_entry reads the raw
    // IGDB shape ({ name }).
    let genres: Vec<serde_json::Value> = info["genres"]
        .as_array()
        .map(|g| g.iter().filter_map(|n| n.as_str()).map(|n| serde_json::json!({ "name": n })).collect())
        .unwrap_or_default();
    let igdb_game = serde_json::json!({ "id": info["igdb_id"], "genres": genres });
    Some(build_index_entry(game_dir, game_name, &cover_path, &igdb_game))
}

fn upsert_index_entry(meta_root: &std::path::Path, app_id: &str, entry: serde_json::Value) {
    let mut index = read_index(meta_root);
    if let Some(obj) = index.as_object_mut() {
        obj.insert(app_id.to_string(), entry);
    }
    write_index(meta_root, &index);
}

// The read_metadata_index projection of one index entry (cover_path/
// banner_path only when the files still exist, is_vn only when true,
// igdb_id when known). `legacy_info` is consulted for entries written
// before INDEX_META_VERSION; the caller backfills those afterwards.
pub(super) fn project_index_entry(entry: &serde_json::Value, legacy_info: Option<&serde_json::Value>) -> serde_json::Value {
    let mut result = serde_json::json!({});
    if let Some(p) = entry["cover"].as_str() {
        if std::path::Path::new(p).exists() {
            result["cover_path"] = serde_json::Value::String(p.to_string());
        }
    }
    if let Some(p) = entry["banner"].as_str() {
        if std::path::Path::new(p).exists() {
            result["banner_path"] = serde_json::Value::String(p.to_string());
        }
    }
    let (is_vn, igdb_id) = if let Some(info) = legacy_info {
        (is_visual_novel_info(info), info["igdb_id"].as_u64())
    } else {
        (entry["is_vn"].as_bool().unwrap_or(false), entry["igdb_id"].as_u64())
    };
    if is_vn {
        result["is_vn"] = serde_json::Value::Bool(true);
    }
    if let Some(igdb_id) = igdb_id {
        result["igdb_id"] = serde_json::Value::Number(igdb_id.into());
    }
    result
}

pub(super) fn save_game_info(
    game_dir: &std::path::Path,
    igdb_game: &serde_json::Value,
    app_id: &str,
) -> Result<(), String> {
    let mut info = serde_json::json!({
        "app_id": app_id,
        "name": igdb_game["name"].as_str().unwrap_or(""),
        "igdb_id": igdb_game["id"].as_u64(),
        "summary": igdb_game["summary"].as_str().unwrap_or(""),
        "release_date": igdb_game["first_release_date"].as_u64(),
        "rating": igdb_game["rating"],
        "last_fetched": chrono::Utc::now().to_rfc3339(),
    });

    if let Some(genres) = igdb_game["genres"].as_array() {
        let genre_names: Vec<String> = genres
            .iter()
            .filter_map(|g| g["name"].as_str().map(|s| s.to_string()))
            .collect();
        info["genres"] = serde_json::Value::Array(
            genre_names
                .into_iter()
                .map(serde_json::Value::String)
                .collect(),
        );
    }

    if let Some(companies) = igdb_game["involved_companies"].as_array() {
        let mut developers = Vec::new();
        let mut publishers = Vec::new();
        for company in companies {
            let is_dev = company["developer"].as_bool().unwrap_or(false);
            let is_pub = company["publisher"].as_bool().unwrap_or(false);
            if let Some(name) = company["company"]["name"].as_str() {
                if is_dev {
                    developers.push(name.to_string());
                }
                if is_pub {
                    publishers.push(name.to_string());
                }
            }
        }
        if !developers.is_empty() {
            info["developers"] = serde_json::Value::Array(
                developers
                    .into_iter()
                    .map(serde_json::Value::String)
                    .collect(),
            );
        }
        if !publishers.is_empty() {
            info["publishers"] = serde_json::Value::Array(
                publishers
                    .into_iter()
                    .map(serde_json::Value::String)
                    .collect(),
            );
        }
    }

    let info_path = game_dir.join("info.json");
    std::fs::write(
        &info_path,
        serde_json::to_string_pretty(&info).unwrap_or_default(),
    )
    .str_err()
}

// Resolves a known IGDB game id directly — no Steam-ID/fuzzy-name guessing —
// shared by igdb_force_by_igdb_id (manual pick from the UI) and
// igdb_get_cover_by_steam_id's own check for a saved local_game_links
// override (an earlier manual pick that must keep winning on every future
// fetch, not just the one time it was made).
async fn fetch_igdb_game_by_id(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    igdb_id: u64,
) -> Result<(String, Option<u64>, serde_json::Value), String> {
    let games = igdb_query(
        client,
        client_id,
        token,
        IGDB_API_GAMES,
        &format!(
            "fields {IGDB_GAME_FIELDS}; where id = {} & cover != null; limit 1;",
            igdb_id
        ),
    )
    .await?;

    let game = games
        .as_array()
        .and_then(|a| a.first())
        .ok_or("Game not found in IGDB")?;

    let (cover_image_id, game_id, igdb_game) = extract_cover_and_game(game);
    let cover_image_id = cover_image_id.ok_or("Game has no cover")?;
    Ok((cover_image_id, game_id, igdb_game))
}

#[tauri::command]
pub async fn igdb_get_cover_by_steam_id(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    app_id: String,
    game_name: String,
    // Passed by the frontend as the game's own launcher (see LocalLibrary's
    // handleFetchMetadata) — a manual pick saved under e.g. "gog"
    // (IgdbPickerModal already uses game.launcher, not a hardcoded "steam")
    // is actually found again below instead of silently never matching,
    // now that this isn't hardcoded to "steam" either.
    launcher: String,
    // Set for an emulated ROM (LocalGame.rom_platform): restricts the IGDB
    // name search to that console and records the automatic match in
    // local_game_links so the card keeps its catalog identity on rescans.
    rom_platform: Option<String>,
) -> Result<Option<String>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?;
    let meta_root = app_data_dir.join("metadata");
    let game_dir = meta_root.join(&app_id);

    if game_dir.exists() {
        let mut has_cover = false;
        let mut has_banner = false;
        if let Ok(entries) = std::fs::read_dir(&game_dir) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.ends_with("_cover.webp") {
                    has_cover = true;
                }
                if n.ends_with("_banner.webp") {
                    has_banner = true;
                }
            }
        }
        if has_cover && has_banner {
            return Ok(Some(game_dir.to_string_lossy().to_string()));
        }
    }

    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = crate::http::http_client();

    // A manual pick from IgdbPickerModal (see save_game_link in folders.rs)
    // always wins over guessing — checked first, ahead of Steam-ID/fuzzy
    // matching, so a corrected mismatch stays fixed even if the cached
    // cover/banner files above ever get cleared and this whole function
    // re-runs from scratch.
    let manual_link = {
        let conn = state.conn.lock().str_err()?;
        crate::game_links::get_game_link(&conn, &launcher, &app_id)
    };
    let manual_igdb_id = manual_link
        .as_deref()
        .and_then(|eid| eid.rsplit(':').next())
        .and_then(|id| id.parse::<u64>().ok());

    let (cover_image_id, _igdb_game_id, igdb_game) = if let Some(igdb_id) = manual_igdb_id {
        fetch_igdb_game_by_id(client, &client_id, &token, igdb_id).await?
    } else {
        let resolved =
            resolve_igdb_game(client, &client_id, &token, &app_id, &game_name, &launcher, rom_platform.as_deref()).await?;
        if rom_platform.is_some() {
            if let Some(igdb_id) = resolved.2["id"].as_u64() {
                let conn = state.conn.lock().str_err()?;
                crate::game_links::save_auto_game_link(&conn, &launcher, &app_id, &format!("game:{igdb_id}")).str_err()?;
            }
        }
        resolved
    };

    download_game_metadata(
        client,
        &client_id,
        &token,
        &game_dir,
        &igdb_game,
        &cover_image_id,
        &app_id,
    )
    .await?;

    let cover_path = game_dir.join(format!("{}_cover.webp", cover_image_id));
    upsert_index_entry(&meta_root, &app_id, build_index_entry(&game_dir, &game_name, &cover_path, &igdb_game));

    Ok(Some(cover_path.to_string_lossy().to_string()))
}

// is_vn: each game's IGDB genre names, set once at fetch time (see
// save_game_info/build_index_entry) — genre NAMES, not ids, unlike
// detect_vn's id-based check used during IGDB search. igdb_id lets the
// frontend match a game to its own catalog entry by real identity
// ("vnovel:<id>"/"game:<id>", the same prefix "Ver en catálogo" links to)
// instead of a fuzzy title guess. Both live in index.json itself now; an
// entry from before that is read from its info.json once and backfilled.
#[tauri::command]
pub async fn read_metadata_index(
    app_handle: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    let meta_root = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("metadata");
    if !meta_root.join("index.json").exists() {
        return Ok(std::collections::HashMap::new());
    }
    tokio::task::spawn_blocking(move || read_metadata_index_in(&meta_root)).await.str_err()
}

pub(super) fn read_metadata_index_in(meta_root: &std::path::Path) -> std::collections::HashMap<String, serde_json::Value> {
    let mut index = read_index(meta_root);
    let mut out = std::collections::HashMap::new();
    let mut backfilled = false;

    if let Some(obj) = index.as_object_mut() {
        for (app_id, entry) in obj.iter_mut() {
            let is_current = entry["meta_v"].as_u64() == Some(INDEX_META_VERSION);
            let legacy_info = if is_current {
                None
            } else {
                std::fs::read_to_string(meta_root.join(app_id).join("info.json"))
                    .ok()
                    .and_then(|data| serde_json::from_str::<serde_json::Value>(&data).ok())
            };
            let result = project_index_entry(entry, legacy_info.as_ref());
            if !is_current {
                if let Some(entry_obj) = entry.as_object_mut() {
                    entry_obj.insert("meta_v".into(), serde_json::Value::Number(INDEX_META_VERSION.into()));
                    if let Some(igdb_id) = result["igdb_id"].as_u64() {
                        entry_obj.insert("igdb_id".into(), serde_json::Value::Number(igdb_id.into()));
                    }
                    if result["is_vn"].as_bool() == Some(true) {
                        entry_obj.insert("is_vn".into(), serde_json::Value::Bool(true));
                    }
                    backfilled = true;
                }
            }
            if result.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
                out.insert(app_id.clone(), result);
            }
        }
    }
    if backfilled {
        write_index(meta_root, &index);
    }
    out
}

#[tauri::command]
pub async fn read_game_info(
    app_handle: tauri::AppHandle,
    app_id: String,
) -> Result<serde_json::Value, String> {
    let meta_root = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("metadata");
    let info_path = meta_root.join(&app_id).join("info.json");
    if !info_path.exists() {
        return Ok(serde_json::json!({}));
    }
    let data = std::fs::read_to_string(&info_path).str_err()?;
    serde_json::from_str(&data).str_err()
}

// Force download metadata for a specific IGDB game ID, bypassing search/matching
#[tauri::command]
pub async fn igdb_force_by_igdb_id(
    app_handle: tauri::AppHandle,
    app_id: String,
    game_name: String,
    igdb_id: u64,
) -> Result<String, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = crate::http::http_client();

    let (cover_image_id, _game_id, igdb_game) =
        fetch_igdb_game_by_id(client, &client_id, &token, igdb_id).await?;

    let meta_root = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("metadata");
    let game_dir = meta_root.join(&app_id);

    // Remove existing metadata so it re-downloads cleanly
    if game_dir.exists() {
        let _ = std::fs::remove_dir_all(&game_dir);
    }

    download_game_metadata(
        client,
        &client_id,
        &token,
        &game_dir,
        &igdb_game,
        &cover_image_id,
        &app_id,
    )
    .await?;

    let cover_path = game_dir.join(format!("{}_cover.webp", cover_image_id));
    upsert_index_entry(&meta_root, &app_id, build_index_entry(&game_dir, &game_name, &cover_path, &igdb_game));

    Ok(cover_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod index_tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("metadea-index-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn legacy_entries_are_read_from_info_json_once_then_backfilled() {
        let root = temp_root("legacy");
        let game_dir = root.join("42");
        std::fs::create_dir_all(&game_dir).unwrap();
        let cover = game_dir.join("abc_cover.webp");
        std::fs::write(&cover, b"").unwrap();
        std::fs::write(game_dir.join("info.json"), r#"{"igdb_id": 7, "genres": ["Visual Novel"]}"#).unwrap();
        write_index(&root, &serde_json::json!({ "42": { "name": "G", "cover": cover.to_string_lossy() } }));

        let first = read_metadata_index_in(&root);
        assert_eq!(first["42"]["igdb_id"].as_u64(), Some(7));
        assert_eq!(first["42"]["is_vn"].as_bool(), Some(true));
        assert!(first["42"]["cover_path"].is_string());

        // Backfilled: the info.json can go away and the answer is the same.
        std::fs::remove_file(game_dir.join("info.json")).unwrap();
        let index = read_index(&root);
        assert_eq!(index["42"]["meta_v"].as_u64(), Some(INDEX_META_VERSION));
        let second = read_metadata_index_in(&root);
        assert_eq!(second["42"]["igdb_id"].as_u64(), Some(7));
        assert_eq!(second["42"]["is_vn"].as_bool(), Some(true));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn new_entries_carry_igdb_id_and_vn_flag_and_drop_missing_files() {
        let root = temp_root("new");
        let game_dir = root.join("7");
        std::fs::create_dir_all(&game_dir).unwrap();
        let cover = game_dir.join("c_cover.webp");
        let igdb_game = serde_json::json!({ "id": 99, "genres": [{ "name": "Adventure" }, { "name": "Visual Novel" }] });
        let entry = build_index_entry(&game_dir, "Game", &cover, &igdb_game);
        assert_eq!(entry["igdb_id"].as_u64(), Some(99));
        assert_eq!(entry["is_vn"].as_bool(), Some(true));
        assert_eq!(entry["meta_v"].as_u64(), Some(INDEX_META_VERSION));
        write_index(&root, &serde_json::json!({ "7": entry }));
        // The cover file was never written: no cover_path, but identity stays.
        let read = read_metadata_index_in(&root);
        assert!(read["7"].get("cover_path").is_none());
        assert_eq!(read["7"]["igdb_id"].as_u64(), Some(99));
        let plain = build_index_entry(&game_dir, "Game", &cover, &serde_json::json!({ "id": 1, "genres": [{ "name": "RPG" }] }));
        assert!(plain.get("is_vn").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn games_on_disk_without_an_index_entry_are_reindexed_and_merges_keep_other_writes() {
        let root = temp_root("reindex");
        let game_dir = root.join("5");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(game_dir.join("c_cover.webp"), b"").unwrap();
        std::fs::write(game_dir.join("b_banner.webp"), b"").unwrap();
        std::fs::write(game_dir.join("info.json"), r#"{"igdb_id": 12, "genres": ["Visual Novel"]}"#).unwrap();

        // An entry lost from index.json: files on disk, nothing indexed.
        assert!(!index_entry_is_complete(read_index(&root).get("5")));
        let rebuilt = index_entry_from_disk(&game_dir, "Game").expect("cover on disk");
        assert!(index_entry_is_complete(Some(&rebuilt)));
        assert_eq!(rebuilt["igdb_id"].as_u64(), Some(12));
        assert_eq!(rebuilt["is_vn"].as_bool(), Some(true));
        assert!(index_entry_from_disk(&root.join("missing"), "X").is_none());

        // A write that landed after the batch started survives its merge.
        write_index(&root, &serde_json::json!({ "other": { "name": "Other" } }));
        merge_index_updates(&root, vec![("5".to_string(), rebuilt)]);
        let index = read_index(&root);
        assert!(index.get("other").is_some());
        assert!(index_entry_is_complete(index.get("5")));

        // A cover without a banner is not "done" for the grid.
        std::fs::remove_file(game_dir.join("b_banner.webp")).unwrap();
        assert!(!index_entry_is_complete(index.get("5")));
        let _ = std::fs::remove_dir_all(&root);
    }
}
