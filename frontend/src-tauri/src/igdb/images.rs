// Image handling: webp re-encoding of downloads, banner (landscape art)
// selection and the localized-cover lookup.

use crate::igdb_env::load_env_config;
use super::auth::get_twitch_token;
use super::client::{igdb_query, IGDB_API_ARTWORKS, IGDB_API_COVERS, IGDB_API_SCREENSHOTS, IGDB_IMAGE_COVER_BIG};

pub(crate) async fn download_as_webp(client: &reqwest::Client, url: &str, dest: &std::path::Path) {
    let Ok(resp) = client.get(url).send().await else {
        return;
    };
    let Ok(bytes) = resp.bytes().await else {
        return;
    };
    // Decode + webp re-encode + disk write are all CPU/blocking-IO work —
    // running them inline on this async fn used to tie up one of the async
    // runtime's own worker threads for the duration, same as any blocking
    // call would. Offloaded to spawn_blocking's dedicated pool so a burst of
    // concurrent cover downloads (an uncached grid's worth of cards) can't
    // starve the runtime's ability to service other in-flight requests.
    let dest = dest.to_path_buf();
    let _ = tokio::task::spawn_blocking(move || {
        let Ok(img) = image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg) else {
            return;
        };
        let _ = img.save_with_format(&dest, image::ImageFormat::WebP);
    })
    .await;
}

// Pulls (image_id, width, height) triples out of a raw IGDB artworks/screenshots
// array, skipping any entry flagged `alpha_channel: true` (transparent artworks
// tend to be logos/PNGs, not usable banner photography).
pub(super) fn extract_image_candidates(value: &serde_json::Value) -> Vec<(String, f64, f64)> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|entry| {
                    if entry["alpha_channel"].as_bool() == Some(true) {
                        return None;
                    }
                    let id = entry["image_id"].as_str()?;
                    let w = entry["width"].as_f64().unwrap_or(0.0);
                    let h = entry["height"].as_f64().unwrap_or(1.0);
                    Some((id.to_string(), w, h))
                })
                .collect()
        })
        .unwrap_or_default()
}

// Picks the best landscape/banner-shaped image out of a set of candidates.
pub(super) fn pick_landscape_image(candidates: &[(String, f64, f64)]) -> Option<String> {
    // Prefer images that meet the strict banner criteria (1280×720+, ratio ≥ 1.5)
    if let Some((id, _, _)) = candidates.iter().find(|(_, w, h)| *w >= 1280.0 && *h >= 720.0 && w / h >= 1.5) {
        return Some(id.clone());
    }

    // Fallback: pick the most landscape-like image (highest w/h ratio) that is wider than tall,
    // so we avoid accidentally picking logos (which tend to be square or portrait)
    candidates.iter()
        .filter(|(_, w, h)| w > h)
        .max_by(|(_, w1, h1), (_, w2, h2)| {
            (w1 / h1).partial_cmp(&(w2 / h2)).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(id, _, _)| id.clone())
}

pub(super) async fn fetch_landscape_image_id(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    game_id: u64,
) -> Option<String> {
    let arts_query = format!("fields image_id,width,height; where game = {} & alpha_channel = false; limit 10;", game_id);
    let ss_query = format!("fields image_id,width,height; where game = {}; limit 5;", game_id);
    let (arts_res, ss_res) = futures::join!(
        igdb_query(client, client_id, token, IGDB_API_ARTWORKS, &arts_query),
        igdb_query(client, client_id, token, IGDB_API_SCREENSHOTS, &ss_query),
    );

    let mut candidates: Vec<(String, f64, f64)> = Vec::new();
    if let Ok(arts) = arts_res {
        candidates.extend(extract_image_candidates(&arts));
    }
    if let Ok(ss) = ss_res {
        candidates.extend(extract_image_candidates(&ss));
    }

    if candidates.is_empty() {
        return None;
    }
    pick_landscape_image(&candidates)
}

/// Returns every cover variant IGDB has for a game. The covers endpoint is
/// separate from `games.cover`, which only exposes the single canonical cover.
#[tauri::command]
pub async fn igdb_get_localized_covers(
    app_handle: tauri::AppHandle,
    igdb_id: u64,
) -> Result<Vec<String>, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let query = format!(
        "fields image_id; where game = {} & image_id != null; limit 50;",
        igdb_id
    );
    let covers = igdb_query(crate::http::http_client(), &client_id, &token, IGDB_API_COVERS, &query).await?;
    Ok(covers
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|cover| cover["image_id"].as_str())
        .map(|image_id| format!("{}/{}.jpg", IGDB_IMAGE_COVER_BIG, image_id))
        .collect())
}
