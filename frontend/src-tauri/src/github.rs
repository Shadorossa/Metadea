use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use crate::db::ToStringErr;

const GITHUB_API: &str = "https://api.github.com";
const GITHUB_OAUTH_DEVICE_CODE: &str = "https://github.com/login/device/code";
const GITHUB_OAUTH_ACCESS_TOKEN: &str = "https://github.com/login/oauth/access_token";

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

// ─── Token commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_github_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    token: String,
) -> Result<(), String> {
    let encrypted = crate::utils::encrypt_secret(&token)?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO user_sessions (service, token, updated_at)
         VALUES ('github', ?1, ?2)
         ON CONFLICT(service) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at",
        rusqlite::params![encrypted, now],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub fn get_github_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Option<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let encrypted: Option<String> = conn
        .query_row(
            "SELECT token FROM user_sessions WHERE service = 'github'",
            [],
            |row| row.get(0),
        )
        .optional()
        .str_err()?;

    match encrypted {
        None => Ok(None),
        Some(stored) => Ok(Some(crate::utils::decrypt_secret(&stored)?)),
    }
}

#[tauri::command]
pub fn delete_github_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM user_sessions WHERE service = 'github'", [])
        .map(|_| ()).str_err()
}

// ─── API commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn request_github_device_code(client_id: String) -> Result<DeviceCodeResponse, String> {
    let client = crate::http::http_client();
    let res = client
        .post(GITHUB_OAUTH_DEVICE_CODE)
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "client_id": client_id, "scope": "public_repo" }))
        .send()
        .await
        .str_err()?;
    if !res.status().is_success() {
        return Err(crate::error_codes::with_detail(crate::error_codes::GITHUB_API, res.status()));
    }
    res.json().await.str_err()
}

#[tauri::command]
pub async fn request_github_device_token(
    client_id: String,
    device_code: String,
) -> Result<TokenResponse, String> {
    let client = crate::http::http_client();
    let res = client
        .post(GITHUB_OAUTH_ACCESS_TOKEN)
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "device_code": device_code,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
        }))
        .send()
        .await
        .str_err()?;
    if !res.status().is_success() {
        return Err(crate::error_codes::with_detail(crate::error_codes::GITHUB_API, res.status()));
    }
    res.json().await.str_err()
}

#[tauri::command]
pub async fn get_github_user_profile(token: String) -> Result<Value, String> {
    let client = crate::http::http_client();

    let mut last_err = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        match client
            .get(format!("{}/user", GITHUB_API))
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "Metadea-App")
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(res) => {
                if res.status().is_success() {
                    return res.json().await.str_err();
                } else if res.status().as_u16() == 401 {
                    return Err(crate::error_codes::GITHUB_SESSION_EXPIRED.to_string());
                } else {
                    return Err(crate::error_codes::with_detail(crate::error_codes::GITHUB_API, res.status()));
                }
            }
            Err(e) => {
                last_err = crate::error_codes::with_detail(crate::error_codes::GITHUB_NETWORK, e);
            }
        }
    }
    Err(last_err)
}
