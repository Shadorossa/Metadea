// Library route storage (local_routes table) plus the folder rename/scan
// helpers the "Localizar" flow needs.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

// Used by the "Localizar" flow (LocalMediaDetailPanel) to rename a picked
// folder and its episode files into a format the automatic matcher (see
// folderMatch.ts) can always recognize afterward. Refuses to clobber an
// existing file/folder at the destination — the caller is expected to have
// already generated non-colliding names, but this is the last line of
// defense against actually losing data if it didn't.
#[tauri::command]
pub async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    let old = PathBuf::from(&old_path);
    let new = PathBuf::from(&new_path);
    if !old.exists() {
        return Err(format!("Source path does not exist: {}", old_path));
    }
    if new.exists() && new != old {
        return Err(format!("A file or folder already exists at: {}", new_path));
    }
    std::fs::rename(&old, &new).map_err(|e| e.to_string())
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
    let mut conn = state.conn.lock().str_err()?;
    // The routes are written as one set; applying half of them points the
    // library at a mix of old and new folders.
    let tx = conn.transaction().str_err()?;
    for (k, val) in obj.iter() {
        if let Some(p) = val.as_str() {
            tx.execute(
                "INSERT INTO local_routes (key, path, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at",
                rusqlite::params![k, p, now],
            )
            .str_err()?;
        }
    }
    tx.commit().str_err()?;
    Ok(())
}
