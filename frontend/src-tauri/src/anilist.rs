use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::Manager;

fn anilist_session_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session_anilist.json"))
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
    anilist_token_encrypted: String,
}

#[tauri::command]
pub fn save_anilist_token(app_handle: tauri::AppHandle, token: String) -> Result<(), String> {
    let path = anilist_session_path(&app_handle)?;
    let encrypted_bytes = encrypt_token(&token)?;
    let b64_encrypted = crate::utils::base64_encode(&encrypted_bytes);
    let session = SessionData { anilist_token_encrypted: b64_encrypted };
    let raw = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_anilist_token(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = anilist_session_path(&app_handle)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let session: SessionData = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let encrypted_bytes = crate::utils::base64_decode(&session.anilist_token_encrypted)?;
    let token = decrypt_token(&encrypted_bytes)?;
    Ok(Some(token))
}

#[tauri::command]
pub fn delete_anilist_token(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = anilist_session_path(&app_handle)?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_anilist_user_profile(token: String) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let query = r#"
        query {
            Viewer {
                name
                avatar {
                    large
                }
            }
        }
    "#;

    let res = client
        .post("https://graphql.anilist.co")
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": query }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Failed to load AniList profile: {}", res.status()));
    }

    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(data)
}
