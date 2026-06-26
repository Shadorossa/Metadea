use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

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
    let path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("env.json");
    if !path.exists() {
        return Err("No env.json — configure IGDB keys first".into());
    }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str::<EnvConfig>(&data).map_err(|e| e.to_string())
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

    let client = reqwest::Client::new();
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
    let resp = client
        .post(endpoint)
        .header("Client-ID", client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body.to_string())
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(format!("IGDB error (HTTP {}): {}", s, b));
    }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

fn extract_cover_and_game(game: &serde_json::Value) -> (Option<String>, Option<u64>, serde_json::Value) {
    let cover   = game["cover"]["image_id"].as_str().map(String::from);
    let game_id = game["id"].as_u64();
    (cover, game_id, game.clone())
}

async fn fetch_banner_id(
    client:    &reqwest::Client,
    client_id: &str,
    token:     &str,
    game_id:   u64,
) -> Option<String> {
    if let Ok(arts) = igdb_query(client, client_id, token,
        "https://api.igdb.com/v4/artworks",
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
        "https://api.igdb.com/v4/screenshots",
        &format!("fields image_id; where game = {}; limit 1;", game_id),
    ).await.ok()?;
    ss[0]["image_id"].as_str().map(String::from)
}

async fn fetch_key_art_or_screenshot_id(
    client:    &reqwest::Client,
    client_id: &str,
    token:     &str,
    game_id:   u64,
) -> Option<String> {
    // Key art: non-transparent artworks, prefer landscape (w/h >= 1.5)
    if let Ok(arts) = igdb_query(client, client_id, token,
        "https://api.igdb.com/v4/artworks",
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
    // Fallback: first screenshot
    let ss = igdb_query(client, client_id, token,
        "https://api.igdb.com/v4/screenshots",
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
    lang: Option<String>,
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
                if n.ends_with("_cover.jpg")  { has_cover  = true; }
                if n.ends_with("_banner.jpg") { has_banner = true; }
            }
        }
        if has_cover && has_banner { return Ok(Some(game_dir.to_string_lossy().to_string())); }
    }

    let cfg           = load_env_config(&app_handle)?;
    let client_id     = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token         = get_twitch_token(&client_id, &client_secret).await?;
    let client        = reqwest::Client::new();
    let safe          = game_name.replace('"', "");
    let name_low      = game_name.to_lowercase();

    const FULL_FIELDS: &str = "id,cover.image_id,name,summary,first_release_date,genres.name,rating,involved_companies.company.name,involved_companies.developer,involved_companies.publisher";

    let ext = igdb_query(&client, &client_id, &token,
        "https://api.igdb.com/v4/external_games",
        &format!("fields game.id,game.cover.image_id,game.name,game.summary,game.first_release_date,game.genres.name,game.rating,game.involved_companies.company.name,game.involved_companies.developer,game.involved_companies.publisher; where uid = \"{app_id}\"; limit 1;"),
    ).await?;
    let (cover_id, igdb_game_id, igdb_game) = if !ext[0]["game"].is_null() {
        extract_cover_and_game(&ext[0]["game"])
    } else {
        let exact = igdb_query(&client, &client_id, &token,
            "https://api.igdb.com/v4/games",
            &format!("fields {FULL_FIELDS}; where name = \"{safe}\" & cover != null; limit 1;"),
        ).await?;
        let (c, gid, g) = extract_cover_and_game(&exact[0]);
        if c.is_some() {
            (c, gid, g)
        } else {
            let search = igdb_query(&client, &client_id, &token,
                "https://api.igdb.com/v4/games",
                &format!("fields name,{FULL_FIELDS}; search \"{safe}\"; where cover != null; limit 5;"),
            ).await?;
            let best = search.as_array().and_then(|arr| {
                arr.iter()
                    .find(|r| r["name"].as_str().map(|n| n.to_lowercase() == name_low).unwrap_or(false))
                    .or_else(|| arr.iter().find(|r| {
                        r["name"].as_str().map(|n| n.to_lowercase().starts_with(&name_low)).unwrap_or(false)
                    }))
                    .or_else(|| arr.first())
            });
            best.map(|r| extract_cover_and_game(r)).unwrap_or((None, None, serde_json::json!({})))
        }
    };

    let cover_image_id = match cover_id {
        Some(id) => id,
        None     => return Ok(None),
    };

    let banner_id = if let Some(gid) = igdb_game_id {
        fetch_banner_id(&client, &client_id, &token, gid).await
    } else {
        None
    };

    std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;

    let cover_path = game_dir.join(format!("{}_cover.jpg", cover_image_id));
    if !cover_path.exists() {
        let bytes = client
            .get(format!("https://images.igdb.com/igdb/image/upload/t_cover_big/{}.jpg", cover_image_id))
            .send().await.map_err(|e| e.to_string())?
            .bytes().await.map_err(|e| e.to_string())?;
        std::fs::write(&cover_path, &bytes).map_err(|e| e.to_string())?;
    }

    if let Some(bid) = &banner_id {
        let banner_path = game_dir.join(format!("{}_banner.jpg", bid));
        if !banner_path.exists() {
            if let Ok(resp) = client
                .get(format!("https://images.igdb.com/igdb/image/upload/t_screenshot_big/{}.jpg", bid))
                .send().await
            {
                if let Ok(bytes) = resp.bytes().await {
                    let _ = std::fs::write(&banner_path, &bytes);
                }
            }
        }
    }

    if !igdb_game.is_null() {
        let _ = save_game_info(&game_dir, &igdb_game, &app_id);
    }

    let index_path = meta_root.join("index.json");
    let mut index: serde_json::Value = std::fs::read_to_string(&index_path)
        .ok().and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = index.as_object_mut() {
        let mut entry = serde_json::json!({
            "name": game_name,
            "cover": cover_path.to_string_lossy(),
        });
        if let Some(bid) = &banner_id {
            let banner_path = game_dir.join(format!("{}_banner.jpg", bid));
            entry["banner"] = serde_json::Value::String(banner_path.to_string_lossy().to_string());
        }
        obj.insert(app_id.clone(), entry);
    }
    let _ = std::fs::write(&index_path, serde_json::to_string_pretty(&index).unwrap_or_default());

    // Download Steam achievements (best-effort)
    let ach_lang = lang.as_deref().unwrap_or("spanish");
    crate::steam::download_achievements(&app_handle, &app_id, &game_dir, ach_lang).await;

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
    Ok(format!("data:image/jpeg;base64,{}", crate::utils::base64_encode(&bytes)))
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
    let client        = reqwest::Client::new();
    let safe_query    = query.replace('"', "");

    const PAGE: usize = 100;
    let mut all: Vec<serde_json::Value> = Vec::new();
    let mut offset: usize = 0;

    loop {
        let page = igdb_query(
            &client,
            &client_id,
            &token,
            "https://api.igdb.com/v4/games",
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

        let items = page.as_array().map(|a| a.clone()).unwrap_or_default();
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
    let client        = reqwest::Client::new();

    let games = igdb_query(
        &client, &client_id, &token,
        "https://api.igdb.com/v4/games",
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

    let banner_id = fetch_key_art_or_screenshot_id(&client, &client_id, &token, igdb_id).await;
    game["banner_image_id"] = banner_id
        .map(serde_json::Value::String)
        .unwrap_or(serde_json::Value::Null);

    if let Ok(ext) = igdb_query(
        &client, &client_id, &token,
        "https://api.igdb.com/v4/external_games",
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
