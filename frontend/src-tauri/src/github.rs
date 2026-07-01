use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TokenResponse {
    pub access_token: Option<String>,
    pub token_type: Option<String>,
    pub scope: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

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
    String::from_utf8(encrypted.to_vec()).map_err(|e| e.to_string())
}

// ─── Token commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_github_token(
    state: tauri::State<'_, crate::db::SessionDb>,
    token: String,
) -> Result<(), String> {
    let encrypted = crate::utils::base64_encode(&encrypt_token(&token)?);
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO user_sessions (service, token, updated_at)
         VALUES ('github', ?1, ?2)
         ON CONFLICT(service) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at",
        rusqlite::params![encrypted, now],
    ).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_github_token(
    state: tauri::State<'_, crate::db::SessionDb>,
) -> Result<Option<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let encrypted: Option<String> = conn
        .query_row(
            "SELECT token FROM user_sessions WHERE service = 'github'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match encrypted {
        None => Ok(None),
        Some(b64) => {
            let bytes = crate::utils::base64_decode(&b64)?;
            Ok(Some(decrypt_token(&bytes)?))
        }
    }
}

#[tauri::command]
pub fn delete_github_token(
    state: tauri::State<'_, crate::db::SessionDb>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM user_sessions WHERE service = 'github'", [])
        .map(|_| ()).map_err(|e| e.to_string())
}

// ─── API commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn request_github_device_code(client_id: String) -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "client_id": client_id, "scope": "public_repo" }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("GitHub API error: {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn request_github_device_token(
    client_id: String,
    device_code: String,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("GitHub API error: {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_github_user_profile(token: String) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("token {}", token))
        .header("User-Agent", "Metadea-App")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to load GitHub profile: {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}
