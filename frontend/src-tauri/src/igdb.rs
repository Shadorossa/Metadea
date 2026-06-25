use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// ── Token cache ───────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct IgdbTokenCache {
  pub token:   Mutex<Option<CachedToken>>,
}

pub struct CachedToken {
  pub access_token: String,
  pub expires_at:   u64, // unix seconds
}

// ── Twitch OAuth response ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct TwitchTokenResponse {
  access_token: String,
  expires_in:   u64,
}

// ── IGDB types ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct IgdbGame {
  pub id:                  u64,
  pub name:                String,
  #[serde(default)] pub summary:           Option<String>,
  #[serde(default)] pub cover:             Option<IgdbCover>,
  #[serde(default)] pub screenshots:       Option<Vec<IgdbImage>>,
  #[serde(default)] pub artworks:          Option<Vec<IgdbImage>>,
  #[serde(default)] pub genres:            Option<Vec<IgdbNamed>>,
  #[serde(default)] pub involved_companies: Option<Vec<IgdbInvolvedCompany>>,
  #[serde(default)] pub first_release_date: Option<i64>,
  #[serde(default)] pub rating:            Option<f64>,
  #[serde(default)] pub rating_count:      Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct IgdbCover {
  pub id:       u64,
  pub image_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct IgdbImage {
  pub id:       u64,
  pub image_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct IgdbNamed {
  pub id:   u64,
  pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct IgdbInvolvedCompany {
  pub id:                    u64,
  #[serde(default)] pub company:   Option<IgdbNamed>,
  #[serde(default)] pub developer: Option<bool>,
  #[serde(default)] pub publisher: Option<bool>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn igdb_image_url(image_id: &str, size: &str) -> String {
  format!("https://images.igdb.com/igdb/image/upload/t_{}/{}.jpg", size, image_id)
}

fn now_secs() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
}

// ── Token fetching ────────────────────────────────────────────────────────────

pub async fn get_bearer_token(
  client_id:     &str,
  client_secret: &str,
  cache:         &IgdbTokenCache,
) -> Result<String, String> {
  // Check cache first
  {
    let lock = cache.token.lock().unwrap();
    if let Some(cached) = lock.as_ref() {
      if now_secs() < cached.expires_at.saturating_sub(60) {
        return Ok(cached.access_token.clone());
      }
    }
  }

  // Fetch new token from Twitch
  let client = reqwest::Client::new();
  let resp = client
    .post("https://id.twitch.tv/oauth2/token")
    .query(&[
      ("client_id",     client_id),
      ("client_secret", client_secret),
      ("grant_type",    "client_credentials"),
    ])
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !resp.status().is_success() {
    return Err(format!("Twitch auth error: {}", resp.status()));
  }

  let data: TwitchTokenResponse = resp.json().await.map_err(|e| e.to_string())?;
  let expires_at = now_secs() + data.expires_in;

  // Store in cache
  {
    let mut lock = cache.token.lock().unwrap();
    *lock = Some(CachedToken {
      access_token: data.access_token.clone(),
      expires_at,
    });
  }

  Ok(data.access_token)
}

// ── IGDB query ────────────────────────────────────────────────────────────────

async fn igdb_post(
  client:    &reqwest::Client,
  client_id: &str,
  token:     &str,
  body:      String,
) -> Result<Vec<IgdbGame>, String> {
  let resp = client
    .post("https://api.igdb.com/v4/games")
    .header("Client-ID",     client_id)
    .header("Authorization", format!("Bearer {}", token))
    .header("Content-Type",  "text/plain")
    .body(body)
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !resp.status().is_success() {
    return Err(format!("IGDB error: {}", resp.status()));
  }

  resp.json::<Vec<IgdbGame>>().await.map_err(|e| e.to_string())
}

const IGDB_FIELDS: &str =
  "id,name,summary,cover.image_id,screenshots.image_id,artworks.image_id,\
   genres.name,involved_companies.company.name,involved_companies.developer,\
   involved_companies.publisher,first_release_date,rating,rating_count";

pub async fn search_games(
  name:      &str,
  client_id: &str,
  token:     &str,
) -> Result<Vec<IgdbGame>, String> {
  let client   = reqwest::Client::new();
  let safe     = name.replace('"', "\\\"");

  // Two queries in parallel: relevance search + substring name match
  let search_body = format!(
    r#"search "{}"; fields {}; limit 15;"#,
    safe, IGDB_FIELDS
  );
  let where_body = format!(
    r#"fields {}; where name ~ *"{}"* & version_parent = null; sort rating desc; limit 15;"#,
    IGDB_FIELDS, safe
  );

  let (search_res, where_res) = tokio::join!(
    igdb_post(&client, client_id, token, search_body),
    igdb_post(&client, client_id, token, where_body),
  );

  // Merge and deduplicate by id, preserving search order first
  let mut seen  = std::collections::HashSet::new();
  let mut games = Vec::<IgdbGame>::new();

  for game in search_res.unwrap_or_default().into_iter()
    .chain(where_res.unwrap_or_default().into_iter())
  {
    if seen.insert(game.id) {
      games.push(game);
    }
  }

  Ok(games)
}
