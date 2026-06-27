use serde::{Deserialize, Serialize};
use chrono::Utc;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaCatalogEntry {
    pub id: String,
    pub external_id: String,
    pub parent_id: Option<String>,
    pub r#type: String,
    pub format: Option<String>,
    pub source: Option<String>,
    pub title_main: Option<String>,
    pub title_romaji: Option<String>,
    pub title_native: Option<String>,
    pub synopsis: Option<String>,
    pub cover_url: Option<String>,
    pub banners_csv: Option<String>,
    pub release_year: Option<i32>,
    pub release_month: Option<i32>,
    pub release_day: Option<i32>,
    pub time_length: Option<i32>,
    pub status: Option<String>,
    pub score_global: Option<f64>,
    pub favorites_count: Option<i32>,
    pub ratings_count: Option<i32>,
    pub total_count: Option<i32>,
    pub total_count_2: Option<i32>,
    pub genres_csv: Option<String>,
    pub genres_tag_csv: Option<String>,
    pub platforms_csv: Option<String>,
    pub companies_cache_csv: Option<String>,
    pub last_synced_at: Option<String>,
    pub sync_failed_count: Option<i32>,
    pub last_sync_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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

fn entry_path(
    data_dir: &std::path::Path,
    external_id: &str,
) -> std::path::PathBuf {
    let safe_id: String = external_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    data_dir
        .join("media_catalog")
        .join(format!("{}.json", safe_id))
}

#[tauri::command]
pub async fn save_catalog_entry(
    app_handle: tauri::AppHandle,
    mut entry: MediaCatalogEntry,
) -> Result<MediaCatalogEntry, String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(data_dir.join("media_catalog")).map_err(|e| e.to_string())?;

    let path = entry_path(&data_dir, &entry.external_id);

    // Preserve id and created_at from existing entry
    if path.exists() {
        if let Ok(json) = std::fs::read_to_string(&path) {
            if let Ok(existing) = serde_json::from_str::<MediaCatalogEntry>(&json) {
                if entry.id.is_empty() {
                    entry.id = existing.id;
                }
                entry.created_at = existing.created_at;
            }
        }
    }

    if entry.id.is_empty() {
        entry.id = generate_id();
    }
    entry.updated_at = Utc::now().to_rfc3339();

    let json = serde_json::to_string_pretty(&entry).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;

    Ok(entry)
}

#[tauri::command]
pub async fn get_catalog_entry(
    app_handle: tauri::AppHandle,
    external_id: String,
) -> Result<Option<MediaCatalogEntry>, String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = entry_path(&data_dir, &external_id);
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let entry = serde_json::from_str::<MediaCatalogEntry>(&json).map_err(|e| e.to_string())?;
    Ok(Some(entry))
}

#[tauri::command]
pub async fn delete_catalog_entry(
    app_handle: tauri::AppHandle,
    external_id: String,
) -> Result<(), String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = entry_path(&data_dir, &external_id);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_all_catalog_entries(
    app_handle: tauri::AppHandle,
) -> Result<Vec<MediaCatalogEntry>, String> {
    let data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let cat_dir = data_dir.join("media_catalog");
    if !cat_dir.exists() {
        return Ok(vec![]);
    }
    let mut entries = Vec::new();
    for item in std::fs::read_dir(&cat_dir).map_err(|e| e.to_string())? {
        let path = item.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(json) = std::fs::read_to_string(&path) {
                if let Ok(e) = serde_json::from_str::<MediaCatalogEntry>(&json) {
                    entries.push(e);
                }
            }
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn search_catalog(
    app_handle: tauri::AppHandle,
    query: String,
) -> Result<Vec<MediaCatalogEntry>, String> {
    let entries = get_all_catalog_entries(app_handle).await?;
    let q = query.to_lowercase();
    let results: Vec<_> = entries
        .into_iter()
        .filter(|e| {
            e.title_main.as_deref().map(|t| t.to_lowercase().contains(&q)).unwrap_or(false)
                || e.title_romaji.as_deref().map(|t| t.to_lowercase().contains(&q)).unwrap_or(false)
                || e.title_native.as_deref().map(|t| t.to_lowercase().contains(&q)).unwrap_or(false)
        })
        .collect();
    Ok(results)
}
