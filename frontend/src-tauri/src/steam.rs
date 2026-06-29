use std::path::PathBuf;
use tauri::Manager;

use crate::igdb::EnvConfig;
use crate::platform_scanning::steam_root;

/// Downloads achievement icons (both locked and unlocked) and saves achievements.json.
/// Always refreshes progress from Steam; only skips icon files that already exist on disk.
/// Re-saves achievements.json whenever the unlock state has changed.
pub async fn download_achievements(
    app_handle: &tauri::AppHandle,
    app_id: &str,
    game_dir: &PathBuf,
    lang: &str,
) {
    let app_data_dir = match app_handle.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let env_path = app_data_dir.join("env.json");
    let data = match std::fs::read_to_string(env_path) {
        Ok(d) => d,
        Err(_) => return,
    };
    let cfg: EnvConfig = match serde_json::from_str(&data) {
        Ok(c) => c,
        Err(_) => return,
    };
    let api_key = match cfg.steam_api_key {
        Some(k) => k,
        None => return,
    };
    let steam_id = match detect_steam_user_id() {
        Some(id) => id,
        None => return,
    };

    let client = reqwest::Client::new();

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

        merged.push(serde_json::json!({
            "apiname":          apiname,
            "name":             display_name,
            "description":      description,
            "achieved":         achieved,
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

#[tauri::command]
pub async fn steam_achievements_download(
    app_handle: tauri::AppHandle,
    app_id: String,
    lang: Option<String>,
) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let game_dir = app_data_dir.join("metadata").join(&app_id);
    std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?
        .join("metadata")
        .join(&app_id)
        .join("achievements");
    let path = icons_dir.join(&filename);
    if !path.exists() {
        return Err("not found".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        crate::utils::base64_encode(&bytes)
    ))
}

#[tauri::command]
pub async fn steam_get_owned_games(
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let env_path = app_data_dir.join("env.json");
    if !env_path.exists() {
        return Err("No env.json — configure Steam API key first".into());
    }
    let data = std::fs::read_to_string(env_path).map_err(|e| e.to_string())?;
    let cfg: EnvConfig = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let api_key = cfg.steam_api_key.ok_or("No Steam API key configured")?;

    let steam_id =
        detect_steam_user_id().ok_or("Could not detect Steam user ID from loginusers.vdf")?;

    let url = format!(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/\
         ?key={}&steamid={}&include_appinfo=true&include_played_free_games=true",
        api_key, steam_id
    );

    let client = reqwest::Client::new();
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Steam API error (HTTP {})", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(json["response"].clone())
}

#[tauri::command]
pub async fn steam_get_player_achievements(
    app_handle: tauri::AppHandle,
    app_id: u32,
    lang: Option<String>,
) -> Result<serde_json::Value, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let env_path = app_data_dir.join("env.json");
    let data = std::fs::read_to_string(env_path).map_err(|_| "No env.json".to_string())?;
    let cfg: EnvConfig = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let api_key = cfg.steam_api_key.ok_or("No Steam API key")?;
    let steam_id = detect_steam_user_id().ok_or("Could not detect Steam user ID")?;
    let language = lang.unwrap_or_else(|| "spanish".to_string());

    let client = reqwest::Client::new();

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
        .map_err(|e| e.to_string())?;
    if !progress_resp.status().is_success() {
        return Err(format!("Steam API error (HTTP {})", progress_resp.status()));
    }
    let progress_json: serde_json::Value = progress_resp.json().await.map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())?;
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
            serde_json::json!({
                "apiname":     apiname,
                "achieved":    p["achieved"].as_u64().unwrap_or(0),
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
