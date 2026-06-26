use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;

// -- Constants ----------------------------------------------------------------

const IGDB_API_GAMES: &str = "https://api.igdb.com/v4/games";
const IGDB_API_EXTERNAL_GAMES: &str = "https://api.igdb.com/v4/external_games";
const IGDB_API_ARTWORKS: &str = "https://api.igdb.com/v4/artworks";
const IGDB_API_SCREENSHOTS: &str = "https://api.igdb.com/v4/screenshots";
const IGDB_IMAGE_COVER_BIG: &str = "https://images.igdb.com/igdb/image/upload/t_cover_big";
const IGDB_IMAGE_1080P: &str = "https://images.igdb.com/igdb/image/upload/t_1080p";

const EDITION_KEYWORDS: &[&str] = &[
    "deluxe", "digital", "edition", "skin", "pack", "bundle", "gold",
    "premium", "ultimate", "complete", "goty", "remastered", "definitive",
    "anniversary", "collector", "limited", "special", "enhanced", "expanded",
];

const IGDB_GAME_FIELDS: &str = "id,cover.image_id,name,summary,first_release_date,genres.name,rating,involved_companies.company.name,involved_companies.developer,involved_companies.publisher";

// -- Env config ----------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct EnvConfig {
    pub igdb_client_id: Option<String>,
    pub igdb_client_secret: Option<String>,
    pub steam_api_key: Option<String>,
}

#[tauri::command]
pub async fn read_env_config(app_handle: tauri::AppHandle) -> Result<EnvConfig, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let env_path = app_data_dir.join("env.json");
    if !env_path.exists() {
        return Ok(EnvConfig { igdb_client_id: None, igdb_client_secret: None, steam_api_key: None });
    }
    let data = std::fs::read_to_string(env_path).map_err(|e| e.to_string())?;
    let config: EnvConfig = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
pub async fn write_env_config(
    app_handle: tauri::AppHandle,
    config: EnvConfig,
) -> Result<String, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let env_path = app_data_dir.join("env.json");
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    std::fs::write(env_path, json).map_err(|e| e.to_string())?;
    Ok("Config saved".to_string())
}

fn load_env_config(app_handle: &tauri::AppHandle) -> Result<EnvConfig, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let env_path = app_data_dir.join("env.json");
    if !env_path.exists() {
        return Err("No env.json — configure IGDB keys first".into());
    }
    let data = std::fs::read_to_string(env_path).map_err(|e| e.to_string())?;
    serde_json::from_str::<EnvConfig>(&data).map_err(|e| e.to_string())
}

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
        let cache = TWITCH_TOKEN.lock().unwrap();
        if let Some(ref t) = *cache {
            if t.expires > Instant::now() + Duration::from_secs(60) {
                return Ok(t.access_token.clone());
            }
        }
    }

    #[derive(Deserialize)]
    struct TwitchResp { access_token: String, expires_in: u64 }

    let client = get_http_client();
    let http = client
        .post("https://id.twitch.tv/oauth2/token")
        .query(&[
            ("client_id",     client_id),
            ("client_secret", client_secret),
            ("grant_type",    "client_credentials"),
        ])
        .send()
        .await
        .map_err(|e| format!("Twitch request failed: {}", e))?;
    if !http.status().is_success() {
        let status = http.status();
        let body   = http.text().await.unwrap_or_default();
        return Err(format!("Twitch auth failed (HTTP {}): {}", status, body));
    }
    let resp = http.json::<TwitchResp>().await
        .map_err(|e| format!("Twitch parse failed: {}", e))?;

    let token   = resp.access_token.clone();
    let expires = Instant::now() + Duration::from_secs(resp.expires_in);
    *TWITCH_TOKEN.lock().unwrap() = Some(TwitchToken { access_token: resp.access_token, expires });
    Ok(token)
}

// -- IGDB helpers --------------------------------------------------------------

async fn igdb_query(
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
            .send().await.map_err(|e| e.to_string())?;

        let status = resp.status();

        if status.as_u16() == 429 {
            if attempt == MAX_RETRIES {
                return Err(format!("IGDB error (HTTP 429): rate limited after {} retries", MAX_RETRIES));
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

        return resp.json::<serde_json::Value>().await.map_err(|e| e.to_string());
    }
    Err("IGDB: unreachable".into())
}

fn extract_cover_and_game(game: &serde_json::Value) -> (Option<String>, Option<u64>, serde_json::Value) {
    let cover   = game["cover"]["image_id"].as_str().map(String::from);
    let game_id = game["id"].as_u64();
    (cover, game_id, game.clone())
}

fn normalize_name(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{2122}' | '\u{00AE}' | '\u{00A9}' => ' ', // ™ ® ©
            ':' | ';' | '_' | '-' | '\'' | '\u{2019}' | '"' => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn score_candidate(query_norm: &str, candidate_raw: &str) -> f64 {
    let q = query_norm;
    let c = {
        let tmp = candidate_raw.chars().map(|ch| match ch {
            '\u{2122}' | '\u{00AE}' | '\u{00A9}' => ' ',
            ':' | '_' | '-' | '\'' | '\u{2019}'   => ' ',
            ch => ch,
        }).collect::<String>();
        tmp.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
    };

    let q_tokens: Vec<&str> = q.split_whitespace().collect();
    if q_tokens.is_empty() { return 0.0; }

    let matched = q_tokens.iter().filter(|t| c.contains(**t)).count();
    let mut score = matched as f64 / q_tokens.len() as f64;

    let edition_penalty: f64 = EDITION_KEYWORDS.iter()
        .filter(|&&w| c.contains(w) && !q.contains(w))
        .count() as f64 * 0.25;
    score -= edition_penalty;

    let len_ratio = q.len() as f64 / c.len().max(1) as f64;
    score += (1.0 - (len_ratio - 1.0).abs().min(1.0)) * 0.1;

    score
}

async fn download_as_webp(client: &reqwest::Client, url: &str, dest: &std::path::Path) {
    let Ok(resp)  = client.get(url).send().await else { return };
    let Ok(bytes) = resp.bytes().await            else { return };
    let Ok(img)   = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg)
        else { return };
    let _ = img.save_with_format(dest, image::ImageFormat::WebP);
}

async fn resolve_igdb_game(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    app_id: &str,
    game_name: &str,
) -> Result<(String, Option<u64>, serde_json::Value), String> {
    // For IGDB search: remove symbols AND replace problematic punctuation with spaces
    // "NieR:Automata™" → "NieR Automata", "STEINS;GATE" → "STEINS GATE"
    let search_query = game_name
        .chars()
        .map(|c| match c {
            '\u{2122}' | '\u{00AE}' | '\u{00A9}' => ' ', // ™ ® ©
            ':' | ';' | '_' | '\'' | '\u{2019}' | '"' => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    // Normalized version for comparison after search
    let name_norm = normalize_name(game_name);

    eprintln!("[IGDB] Resolving: {:?} (app_id={}, search={:?}, norm={:?})", game_name, app_id, search_query, name_norm);

    // Try Steam ID lookup first
    let ext = igdb_query(client, client_id, token,
        IGDB_API_EXTERNAL_GAMES,
        &format!("fields game.{IGDB_GAME_FIELDS}; where uid = \"{app_id}\" & category = 1; limit 1;"),
    ).await?;

    if let Some(g) = ext.as_array().and_then(|a| a.first()).filter(|r| !r["game"].is_null()) {
        let (cover_id, igdb_game_id, igdb_game) = extract_cover_and_game(&g["game"]);
        eprintln!("[IGDB] Steam ID hit: cover={:?}", cover_id);
        if let Some(id) = cover_id {
            return Ok((id, igdb_game_id, igdb_game));
        }
    } else {
        eprintln!("[IGDB] Steam ID miss for app_id={}", app_id);
    }

    // Fallback: fuzzy search with cleaned query
    let fuzzy = igdb_query(client, client_id, token,
        IGDB_API_GAMES,
        &format!("fields {IGDB_GAME_FIELDS}; search \"{search_query}\"; where cover != null; limit 10;"),
    ).await?;

    if let Some(arr) = fuzzy.as_array() {
        eprintln!("[IGDB] Fuzzy results: {:?}", arr.iter().filter_map(|r| r["name"].as_str()).collect::<Vec<_>>());

        // Normalized exact match first
        if let Some(game) = arr.iter()
            .find(|r| r["name"].as_str().map(|n| normalize_name(n) == name_norm).unwrap_or(false))
        {
            let (cover_id, igdb_game_id, igdb_game) = extract_cover_and_game(game);
            eprintln!("[IGDB] Normalized match: {:?}", game["name"].as_str());
            if let Some(id) = cover_id {
                return Ok((id, igdb_game_id, igdb_game));
            }
        }

        // Similarity scoring as last resort
        let best = arr.iter()
            .filter_map(|r| {
                let n = r["name"].as_str()?;
                let score = score_candidate(&name_norm, n);
                eprintln!("[IGDB]   candidate {:?} score={:.2}", n, score);
                if score > 0.5 { Some((score, r)) } else { None }
            })
            .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        if let Some((score, game)) = best {
            let (cover_id, igdb_game_id, igdb_game) = extract_cover_and_game(game);
            eprintln!("[IGDB] Score match: {:?} score={:.2}", game["name"].as_str(), score);
            if let Some(id) = cover_id {
                return Ok((id, igdb_game_id, igdb_game));
            }
        }
    }

    eprintln!("[IGDB] No match found for {:?}", game_name);
    Err(format!("No match found for {:?}", game_name))
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

    std::fs::create_dir_all(game_dir).map_err(|e| e.to_string())?;

    let cover_path = game_dir.join(format!("{}_cover.webp", cover_image_id));
    let banner_path = banner_id.as_ref().map(|bid| game_dir.join(format!("{}_banner.webp", bid)));

    let cover_fut = async {
        if cover_path.exists() { return; }
        download_as_webp(
            client,
            &format!("{}/{}.jpg", IGDB_IMAGE_COVER_BIG, cover_image_id),
            &cover_path,
        ).await;
    };
    let banner_fut = async {
        if let (Some(bid), Some(bpath)) = (&banner_id, &banner_path) {
            if bpath.exists() { return; }
            download_as_webp(
                client,
                &format!("{}/{}.jpg", IGDB_IMAGE_1080P, bid),
                bpath,
            ).await;
        }
    };
    futures::join!(cover_fut, banner_fut);

    if !igdb_game.is_null() {
        let _ = save_game_info(game_dir, igdb_game, app_id);
    }

    Ok(())
}

async fn fetch_landscape_image_id(
    client:    &reqwest::Client,
    client_id: &str,
    token:     &str,
    game_id:   u64,
) -> Option<String> {
    if let Ok(arts) = igdb_query(client, client_id, token,
        IGDB_API_ARTWORKS,
        &format!("fields image_id,width,height; where game = {} & alpha_channel = false; limit 10;", game_id),
    ).await {
        if let Some(arr) = arts.as_array() {
            for entry in arr {
                let w = entry["width"].as_f64().unwrap_or(0.0);
                let h = entry["height"].as_f64().unwrap_or(1.0);
                if h > 0.0 && w / h >= 1.5 {
                    if let Some(id) = entry["image_id"].as_str() {
                        return Some(id.to_string());
                    }
                }
            }
        }
    }
    let ss = igdb_query(client, client_id, token,
        IGDB_API_SCREENSHOTS,
        &format!("fields image_id; where game = {}; limit 1;", game_id),
    ).await.ok()?;
    ss[0]["image_id"].as_str().map(String::from)
}

fn save_game_info(game_dir: &std::path::PathBuf, igdb_game: &serde_json::Value, app_id: &str) -> Result<(), String> {
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
            genre_names.into_iter().map(serde_json::Value::String).collect()
        );
    }

    if let Some(companies) = igdb_game["involved_companies"].as_array() {
        let mut developers = Vec::new();
        let mut publishers = Vec::new();
        for company in companies {
            let is_dev = company["developer"].as_bool().unwrap_or(false);
            let is_pub = company["publisher"].as_bool().unwrap_or(false);
            if let Some(name) = company["company"]["name"].as_str() {
                if is_dev { developers.push(name.to_string()); }
                if is_pub { publishers.push(name.to_string()); }
            }
        }
        if !developers.is_empty() {
            info["developers"] = serde_json::Value::Array(
                developers.into_iter().map(serde_json::Value::String).collect()
            );
        }
        if !publishers.is_empty() {
            info["publishers"] = serde_json::Value::Array(
                publishers.into_iter().map(serde_json::Value::String).collect()
            );
        }
    }

    let info_path = game_dir.join("info.json");
    std::fs::write(&info_path, serde_json::to_string_pretty(&info).unwrap_or_default())
        .map_err(|e| e.to_string())
}

// VN filter: genre 34 in top-3, not RPG (12) or Fighting (4), with parent inheritance
fn detect_vn(game: &serde_json::Value) -> bool {
    let genres = game["genres"].as_array().cloned().unwrap_or_default();
    let top3: Vec<u64> = genres.iter().take(3).filter_map(|g| g["id"].as_u64()).collect();
    let all_ids: Vec<u64> = genres.iter().filter_map(|g| g["id"].as_u64()).collect();

    let has_vn = top3.contains(&34) && !all_ids.contains(&12) && !all_ids.contains(&4);
    if has_vn { return true; }

    for parent_key in &["version_parent", "parent_game"] {
        let parent = &game[parent_key];
        if parent.is_null() { continue; }
        let pg = parent["genres"].as_array().cloned().unwrap_or_default();
        let pt3: Vec<u64> = pg.iter().take(3).filter_map(|g| g["id"].as_u64()).collect();
        let pa: Vec<u64>  = pg.iter().filter_map(|g| g["id"].as_u64()).collect();
        if pt3.contains(&34) && !pa.contains(&12) && !pa.contains(&4) {
            return true;
        }
    }
    false
}

// -- Tauri commands ------------------------------------------------------------

#[tauri::command]
pub async fn igdb_get_cover_by_steam_id(
    app_handle: tauri::AppHandle,
    app_id: String,
    game_name: String,
) -> Result<Option<String>, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let meta_root    = app_data_dir.join("metadata");
    let game_dir     = meta_root.join(&app_id);

    if game_dir.exists() {
        let mut has_cover = false;
        let mut has_banner = false;
        if let Ok(entries) = std::fs::read_dir(&game_dir) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.ends_with("_cover.webp")  { has_cover  = true; }
                if n.ends_with("_banner.webp") { has_banner = true; }
            }
        }
        if has_cover && has_banner { return Ok(Some(game_dir.to_string_lossy().to_string())); }
    }

    let cfg           = load_env_config(&app_handle)?;
    let client_id     = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token         = get_twitch_token(&client_id, &client_secret).await?;
    let client        = get_http_client();

    let (cover_image_id, igdb_game_id, igdb_game) = resolve_igdb_game(&client, &client_id, &token, &app_id, &game_name).await?;

    download_game_metadata(&client, &client_id, &token, &game_dir, &igdb_game, &cover_image_id, igdb_game_id, &app_id).await?;

    let cover_path = game_dir.join(format!("{}_cover.webp", cover_image_id));

    let index_path = meta_root.join("index.json");
    let mut index: serde_json::Value = std::fs::read_to_string(&index_path)
        .ok().and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = index.as_object_mut() {
        let mut entry = serde_json::json!({
            "name": game_name,
            "cover": cover_path.to_string_lossy(),
        });
        if let Some(banner_id) = igdb_game_id {
            let banner_path = game_dir.join(format!("{}_banner.webp", banner_id));
            if banner_path.exists() {
                entry["banner"] = serde_json::Value::String(banner_path.to_string_lossy().to_string());
            }
        }
        obj.insert(app_id.clone(), entry);
    }
    let _ = std::fs::write(&index_path, serde_json::to_string_pretty(&index).unwrap_or_default());

    Ok(Some(cover_path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn read_metadata_index(
    app_handle: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    let meta_root  = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("metadata");
    let index_path = meta_root.join("index.json");
    if !index_path.exists() {
        return Ok(std::collections::HashMap::new());
    }
    let data  = std::fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let index: serde_json::Value = serde_json::from_str(&data).unwrap_or_else(|_| serde_json::json!({}));
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
    let meta_root = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("metadata");
    let info_path = meta_root.join(&app_id).join("info.json");
    if !info_path.exists() {
        return Ok(serde_json::json!({}));
    }
    let data = std::fs::read_to_string(&info_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn file_to_data_url(file_path: String) -> Result<String, String> {
    let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    let mime = if file_path.ends_with(".webp") {
        "image/webp"
    } else if file_path.ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    };
    Ok(format!("data:{};base64,{}", mime, crate::utils::base64_encode(&bytes)))
}

#[tauri::command]
pub async fn igdb_search(
    app_handle: tauri::AppHandle,
    query: String,
    is_visual_novel: bool,
) -> Result<serde_json::Value, String> {
    if query.is_empty() {
        return Ok(serde_json::json!([]));
    }

    let cfg           = load_env_config(&app_handle)?;
    let client_id     = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token         = get_twitch_token(&client_id, &client_secret).await?;
    let client        = get_http_client();
    let safe_query    = query.replace('"', "");

    const PAGE: usize = 100;
    let mut all: Vec<serde_json::Value> = Vec::new();
    let mut offset: usize = 0;

    loop {
        let page = igdb_query(
            &client,
            &client_id,
            &token,
            IGDB_API_GAMES,
            &format!(
                "fields id,name,cover.image_id,rating,first_release_date,\
                 genres.id,genres.name,\
                 version_parent.id,version_parent.genres.id,\
                 parent_game.id,parent_game.genres.id,\
                 version_title; \
                 search \"{}\"; where cover != null; limit {}; offset {};",
                safe_query, PAGE, offset
            ),
        ).await?;

        let items = page.as_array().cloned().unwrap_or_default();
        let count = items.len();

        for item in items {
            if !item["version_parent"].is_null() || !item["version_title"].is_null() {
                continue;
            }
            let vn = detect_vn(&item);
            if is_visual_novel == vn {
                all.push(item);
            }
        }

        if count < PAGE { break; }
        offset += PAGE;
    }

    Ok(serde_json::Value::Array(all))
}

#[tauri::command]
pub async fn igdb_get_game_detail(
    app_handle: tauri::AppHandle,
    igdb_id: u64,
) -> Result<serde_json::Value, String> {
    let cfg           = load_env_config(&app_handle)?;
    let client_id     = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token         = get_twitch_token(&client_id, &client_secret).await?;
    let client        = get_http_client();

    let games = igdb_query(
        &client, &client_id, &token,
        IGDB_API_GAMES,
        &format!(
            "fields id,name,cover.image_id,summary,first_release_date,rating,\
             genres.name,involved_companies.company.name,\
             involved_companies.developer,involved_companies.publisher,platforms.name; \
             where id = {}; limit 1;",
            igdb_id
        ),
    ).await?;

    let mut game = games[0].clone();
    if game.is_null() {
        return Ok(serde_json::json!(null));
    }

    let banner_id = fetch_landscape_image_id(&client, &client_id, &token, igdb_id).await;
    game["banner_image_id"] = banner_id
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null);

    if let Ok(ext) = igdb_query(
        &client, &client_id, &token,
        IGDB_API_EXTERNAL_GAMES,
        &format!("fields category,url; where game = {}; limit 30;", igdb_id),
    ).await {
        if let Some(arr) = ext.as_array() {
            let links: Vec<serde_json::Value> = arr.iter()
                .filter_map(|e| {
                    let url = e["url"].as_str().filter(|u| !u.is_empty())?;
                    let platform = if url.contains("store.steampowered.com") { "steam" }
                        else if url.contains("gog.com")           { "gog" }
                        else if url.contains("epicgames.com")     { "epic" }
                        else if url.contains("xbox.com") || url.contains("microsoft.com/store") { "xbox" }
                        else if url.contains("playstation.com")   { "playstation" }
                        else { return None; };
                    Some(serde_json::json!({ "platform": platform, "url": url }))
                })
                .collect();
            if !links.is_empty() {
                game["store_links"] = serde_json::Value::Array(links);
            }
        }
    }

    Ok(game)
}
