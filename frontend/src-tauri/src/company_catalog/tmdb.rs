// TMDB production companies (`company/{id}` + discover movie/tv
// `with_companies`) and TV networks (`network/{id}` + discover tv
// `with_networks`), with the user's own access token or api key.
use serde_json::Value;

use super::model::{CompanyPage, CompanyWork, WorksCursor};

/// Below this many votes a TMDB average is noise (one 10/10 vote), so the
/// work gets no score.
const MIN_VOTES_FOR_SCORE: u64 = 10;
/// TMDB's Animation genre.
const GENRE_ANIMATION: u64 = 16;

/// Japanese animation on TMDB: search serves it from AniList instead and
/// drops it from TMDB results (lib/search/providers/tmdb.ts isAnime); the
/// company page does the same so both list the same works.
fn is_japanese_animation(row: &Value) -> bool {
    row["original_language"].as_str() == Some("ja")
        && row["genre_ids"].as_array().is_some_and(|ids| ids.iter().any(|id| id.as_u64() == Some(GENRE_ANIMATION)))
}
use super::FetchError;
use crate::igdb::RequestBudget;

const TMDB_API: &str = "https://api.themoviedb.org/3";
const POSTER_BASE: &str = "https://image.tmdb.org/t/p/w300";
const LOGO_BASE: &str = "https://image.tmdb.org/t/p/w300";
/// TMDB refuses discover pages past 500.
const MAX_PAGE: u32 = 500;
/// Discover pages fetched per load-more call (20 results each).
pub(super) const PAGES_PER_CALL: u32 = 3;

static TMDB_COMPANY_BUDGET: RequestBudget =
    RequestBudget::new(10, std::time::Duration::from_secs(1), std::time::Duration::ZERO);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TmdbKind {
    Company,
    Network,
}

pub(crate) struct TmdbAuth {
    access_token: Option<String>,
    api_key: Option<String>,
}

pub(crate) fn auth(app_handle: &tauri::AppHandle) -> Result<TmdbAuth, FetchError> {
    let cfg = crate::igdb_env::load_env_config(app_handle).map_err(FetchError::Api)?;
    let non_empty = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
    let access_token = non_empty(cfg.tmdb_access_token);
    let api_key = non_empty(cfg.tmdb_api_key);
    if access_token.is_none() && api_key.is_none() {
        return Err(FetchError::KeysMissing);
    }
    Ok(TmdbAuth { access_token, api_key })
}

pub(crate) async fn get(auth: &TmdbAuth, path: &str, query: &[(&str, String)]) -> Result<Value, FetchError> {
    TMDB_COMPANY_BUDGET.acquire().await;
    let mut request = crate::http::http_client().get(format!("{TMDB_API}{path}")).query(query);
    if let Some(token) = &auth.access_token {
        request = request.bearer_auth(token);
    }
    if let Some(key) = &auth.api_key {
        request = request.query(&[("api_key", key)]);
    }
    let response = request.send().await.map_err(|e| FetchError::Api(e.to_string()))?;
    let status = response.status();
    if status.as_u16() == 404 {
        return Err(FetchError::NotFound);
    }
    if !status.is_success() {
        return Err(FetchError::Api(format!("TMDB HTTP {status}")));
    }
    response.json().await.map_err(|e| FetchError::Api(e.to_string()))
}

/// `company/{id}` or `network/{id}` → page header.
pub(super) fn parse_header(provider_id: &str, kind: TmdbKind, body: &Value) -> Option<CompanyPage> {
    let name = body["name"].as_str()?.to_string();
    let text = |key: &str| body[key].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    Some(CompanyPage {
        provider_id: provider_id.to_string(),
        source: "tmdb".into(),
        name,
        logo_url: text("logo_path").map(|p| format!("{LOGO_BASE}{p}")),
        description: text("description"),
        country_code: text("origin_country"),
        headquarters: text("headquarters"),
        founded_year: None,
        websites: text("homepage").into_iter().collect(),
        source_url: body["id"].as_u64().map(|id| format!(
            "https://www.themoviedb.org/{}/{id}",
            match kind { TmdbKind::Company => "company", TmdbKind::Network => "network" }
        )),
        roles: vec![match kind { TmdbKind::Company => "production", TmdbKind::Network => "network" }.to_string()],
        works: Vec::new(),
        total_hint: None,
    })
}

pub(super) struct DiscoverPage {
    pub works: Vec<CompanyWork>,
    pub total_pages: u32,
    pub total_results: u32,
}

/// One discover page. `media_type` is `movie` or `series`; `today` is
/// `YYYY-MM-DD` (TMDB dates compare as strings).
pub(super) fn parse_discover(body: &Value, media_type: &str, role: &str, today: &str) -> DiscoverPage {
    let works = body["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let id = row["id"].as_u64()?;
            if is_japanese_animation(row) {
                return None;
            }
            let title = row["title"].as_str().or_else(|| row["name"].as_str())?;
            let date = row["release_date"].as_str().or_else(|| row["first_air_date"].as_str()).unwrap_or("");
            Some(CompanyWork {
                external_id: format!("{media_type}:{id}"),
                title: title.to_string(),
                cover_url: row["poster_path"].as_str().map(|p| format!("{POSTER_BASE}{p}")),
                year: date.get(..4).and_then(|y| y.parse().ok()),
                media_type: media_type.to_string(),
                roles: vec![role.to_string()],
                is_extra: false,
                unreleased: date.is_empty() || date > today,
                score: row["vote_average"]
                    .as_f64()
                    .filter(|v| *v > 0.0 && row["vote_count"].as_u64().unwrap_or(0) >= MIN_VOTES_FOR_SCORE)
                    .map(|v| (v * 10.0).round() as f32 / 10.0),
                is_adult: false,
                format: None,
            })
        })
        .collect();
    DiscoverPage {
        works,
        total_pages: body["total_pages"].as_u64().unwrap_or(0).min(u64::from(MAX_PAGE)) as u32,
        total_results: body["total_results"].as_u64().unwrap_or(0) as u32,
    }
}

fn next_page(current: u32, total_pages: u32) -> Option<u32> {
    (current < total_pages).then_some(current + 1)
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

async fn discover(auth: &TmdbAuth, kind: TmdbKind, company_id: u64, media_type: &str, page: u32) -> Result<DiscoverPage, FetchError> {
    let (path, sort) = if media_type == "movie" { ("/discover/movie", "primary_release_date.desc") } else { ("/discover/tv", "first_air_date.desc") };
    let filter = match kind { TmdbKind::Company => "with_companies", TmdbKind::Network => "with_networks" };
    let role = match kind { TmdbKind::Company => "production", TmdbKind::Network => "network" };
    let body = get(auth, path, &[
        (filter, company_id.to_string()),
        ("sort_by", sort.to_string()),
        ("include_adult", "false".to_string()),
        ("language", "en-US".to_string()),
        ("page", page.to_string()),
    ]).await?;
    Ok(parse_discover(&body, media_type, role, &today()))
}

pub(super) async fn fetch_first(app_handle: &tauri::AppHandle, provider_id: &str, kind: TmdbKind, company_id: u64) -> Result<(CompanyPage, WorksCursor), FetchError> {
    let auth = auth(app_handle)?;
    let path = match kind { TmdbKind::Company => format!("/company/{company_id}"), TmdbKind::Network => format!("/network/{company_id}") };
    let body = get(&auth, &path, &[]).await?;
    let mut page = parse_header(provider_id, kind, &body).ok_or(FetchError::NotFound)?;
    let tv = discover(&auth, kind, company_id, "series", 1).await?;
    let (movie, movie_page) = match kind {
        TmdbKind::Company => {
            let movie = discover(&auth, kind, company_id, "movie", 1).await?;
            let next = next_page(1, movie.total_pages);
            (Some(movie), next)
        }
        TmdbKind::Network => (None, None),
    };
    page.total_hint = Some(tv.total_results + movie.as_ref().map_or(0, |m| m.total_results));
    let tv_page = next_page(1, tv.total_pages);
    if let Some(movie) = movie {
        super::model::merge_works(&mut page.works, movie.works);
    }
    super::model::merge_works(&mut page.works, tv.works);
    Ok((page, WorksCursor::Tmdb { movie_page, tv_page }))
}

pub(super) async fn fetch_next(app_handle: &tauri::AppHandle, kind: TmdbKind, company_id: u64, mut movie_page: Option<u32>, mut tv_page: Option<u32>) -> Result<(Vec<CompanyWork>, WorksCursor), FetchError> {
    let auth = auth(app_handle)?;
    let mut works = Vec::new();
    for _ in 0..PAGES_PER_CALL {
        if let Some(page) = movie_page {
            let result = discover(&auth, kind, company_id, "movie", page).await?;
            movie_page = next_page(page, result.total_pages);
            works.extend(result.works);
        } else if let Some(page) = tv_page {
            let result = discover(&auth, kind, company_id, "series", page).await?;
            tv_page = next_page(page, result.total_pages);
            works.extend(result.works);
        } else {
            break;
        }
    }
    Ok((works, WorksCursor::Tmdb { movie_page, tv_page }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMPANY: &str = include_str!("fixtures/tmdb_company.json");
    const DISCOVER: &str = include_str!("fixtures/tmdb_discover_movie.json");

    #[test]
    fn company_fixture_parses_header() {
        let body: Value = serde_json::from_str(COMPANY).unwrap();
        let page = parse_header("tmdb-company:420", TmdbKind::Company, &body).unwrap();
        assert_eq!(page.name, "Marvel Studios");
        assert_eq!(page.logo_url.as_deref(), Some("https://image.tmdb.org/t/p/w300/hUzeosd33nzE5MCNsZxCGEKTXaQ.png"));
        assert_eq!(page.headquarters.as_deref(), Some("Burbank, California, United States"));
        assert_eq!(page.country_code.as_deref(), Some("US"));
        assert_eq!(page.websites, vec!["https://www.marvel.com/movies"]);
        assert_eq!(page.roles, vec!["production"]);
        assert_eq!(page.source_url.as_deref(), Some("https://www.themoviedb.org/company/420"));
        let network = parse_header("tmdb-network:213", TmdbKind::Network, &serde_json::json!({ "name": "Netflix", "logo_path": null })).unwrap();
        assert_eq!(network.roles, vec!["network"]);
        assert_eq!(network.logo_url, None);
    }

    #[test]
    fn discover_fixture_parses_works_and_release_state() {
        let body: Value = serde_json::from_str(DISCOVER).unwrap();
        let page = parse_discover(&body, "movie", "production", "2026-09-23");
        assert_eq!(page.total_pages, 5);
        assert_eq!(page.total_results, 92);
        assert_eq!(page.works.len(), 3, "rows without an id and Japanese animation are skipped");
        assert_eq!(page.works[0].score, Some(8.2));
        assert_eq!(page.works[1].score, None, "too few votes");
        let endgame = &page.works[0];
        assert_eq!(endgame.external_id, "movie:299534");
        assert_eq!(endgame.year, Some(2019));
        assert!(!endgame.unreleased);
        assert!(page.works[1].unreleased, "future date");
        assert!(page.works[2].unreleased, "no date");
        assert_eq!(page.works[2].year, None);
    }

    #[test]
    fn paging_stops_at_the_last_page() {
        assert_eq!(next_page(1, 5), Some(2));
        assert_eq!(next_page(5, 5), None);
        assert_eq!(next_page(1, 0), None);
    }
}
