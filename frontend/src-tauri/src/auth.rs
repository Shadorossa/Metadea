use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthSession {
    pub token: String,
    pub username: String,
}

#[tauri::command]
pub async fn init_database() -> Result<String, String> {
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn store_auth_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    token: String,
    username: String,
) -> Result<String, String> {
    let conn = state.conn.lock().str_err()?;
    crate::sessions::save_session_token(&conn, "app_auth", &token, Some(&username))?;
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn get_auth_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Option<AuthSession>, String> {
    let conn = state.conn.lock().str_err()?;
    Ok(crate::sessions::load_session_token(&conn, "app_auth")?
        .map(|(token, username)| AuthSession { token, username: username.unwrap_or_default() }))
}

#[tauri::command]
pub async fn clear_auth_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<String, String> {
    let conn = state.conn.lock().str_err()?;
    crate::sessions::delete_session_token(&conn, "app_auth")?;
    Ok("ok".to_string())
}
