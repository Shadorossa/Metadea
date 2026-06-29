use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

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

#[tauri::command]
pub async fn request_github_device_code(client_id: String) -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "scope": "public_repo"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("GitHub API error: {}", res.status()));
    }

    let data: DeviceCodeResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(data)
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

    let data: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(data)
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

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}

fn github_session_path(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session.json"))
}

#[cfg(target_os = "windows")]
fn encrypt_token(token: &str) -> Result<Vec<u8>, String> {
    windows_dpapi::encrypt_data(token.as_bytes(), windows_dpapi::Scope::User)
        .map_err(|e| format!("Encryption failed: {:?}", e))
}

#[cfg(target_os = "windows")]
fn decrypt_token(encrypted: &[u8]) -> Result<String, String> {
    let decrypted_bytes = windows_dpapi::decrypt_data(encrypted, windows_dpapi::Scope::User)
        .map_err(|e| format!("Decryption failed: {:?}", e))?;
    String::from_utf8(decrypted_bytes)
        .map_err(|e| format!("Invalid UTF-8 after decryption: {}", e))
}

#[cfg(not(target_os = "windows"))]
fn encrypt_token(token: &str) -> Result<Vec<u8>, String> {
    Ok(token.as_bytes().to_vec())
}

#[cfg(not(target_os = "windows"))]
fn decrypt_token(encrypted: &[u8]) -> Result<String, String> {
    String::from_utf8(encrypted.to_vec())
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Debug)]
struct SessionData {
    github_token_encrypted: String,
}

#[tauri::command]
pub fn save_github_token(app_handle: tauri::AppHandle, token: String) -> Result<(), String> {
    let path = github_session_path(&app_handle)?;
    let encrypted_bytes = encrypt_token(&token)?;
    let b64_encrypted = crate::utils::base64_encode(&encrypted_bytes);
    let session = SessionData { github_token_encrypted: b64_encrypted };
    let raw = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_github_token(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = github_session_path(&app_handle)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let session: SessionData = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let encrypted_bytes = crate::utils::base64_decode(&session.github_token_encrypted)?;
    let token = decrypt_token(&encrypted_bytes)?;
    Ok(Some(token))
}

#[tauri::command]
pub fn delete_github_token(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = github_session_path(&app_handle)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
