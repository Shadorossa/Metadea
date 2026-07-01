use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

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
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO user_sessions (service, token, username, updated_at)
         VALUES ('app_auth', ?1, ?2, ?3)
         ON CONFLICT(service) DO UPDATE SET
             token = excluded.token,
             username = excluded.username,
             updated_at = excluded.updated_at",
        rusqlite::params![token, username, now],
    ).map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn get_auth_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Option<AuthSession>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT token, username FROM user_sessions WHERE service = 'app_auth'",
        [],
        |row| {
            Ok(AuthSession {
                token:    row.get(0)?,
                username: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_auth_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM user_sessions WHERE service = 'app_auth'", [])
        .map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn save_library_item() -> Result<String, String> {
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn get_library_items() -> Result<Vec<String>, String> {
    Ok(vec![])
}

#[tauri::command]
pub async fn get_library_stats() -> Result<String, String> {
    Ok("{}".to_string())
}
