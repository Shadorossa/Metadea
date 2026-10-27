// IGDB games by their URL slug — the key the Backloggd import has: a
// Backloggd game URL (`/games/<slug>/`) carries IGDB's own slug, while the
// export's numeric id is Backloggd's internal one.
use serde::Serialize;

use super::auth::get_twitch_token;
use super::batch::{igdb_credentials, twitch_error};
use super::client::{igdb_query, IGDB_API_GAMES, IGDB_IMAGE_COVER_BIG};
use super::mapping::detect_vn;
use crate::error_codes::{self, with_detail};

// IGDB caps a response at 500 rows; one slug matches at most one game.
const SLUGS_PER_QUERY: usize = 200;

#[derive(Debug, Serialize, PartialEq)]
pub struct IgdbSlugMatch {
    pub slug: String,
    pub id: u64,
    pub name: String,
    pub cover_url: Option<String>,
    pub release_year: Option<i32>,
    /// Filed as `vnovel:` instead of `game:` (same rule as the search).
    pub is_vn: bool,
}

/// Slugs IGDB can match: lowercase letters, digits and `-` only, so the
/// query string needs no escaping.
fn is_slug(slug: &str) -> bool {
    !slug.is_empty() && slug.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn slug_query(slugs: &[&str]) -> String {
    let list = slugs.iter().map(|s| format!("\"{s}\"")).collect::<Vec<_>>().join(",");
    format!(
        "fields id,slug,name,cover.image_id,first_release_date,genres.id,\
         version_parent.genres.id,parent_game.genres.id; where slug = ({list}); limit 500;"
    )
}

fn parse_match(game: &serde_json::Value) -> Option<IgdbSlugMatch> {
    let release_year = game["first_release_date"]
        .as_i64()
        .and_then(|secs| chrono::DateTime::from_timestamp(secs, 0))
        .map(|date| chrono::Datelike::year(&date));
    Some(IgdbSlugMatch {
        slug: game["slug"].as_str()?.to_string(),
        id: game["id"].as_u64()?,
        name: game["name"].as_str().unwrap_or_default().to_string(),
        cover_url: game["cover"]["image_id"].as_str().map(|id| format!("{IGDB_IMAGE_COVER_BIG}/{id}.jpg")),
        release_year,
        is_vn: detect_vn(game),
    })
}

/// The IGDB game behind each slug that exists; unknown slugs are left out.
#[tauri::command]
pub async fn igdb_games_by_slugs(app_handle: tauri::AppHandle, slugs: Vec<String>) -> Result<Vec<IgdbSlugMatch>, String> {
    let mut wanted: Vec<&str> = slugs.iter().map(String::as_str).filter(|s| is_slug(s)).collect();
    wanted.sort_unstable();
    wanted.dedup();
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let cfg = crate::igdb_env::env_from_db(&tauri::Manager::state::<crate::db::MetadeaDb>(&app_handle))?;
    let (client_id, client_secret) = igdb_credentials(cfg.igdb_client_id, cfg.igdb_client_secret)?;
    let token = get_twitch_token(&client_id, &client_secret).await.map_err(|e| twitch_error(&e))?;
    let client = crate::http::http_client();

    let mut matches = Vec::new();
    for chunk in wanted.chunks(SLUGS_PER_QUERY) {
        let body = igdb_query(client, &client_id, &token, IGDB_API_GAMES, &slug_query(chunk))
            .await
            .map_err(|e| with_detail(error_codes::IGDB_NETWORK, e))?;
        matches.extend(body.as_array().into_iter().flatten().filter_map(parse_match));
    }
    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_slugs_reach_the_query() {
        assert!(is_slug("the-witcher-3-wild-hunt"));
        for bad in ["", "Zelda", "a\"b", "a b", "x;fields"] {
            assert!(!is_slug(bad), "{bad}");
        }
        assert_eq!(
            slug_query(&["a", "b-2"]),
            "fields id,slug,name,cover.image_id,first_release_date,genres.id,\
             version_parent.genres.id,parent_game.genres.id; where slug = (\"a\",\"b-2\"); limit 500;"
        );
    }

    #[test]
    fn parses_a_game_and_flags_visual_novels() {
        let game = serde_json::json!({
            "id": 1942, "slug": "the-witcher-3-wild-hunt", "name": "The Witcher 3: Wild Hunt",
            "cover": { "image_id": "co1wyy" }, "first_release_date": 1431993600,
            "genres": [{ "id": 12 }, { "id": 31 }],
        });
        assert_eq!(parse_match(&game), Some(IgdbSlugMatch {
            slug: "the-witcher-3-wild-hunt".into(),
            id: 1942,
            name: "The Witcher 3: Wild Hunt".into(),
            cover_url: Some(format!("{IGDB_IMAGE_COVER_BIG}/co1wyy.jpg")),
            release_year: Some(2015),
            is_vn: false,
        }));
        let vn = serde_json::json!({ "id": 7, "slug": "steins-gate", "name": "Steins;Gate", "genres": [{ "id": 34 }] });
        let parsed = parse_match(&vn).unwrap();
        assert!(parsed.is_vn);
        assert_eq!((parsed.cover_url, parsed.release_year), (None, None));
        assert_eq!(parse_match(&serde_json::json!({ "name": "no id" })), None);
    }
}
