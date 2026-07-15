use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedFolder {
    pub path: String,
    pub label: String,
}

#[tauri::command]
pub async fn pick_folder(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app_handle.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn scan_folder_contents(path: String) -> Result<Vec<FolderEntry>, String> {
    let dir = PathBuf::from(&path);
    if !dir.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    let mut entries = Vec::new();
    if let Ok(read_dir) = std::fs::read_dir(&dir) {
        for entry in read_dir.flatten() {
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = metadata.is_dir();
            let size = if is_dir { 0 } else { metadata.len() };
            entries.push(FolderEntry { name, is_dir, size });
        }
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

#[tauri::command]
pub async fn get_local_folders(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<SavedFolder>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare("SELECT label, path FROM local_folders ORDER BY id")
        .str_err()?;
    let folders = stmt
        .query_map([], |row| {
            Ok(SavedFolder {
                label: row.get(0)?,
                path: row.get(1)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(folders)
}

#[tauri::command]
pub async fn save_local_folders(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    folders_json: String,
) -> Result<String, String> {
    let folders: Vec<SavedFolder> =
        serde_json::from_str(&folders_json).str_err()?;
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM local_folders", [])
        .str_err()?;
    for f in &folders {
        conn.execute(
            "INSERT INTO local_folders (label, path) VALUES (?1, ?2)",
            rusqlite::params![f.label, f.path],
        )
        .str_err()?;
    }
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn read_routes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<String, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare("SELECT key, path FROM local_routes")
        .str_err()?;
    let mut map = serde_json::Map::new();
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .str_err()?;
    for row in rows.flatten() {
        map.insert(row.0, serde_json::Value::String(row.1));
    }
    serde_json::to_string(&map).str_err()
}

#[tauri::command]
pub async fn write_routes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    routes_json: String,
) -> Result<(), String> {
    let v: serde_json::Value =
        serde_json::from_str(&routes_json).str_err()?;
    let obj = v.as_object().ok_or("Expected JSON object")?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    for (k, val) in obj.iter() {
        if let Some(p) = val.as_str() {
            conn.execute(
                "INSERT INTO local_routes (key, path, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at",
                rusqlite::params![k, p, now],
            )
            .str_err()?;
        }
    }
    Ok(())
}

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

#[tauri::command]
pub async fn delete_game_link(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    launcher: String,
    link_key: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "DELETE FROM local_game_links WHERE launcher = ?1 AND link_key = ?2",
        rusqlite::params![launcher, link_key],
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

#[tauri::command]
pub async fn open_env_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?;
    std::fs::create_dir_all(&app_data_dir).str_err()?;
    let path_str = app_data_dir.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(&path_str)
            .spawn()
            .str_err()?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(&path_str)
            .spawn()
            .str_err()?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .str_err()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn launch_game(
    app_handle: tauri::AppHandle,
    launcher: String,
    app_id: Option<String>,
    install_path: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    match launcher.as_str() {
        "steam" => {
            let id = app_id.ok_or("No app_id for Steam game")?;
            app_handle.opener().open_url(format!("steam://run/{}", id), None::<String>)
                .str_err()
        }
        "epic" => {
            if let Some(id) = app_id {
                app_handle.opener()
                    .open_url(format!("com.epicgames.launcher://apps/{}?action=launch&silent=true", id), None::<String>)
                    .str_err()
            } else if let Some(path) = install_path {
                app_handle.opener().open_path(path, None::<String>).str_err()
            } else {
                Err("No launch target for Epic game".into())
            }
        }
        "gog" => {
            if let Some(id) = app_id {
                app_handle.opener()
                    .open_url(format!("goggalaxy://openGame/{}", id), None::<String>)
                    .str_err()
            } else if let Some(path) = install_path {
                app_handle.opener().open_path(path, None::<String>).str_err()
            } else {
                Err("No launch target for GOG game".into())
            }
        }
        _ => {
            if let Some(path) = install_path {
                app_handle.opener().open_path(path, None::<String>).str_err()
            } else {
                Err(format!("No launch target for {} game", launcher))
            }
        }
    }
}

// Opens any local file with the OS's default handler for its extension —
// video player for anime/series/movies, image/PDF/e-reader for
// manga/lnovel/books, whatever is registered rather than assuming VLC.
#[tauri::command]
pub async fn open_local_file(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app_handle.opener().open_path(path, None::<String>).str_err()
}

#[tauri::command]
pub async fn scan_anime_folder(folder_path: String) -> Result<Vec<String>, String> {
    let path = std::path::Path::new(&folder_path);
    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut files = vec![];
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if matches!(ext_str.as_str(), "mkv" | "mp4" | "avi" | "mov" | "flv" | "webm") {
                        if let Some(name) = path.file_name() {
                            files.push(name.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    files.sort();
    Ok(files)
}

// A plain `Command::new("vlc")` only works when VLC's install dir was added
// to PATH, which the default Windows installer does *not* do — that silent
// spawn failure was why the "Reproducir" button did nothing. This looks up
// VLC the same way Windows itself does (the "App Paths" registry key VLC's
// installer registers), then falls back to the two standard install
// locations, and only tries bare "vlc" last in case it *is* on PATH.
#[cfg(windows)]
fn vlc_path_from_registry() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;
    const SUBKEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\vlc.exe";
    // VLC is very commonly still distributed/installed as a 32-bit build even
    // on 64-bit Windows — its App Paths entry then only exists in the WOW64
    // 32-bit registry view, which a 64-bit process (this app) does not see
    // by default. Check both views on both hives explicitly.
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            if let Ok(key) =
                RegKey::predef(hive).open_subkey_with_flags(SUBKEY, KEY_READ | view)
            {
                if let Ok(path) = key.get_value::<String, _>("") {
                    let p = PathBuf::from(path.trim_matches('"'));
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn vlc_path_from_registry() -> Option<PathBuf> {
    None
}

fn find_vlc_executable() -> PathBuf {
    if let Some(p) = vlc_path_from_registry() {
        return p;
    }
    for candidate in [
        "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
        "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
    ] {
        let p = PathBuf::from(candidate);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("vlc")
}

// Fixed loopback-only port/password for VLC's HTTP status interface — this
// only ever talks to a VLC instance we ourselves just spawned on the same
// machine, so a hardcoded local secret is fine (nothing external can reach
// it, and there's no sensitive data behind it beyond "what's playing").
const VLC_HTTP_PORT: u16 = 39321;
const VLC_HTTP_PASSWORD: &str = "metadea-local";

#[tauri::command]
pub async fn play_file_with_vlc(file_path: String) -> Result<(), String> {
    // `--extraintf http` runs VLC's web status API *alongside* its normal
    // player window (it doesn't replace the UI) so get_vlc_playback_status
    // can poll episode progress. If VLC is already running in single-instance
    // mode, this file just gets forwarded to that instance and these flags
    // are silently ignored — a known limitation of external control this way.
    std::process::Command::new(find_vlc_executable())
        .arg(&file_path)
        .arg("--extraintf").arg("http")
        .arg("--http-host").arg("127.0.0.1")
        .arg("--http-port").arg(VLC_HTTP_PORT.to_string())
        .arg("--http-password").arg(VLC_HTTP_PASSWORD)
        .spawn()
        .map_err(|e| format!("Failed to launch VLC: {}", e))?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VlcPlaybackStatus {
    pub state:    String,
    pub position: f64,
    pub time:     i64,
    pub length:   i64,
}

// Polled by the frontend while an episode is playing to auto-mark it as
// watched once position crosses 80%. Returns Ok(None) whenever VLC's HTTP
// interface isn't reachable (not running yet, or running without
// --extraintf http) rather than erroring — that's an expected, frequent
// state (e.g. right after spawn, before VLC has finished starting up), not
// a failure the caller needs to react to.
#[tauri::command]
pub async fn get_vlc_playback_status() -> Result<Option<VlcPlaybackStatus>, String> {
    let url = format!("http://127.0.0.1:{}/requests/status.json", VLC_HTTP_PORT);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .basic_auth("", Some(VLC_HTTP_PASSWORD))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;

    let resp = match resp {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(None),
    };

    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    Ok(Some(VlcPlaybackStatus {
        state:    json.get("state").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        position: json.get("position").and_then(|v| v.as_f64()).unwrap_or(0.0),
        time:     json.get("time").and_then(|v| v.as_i64()).unwrap_or(0),
        length:   json.get("length").and_then(|v| v.as_i64()).unwrap_or(0),
    }))
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct AnimeLocalEntry {
    pub anilist_id: i32,
    pub folder_path: String,
    pub episode_count: i32,
    pub updated_at: String,
}

#[tauri::command]
pub async fn save_anime_folder(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    anilist_id: i32,
    folder_path: String,
    episode_count: i32,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;

    conn.execute(
        "INSERT INTO local_anime_folders (anilist_id, folder_path, episode_count, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(anilist_id) DO UPDATE SET
            folder_path = excluded.folder_path,
            episode_count = excluded.episode_count,
            updated_at = excluded.updated_at",
        rusqlite::params![anilist_id, folder_path, episode_count, now],
    )
    .str_err()?;

    Ok(())
}

#[tauri::command]
pub async fn get_anime_folder(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    anilist_id: i32,
) -> Result<Option<AnimeLocalEntry>, String> {
    let conn = state.conn.lock().str_err()?;

    let result = conn
        .query_row(
            "SELECT anilist_id, folder_path, episode_count, updated_at FROM local_anime_folders WHERE anilist_id = ?1",
            rusqlite::params![anilist_id],
            |row| {
                Ok(AnimeLocalEntry {
                    anilist_id: row.get(0)?,
                    folder_path: row.get(1)?,
                    episode_count: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
        .str_err()?;

    Ok(result)
}
