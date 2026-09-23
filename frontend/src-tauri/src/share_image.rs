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
// A cover URL reaching here comes from the community catalog, i.e. from a
// third-party pull request. Without these guards the command is a general
// purpose fetch primitive: it would happily pull `http://127.0.0.1:.../` (the
// VLC control interface listens there) or stream an unbounded body into
// memory, base64 included.
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

fn is_blocked_ip(ip: &std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
                || v4.is_broadcast()
        }
        std::net::IpAddr::V6(v6) => {
            let segments = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // fc00::/7 unique-local and fe80::/10 link-local; both are
                // still unstable in std, so match the prefixes directly.
                || (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80
        }
    }
}

/// Rejects anything that is not plain `https` pointing at a public address.
///
/// This resolves the host and re-checks, rather than trusting the literal, so
/// a name that maps to 127.0.0.1 is caught too. It cannot close a DNS-rebinding
/// race between this lookup and reqwest's own — for that the connection itself
/// would have to be intercepted — but it removes the trivial cases.
async fn ensure_public_https(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid image URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Only https image URLs are allowed".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "Image URL has no host".to_string())?
        .to_string();
    let port = parsed.port_or_known_default().unwrap_or(443);

    let addresses = tokio::task::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        (host.as_str(), port)
            .to_socket_addrs()
            .map(|iter| iter.collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| "Could not resolve the image host".to_string())?;

    if addresses.is_empty() || addresses.iter().any(|addr| is_blocked_ip(&addr.ip())) {
        return Err("Image host is not a public address".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn fetch_image_data_url(url: String) -> Result<String, String> {
    ensure_public_https(&url).await?;

    let mut resp = crate::http::http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Failed to download image: HTTP {}", resp.status()));
    }
    if resp.content_length().is_some_and(|len| len > MAX_IMAGE_BYTES as u64) {
        return Err("Image is too large".to_string());
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .unwrap_or("image/jpeg")
        .to_string();

    // Streamed rather than `.bytes()` so a server that lies about (or omits)
    // Content-Length still cannot make us allocate without bound.
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_IMAGE_BYTES {
            return Err("Image is too large".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
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
