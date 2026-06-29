use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthSession {
    pub token: String,
    pub username: String,
}

#[tauri::command]
pub async fn init_database() -> Result<String, String> {
    Ok("Database initialized".to_string())
}

#[tauri::command]
pub async fn store_auth_token(
    app_handle: tauri::AppHandle,
    token: String,
    username: String,
) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let session_path = app_data_dir.join("session.json");
    let session = AuthSession { token, username };
    let json = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    std::fs::write(session_path, json).map_err(|e| e.to_string())?;
    Ok("Token stored".to_string())
}

#[tauri::command]
pub async fn get_auth_token(app_handle: tauri::AppHandle) -> Result<Option<AuthSession>, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let session_path = app_data_dir.join("session.json");
    if !session_path.exists() {
        return Ok(None);
    }
    let data = std::fs::read_to_string(session_path).map_err(|e| e.to_string())?;
    let session: AuthSession = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(Some(session))
}

#[tauri::command]
pub async fn clear_auth_token(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let session_path = app_data_dir.join("session.json");
    if session_path.exists() {
        std::fs::remove_file(session_path).map_err(|e| e.to_string())?;
    }
    Ok("Token cleared".to_string())
}

#[tauri::command]
pub async fn save_library_item() -> Result<String, String> {
    Ok("Item saved".to_string())
}

#[tauri::command]
pub async fn get_library_items() -> Result<Vec<String>, String> {
    Ok(vec![])
}

#[tauri::command]
pub async fn get_library_stats() -> Result<String, String> {
    Ok("{}".to_string())
}
