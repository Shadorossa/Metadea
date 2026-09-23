use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
        .filter(|s| !s.is_empty())
        // Keys saved before write_env_config encrypted are plaintext rows.
        .map(|s| crate::utils::decrypt_secret_or_plaintext(&s)))
}

fn is_hidden_achievement(schema: Option<&serde_json::Value>) -> bool {
    match schema.and_then(|achievement| achievement.get("hidden")) {
        Some(serde_json::Value::Bool(hidden)) => *hidden,
        Some(serde_json::Value::Number(hidden)) => hidden.as_u64() == Some(1),
        Some(serde_json::Value::String(hidden)) => hidden == "1" || hidden.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

// ── Achievements cache ───────────────────────────────────────────────────
//
// Everything lives under `$APPDATA/metadata/<appId>/` (already in the asset
// protocol scope, so the webview loads the icon files directly):
//
//   achievements_player_<lang>.json  the merged `{unlocked,total,list}` of the
//                                     last live fetch, plus `fetched_at` —
//                                     what the detail panel paints first;
//   achievements_schema_<lang>.json  GetSchemaForGame's achievement list, kept
//                                     for SCHEMA_TTL_SECS so a live refresh is
//                                     one Steam request instead of two;
//   achievements.json + achievements/ the "Obtener metadatos" download (legacy
//                                     format, icon files `<apiname>_{un,}locked.jpg`).

/// Schemas (names, descriptions, icon URLs) almost never change for a
/// released game; a week keeps a later refresh down to the progress request.
const SCHEMA_TTL_SECS: u64 = 7 * 24 * 60 * 60;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Steam Web API language names are plain lowercase words ("english",
/// "spanish", "schinese"...). Anything else falls back to English — the
/// value also names cache files, so it never carries path characters.
fn normalize_steam_lang(lang: Option<&str>) -> String {
    match lang {
        Some(l) if !l.is_empty() && l.len() <= 20 && l.bytes().all(|b| b.is_ascii_lowercase()) => l.to_string(),
        _ => "english".to_string(),
    }
}

fn game_metadata_dir(app_handle: &tauri::AppHandle, app_id: &str) -> Option<PathBuf> {
    Some(app_handle.path().app_data_dir().ok()?.join("metadata").join(app_id))
}

fn player_cache_path(game_dir: &Path, lang: &str) -> PathBuf {
    game_dir.join(format!("achievements_player_{lang}.json"))
}

fn schema_cache_path(game_dir: &Path, lang: &str) -> PathBuf {
    game_dir.join(format!("achievements_schema_{lang}.json"))
}

fn schema_is_fresh(fetched_at: u64, now: u64) -> bool {
    fetched_at <= now && now - fetched_at < SCHEMA_TTL_SECS
}

/// Writes through a sibling temp file so a reader never sees half a JSON.
fn write_json_atomic(path: &Path, value: &serde_json::Value) {
    let Ok(text) = serde_json::to_string(value) else { return };
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, text).is_ok() && std::fs::rename(&tmp, path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// The cached schema list and when it was fetched, fresh or not (a stale one
/// is still the fallback when the refetch fails).
fn read_schema_cache(game_dir: &Path, lang: &str) -> Option<(u64, Vec<serde_json::Value>)> {
    let json = read_json(&schema_cache_path(game_dir, lang))?;
    Some((json["fetched_at"].as_u64()?, json["achievements"].as_array()?.clone()))
}

fn write_schema_cache(game_dir: &Path, lang: &str, achievements: &[serde_json::Value], now: u64) {
    write_json_atomic(
        &schema_cache_path(game_dir, lang),
        &serde_json::json!({ "fetched_at": now, "achievements": achievements }),
    );
}

fn schema_map(list: &[serde_json::Value]) -> HashMap<String, serde_json::Value> {
    list.iter()
        .filter_map(|a| Some((a["name"].as_str()?.to_string(), a.clone())))
        .collect()
}

/// An apiname only ever names an icon file when it can't escape the folder.
fn safe_icon_stem(apiname: &str) -> bool {
    !apiname.is_empty() && !apiname.contains(['/', '\\', ':']) && !apiname.contains("..")
}

fn icon_file_name(apiname: &str, achieved: bool) -> String {
    format!("{apiname}_{}.jpg", if achieved { "unlocked" } else { "locked" })
}

/// Progress + schema → the list the panel renders, unlocked first.
/// `icon` is the Steam CDN URL of the variant matching the unlock state.
fn merge_achievements(
    progress: &[serde_json::Value],
    schema: &HashMap<String, serde_json::Value>,
) -> serde_json::Value {
    let mut list: Vec<serde_json::Value> = progress
        .iter()
        .map(|p| {
            let apiname = p["apiname"].as_str().unwrap_or("");
            let s = schema.get(apiname);
            let achieved = p["achieved"].as_u64().unwrap_or(0);
            let name = s
                .and_then(|s| s["displayName"].as_str())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| p["name"].as_str().unwrap_or(apiname));
            let description = s
                .and_then(|s| s["description"].as_str())
                .filter(|v| !v.is_empty())
                .or_else(|| p["description"].as_str().filter(|v| !v.is_empty()))
                .unwrap_or("");
            let icon = s
                .and_then(|s| {
                    if achieved == 1 {
                        s["icon"].as_str()
                    } else {
                        s["icongray"].as_str().or_else(|| s["icon"].as_str())
                    }
                })
                .unwrap_or("");
            serde_json::json!({
                "apiname":     apiname,
                "achieved":    achieved,
                "hidden":      is_hidden_achievement(s),
                "unlocktime":  p["unlocktime"].as_u64().unwrap_or(0),
                "name":        name,
                "description": description,
                "icon":        icon,
            })
        })
        .collect();
    summarize(&mut list)
}

fn summarize(list: &mut Vec<serde_json::Value>) -> serde_json::Value {
    // Stable: unlocked first, Steam's own order within each group.
    list.sort_by_key(|a| u8::from(a["achieved"].as_u64() != Some(1)));
    let unlocked = list.iter().filter(|a| a["achieved"].as_u64() == Some(1)).count();
    serde_json::json!({ "unlocked": unlocked, "total": list.len(), "list": list })
}

/// The legacy download (`achievements.json`) in the panel's shape — no
/// remote icon URL there, the local icon files cover it.
fn from_downloaded_achievements(game_dir: &Path) -> Option<serde_json::Value> {
    let path = game_dir.join("achievements.json");
    let items: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&path).ok()?).ok()?;
    let fetched_at = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut list: Vec<serde_json::Value> = items
        .iter()
        .map(|a| serde_json::json!({
            "apiname":     a["apiname"].as_str().unwrap_or(""),
            "achieved":    a["achieved"].as_u64().unwrap_or(0),
            "hidden":      a["hidden"].as_bool().unwrap_or(false),
            "unlocktime":  a["unlocktime"].as_u64().unwrap_or(0),
            "name":        a["name"].as_str().unwrap_or(""),
            "description": a["description"].as_str().unwrap_or(""),
            "icon":        "",
        }))
        .collect();
    let mut merged = summarize(&mut list);
    merged["fetched_at"] = fetched_at.into();
    Some(merged)
}

/// Adds `icon_local` (absolute path) to every entry whose icon file for its
/// current state is on disk; the panel serves it through the asset protocol
/// and falls back to `icon` (the CDN) otherwise.
fn attach_local_icons(merged: &mut serde_json::Value, game_dir: &Path) {
    let icons_dir = game_dir.join("achievements");
    if !icons_dir.is_dir() {
        return;
    }
    let Some(list) = merged["list"].as_array_mut() else { return };
    for a in list {
        let apiname = a["apiname"].as_str().unwrap_or("").to_string();
        if !safe_icon_stem(&apiname) {
            continue;
        }
        let path = icons_dir.join(icon_file_name(&apiname, a["achieved"].as_u64() == Some(1)));
        if path.is_file() {
            a["icon_local"] = path.to_string_lossy().into_owned().into();
        }
    }
}

/// The persisted merged result for (game, language): the last live fetch,
/// else the downloaded achievements.json. Disk only — never the network.
fn read_cached_achievements(game_dir: &Path, lang: &str) -> Option<serde_json::Value> {
    let mut merged = read_json(&player_cache_path(game_dir, lang))
        .filter(|j| j["list"].is_array() && j["fetched_at"].is_u64())
        .or_else(|| from_downloaded_achievements(game_dir))?;
    attach_local_icons(&mut merged, game_dir);
    Some(merged)
}

fn write_player_cache(game_dir: &Path, lang: &str, merged: &serde_json::Value, now: u64) {
    let mut stored = merged.clone();
    stored["fetched_at"] = now.into();
    if std::fs::create_dir_all(game_dir).is_ok() {
        write_json_atomic(&player_cache_path(game_dir, lang), &stored);
    }
}

async fn fetch_progress(
    client: &reqwest::Client,
    api_key: &str,
    steam_id: &str,
    app_id: &str,
    lang: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/\
         ?key={api_key}&steamid={steam_id}&appid={app_id}&l={lang}"
    );
    let resp = client.get(&url).send().await.str_err()?;
    if !resp.status().is_success() {
        return Err(format!("Steam API error (HTTP {})", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.str_err()?;
    Ok(json["playerstats"]["achievements"].as_array().cloned().unwrap_or_default())
}

async fn fetch_schema(
    client: &reqwest::Client,
    api_key: &str,
    app_id: &str,
    lang: &str,
) -> Option<Vec<serde_json::Value>> {
    let url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/\
         ?key={api_key}&appid={app_id}&l={lang}"
    );
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let json: serde_json::Value = resp.json().await.ok()?;
    Some(
        json["game"]["availableGameStats"]["achievements"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
    )
}

/// Progress and (when the cached one is stale or missing) the schema, both
/// requests in flight at once. A failed schema refetch falls back to the
/// stale cache; a fresh fetch is persisted for SCHEMA_TTL_SECS.
async fn fetch_progress_and_schema(
    client: &reqwest::Client,
    api_key: &str,
    steam_id: &str,
    app_id: &str,
    lang: &str,
    game_dir: &Path,
) -> Result<(Vec<serde_json::Value>, HashMap<String, serde_json::Value>), String> {
    let now = now_secs();
    let cached = read_schema_cache(game_dir, lang);
    let fresh = cached.as_ref().filter(|(at, _)| schema_is_fresh(*at, now)).map(|(_, list)| list.clone());
    let need_schema = fresh.is_none();
    let (progress, fetched) = futures::join!(
        fetch_progress(client, api_key, steam_id, app_id, lang),
        async {
            if need_schema { fetch_schema(client, api_key, app_id, lang).await } else { None }
        },
    );
    let progress = progress?;
    let schema = match (fresh, fetched) {
        (Some(list), _) => list,
        (None, Some(list)) => {
            if std::fs::create_dir_all(game_dir).is_ok() {
                write_schema_cache(game_dir, lang, &list, now);
            }
            list
        }
        (None, None) => cached.map(|(_, list)| list).unwrap_or_default(),
    };
    Ok((progress, schema_map(&schema)))
}

/// Downloads achievement icons (both locked and unlocked) and saves achievements.json.
/// Always refreshes progress from Steam; only skips icon files that already exist on disk.
/// Re-saves achievements.json whenever the unlock state has changed, and
/// refreshes the panel's merged cache on the way.
pub async fn download_achievements(
    app_handle: &tauri::AppHandle,
    app_id: &str,
    game_dir: &Path,
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
    let client = crate::http::http_client();

    let (progress_list, schema_map) =
        match fetch_progress_and_schema(client, &api_key, &steam_id, app_id, lang, game_dir).await {
            Ok(r) => r,
            Err(_) => return,
        };
    if progress_list.is_empty() {
        return;
    }
    write_player_cache(game_dir, lang, &merge_achievements(&progress_list, &schema_map), now_secs());

    // Check if existing achievements.json already matches current unlock state (skip heavy work)
    let out_path = game_dir.join("achievements.json");
    let existing_unlocked: Option<u64> = std::fs::read_to_string(&out_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<serde_json::Value>>(&s).ok())
        .map(|arr| arr.iter().filter(|a| a["achieved"].as_u64() == Some(1)).count() as u64);
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
        let icon_file = icon_file_name(apiname, true);
        let icon_gray_file = icon_file_name(apiname, false);
        if safe_icon_stem(apiname) {
            fetch_icon(client, icon_url, &icons_dir.join(&icon_file)).await;
            fetch_icon(client, icon_gray_url, &icons_dir.join(&icon_gray_file)).await;
        }

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
pub async fn steam_get_screenshots(
    app_handle: tauri::AppHandle,
    app_id: String,
) -> Result<Vec<SteamScreenshot>, String> {
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
        let entries = match std::fs::read_dir(&screenshots_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => continue,
        };

        // Steam's install root is user-configurable, so this directory cannot
        // be expressed in the static assetProtocol scope. Widen the scope to
        // exactly the screenshot folders we just found, instead of shipping a
        // blanket "**" that would expose the whole filesystem to the webview.
        let scope = app_handle.asset_protocol_scope();
        let _ = scope.allow_directory(&screenshots_dir, false);
        let _ = scope.allow_directory(screenshots_dir.join("thumbnails"), false);

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

    screenshots.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
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
    let l = normalize_steam_lang(lang.as_deref());
    download_achievements(&app_handle, &app_id, &game_dir, &l).await;
    Ok(())
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

    let client = crate::http::http_client();
    let resp = client.get(&url).send().await.str_err()?;
    if !resp.status().is_success() {
        return Err(format!("Steam API error (HTTP {})", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.str_err()?;
    Ok(json["response"].clone())
}

/// Live progress merged with the (cached, 7-day) schema. Persists the merged
/// result so the next open paints it from disk first
/// (`steam_get_cached_achievements`).
#[tauri::command]
pub async fn steam_get_player_achievements(
    app_handle: tauri::AppHandle,
    app_id: u32,
    lang: Option<String>,
) -> Result<serde_json::Value, String> {
    let api_key = steam_api_key(&app_handle.state::<crate::db::MetadeaDb>())?
        .ok_or("No Steam API key")?;
    let steam_id = detect_steam_user_id().ok_or("Could not detect Steam user ID")?;
    let language = normalize_steam_lang(lang.as_deref());
    let app_id = app_id.to_string();
    let game_dir = app_handle.path().app_data_dir().str_err()?.join("metadata").join(&app_id);

    let client = crate::http::http_client();
    let (progress, schema) =
        fetch_progress_and_schema(client, &api_key, &steam_id, &app_id, &language, &game_dir).await?;
    let now = now_secs();
    let mut merged = merge_achievements(&progress, &schema);
    write_player_cache(&game_dir, &language, &merged, now);
    merged["fetched_at"] = now.into();
    attach_local_icons(&mut merged, &game_dir);
    Ok(merged)
}

/// The last merged result persisted for (game, language), or the downloaded
/// achievements.json — disk only, `null` when neither exists. `fetched_at`
/// (unix seconds) lets the caller decide whether a live refresh is due.
#[tauri::command]
pub async fn steam_get_cached_achievements(
    app_handle: tauri::AppHandle,
    app_id: u32,
    lang: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    let language = normalize_steam_lang(lang.as_deref());
    Ok(game_metadata_dir(&app_handle, &app_id.to_string())
        .and_then(|dir| read_cached_achievements(&dir, &language)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_game_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("metadea-steam-{tag}-{}-{}", std::process::id(), now_secs()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn progress() -> Vec<serde_json::Value> {
        vec![
            serde_json::json!({ "apiname": "A", "achieved": 0, "unlocktime": 0 }),
            serde_json::json!({ "apiname": "B", "achieved": 1, "unlocktime": 1700000000u64 }),
        ]
    }

    fn schema() -> Vec<serde_json::Value> {
        vec![
            serde_json::json!({ "name": "A", "displayName": "Alpha", "description": "d", "hidden": 1,
                                "icon": "https://cdn/a.jpg", "icongray": "https://cdn/a_gray.jpg" }),
            serde_json::json!({ "name": "B", "displayName": "Beta", "icon": "https://cdn/b.jpg", "icongray": "https://cdn/b_gray.jpg" }),
        ]
    }

    #[test]
    fn merge_sorts_unlocked_first_and_picks_the_state_icon() {
        let merged = merge_achievements(&progress(), &schema_map(&schema()));
        assert_eq!(merged["unlocked"], 1);
        assert_eq!(merged["total"], 2);
        assert_eq!(merged["list"][0]["apiname"], "B");
        assert_eq!(merged["list"][0]["icon"], "https://cdn/b.jpg");
        assert_eq!(merged["list"][1]["icon"], "https://cdn/a_gray.jpg");
        assert_eq!(merged["list"][1]["hidden"], true);
        assert_eq!(merged["list"][1]["name"], "Alpha");
    }

    #[test]
    fn player_cache_roundtrips_with_local_icons() {
        let dir = temp_game_dir("roundtrip");
        let merged = merge_achievements(&progress(), &schema_map(&schema()));
        write_player_cache(&dir, "english", &merged, 1234);
        std::fs::create_dir_all(dir.join("achievements")).unwrap();
        std::fs::write(dir.join("achievements").join("B_unlocked.jpg"), b"x").unwrap();

        let cached = read_cached_achievements(&dir, "english").unwrap();
        assert_eq!(cached["fetched_at"], 1234);
        let icon = dir.join("achievements").join("B_unlocked.jpg");
        assert_eq!(cached["list"][0]["icon_local"], icon.to_string_lossy().as_ref());
        assert!(cached["list"][1].get("icon_local").is_none());
        let mut without_icon = cached.clone();
        without_icon["list"][0].as_object_mut().unwrap().remove("icon_local");
        assert_eq!(without_icon["list"], merged["list"]);
        // Another language has no cache of its own and no download to fall back to.
        assert!(read_cached_achievements(&dir, "spanish").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cached_read_falls_back_to_the_downloaded_achievements_json() {
        let dir = temp_game_dir("legacy");
        std::fs::write(dir.join("achievements.json"), serde_json::json!([
            { "apiname": "A", "name": "Alpha", "description": "", "achieved": 0, "hidden": true, "unlocktime": 0,
              "icon_unlocked": "A_unlocked.jpg", "icon_locked": "A_locked.jpg" },
            { "apiname": "B", "name": "Beta", "description": "", "achieved": 1, "hidden": false, "unlocktime": 5,
              "icon_unlocked": "B_unlocked.jpg", "icon_locked": "B_locked.jpg" },
        ]).to_string()).unwrap();
        let cached = read_cached_achievements(&dir, "german").unwrap();
        assert_eq!(cached["unlocked"], 1);
        assert_eq!(cached["total"], 2);
        assert_eq!(cached["list"][0]["apiname"], "B");
        assert!(cached["fetched_at"].as_u64().unwrap() > 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn schema_cache_honours_its_ttl() {
        let dir = temp_game_dir("schema");
        write_schema_cache(&dir, "english", &schema(), 1000);
        let (at, list) = read_schema_cache(&dir, "english").unwrap();
        assert_eq!(at, 1000);
        assert_eq!(list.len(), 2);
        assert!(schema_is_fresh(at, 1000 + SCHEMA_TTL_SECS - 1));
        assert!(!schema_is_fresh(at, 1000 + SCHEMA_TTL_SECS));
        // A clock that went backwards never trusts the cache.
        assert!(!schema_is_fresh(at, 999));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn language_is_a_plain_lowercase_word_or_english() {
        assert_eq!(normalize_steam_lang(Some("spanish")), "spanish");
        assert_eq!(normalize_steam_lang(None), "english");
        assert_eq!(normalize_steam_lang(Some("../x")), "english");
        assert_eq!(normalize_steam_lang(Some("Spanish")), "english");
        assert!(!safe_icon_stem("../evil"));
        assert!(safe_icon_stem("ACH_WIN_1"));
    }
}
