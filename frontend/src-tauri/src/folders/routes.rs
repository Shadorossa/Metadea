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

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct TaggedPathMatch {
    pub abs_path: String,
    pub is_dir: bool,
}

// The same listing scan_folder_contents returns (directories first, then
// by name), without the IPC hop — the tagged-path walk below reads one
// directory per level and used to be one round trip per directory.
fn list_folder_entries(dir: &std::path::Path) -> Vec<FolderEntry> {
    let mut entries = Vec::new();
    if let Ok(read_dir) = std::fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let Ok(metadata) = entry.metadata() else { continue };
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = metadata.is_dir();
            entries.push(FolderEntry { name, is_dir, size: if is_dir { 0 } else { metadata.len() } });
        }
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    entries
}

// folder-match.ts's findTaggedPathRecursive, run entirely on this side: a
// depth-first walk (same listing order, same depth cap, first hit wins)
// looking for a "[tag]" literally in a name. `base_path`/`name` are joined
// with '/' exactly as the frontend did, so the returned path is the same
// string the "Localizar" flow and the panel's own matching already expect.
pub(crate) fn find_tagged_path_in(base_path: &str, tag: &str, max_depth: u32) -> Option<TaggedPathMatch> {
    let entries = list_folder_entries(std::path::Path::new(base_path));
    if let Some(direct) = entries.iter().find(|e| e.name.contains(tag)) {
        return Some(TaggedPathMatch { abs_path: format!("{base_path}/{}", direct.name), is_dir: direct.is_dir });
    }
    if max_depth == 0 {
        return None;
    }
    for entry in entries.iter().filter(|e| e.is_dir) {
        if let Some(found) = find_tagged_path_in(&format!("{base_path}/{}", entry.name), tag, max_depth - 1) {
            return Some(found);
        }
    }
    None
}

#[tauri::command]
pub async fn find_tagged_path(base_path: String, tag: String, max_depth: u32) -> Result<Option<TaggedPathMatch>, String> {
    if tag.is_empty() {
        return Ok(None);
    }
    let max_depth = max_depth.min(8);
    tokio::task::spawn_blocking(move || find_tagged_path_in(&base_path, &tag, max_depth))
        .await
        .str_err()
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

#[cfg(test)]
mod tagged_path_tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("metadea-tagged-{}-{}", std::process::id(), name));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn finds_a_nested_tagged_folder_depth_first_in_listing_order() {
        let root = temp_root("nested");
        std::fs::create_dir_all(root.join("a").join("deep [anime-1]")).unwrap();
        std::fs::create_dir_all(root.join("b")).unwrap();
        std::fs::write(root.join("b").join("movie [anime-1].mkv"), b"").unwrap();
        let base = root.to_string_lossy().to_string();
        let found = find_tagged_path_in(&base, "[anime-1]", 3).unwrap();
        assert_eq!(found, TaggedPathMatch { abs_path: format!("{base}/a/deep [anime-1]"), is_dir: true });
        // Depth 0 only looks at the root's own children.
        assert_eq!(find_tagged_path_in(&base, "[anime-1]", 0), None);
        // A direct child wins over anything deeper.
        std::fs::write(root.join("direct [anime-1].mkv"), b"").unwrap();
        assert_eq!(find_tagged_path_in(&base, "[anime-1]", 3).unwrap().abs_path, format!("{base}/direct [anime-1].mkv"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_root_or_tag_yields_nothing() {
        let root = temp_root("missing");
        let base = root.to_string_lossy().to_string();
        assert_eq!(find_tagged_path_in(&format!("{base}/nope"), "[x]", 2), None);
        assert_eq!(find_tagged_path_in(&base, "[x]", 2), None);
        let _ = std::fs::remove_dir_all(&root);
    }
}
