use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
    state: tauri::State<'_, crate::db::LocalDataDb>,
) -> Result<Vec<SavedFolder>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT label, path FROM local_folders ORDER BY id")
        .map_err(|e| e.to_string())?;
    let folders = stmt
        .query_map([], |row| {
            Ok(SavedFolder {
                label: row.get(0)?,
                path: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(folders)
}

#[tauri::command]
pub async fn save_local_folders(
    state: tauri::State<'_, crate::db::LocalDataDb>,
    folders_json: String,
) -> Result<String, String> {
    let folders: Vec<SavedFolder> =
        serde_json::from_str(&folders_json).map_err(|e| e.to_string())?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM local_folders", [])
        .map_err(|e| e.to_string())?;
    for f in &folders {
        conn.execute(
            "INSERT INTO local_folders (label, path) VALUES (?1, ?2)",
            rusqlite::params![f.label, f.path],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn read_routes(
    state: tauri::State<'_, crate::db::LocalDataDb>,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, path FROM local_routes")
        .map_err(|e| e.to_string())?;
    let mut map = serde_json::Map::new();
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows.flatten() {
        map.insert(row.0, serde_json::Value::String(row.1));
    }
    serde_json::to_string(&map).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_routes(
    state: tauri::State<'_, crate::db::LocalDataDb>,
    routes_json: String,
) -> Result<(), String> {
    let v: serde_json::Value =
        serde_json::from_str(&routes_json).map_err(|e| e.to_string())?;
    let obj = v.as_object().ok_or("Expected JSON object")?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    for (k, val) in obj {
        if let Some(p) = val.as_str() {
            conn.execute(
                "INSERT INTO local_routes (key, path, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at",
                rusqlite::params![k, p, now],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn save_game_link(
    state: tauri::State<'_, crate::db::LocalDataDb>,
    launcher: String,
    link_key: String,
    external_id: String,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO local_game_links (launcher, link_key, external_id, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(launcher, link_key) DO UPDATE SET
             external_id = excluded.external_id,
             updated_at  = excluded.updated_at",
        rusqlite::params![launcher, link_key, external_id, now],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_game_link(
    state: tauri::State<'_, crate::db::LocalDataDb>,
    launcher: String,
    link_key: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM local_game_links WHERE launcher = ?1 AND link_key = ?2",
        rusqlite::params![launcher, link_key],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
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
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let path_str = app_data_dir.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
