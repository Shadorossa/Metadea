use std::path::PathBuf;
use tauri::Manager;

use crate::platform_scanning::steam_root;
use crate::db::ToStringErr;

/// Reads the user's configured Steam Web API key, if any — shared by every
/// endpoint that needs it instead of each repeating the same lookup query.
fn steam_api_key(db: &crate::db::MetadeaDb) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    let conn = db.conn.lock().str_err()?;
    Ok(conn
        .query_row("SELECT value FROM app_env WHERE name = 'steam_api_key'", [], |r| r.get::<_, String>(0))
        .optional()
        .str_err()?
        .filter(|s| !s.is_empty()))
}

fn is_hidden_achievement(schema: Option<&serde_json::Value>) -> bool {
    match schema.and_then(|achievement| achievement.get("hidden")) {
        Some(serde_json::Value::Bool(hidden)) => *hidden,
        Some(serde_json::Value::Number(hidden)) => hidden.as_u64() == Some(1),
        Some(serde_json::Value::String(hidden)) => hidden == "1" || hidden.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

/// Downloads achievement icons (both locked and unlocked) and saves achievements.json.
/// Always refreshes progress from Steam; only skips icon files that already exist on disk.
/// Re-saves achievements.json whenever the unlock state has changed.
pub async fn download_achievements(
    app_handle: &tauri::AppHandle,
    app_id: &str,
    game_dir: &PathBuf,
    lang: &str,
) {
    let db = app_handle.state::<crate::db::MetadeaDb>();
    let api_key = match steam_api_key(&db) {
        Ok(Some(k)) => k,
        _ => return,
    };
    let steam_id = match detect_steam_user_id() {
        Some(id) => id,
        None => return,
    };
    let client = crate::igdb::get_http_client();

    // Always fetch current player progress
    let progress_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/\
         ?key={}&steamid={}&appid={}&l={}",
        api_key, steam_id, app_id, lang
    );
    let progress_list: Vec<serde_json::Value> = match client.get(&progress_url).send().await {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|j| j["playerstats"]["achievements"].as_array().cloned())
            .unwrap_or_default(),
        _ => return,
    };
    if progress_list.is_empty() {
        return;
    }

    // Check if existing achievements.json already matches current unlock state (skip heavy work)
    let out_path = game_dir.join("achievements.json");
    let existing_unlocked: Option<u64> = std::fs::read_to_string(&out_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(&s).ok())
        .map(|arr| {
            arr.iter()
                .filter(|a| a["achieved"].as_u64() == Some(1))
                .count() as u64
        });
    let current_unlocked = progress_list
        .iter()
        .filter(|a| a["achieved"].as_u64() == Some(1))
        .count() as u64;

    let icons_dir = game_dir.join("achievements");
    let icons_exist = icons_dir.exists()
        && std::fs::read_dir(&icons_dir)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false);

    // Only skip if nothing changed AND icons are already on disk
    if existing_unlocked == Some(current_unlocked) && icons_exist {
        return;
    }

    // Fetch schema for display names + both icon URLs
    let schema_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/\
         ?key={}&appid={}&l={}",
        api_key, app_id, lang
    );
    let schema_map: std::collections::HashMap<String, serde_json::Value> =
        match client.get(&schema_url).send().await {
            Ok(r) if r.status().is_success() => r
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|j| {
                    j["game"]["availableGameStats"]["achievements"]
                        .as_array()
                        .cloned()
                })
                .map(|arr| {
                    arr.into_iter()
                        .filter_map(|a| {
                            let name = a["name"].as_str()?.to_string();
                            Some((name, a))
                        })
                        .collect()
                })
                .unwrap_or_default(),
            _ => std::collections::HashMap::new(),
        };

    let _ = std::fs::create_dir_all(&icons_dir);

    async fn fetch_icon(client: &reqwest::Client, url: &str, path: &PathBuf) {
        if path.exists() || url.is_empty() {
            return;
        }
        if let Ok(resp) = client.get(url).send().await {
            if let Ok(bytes) = resp.bytes().await {
                let _ = std::fs::write(path, &bytes);
            }
        }
    }

    let mut merged: Vec<serde_json::Value> = Vec::new();
    for p in &progress_list {
        let apiname = p["apiname"].as_str().unwrap_or("");
        let schema = schema_map.get(apiname);
        let achieved = p["achieved"].as_u64().unwrap_or(0);

        let icon_url = schema.and_then(|s| s["icon"].as_str()).unwrap_or("");
        let icon_gray_url = schema.and_then(|s| s["icongray"].as_str()).unwrap_or("");

        // Download both locked and unlocked icons
        let icon_file = format!("{}_unlocked.jpg", apiname);
        let icon_gray_file = format!("{}_locked.jpg", apiname);
        fetch_icon(&client, icon_url, &icons_dir.join(&icon_file)).await;
        fetch_icon(&client, icon_gray_url, &icons_dir.join(&icon_gray_file)).await;

        let display_name = schema
            .and_then(|s| s["displayName"].as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| p["name"].as_str().unwrap_or(apiname));
        let description = schema
            .and_then(|s| s["description"].as_str())
            .filter(|s| !s.is_empty())
            .or_else(|| p["description"].as_str().filter(|s| !s.is_empty()))
            .unwrap_or("");
        let hidden = is_hidden_achievement(schema);

        merged.push(serde_json::json!({
            "apiname":          apiname,
            "name":             display_name,
            "description":      description,
            "achieved":         achieved,
            "hidden":           hidden,
            "unlocktime":       p["unlocktime"].as_u64().unwrap_or(0),
            "icon_unlocked":    icon_file,
            "icon_locked":      icon_gray_file,
        }));
    }

    let _ = std::fs::write(
        &out_path,
        serde_json::to_string_pretty(&merged).unwrap_or_default(),
    );
}

/// Reads the most-recently-used Steam ID from loginusers.vdf.
pub fn detect_steam_user_id() -> Option<String> {
    let root = steam_root()?;
    let vdf_path = root.join("config").join("loginusers.vdf");
    let content = std::fs::read_to_string(vdf_path).ok()?;

    let mut current_id: Option<String> = None;
    let mut most_recent_id: Option<String> = None;

    for line in content.lines() {
        let line = line.trim();
        // Lines like: "76561198xxxxxxxxx"  (bare 17-digit Steam ID at top level)
        if line.starts_with('"') && line.ends_with('"') {
            let val = line.trim_matches('"');
            if val.len() == 17 && val.chars().all(|c| c.is_ascii_digit()) {
                current_id = Some(val.to_string());
            }
        }
        // "MostRecent"  "1"
        if line.contains("\"MostRecent\"") && line.contains("\"1\"") {
            if let Some(id) = &current_id {
                most_recent_id = Some(id.clone());
            }
        }
    }

    most_recent_id.or(current_id)
}

/// Lists recent screenshots for this app from all local Steam accounts.
/// Steam stores these in userdata/<account-id>/760/remote/<appid>/screenshots.
#[derive(serde::Serialize)]
pub struct SteamScreenshot {
    path: String,
    thumbnail_path: String,
}

#[tauri::command]
pub async fn steam_get_screenshots(app_id: String) -> Result<Vec<SteamScreenshot>, String> {
    if app_id.is_empty() || !app_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid Steam app ID".to_string());
    }

    let root = steam_root().ok_or_else(|| "Steam installation not found".to_string())?;
    let userdata = root.join("userdata");
    let accounts = match std::fs::read_dir(userdata) {
        Ok(accounts) => accounts,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };

    let mut screenshots: Vec<(std::time::SystemTime, SteamScreenshot)> = Vec::new();
    for account in accounts.flatten() {
        let account_path = account.path();
        if !account_path.is_dir()
            || !account.file_name().to_string_lossy().chars().all(|c| c.is_ascii_digit())
        {
            continue;
        }

        let screenshots_dir = account_path
            .join("760")
            .join("remote")
            .join(&app_id)
            .join("screenshots");
        let entries = match std::fs::read_dir(screenshots_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => continue,
        };

        screenshots.extend(entries.flatten().filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let extension = path.extension()?.to_str()?.to_ascii_lowercase();
            if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "bmp" | "webp") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().unwrap_or(std::time::UNIX_EPOCH);
            let thumbnail_path = path
                .parent()?
                .join("thumbnails")
                .join(path.file_name()?);
            let thumbnail_path = if thumbnail_path.is_file() { thumbnail_path } else { path.clone() };
            Some((modified, SteamScreenshot {
                path: path.to_string_lossy().into_owned(),
                thumbnail_path: thumbnail_path.to_string_lossy().into_owned(),
            }))
        }));
    }

    screenshots.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(screenshots.into_iter().map(|(_, path)| path).collect())
}

#[tauri::command]
pub async fn steam_achievements_download(
    app_handle: tauri::AppHandle,
    app_id: String,
    lang: Option<String>,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?;
    let game_dir = app_data_dir.join("metadata").join(&app_id);
    std::fs::create_dir_all(&game_dir).str_err()?;
    let l = lang.unwrap_or_else(|| "spanish".to_string());
    download_achievements(&app_handle, &app_id, &game_dir, &l).await;
    Ok(())
}

#[tauri::command]
pub async fn steam_achievement_icon(
    app_handle: tauri::AppHandle,
    app_id: String,
    filename: String,
) -> Result<String, String> {
    let icons_dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("metadata")
        .join(&app_id)
        .join("achievements");
    let path = icons_dir.join(&filename);
    if !path.exists() {
        return Err("not found".into());
    }
    let bytes = std::fs::read(&path).str_err()?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        crate::utils::base64_encode(&bytes)
    ))
}

#[tauri::command]
pub async fn steam_get_owned_games(
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let api_key = steam_api_key(&app_handle.state::<crate::db::MetadeaDb>())?
        .ok_or("No Steam API key configured")?;

    let steam_id =
        detect_steam_user_id().ok_or("Could not detect Steam user ID from loginusers.vdf")?;

    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/\
         ?key={}&steamid={}&include_appinfo=true&include_played_free_games=true",
        api_key, steam_id
    );

    let client = crate::igdb::get_http_client();
    let resp = client.get(&url).send().await.str_err()?;
    if !resp.status().is_success() {
        return Err(format!("Steam API error (HTTP {})", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.str_err()?;
    Ok(json["response"].clone())
}

#[tauri::command]
pub async fn steam_get_player_achievements(
    app_handle: tauri::AppHandle,
    app_id: u32,
    lang: Option<String>,
) -> Result<serde_json::Value, String> {
    let api_key = steam_api_key(&app_handle.state::<crate::db::MetadeaDb>())?
        .ok_or("No Steam API key")?;
    let steam_id = detect_steam_user_id().ok_or("Could not detect Steam user ID")?;
    let language = lang.unwrap_or_else(|| "spanish".to_string());

    let client = crate::igdb::get_http_client();

    // Fetch player progress (achieved status + unlock times)
    let progress_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/\
         ?key={}&steamid={}&appid={}&l={}",
        api_key, steam_id, app_id, language
    );
    let progress_resp = client
        .get(&progress_url)
        .send()
        .await
        .str_err()?;
    if !progress_resp.status().is_success() {
        return Err(format!("Steam API error (HTTP {})", progress_resp.status()));
    }
    let progress_json: serde_json::Value = progress_resp.json().await.str_err()?;
    let progress_list = progress_json["playerstats"]["achievements"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    // Fetch schema for display names, descriptions and icon URLs
    let schema_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/\
         ?key={}&appid={}&l={}",
        api_key, app_id, language
    );
    let schema_resp = client
        .get(&schema_url)
        .send()
        .await
        .str_err()?;
    let schema_map: std::collections::HashMap<String, serde_json::Value> =
        if schema_resp.status().is_success() {
            let schema_json: serde_json::Value = schema_resp.json().await.unwrap_or_default();
            schema_json["game"]["availableGameStats"]["achievements"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| {
                            let name = a["name"].as_str()?.to_string();
                            Some((name, a.clone()))
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            std::collections::HashMap::new()
        };

    // Merge: progress + schema
    let merged: Vec<serde_json::Value> = progress_list
        .iter()
        .map(|p| {
            let apiname = p["apiname"].as_str().unwrap_or("");
            let schema = schema_map.get(apiname);
            let display_name = schema
                .and_then(|s| s["displayName"].as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| p["name"].as_str().unwrap_or(apiname));
            let description = schema
                .and_then(|s| s["description"].as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| p["description"].as_str().filter(|s| !s.is_empty()))
                .unwrap_or("");
            let icon = schema
                .and_then(|s| {
                    if p["achieved"].as_u64() == Some(1) {
                        s["icon"].as_str()
                    } else {
                        s["icongray"].as_str().or_else(|| s["icon"].as_str())
                    }
                })
                .unwrap_or("");
            let hidden = is_hidden_achievement(schema);
            serde_json::json!({
                "apiname":     apiname,
                "achieved":    p["achieved"].as_u64().unwrap_or(0),
                "hidden":      hidden,
                "unlocktime":  p["unlocktime"].as_u64().unwrap_or(0),
                "name":        display_name,
                "description": description,
                "icon":        icon,
            })
        })
        .collect();

    let total = merged.len() as u64;
    let unlocked = merged
        .iter()
        .filter(|a| a["achieved"].as_u64() == Some(1))
        .count() as u64;

    // Sort: unlocked first, then locked
    let mut sorted = merged;
    sorted.sort_by_key(|a| {
        if a["achieved"].as_u64() == Some(1) {
            0u8
        } else {
            1u8
        }
    });

    Ok(serde_json::json!({
        "unlocked": unlocked,
        "total":    total,
        "list":     sorted,
    }))
}
