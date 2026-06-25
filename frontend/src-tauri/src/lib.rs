use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthSession {
    pub token: String,
    pub username: String,
}

// Simple in-memory storage for auth (in production, use proper DB)
struct AppState {
    auth: Mutex<Option<AuthSession>>,
}

#[tauri::command]
async fn init_database() -> Result<String, String> {
    // TODO: Initialize SQLite database
    Ok("Database initialized".to_string())
}

#[tauri::command]
async fn store_auth_token(token: String) -> Result<String, String> {
    Ok("Token stored".to_string())
}

#[tauri::command]
async fn get_auth_token() -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
async fn clear_auth_token() -> Result<String, String> {
    Ok("Token cleared".to_string())
}

#[tauri::command]
async fn save_library_item() -> Result<String, String> {
    Ok("Item saved".to_string())
}

#[tauri::command]
async fn get_library_items() -> Result<Vec<String>, String> {
    Ok(vec![])
}

#[tauri::command]
async fn get_library_stats() -> Result<String, String> {
    Ok("{}".to_string())
}

#[tauri::command]
async fn scan_all_games() -> Result<String, String> {
    Ok("[]".to_string())
}

#[tauri::command]
async fn pick_folder() -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
async fn scan_folder_contents(path: String) -> Result<String, String> {
    Ok("[]".to_string())
}

#[tauri::command]
async fn get_local_folders() -> Result<String, String> {
    Ok("[]".to_string())
}

#[tauri::command]
async fn save_local_folders(folders: String) -> Result<String, String> {
    Ok("Folders saved".to_string())
}

#[tauri::command]
async fn read_env_config() -> Result<String, String> {
    Ok("{}".to_string())
}

#[tauri::command]
async fn write_env_config(config: String) -> Result<String, String> {
    Ok("Config saved".to_string())
}

#[tauri::command]
async fn igdb_search(query: String) -> Result<String, String> {
    Ok("[]".to_string())
}

#[tauri::command]
async fn debug_scan_info() -> Result<String, String> {
    Ok("debug info".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_database,
            store_auth_token,
            get_auth_token,
            clear_auth_token,
            save_library_item,
            get_library_items,
            get_library_stats,
            scan_all_games,
            pick_folder,
            scan_folder_contents,
            get_local_folders,
            save_local_folders,
            read_env_config,
            write_env_config,
            igdb_search,
            debug_scan_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
