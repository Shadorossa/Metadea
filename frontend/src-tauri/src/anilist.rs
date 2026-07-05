use rusqlite::OptionalExtension;
use serde_json::Value;
use crate::db::ToStringErr;

// ─── DPAPI encryption helpers ─────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn encrypt_token(token: &str) -> Result<Vec<u8>, String> {
    windows_dpapi::encrypt_data(token.as_bytes(), windows_dpapi::Scope::User)
        .map_err(|e| format!("Encryption failed: {:?}", e))
}

#[cfg(target_os = "windows")]
fn decrypt_token(encrypted: &[u8]) -> Result<String, String> {
    let bytes = windows_dpapi::decrypt_data(encrypted, windows_dpapi::Scope::User)
        .map_err(|e| format!("Decryption failed: {:?}", e))?;
    String::from_utf8(bytes).map_err(|e| format!("Invalid UTF-8: {}", e))
}

#[cfg(not(target_os = "windows"))]
fn encrypt_token(token: &str) -> Result<Vec<u8>, String> {
    Ok(token.as_bytes().to_vec())
}

#[cfg(not(target_os = "windows"))]
fn decrypt_token(encrypted: &[u8]) -> Result<String, String> {
    String::from_utf8(encrypted.to_vec()).str_err()
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_anilist_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    token: String,
) -> Result<(), String> {
    let encrypted = crate::utils::base64_encode(&encrypt_token(&token)?);
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO user_sessions (service, token, updated_at)
         VALUES ('anilist', ?1, ?2)
         ON CONFLICT(service) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at",
        rusqlite::params![encrypted, now],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub fn get_anilist_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Option<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let encrypted: Option<String> = conn
        .query_row(
            "SELECT token FROM user_sessions WHERE service = 'anilist'",
            [],
            |row| row.get(0),
        )
        .optional()
        .str_err()?;

    match encrypted {
        None => Ok(None),
        Some(b64) => {
            let bytes = crate::utils::base64_decode(&b64)?;
            Ok(Some(decrypt_token(&bytes)?))
        }
    }
}

#[tauri::command]
pub fn delete_anilist_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM user_sessions WHERE service = 'anilist'", [])
        .map(|_| ()).str_err()
}

#[tauri::command]
pub async fn get_anilist_user_profile(token: String) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let query = r#"query { Viewer { name avatar { large } } }"#;
    let res = client
        .post("https://graphql.anilist.co")
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": query }))
        .send()
        .await
        .str_err()?;

    if !res.status().is_success() {
        return Err(format!("Failed to load AniList profile: {}", res.status()));
    }
    res.json().await.str_err()
}
