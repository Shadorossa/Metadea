use std::path::PathBuf;
use tauri::Manager;

fn user_metadata_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("user_metadata");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub async fn save_user_image(
    app_handle: tauri::AppHandle,
    key: String,
    data_url: String,
) -> Result<(), String> {
    let allowed = ["avatar", "banner"];
    if !allowed.contains(&key.as_str()) {
        return Err(format!("Invalid key: {}", key));
    }
    let path = user_metadata_dir(&app_handle)?.join(&key);
    let base64_data = data_url
        .splitn(2, ',')
        .nth(1)
        .ok_or("Invalid data URL")?;
    let bytes = crate::utils::base64_decode(base64_data)?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user_image(
    app_handle: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let allowed = ["avatar", "banner"];
    if !allowed.contains(&key.as_str()) {
        return Err(format!("Invalid key: {}", key));
    }
    let path = user_metadata_dir(&app_handle)?.join(&key);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mime = if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else {
        "image/webp"
    };
    let encoded = crate::utils::base64_encode(&bytes);
    Ok(Some(format!("data:{};base64,{}", mime, encoded)))
}

#[tauri::command]
pub async fn remove_user_image(
    app_handle: tauri::AppHandle,
    key: String,
) -> Result<(), String> {
    let allowed = ["avatar", "banner"];
    if !allowed.contains(&key.as_str()) {
        return Err(format!("Invalid key: {}", key));
    }
    let path = user_metadata_dir(&app_handle)?.join(&key);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn save_user_info(
    app_handle: tauri::AppHandle,
    info: serde_json::Value,
) -> Result<(), String> {
    let path = user_metadata_dir(&app_handle)?.join("user_info.json");
    let existing: serde_json::Value = if path.exists() {
        let raw = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    let mut merged = existing;
    if let (Some(obj), Some(new_obj)) = (merged.as_object_mut(), info.as_object()) {
        for (k, v) in new_obj { obj.insert(k.clone(), v.clone()); }
    }
    let out = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    std::fs::write(path, out).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_user_info(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = user_metadata_dir(&app_handle)?.join("user_info.json");
    if !path.exists() { return Ok(serde_json::json!({})); }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
