use chrono::Datelike;
use serde::Deserialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;
use crate::db::ToStringErr;

// -- Constants ----------------------------------------------------------------

pub(crate) const IGDB_API_GAMES: &str = "https://api.igdb.com/v4/games";
pub(crate) const IGDB_API_EXTERNAL_GAMES: &str = "https://api.igdb.com/v4/external_games";
const IGDB_API_ARTWORKS: &str = "https://api.igdb.com/v4/artworks";
const IGDB_API_SCREENSHOTS: &str = "https://api.igdb.com/v4/screenshots";
const IGDB_IMAGE_COVER_BIG: &str = "https://images.igdb.com/igdb/image/upload/t_cover_big";
const IGDB_IMAGE_1080P: &str = "https://images.igdb.com/igdb/image/upload/t_1080p";

pub(crate) const EDITION_KEYWORDS: &[&str] = &[
    "deluxe",
    "digital",
    "edition",
    "skin",
    "pack",
    "bundle",
    "gold",
    "premium",
    "ultimate",
    "complete",
    "goty",
    "remastered",
    "definitive",
    "anniversary",
    "collector",
    "limited",
    "special",
    "enhanced",
    "expanded",
];

pub(crate) const IGDB_GAME_FIELDS: &str = "id,cover.image_id,name,summary,first_release_date,genres.name,rating,category,involved_companies.company.name,involved_companies.developer,involved_companies.publisher";

fn get_game_category(game: &serde_json::Value) -> u64 {
    game["category"]
        .as_u64()
        .or_else(|| game["game_type"].as_u64())
        .unwrap_or(0)
}

/// Whole-word match only — "Definitive Edition" is excluded, "Expedition 33"
/// is not (a substring `contains("edition")` check would wrongly catch it).
/// Category/game_type alone isn't reliable for catching these — IGDB very
/// often tags a remaster/expanded-edition/DLC entry as plain category=0
/// main_game with nothing in game_type either, so it'd otherwise slip past
/// the category-based EXCLUDED/allowlist checks in igdb_search entirely.
const NON_GAME_NAME_WORDS: &[&str] = &["edition", "remaster", "remastered", "dlc"];
fn name_has_edition_word(name: &str) -> bool {
    name.split(|c: char| !c.is_alphanumeric())
        .any(|tok| NON_GAME_NAME_WORDS.iter().any(|w| tok.eq_ignore_ascii_case(w)))
}

/// Returns true if the game is a DLC/addon/non-game entry that should be excluded.
pub(crate) fn is_non_game(game: &serde_json::Value) -> bool {
    // Solo permitimos: 0 (main_game), 4 (standalone_expansion), 7 (season), 8 (remake), 14 (update)
    const ALLOWED: &[u64] = &[0, 4, 7, 8, 14];
    let category = get_game_category(game);
    !ALLOWED.contains(&category)
}


// -- Env config -----------------------------------------------------------
// Moved to igdb_env.rs; read_env_config re-exported so comicvine.rs's
// `crate::igdb::read_env_config(...)` call keeps working (lib.rs's
// generate_handler! needs the real defining module for both commands, so
// that one references igdb_env:: directly instead).
pub use crate::igdb_env::read_env_config;
use crate::igdb_env::load_env_config;

// -- HTTP client cache --------------------------------------------------------

fn get_http_client() -> &'static reqwest::Client {
    static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_default()
    })
}

// -- Twitch token cache --------------------------------------------------------

struct TwitchToken {
    access_token: String,
    expires: Instant,
}

static TWITCH_TOKEN: Mutex<Option<TwitchToken>> = Mutex::new(None);

async fn get_twitch_token(client_id: &str, client_secret: &str) -> Result<String, String> {
    {
        // Recovers the guard even if the mutex was poisoned by a panic
        // elsewhere while holding it — there's no broken invariant here
        // (just an Option<TwitchToken> plain value), so it's safe to keep
        // using it rather than propagate the poisoning as a hard crash.
        let cache = TWITCH_TOKEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(ref t) = *cache {
            if t.expires > Instant::now() + Duration::from_secs(60) {
                return Ok(t.access_token.clone());
            }
        }
    }

    #[derive(Deserialize)]
    struct TwitchResp {
        access_token: String,
        expires_in: u64,
    }

    let client = get_http_client();
    let http = client
        .post("https://id.twitch.tv/oauth2/token")
        .query(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("grant_type", "client_credentials"),
        ])
        .send()
        .await
        .map_err(|e| format!("Twitch request failed: {}", e))?;
    if !http.status().is_success() {
        let status = http.status();
        let body = http.text().await.unwrap_or_default();
        return Err(format!("Twitch auth failed (HTTP {}): {}", status, body));
    }
    let resp = http
        .json::<TwitchResp>()
        .await
        .map_err(|e| format!("Twitch parse failed: {}", e))?;

    let token = resp.access_token.clone();
    let expires = Instant::now() + Duration::from_secs(resp.expires_in);
    *TWITCH_TOKEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(TwitchToken {
        access_token: resp.access_token,
        expires,
    });
    Ok(token)
}

// -- IGDB helpers --------------------------------------------------------------

pub(crate) async fn igdb_query(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    endpoint: &str,
    body: &str,
) -> Result<serde_json::Value, String> {
    const MAX_RETRIES: u32 = 4;
    let mut delay_secs = 1u64;

    for attempt in 0..=MAX_RETRIES {
        let resp = client
            .post(endpoint)
            .header("Client-ID", client_id)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "text/plain")
            .body(body.to_string())
            .send()
            .await
            .str_err()?;

        let status = resp.status();

        if status.as_u16() == 429 {
            if attempt == MAX_RETRIES {
                return Err(format!(
                    "IGDB error (HTTP 429): rate limited after {} retries",
                    MAX_RETRIES
                ));
            }
            // Respect Retry-After header if present, otherwise exponential backoff
            let wait = resp
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(delay_secs);
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            delay_secs = (delay_secs * 2).min(30);
            continue;
        }

        if !status.is_success() {
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("IGDB error (HTTP {}): {}", status, b));
        }

        return resp
            .json::<serde_json::Value>()
            .await
            .str_err();
    }
    Err("IGDB: unreachable".into())
}

pub(crate) fn extract_cover_and_game(
    game: &serde_json::Value,
) -> (Option<String>, Option<u64>, serde_json::Value) {
    let cover = game["cover"]["image_id"].as_str().map(String::from);
    let game_id = game["id"].as_u64();
    (cover, game_id, game.clone())
}

// Matching heuristics moved to igdb_matching.rs.
use crate::igdb_matching::resolve_igdb_game;

async fn download_as_webp(client: &reqwest::Client, url: &str, dest: &std::path::Path) {
    let Ok(resp) = client.get(url).send().await else {
        return;
    };
    let Ok(bytes) = resp.bytes().await else {
        return;
    };
    let Ok(img) = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg) else {
        return;
    };
    let _ = img.save_with_format(dest, image::ImageFormat::WebP);
}

async fn download_game_metadata(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    game_dir: &std::path::PathBuf,
    igdb_game: &serde_json::Value,
    cover_image_id: &str,
    igdb_game_id: Option<u64>,
    app_id: &str,
) -> Result<(), String> {
    let banner_id = if let Some(gid) = igdb_game_id {
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

// Pulls (image_id, width, height) triples out of a raw IGDB artworks/screenshots
// array, skipping any entry flagged `alpha_channel: true` (transparent artworks
// tend to be logos/PNGs, not usable banner photography).
fn extract_image_candidates(value: &serde_json::Value) -> Vec<(String, f64, f64)> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|entry| {
                    if entry["alpha_channel"].as_bool() == Some(true) {
                        return None;
                    }
                    let id = entry["image_id"].as_str()?;
                    let w = entry["width"].as_f64().unwrap_or(0.0);
                    let h = entry["height"].as_f64().unwrap_or(1.0);
                    Some((id.to_string(), w, h))
                })
                .collect()
        })
        .unwrap_or_default()
}

// Picks the best landscape/banner-shaped image out of a set of candidates.
fn pick_landscape_image(candidates: &[(String, f64, f64)]) -> Option<String> {
    // Prefer images that meet the strict banner criteria (1280×720+, ratio ≥ 1.5)
    if let Some((id, _, _)) = candidates.iter().find(|(_, w, h)| *w >= 1280.0 && *h >= 720.0 && w / h >= 1.5) {
        return Some(id.clone());
    }

    // Fallback: pick the most landscape-like image (highest w/h ratio) that is wider than tall,
    // so we avoid accidentally picking logos (which tend to be square or portrait)
    candidates.iter()
        .filter(|(_, w, h)| w > h)
        .max_by(|(_, w1, h1), (_, w2, h2)| {
            (w1 / h1).partial_cmp(&(w2 / h2)).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(id, _, _)| id.clone())
}

// Derives {platform, url} store links from a raw IGDB external_games array,
// matching known storefront domains and dropping everything else.
fn build_store_links(external_games: &serde_json::Value) -> Option<Vec<serde_json::Value>> {
    let arr = external_games.as_array()?;
    let links: Vec<serde_json::Value> = arr
        .iter()
        .filter_map(|e| {
            let url = e["url"].as_str().filter(|u| !u.is_empty())?;
            let platform = if url.contains("store.steampowered.com") {
                "steam"
            } else if url.contains("gog.com") {
                "gog"
            } else if url.contains("epicgames.com") {
                "epic"
            } else if url.contains("xbox.com") || url.contains("microsoft.com/store") {
                "xbox"
            } else if url.contains("playstation.com") {
                "playstation"
            } else {
                return None;
            };
            Some(serde_json::json!({ "platform": platform, "url": url }))
        })
        .collect();
    if links.is_empty() { None } else { Some(links) }
}

async fn fetch_landscape_image_id(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    game_id: u64,
) -> Option<String> {
    let arts_query = format!("fields image_id,width,height; where game = {} & alpha_channel = false; limit 10;", game_id);
    let ss_query = format!("fields image_id,width,height; where game = {}; limit 5;", game_id);
    let (arts_res, ss_res) = futures::join!(
        igdb_query(client, client_id, token, IGDB_API_ARTWORKS, &arts_query),
        igdb_query(client, client_id, token, IGDB_API_SCREENSHOTS, &ss_query),
    );

    let mut candidates: Vec<(String, f64, f64)> = Vec::new();
    if let Ok(arts) = arts_res {
        candidates.extend(extract_image_candidates(&arts));
    }
    if let Ok(ss) = ss_res {
        candidates.extend(extract_image_candidates(&ss));
    }

    if candidates.is_empty() {
        return None;
    }
    pick_landscape_image(&candidates)
}

fn save_game_info(
    game_dir: &std::path::PathBuf,
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

// VN filter: genre 34 in top-3, not RPG (12) or Fighting (4), with parent inheritance
fn detect_vn(game: &serde_json::Value) -> bool {
    let genres = game["genres"].as_array().cloned().unwrap_or_default();
    let top3: Vec<u64> = genres
        .iter()
        .take(3)
        .filter_map(|g| g["id"].as_u64())
        .collect();
    let all_ids: Vec<u64> = genres.iter().filter_map(|g| g["id"].as_u64()).collect();

    let has_vn = top3.contains(&34) && !all_ids.contains(&12) && !all_ids.contains(&4);
    if has_vn {
        return true;
    }

    for parent_key in &["version_parent", "parent_game"] {
        let parent = &game[parent_key];
        if parent.is_null() {
            continue;
        }
        let pg = parent["genres"].as_array().cloned().unwrap_or_default();
        let pt3: Vec<u64> = pg.iter().take(3).filter_map(|g| g["id"].as_u64()).collect();
        let pa: Vec<u64> = pg.iter().filter_map(|g| g["id"].as_u64()).collect();
        if pt3.contains(&34) && !pa.contains(&12) && !pa.contains(&4) {
            return true;
        }
    }
    false
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

// -- Tauri commands ------------------------------------------------------------

#[tauri::command]
pub async fn igdb_get_cover_by_steam_id(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    app_id: String,
    game_name: String,
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
    let client = get_http_client();

    // A manual pick from IgdbPickerModal (see save_game_link in folders.rs)
    // always wins over guessing — checked first, ahead of Steam-ID/fuzzy
    // matching, so a corrected mismatch stays fixed even if the cached
    // cover/banner files above ever get cleared and this whole function
    // re-runs from scratch.
    let manual_link = {
        let conn = state.conn.lock().str_err()?;
        crate::folders::get_game_link(&conn, "steam", &app_id)
    };
    let manual_igdb_id = manual_link
        .as_deref()
        .and_then(|eid| eid.rsplit(':').next())
        .and_then(|id| id.parse::<u64>().ok());

    let (cover_image_id, igdb_game_id, igdb_game) = if let Some(igdb_id) = manual_igdb_id {
        fetch_igdb_game_by_id(&client, &client_id, &token, igdb_id).await?
    } else {
        resolve_igdb_game(&client, &client_id, &token, &app_id, &game_name).await?
    };

    download_game_metadata(
        &client,
        &client_id,
        &token,
        &game_dir,
        &igdb_game,
        &cover_image_id,
        igdb_game_id,
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

// Games releasing in [start_unix, end_unix] — single request, used by the
// Home calendar's "General" view. Uses a broader category allowlist than
// igdb_search's is_non_game (which is tuned for "is this the same game as
// my library entry" matching): a release calendar should also surface
// DLC/expansions, remasters, expanded editions and ports actually shipping
// that month, not just brand-new main games — those are real "this comes
// out this month" events players look for.
const CALENDAR_ALLOWED_CATEGORIES: &[u64] = &[0, 1, 2, 4, 8, 9, 10, 11, 14];
// main_game, dlc_addon, expansion, standalone_expansion, remake, remaster,
// expanded_game, port, update

// Number of equal date sub-ranges to split [start_unix, end_unix] into.
// Sorting the *whole* range by date ascending with one limit meant a busy
// first half of the month (indie/mobile titles releasing daily) could fill
// the entire cap before the query ever reached later dates — reported as
// "no games after the 14th". Each chunk gets its own request + its own
// slice of the limit. Same "split the range into N chunks" pattern as
// upcoming-general.ts's CHUNKS on the AniList side (not shared code — one's
// a GraphQL alias set, this is plain concurrent REST calls — but check that
// file too if this partitioning approach needs to change).
// igdb_query already retries on 429 with backoff, so firing this many
// concurrent requests is safe even if it briefly exceeds IGDB's ~4 req/s.
const IGDB_DATE_CHUNKS: i64 = 8;
const IGDB_CHUNK_LIMIT: u32 = 200; // 8 × 200 = 1600 games/month capacity

fn is_calendar_release(g: &serde_json::Value) -> bool {
    let category = get_game_category(g);
    if !CALENDAR_ALLOWED_CATEGORIES.contains(&category) {
        return false;
    }
    // Same edition-dedup rule as igdb_search: a main_game (0) with a
    // version_parent/version_title is itself a special edition of some
    // base entry, not a standalone release.
    category != 0 || (g["version_parent"].is_null() && g["version_title"].is_null())
}

#[tauri::command]
pub async fn igdb_upcoming_releases(
    app_handle: tauri::AppHandle,
    start_unix: i64,
    end_unix: i64,
) -> Result<serde_json::Value, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = get_http_client();

    let span = (end_unix - start_unix).max(1);
    let chunk_size = span / IGDB_DATE_CHUNKS;
    let queries = (0..IGDB_DATE_CHUNKS).map(|i| {
        let chunk_start = start_unix + i * chunk_size;
        let chunk_end = if i == IGDB_DATE_CHUNKS - 1 { end_unix } else { chunk_start + chunk_size };
        let client_id = client_id.clone();
        let token = token.clone();
        async move {
            let body = format!(
                "fields id,name,cover.image_id,first_release_date,category,game_type,\
                 version_parent.id,version_title,hypes; \
                 where first_release_date >= {} & first_release_date <= {}; \
                 sort first_release_date asc; limit {};",
                chunk_start, chunk_end, IGDB_CHUNK_LIMIT
            );
            igdb_query(&client, &client_id, &token, IGDB_API_GAMES, &body).await
        }
    });

    let chunk_results = futures::future::join_all(queries).await;
    let mut raw_games: Vec<serde_json::Value> = Vec::new();
    for chunk in chunk_results {
        if let Ok(serde_json::Value::Array(arr)) = chunk {
            raw_games.extend(arr);
        }
    }

    let games: Vec<serde_json::Value> = raw_games.into_iter().filter(is_calendar_release).collect();

    Ok(serde_json::Value::Array(games))
}

#[tauri::command]
pub async fn igdb_search(
    app_handle: tauri::AppHandle,
    query: String,
    is_visual_novel: bool,
    page: Option<u32>,
    // Restricts results to exactly these IGDB category/game_type values
    // instead of the normal main_game/standalone_expansion/season/remake
    // allowlist below — used by relation pickers (Bundled In: category 3
    // bundles; Contains: category 10 expanded editions) that need exactly
    // the categories plain search deliberately excludes. `None` keeps the
    // normal behavior.
    only_categories: Option<Vec<u64>>,
) -> Result<serde_json::Value, String> {
    if query.is_empty() {
        return Ok(serde_json::json!({ "games": [], "hasMore": false }));
    }

    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = get_http_client();
    let safe_query = query.replace('"', "");

    // One request per page — this used to loop fetching every page IGDB had
    // (100 at a time) before returning anything at all, which for a broad
    // query could be dozens of sequential requests and was the main reason
    // game search felt so much slower than every other provider. `page` is
    // our own 1-based, 50-results-per-page unit (matching the other
    // providers), independent of IGDB's own `limit`/`offset` query syntax.
    const PAGE_SIZE: usize = 50;
    let page = page.unwrap_or(1).max(1) as usize;
    let offset = (page - 1) * PAGE_SIZE;

    let raw = igdb_query(
        &client,
        &client_id,
        &token,
        IGDB_API_GAMES,
        &format!(
            "fields id,name,cover.image_id,rating,first_release_date,status,\
             genres.id,genres.name,category,game_type,\
             version_parent.id,version_parent.genres.id,\
             parent_game.id,parent_game.genres.id; \
             search \"{}\"; where cover != null; limit {}; offset {};",
            safe_query, PAGE_SIZE, offset
        ),
    )
    .await?;

    let items = raw.as_array().cloned().unwrap_or_default();
    // IGDB returning a full page doesn't guarantee there's a next one (the
    // last page can happen to be exactly PAGE_SIZE long), but it's the only
    // signal available without a second request — worst case, one "Load
    // more" click comes back empty and the UI just stops offering it.
    let has_more = items.len() == PAGE_SIZE;

    let mut games: Vec<serde_json::Value> = Vec::new();
    for item in items {
        // Cancelled status is 6 in IGDB API
        if item["status"].as_i64() == Some(6) {
            continue;
        }

        // Used only by relation pickers (Bundled In: category 3 bundles;
        // Contains: category 10 expanded editions), which need exactly the
        // categories plain search deliberately excludes below — every other
        // filter (edition-word names, version_parent dedup) doesn't apply
        // to these.
        if let Some(cats) = &only_categories {
            if !cats.contains(&get_game_category(&item)) {
                continue;
            }
            let vn = detect_vn(&item);
            if is_visual_novel == vn {
                games.push(item);
            }
            continue;
        }

        // Bundles (3), remasters (9), updates (14), and expanded editions
        // (10) never belong in plain search results (bundles aren't a
        // playable title on their own; remasters/updates/expanded editions
        // should only ever surface as a relation on the original game's
        // page, not as their own separate search hit) — checked against
        // both fields independently since get_game_category's
        // category-then-game_type fallback can mask one flagging it when
        // the other is simply absent from this particular record (e.g. an
        // expanded edition IGDB tagged category=main_game but game_type=10).
        const EXCLUDED: &[u64] = &[3, 9, 10, 14];
        if item["category"].as_u64().is_some_and(|c| EXCLUDED.contains(&c))
            || item["game_type"].as_u64().is_some_and(|c| EXCLUDED.contains(&c)) {
            continue;
        }

        // 0 main_game, 4 standalone_expansion, 7 season, 8 remake.
        let category = get_game_category(&item);
        if !matches!(category, 0 | 4 | 7 | 8) {
            continue;
        }

        // Si es main_game (0) y tiene parent o version_title, lo saltamos para evitar duplicados de fichas base
        if category == 0 && (!item["version_parent"].is_null() || !item["version_title"].is_null()) {
            continue;
        }

        // A main_game (0) whose own name is literally "... Edition" is
        // almost always a re-released bundle/version IGDB miscategorized as
        // its own main game rather than as a proper edition/remaster
        // relation — word-boundary checked so "Expedition 33" isn't caught.
        if category == 0 && name_has_edition_word(item["name"].as_str().unwrap_or("")) {
            continue;
        }

        let vn = detect_vn(&item);
        if is_visual_novel == vn {
            games.push(item);
        }
    }

    Ok(serde_json::json!({ "games": games, "hasMore": has_more }))
}

// Raw IGDB search with zero filtering — no cover requirement, no category
// allowlist, no VN/game split — used by the admin panel's "Add work" search
// so any title in IGDB can be found regardless of how it's classified.
#[tauri::command]
pub async fn igdb_search_unfiltered(
    app_handle: tauri::AppHandle,
    query: String,
    page: Option<u32>,
) -> Result<serde_json::Value, String> {
    if query.is_empty() {
        return Ok(serde_json::json!({ "games": [], "hasMore": false }));
    }

    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = get_http_client();
    let safe_query = query.replace('"', "");

    const PAGE_SIZE: usize = 50;
    let page = page.unwrap_or(1).max(1) as usize;
    let offset = (page - 1) * PAGE_SIZE;

    let raw = igdb_query(
        &client,
        &client_id,
        &token,
        IGDB_API_GAMES,
        &format!(
            "fields id,name,cover.image_id,rating,first_release_date,genres.id,genres.name,category,game_type; \
             search \"{}\"; limit {}; offset {};",
            safe_query, PAGE_SIZE, offset
        ),
    )
    .await?;

    let mut items = raw.as_array().cloned().unwrap_or_default();
    let has_more = items.len() == PAGE_SIZE;

    // Unlike igdb_search (which splits results into two buckets via the
    // is_visual_novel parameter), this command returns one mixed list — tag
    // each item with is_vn directly so the frontend can pick "vnovel:" vs
    // "game:" for the id prefix, same convention as every other place this
    // gets tagged (see detect_vn's other call sites in this file).
    for item in items.iter_mut() {
        let is_vn = detect_vn(item);
        if let Some(obj) = item.as_object_mut() {
            obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
        }
    }

    Ok(serde_json::json!({ "games": items, "hasMore": has_more }))
}

// Single-request detail fetch: banner candidates (artworks/screenshots) and
// store links (external_games) are Game sub-fields in IGDB's schema, so they
// ride along in the same query instead of requiring separate round-trips.
// Only the remake→base-game reverse lookup (`igdb_get_base_games`) can't be
// embedded this way — IGDB has no back-reference field for it — and it's
// only fired for the minority of games that are actually remakes.
#[tauri::command]
pub async fn igdb_get_game_detail(
    app_handle: tauri::AppHandle,
    igdb_id: u64,
) -> Result<serde_json::Value, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = get_http_client();

    let games_query = format!(
        "fields id,name,url,cover.image_id,summary,first_release_date,rating,total_rating,status,\
         genres.name,involved_companies.company.name,\
         involved_companies.developer,involved_companies.publisher,platforms.name,\
         alternative_names.name,alternative_names.comment,game_type,\
         parent_game.id,parent_game.name,parent_game.cover.image_id,parent_game.first_release_date,parent_game.genres.id,\
         version_parent.id,version_parent.name,version_parent.cover.image_id,version_parent.first_release_date,version_parent.genres.id,\
         artworks.image_id,artworks.width,artworks.height,artworks.alpha_channel,\
         screenshots.image_id,screenshots.width,screenshots.height,\
         external_games.category,external_games.url,\
         remakes.id,remakes.name,remakes.cover.image_id,remakes.first_release_date,remakes.genres.id,remakes.game_type,\
         remasters.id,remasters.name,remasters.cover.image_id,remasters.first_release_date,remasters.genres.id,remasters.game_type,\
         dlcs.id,dlcs.name,dlcs.cover.image_id,dlcs.first_release_date,dlcs.genres.id,dlcs.game_type,\
         expansions.id,expansions.name,expansions.cover.image_id,expansions.first_release_date,expansions.genres.id,expansions.game_type,\
         standalone_expansions.id,standalone_expansions.name,standalone_expansions.cover.image_id,standalone_expansions.first_release_date,standalone_expansions.genres.id,standalone_expansions.game_type,\
         expanded_games.id,expanded_games.name,expanded_games.cover.image_id,expanded_games.first_release_date,expanded_games.genres.id,expanded_games.game_type,\
         ports.id,ports.name,ports.cover.image_id,ports.first_release_date,ports.genres.id,ports.game_type,\
         forks.id,forks.name,forks.cover.image_id,forks.first_release_date,forks.genres.id,forks.game_type; \
         where id = {}; limit 1;",
        igdb_id
    );

    let games = igdb_query(&client, &client_id, &token, IGDB_API_GAMES, &games_query).await?;
    let mut game = games[0].clone();
    if game.is_null() {
        return Ok(game);
    }

    let mut candidates = extract_image_candidates(&game["artworks"]);
    candidates.extend(extract_image_candidates(&game["screenshots"]));
    game["banner_image_id"] = pick_landscape_image(&candidates)
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null);

    let mut store_links = build_store_links(&game["external_games"]);

    // Some ports (e.g. a console release of a PC game) carry storefront
    // links the base entry doesn't — if this game has none of its own,
    // check its ports before giving up. Batched into one follow-up request
    // rather than one per port.
    if store_links.is_none() {
        if let Some(port_ids) = game["ports"].as_array().map(|ports| {
            ports.iter().filter_map(|p| p["id"].as_u64()).collect::<Vec<_>>()
        }) {
            if !port_ids.is_empty() {
                let ids_csv = port_ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
                let ports_query = format!(
                    "fields id,external_games.category,external_games.url; where id = ({}); limit {};",
                    ids_csv, port_ids.len()
                );
                if let Ok(port_results) = igdb_query(&client, &client_id, &token, IGDB_API_GAMES, &ports_query).await {
                    if let Some(port_arr) = port_results.as_array() {
                        let mut merged: Vec<serde_json::Value> = Vec::new();
                        let mut seen_urls = std::collections::HashSet::new();
                        for port in port_arr {
                            if let Some(links) = build_store_links(&port["external_games"]) {
                                for link in links {
                                    if let Some(url) = link["url"].as_str() {
                                        if seen_urls.insert(url.to_string()) {
                                            merged.push(link);
                                        }
                                    }
                                }
                            }
                        }
                        if !merged.is_empty() {
                            store_links = Some(merged);
                        }
                    }
                }
            }
        }
    }

    // Explicitly null (not just an absent field) once both the game itself
    // and its ports have been checked — lets the frontend persist "we looked,
    // there really are none" to shop_links_csv instead of leaving it
    // ambiguous with "never checked".
    game["store_links"] = match store_links {
        Some(links) => serde_json::Value::Array(links),
        None => serde_json::Value::Null,
    };

    // Related sub-games (remakes, dlcs, ...) are their own titles and can be
    // visual novels even when the current game isn't (or vice versa) — tag
    // each one with is_vn from its own genres so the frontend can route it
    // to /media?id=vnovel:X instead of always assuming id=game:X, which used
    // to create duplicate catalog stubs of the same title under both prefixes.
    const REL_ARRAYS: &[&str] = &[
        "remakes", "remasters", "dlcs", "expansions",
        "standalone_expansions", "expanded_games", "ports", "forks",
    ];
    if let Some(obj) = game.as_object_mut() {
        for key in REL_ARRAYS {
            if let Some(arr) = obj.get_mut(*key).and_then(|v| v.as_array_mut()) {
                for node in arr.iter_mut() {
                    let is_vn = detect_vn(node);
                    if let Some(node_obj) = node.as_object_mut() {
                        node_obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
                        node_obj.remove("genres");
                    }
                }
            }
        }
        for key in &["parent_game", "version_parent"] {
            if let Some(node) = obj.get(*key).cloned() {
                if !node.is_null() {
                    let is_vn = detect_vn(&node);
                    if let Some(node_obj) = obj.get_mut(*key).and_then(|v| v.as_object_mut()) {
                        node_obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
                        node_obj.remove("genres");
                    }
                }
            }
        }
    }

    // These were only needed to derive banner_image_id/store_links above —
    // drop them so the IPC payload isn't carrying raw sub-arrays twice over.
    if let Some(obj) = game.as_object_mut() {
        obj.remove("artworks");
        obj.remove("screenshots");
        obj.remove("external_games");
    }

    Ok(game)
}

// Reverse lookup for remakes/remasters: IGDB only exposes the forward
// "remakes"/"remasters" array on the original game, not a back-reference on
// the edition itself. `relation_field` picks which forward array to search
// ("remakes" when the core detail response has game_type == 8, "remasters"
// for game_type == 9) — same query shape either way, just which column is
// matched against.
#[tauri::command]
pub async fn igdb_get_base_games(
    app_handle: tauri::AppHandle,
    igdb_id: u64,
    relation_field: String,
) -> Result<serde_json::Value, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = get_http_client();

    if relation_field != "remakes" && relation_field != "remasters" {
        return Err(format!("Unsupported relation_field: {}", relation_field));
    }

    let base_query = format!(
        "fields id,name,cover.image_id,first_release_date,genres.id; where {} = {}; limit 5;",
        relation_field, igdb_id
    );

    let mut results = igdb_query(&client, &client_id, &token, IGDB_API_GAMES, &base_query).await?;
    if let Some(arr) = results.as_array_mut() {
        for node in arr.iter_mut() {
            let is_vn = detect_vn(node);
            if let Some(node_obj) = node.as_object_mut() {
                node_obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
                node_obj.remove("genres");
            }
        }
    }
    Ok(results)
}

// Walks the forward edition/version relation graph (remakes, remasters,
// dlcs, expansions, standalone_expansions, expanded_games, ports, forks,
// parent_game) breadth-first, batching one IGDB query per depth level, so
// that e.g. "a remaster of an expanded edition" or "a port of a remaster"
// still surfaces on the original game's page even though it's two or three
// hops away rather than a direct relation. Bounded by MAX_DEPTH/MAX_NODES
// to keep this to a handful of requests. Each returned node carries a
// synthetic "via" field naming the relation array that first discovered it,
// so the frontend can label it (the node's own further relation arrays are
// stripped before returning — only needed for traversal).
#[tauri::command]
pub async fn igdb_get_relation_graph(
    app_handle: tauri::AppHandle,
    root_id: u64,
) -> Result<Vec<serde_json::Value>, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = get_http_client();

    const MAX_DEPTH: usize = 4;
    const MAX_NODES: usize = 40;
    const REL_FIELDS: &[&str] = &[
        "remakes", "remasters", "dlcs", "expansions",
        "standalone_expansions", "expanded_games", "ports", "forks",
    ];


    let mut visited: std::collections::HashMap<u64, String> = std::collections::HashMap::new();
    visited.insert(root_id, "root".to_string());
    let mut frontier: Vec<u64> = vec![root_id];
    let mut collected: Vec<serde_json::Value> = Vec::new();

    for _ in 0..MAX_DEPTH {
        if frontier.is_empty() || visited.len() >= MAX_NODES {
            break;
        }
        let ids_csv = frontier.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let query = format!(
            "fields id,name,cover.image_id,first_release_date,genres.id,\
             parent_game.id,\
             remakes.id,remasters.id,dlcs.id,expansions.id,\
             standalone_expansions.id,expanded_games.id,ports.id,forks.id; \
             where id = ({}); limit {};",
            ids_csv,
            frontier.len()
        );

        let results = igdb_query(&client, &client_id, &token, IGDB_API_GAMES, &query).await?;
        let arr = results.as_array().cloned().unwrap_or_default();

        let mut next_frontier: Vec<u64> = Vec::new();
        for item in &arr {
            let id = match item["id"].as_u64() {
                Some(v) => v,
                None => continue,
            };

            if id != root_id {
                let is_vn = detect_vn(item);
                let mut out = item.clone();
                if let Some(obj) = out.as_object_mut() {
                    let via = visited.get(&id).cloned().unwrap_or_else(|| "relation".to_string());
                    obj.insert("via".to_string(), serde_json::Value::String(via));
                    obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
                    for f in REL_FIELDS {
                        obj.remove(*f);
                    }
                    obj.remove("parent_game");
                    obj.remove("genres");
                }
                collected.push(out);
            }

            // All non-root nodes are dead ends for BFS traversal.
            // Their own sub-relations (DLC of a remake, remaster of a remake)
            // belong specifically to that edition and must only show on its own
            // page — not bubble up to the base game's relation list.
            if id != root_id {
                continue;
            }

            for field in REL_FIELDS {
                // Ports are never shown as related versions.
                if *field == "ports" {
                    continue;
                }
                if let Some(list) = item[*field].as_array() {
                    for sub in list {
                        if let Some(sid) = sub["id"].as_u64() {
                            if visited.len() < MAX_NODES && !visited.contains_key(&sid) {
                                visited.insert(sid, field.to_string());
                                next_frontier.push(sid);
                            }
                        }
                    }
                }
            }
            if let Some(pid) = item["parent_game"]["id"].as_u64() {
                if visited.len() < MAX_NODES && !visited.contains_key(&pid) {
                    visited.insert(pid, "parent_game".to_string());
                    next_frontier.push(pid);
                }
            }
        }
        frontier = next_frontier;
    }

    Ok(collected)
}

// Search IGDB candidates for manual override — returns lightweight list for picker UI
#[tauri::command]
pub async fn igdb_search_candidates(
    app_handle: tauri::AppHandle,
    game_name: String,
) -> Result<Vec<serde_json::Value>, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = get_http_client();

    // Clean the name and strip edition/version keywords so the search casts
    // a wider net — "Batman: Arkham City GOTY Edition" → "Batman Arkham City"
    let tokens: Vec<String> = game_name
        .chars()
        .map(|c| match c {
            '\u{2122}' | '\u{00AE}' | '\u{00A9}' => ' ',
            ':' | ';' | '_' | '\'' | '\u{2019}' | '"' | '+' | '.' => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .filter(|t| {
            let tl = t.to_lowercase();
            // Remove pure edition/version/qualifier tokens
            !EDITION_KEYWORDS.contains(&tl.as_str())
                && !matches!(tl.as_str(), "the" | "a" | "an" | "of" | "in" | "on" | "for")
        })
        .map(String::from)
        .collect();

    // Take up to 50% of meaningful tokens (min 2) to allow name variations
    let take = (tokens.len() / 2).max(2).min(tokens.len());
    let search_query = tokens[..take].join(" ");

    // Search with only flat/2-level fields — involved_companies.company.name
    // (3 levels) causes 400 when combined with `search`
    let results = igdb_query(
        &client,
        &client_id,
        &token,
        IGDB_API_GAMES,
        &format!(
            "fields id,name,cover.image_id,first_release_date,category,game_type; \
             search \"{}\"; where cover != null; limit 20;",
            search_query
        ),




    )
    .await?;

    let games: Vec<serde_json::Value> = results
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|g| !is_non_game(g))
        .collect();

    // Fetch developer info in a second query using the game IDs
    let ids: Vec<String> = games
        .iter()
        .filter_map(|g| g["id"].as_u64().map(|id| id.to_string()))
        .collect();

    let dev_map: std::collections::HashMap<u64, String> = if !ids.is_empty() {
        let id_list = ids.join(",");
        let dev_results = igdb_query(
            &client,
            &client_id,
            &token,
            IGDB_API_GAMES,
            &format!(
                "fields id,involved_companies.company.name,involved_companies.developer; \
                 where id = ({}) & cover != null; limit 20;",
                id_list
            ),
        )
        .await
        .unwrap_or(serde_json::json!([]));

        dev_results
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|g| {
                let id = g["id"].as_u64()?;
                let dev = g["involved_companies"]
                    .as_array()?
                    .iter()
                    .find(|c| c["developer"].as_bool().unwrap_or(false))?["company"]["name"]
                    .as_str()
                    .map(String::from)?;
                Some((id, dev))
            })
            .collect()
    } else {
        std::collections::HashMap::new()
    };

    let candidates = games
        .into_iter()
        .filter_map(|game| {
            let id = game["id"].as_u64()?;
            let year = chrono::DateTime::from_timestamp(
                game["first_release_date"].as_i64().unwrap_or(0),
                0,
            )
            .map(|dt| dt.year())
            .unwrap_or(0);
            let cover_url = game["cover"]["image_id"]
                .as_str()
                .map(|img_id| format!("{}/{}.jpg", IGDB_IMAGE_COVER_BIG, img_id))?;
            let developer = dev_map.get(&id).cloned().unwrap_or_default();
            Some(serde_json::json!({
                "id":        id,
                "name":      game["name"],
                "year":      year,
                "cover_url": cover_url,
                "developer": developer,
            }))
        })
        .collect();

    Ok(candidates)
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
    let client = get_http_client();

    let (cover_image_id, game_id, igdb_game) =
        fetch_igdb_game_by_id(&client, &client_id, &token, igdb_id).await?;

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
        &client,
        &client_id,
        &token,
        &game_dir,
        &igdb_game,
        &cover_image_id,
        game_id,
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
