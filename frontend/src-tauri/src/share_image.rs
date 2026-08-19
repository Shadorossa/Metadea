// "Compartir" in MediaEditorModal (see share-image.ts on the frontend,
// which draws the actual PNG on a canvas) — this side just puts up a save
// dialog and writes the bytes it's handed. There's no API to post directly
// to Instagram Stories from a desktop app (that only exists for mobile, and
// even then requires a Business account + Meta app review), so the whole
// feature is "generate the image, let the user share it themselves."
use crate::utils::{base64_decode, base64_encode};
use tauri_plugin_dialog::DialogExt;

// share-image.ts draws the cover/avatar onto a <canvas> to compose the
// share image — loading a remote https:// image straight into an <img> and
// exporting the canvas silently produces a blank result unless that image's
// server sends CORS headers explicitly allowing it, which AniList/TMDB/IGDB
// covers generally don't. Fetching the bytes here instead (a plain server-
// side HTTP request, no browser CORS policy involved) and handing them back
// as a data: URL sidesteps that entirely — a data: URL never taints a canvas.
#[tauri::command]
pub async fn fetch_image_data_url(url: String) -> Result<String, String> {
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Failed to download image: HTTP {}", resp.status()));
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(format!("data:{};base64,{}", content_type, base64_encode(&bytes)))
}

#[tauri::command]
pub async fn save_image_file(
    app_handle: tauri::AppHandle,
    // "data:image/png;base64,...." — same convention save_user_image
    // (user_metadata.rs) already uses for image data crossing the IPC
    // bridge, rather than a raw byte array.
    data_url: String,
    default_name: String,
) -> Result<Option<String>, String> {
    let b64 = data_url
        .split_once("base64,")
        .map(|(_, rest)| rest)
        .unwrap_or(&data_url);
    let bytes = base64_decode(b64)?;

    let picked = app_handle
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("PNG Image", &["png"])
        .blocking_save_file();

    let Some(path) = picked else { return Ok(None) };
    let path_str = path.to_string();
    std::fs::write(&path_str, &bytes).map_err(|e| e.to_string())?;
    Ok(Some(path_str))
}
