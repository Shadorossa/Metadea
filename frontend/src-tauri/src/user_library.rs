use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibraryEntry {
    #[serde(default = "generate_id")]
    pub id: String,
    #[serde(default = "default_user")]
    pub user_id: String,
    pub external_id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub status: Option<String>,
    pub rating: Option<f64>,
    #[serde(default)]
    pub progress: f64,
    #[serde(default)]
    pub minutes_spent: f64,
    #[serde(default)]
    pub is_favorite: i32,
    #[serde(default)]
    pub is_platinum: i32,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
    pub added_at: Option<String>,
    pub updated_at: Option<String>,
    pub selected_platform: Option<String>,
    pub selected_version: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

fn generate_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let a = (nanos as u64)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    let b = ((nanos >> 64) as u64)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(a);
    format!("{:016x}{:016x}", a, b)
}

fn default_user() -> String {
    "local".to_string()
}

fn entry_path(
    data_dir: &std::path::Path,
    external_id: &str,
    entry_type: &str,
) -> std::path::PathBuf {
    let safe_id: String = external_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    data_dir
        .join("user_library")
        .join(format!("{}_{}.json", entry_type, safe_id))
}

#[tauri::command]
pub async fn save_library_entry(
    app_handle: tauri::AppHandle,
    mut entry: LibraryEntry,
) -> Result<LibraryEntry, String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(data_dir.join("user_library")).map_err(|e| e.to_string())?;

    let path = entry_path(&data_dir, &entry.external_id, &entry.entry_type);

    // Preserve id and added_at from existing file
    if path.exists() {
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(existing) = serde_json::from_str::<LibraryEntry>(&json) {
                if entry.id.is_empty() {
                    entry.id = existing.id;
                }
                entry.added_at = existing.added_at;
            }
        }
    }

    if entry.id.is_empty()      { entry.id      = generate_id(); }
    if entry.user_id.is_empty() { entry.user_id = "local".to_string(); }
    if entry.added_at.is_none() { entry.added_at = Some(chrono::Utc::now().to_rfc3339()); }
    entry.updated_at = Some(chrono::Utc::now().to_rfc3339());

    let json = serde_json::to_string_pretty(&entry).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;

    Ok(entry)
}

#[tauri::command]
pub async fn get_library_entry(
    app_handle: tauri::AppHandle,
    external_id: String,
    entry_type: String,
) -> Result<Option<LibraryEntry>, String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = entry_path(&data_dir, &external_id, &entry_type);
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let entry = serde_json::from_str::<LibraryEntry>(&json).map_err(|e| e.to_string())?;
    Ok(Some(entry))
}

#[tauri::command]
pub async fn delete_library_entry(
    app_handle: tauri::AppHandle,
    external_id: String,
    entry_type: String,
) -> Result<(), String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = entry_path(&data_dir, &external_id, &entry_type);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_all_library_entries(
    app_handle: tauri::AppHandle,
) -> Result<Vec<LibraryEntry>, String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let lib_dir = data_dir.join("user_library");
    if !lib_dir.exists() {
        return Ok(vec![]);
    }
    let mut entries = Vec::new();
    for item in std::fs::read_dir(&lib_dir).map_err(|e| e.to_string())? {
        let path = item.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(json) = std::fs::read_to_string(&path) {
                if let Ok(e) = serde_json::from_str::<LibraryEntry>(&json) {
                    entries.push(e);
                }
            }
        }
    }
    Ok(entries)
}
