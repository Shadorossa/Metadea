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

    std::fs::create_dir_all(game_dir).str_err()?;

    let cover_path = game_dir.join(format!("{}_cover.webp", cover_image_id));
    let banner_path = banner_id
        .as_ref()
        .map(|bid| game_dir.join(format!("{}_banner.webp", bid)));

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
        if let (Some(bid), Some(bpath)) = (&banner_id, &banner_path) {
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

fn save_game_info(
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
        resolve_igdb_game(client, &client_id, &token, &app_id, &game_name, &launcher).await?
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

    let index_path = meta_root.join("index.json");
    let mut index: serde_json::Value = std::fs::read_to_string(&index_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = index.as_object_mut() {
        let mut entry = serde_json::json!({
            "name": game_name,
            "cover": cover_path.to_string_lossy(),
        });
        // Banner filename uses image_id hash, not igdb_game_id number.
        // Scan for any *_banner.webp file in the game directory.
        if let Ok(entries) = std::fs::read_dir(game_dir) {
            if let Some(banner_path) = entries
                .flatten()
                .find(|e| e.file_name().to_string_lossy().ends_with("_banner.webp"))
                .map(|e| e.path())
            {
                entry["banner"] =
                    serde_json::Value::String(banner_path.to_string_lossy().to_string());
            }
        }
        obj.insert(app_id.clone(), entry);
    }
    let _ = std::fs::write(
        &index_path,
        serde_json::to_string_pretty(&index).unwrap_or_default(),
    );

    Ok(Some(cover_path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn read_metadata_index(
    app_handle: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    let meta_root = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("metadata");
    let index_path = meta_root.join("index.json");
    if !index_path.exists() {
        return Ok(std::collections::HashMap::new());
    }
    let data = std::fs::read_to_string(&index_path).str_err()?;
    let index: serde_json::Value =
        serde_json::from_str(&data).unwrap_or_else(|_| serde_json::json!({}));
    let mut out = std::collections::HashMap::new();

    if let Some(obj) = index.as_object() {
        for (app_id, entry) in obj {
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
            // Read straight off each game's own info.json genres — set once
            // at fetch time by save_game_info, so this also classifies games
            // fetched before is_vn existed at all, no re-fetch needed. Genre
            // NAMES (not ids, unlike detect_vn's id-based check used during
            // IGDB search) since that's all info.json ever stored.
            let info_path = meta_root.join(app_id).join("info.json");
            if let Ok(info_data) = std::fs::read_to_string(&info_path) {
                if let Ok(info) = serde_json::from_str::<serde_json::Value>(&info_data) {
                    let is_vn = info["genres"]
                        .as_array()
                        .map(|genres| genres.iter().any(|g| g.as_str() == Some("Visual Novel")))
                        .unwrap_or(false);
                    if is_vn {
                        result["is_vn"] = serde_json::Value::Bool(true);
                    }
                    // Lets the frontend match this game to its own catalog
                    // entry by real identity ("vnovel:<id>"/"game:<id>",
                    // same prefix "Ver en catálogo" links to) instead of a
                    // fuzzy title guess.
                    if let Some(igdb_id) = info["igdb_id"].as_u64() {
                        result["igdb_id"] = serde_json::Value::Number(igdb_id.into());
                    }
                }
            }
            if result.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
                out.insert(app_id.clone(), result);
            }
        }
    }

    Ok(out)
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

    let index_path = meta_root.join("index.json");
    let mut index: serde_json::Value = std::fs::read_to_string(&index_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = index.as_object_mut() {
        let mut entry = serde_json::json!({
            "name": game_name,
            "cover": cover_path.to_string_lossy(),
        });
        if let Ok(entries) = std::fs::read_dir(&game_dir) {
            if let Some(banner_path) = entries
                .flatten()
                .find(|e| e.file_name().to_string_lossy().ends_with("_banner.webp"))
                .map(|e| e.path())
            {
                entry["banner"] =
                    serde_json::Value::String(banner_path.to_string_lossy().to_string());
            }
        }
        obj.insert(app_id.clone(), entry);
    }
    let _ = std::fs::write(
        &index_path,
        serde_json::to_string_pretty(&index).unwrap_or_default(),
    );

    Ok(cover_path.to_string_lossy().to_string())
}
