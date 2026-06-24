use crate::db::{Database, LibraryItem};
use tauri::State;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
pub async fn init_database(
  app_data_dir: String,
  database: State<'_, Database>,
) -> Result<String, String> {
  let path = PathBuf::from(app_data_dir);
  std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;

  database.init(path).map_err(|e| e.to_string())?;
  Ok("Database initialized".to_string())
}

#[tauri::command]
pub async fn save_library_item(
  external_id: String,
  item_type: String,
  rating: Option<i32>,
  status: Option<String>,
  database: State<'_, Database>,
) -> Result<String, String> {
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_secs();

  let item = LibraryItem {
    id: None,
    external_id: external_id.clone(),
    item_type,
    rating,
    status: status.unwrap_or_else(|| "planning".to_string()),
    created_at: now.to_string(),
  };

  database.save_item(item).map_err(|e| e.to_string())?;
  Ok(format!("Item {} saved", external_id))
}

#[tauri::command]
pub async fn get_library_items(
  database: State<'_, Database>,
) -> Result<Vec<LibraryItem>, String> {
  database.get_all_items().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_library_stats(
  database: State<'_, Database>,
) -> Result<serde_json::Value, String> {
  database.get_stats().map_err(|e| e.to_string())
}
