// IGDB endpoint/image constants and the retrying APIcalypse query helper
// every other submodule goes through.

use crate::db::ToStringErr;

// -- Constants ----------------------------------------------------------------

pub(crate) const IGDB_API_GAMES: &str = "https://api.igdb.com/v4/games";
pub(crate) const IGDB_API_EXTERNAL_GAMES: &str = "https://api.igdb.com/v4/external_games";
pub(super) const IGDB_API_ARTWORKS: &str = "https://api.igdb.com/v4/artworks";
pub(super) const IGDB_API_SCREENSHOTS: &str = "https://api.igdb.com/v4/screenshots";
pub(super) const IGDB_API_COVERS: &str = "https://api.igdb.com/v4/covers";
pub(super) const IGDB_IMAGE_COVER_BIG: &str = "https://images.igdb.com/igdb/image/upload/t_cover_big";
pub(super) const IGDB_IMAGE_1080P: &str = "https://images.igdb.com/igdb/image/upload/t_1080p";

pub(crate) const EDITION_KEYWORDS: &[&str] = &[
    "deluxe",
    "digital",
    "edition",
    "skin",
    "pack",
    "bundle",
    "gold",
    "premium",
    "ultimate",
    "complete",
    "goty",
    "remastered",
    "definitive",
    "anniversary",
    "collector",
    "limited",
    "special",
    "enhanced",
    "expanded",
];

pub(crate) const IGDB_GAME_FIELDS: &str = "id,cover.image_id,name,summary,first_release_date,genres.name,rating,category,involved_companies.company.name,involved_companies.developer,involved_companies.publisher";

// -- IGDB helpers --------------------------------------------------------------

pub(crate) async fn igdb_query(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    endpoint: &str,
    body: &str,
) -> Result<serde_json::Value, String> {
    const MAX_RETRIES: u32 = 4;
    let mut delay_secs = 1u64;

    for attempt in 0..=MAX_RETRIES {
        let resp = client
            .post(endpoint)
            .header("Client-ID", client_id)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "text/plain")
            .body(body.to_string())
            .send()
            .await
            .str_err()?;

        let status = resp.status();

        if status.as_u16() == 429 {
            if attempt == MAX_RETRIES {
                return Err(format!(
                    "IGDB error (HTTP 429): rate limited after {} retries",
                    MAX_RETRIES
                ));
            }
            // Respect Retry-After header if present, otherwise exponential backoff
            let wait = resp
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(delay_secs);
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            delay_secs = (delay_secs * 2).min(30);
            continue;
        }

        if !status.is_success() {
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("IGDB error (HTTP {}): {}", status, b));
        }

        return resp
            .json::<serde_json::Value>()
            .await
            .str_err();
    }
    Err("IGDB: unreachable".into())
}
