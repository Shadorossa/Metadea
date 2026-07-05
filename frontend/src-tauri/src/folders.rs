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

#[tauri::command]
pub async fn play_file_with_vlc(file_path: String) -> Result<(), String> {
    std::process::Command::new("vlc")
        .arg(&file_path)
        .spawn()
        .map_err(|e| format!("Failed to launch VLC: {}", e))?;
    Ok(())
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
