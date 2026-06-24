use crate::db::{Database, LibraryItem, AuthSession};
use tauri::State;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

// ─── Database init ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn init_database(
  app_data_dir: String,
  database: State<'_, Database>,
) -> Result<String, String> {
  let path = PathBuf::from(app_data_dir);
  std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
  database.init(path).map_err(|e| e.to_string())?;
  Ok("ok".to_string())
}

// ─── Auth token ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn store_auth_token(
  token:    String,
  username: String,
  database: State<'_, Database>,
) -> Result<(), String> {
  database.set_config("auth_token",    &token)    .map_err(|e| e.to_string())?;
  database.set_config("auth_username", &username) .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn get_auth_token(
  database: State<'_, Database>,
) -> Result<Option<AuthSession>, String> {
  let token    = database.get_config("auth_token")   .map_err(|e| e.to_string())?;
  let username = database.get_config("auth_username").map_err(|e| e.to_string())?;

  match token {
    Some(t) => Ok(Some(AuthSession {
      token:    t,
      username: username.unwrap_or_default(),
    })),
    None => Ok(None),
  }
}

#[tauri::command]
pub async fn clear_auth_token(
  database: State<'_, Database>,
) -> Result<(), String> {
  database.delete_config("auth_token")   .map_err(|e| e.to_string())?;
  database.delete_config("auth_username").map_err(|e| e.to_string())?;
  Ok(())
}

// ─── Library ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_library_item(
  external_id: String,
  item_type:   String,
  rating:      Option<i32>,
  status:      Option<String>,
  database:    State<'_, Database>,
) -> Result<String, String> {
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_secs();

  let item = LibraryItem {
    id:          None,
    external_id: external_id.clone(),
    item_type,
    rating,
    status:      status.unwrap_or_else(|| "planning".to_string()),
    created_at:  now.to_string(),
  };

  database.save_item(item).map_err(|e| e.to_string())?;
  Ok(format!("saved:{}", external_id))
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
