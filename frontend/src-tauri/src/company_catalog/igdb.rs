// IGDB companies: the company row carries every game id it developed or
// published; the games themselves are resolved in multiquery batches (10
// sub-queries of 500 ids per request) through the shared IGDB client, so
// the IGDB_BUDGET rate limiter paces them with every other IGDB call.
use serde_json::Value;

use super::model::{score_from_100, CompanyPage, CompanyWork, PendingGame, WorksCursor};
use super::FetchError;
use crate::igdb::{
    detect_vn, get_twitch_token, igdb_query, plain_search_verdict, PlainSearchVerdict, IGDB_API_MULTIQUERY,
    IGDB_IMAGE_COVER_BIG,
};

const IGDB_API_COMPANIES: &str = "https://api.igdb.com/v4/companies";
const IDS_PER_QUERY: usize = 500;
const QUERIES_PER_REQUEST: usize = 10;
const LOGO_BASE: &str = "https://images.igdb.com/igdb/image/upload/t_logo_med";

// IGDB's (deprecated but still filled) status: 6 cancelled, 7 rumored.
// Cancelled games never reach the page (search drops them too).
const NEVER_RELEASED_STATUSES: &[u64] = &[6, 7];

pub(super) struct IgdbAuth {
    client_id: String,
    token: String,
}

pub(super) async fn auth(app_handle: &tauri::AppHandle) -> Result<IgdbAuth, FetchError> {
    let cfg = crate::igdb_env::load_env_config(app_handle).map_err(FetchError::Api)?;
    let (Some(client_id), Some(secret)) = (cfg.igdb_client_id, cfg.igdb_client_secret) else {
        return Err(FetchError::KeysMissing);
    };
    let token = get_twitch_token(&client_id, &secret).await.map_err(FetchError::Api)?;
    Ok(IgdbAuth { client_id, token })
}

/// ISO 3166-1 numeric (what IGDB stores) → alpha-2, for the countries game
/// companies actually come from; anything else is simply not shown.
fn country_alpha2(numeric: u64) -> Option<&'static str> {
    const TABLE: &[(u64, &str)] = &[
        (32, "AR"), (36, "AU"), (40, "AT"), (56, "BE"), (76, "BR"), (100, "BG"), (112, "BY"),
        (124, "CA"), (152, "CL"), (156, "CN"), (158, "TW"), (170, "CO"), (191, "HR"), (203, "CZ"),
        (208, "DK"), (233, "EE"), (246, "FI"), (250, "FR"), (276, "DE"), (300, "GR"), (344, "HK"),
        (348, "HU"), (352, "IS"), (356, "IN"), (360, "ID"), (372, "IE"), (376, "IL"), (380, "IT"),
        (392, "JP"), (410, "KR"), (428, "LV"), (440, "LT"), (458, "MY"), (484, "MX"), (528, "NL"),
        (554, "NZ"), (578, "NO"), (608, "PH"), (616, "PL"), (620, "PT"), (642, "RO"), (643, "RU"),
        (688, "RS"), (702, "SG"), (703, "SK"), (705, "SI"), (710, "ZA"), (724, "ES"), (752, "SE"),
        (756, "CH"), (764, "TH"), (792, "TR"), (804, "UA"), (826, "GB"), (840, "US"), (704, "VN"),
    ];
    TABLE.iter().find(|(n, _)| *n == numeric).map(|(_, code)| *code)
}

fn year_of_unix(ts: i64) -> Option<i32> {
    use chrono::Datelike;
    chrono::DateTime::from_timestamp(ts, 0).map(|d| d.year())
}

fn ids_of(value: &Value) -> Vec<u64> {
    value.as_array().map(|a| a.iter().filter_map(Value::as_u64).collect()).unwrap_or_default()
}

/// The `companies` row → page header plus the pending game ids.
pub(super) fn parse_company(provider_id: &str, rows: &Value) -> Option<(CompanyPage, Vec<PendingGame>)> {
    let row = rows.as_array()?.first()?;
    let name = row["name"].as_str()?.to_string();
    let developed = ids_of(&row["developed"]);
    let published = ids_of(&row["published"]);
    let mut pending: Vec<PendingGame> = developed.iter().map(|id| (*id, true, published.contains(id))).collect();
    pending.extend(published.iter().filter(|id| !developed.contains(id)).map(|id| (*id, false, true)));

    let mut roles = Vec::new();
    if !developed.is_empty() { roles.push("developer".to_string()); }
    if !published.is_empty() { roles.push("publisher".to_string()); }

    let page = CompanyPage {
        provider_id: provider_id.to_string(),
        source: "igdb".into(),
        name,
        logo_url: row["logo"]["image_id"].as_str().map(|id| format!("{LOGO_BASE}/{id}.png")),
        description: row["description"].as_str().filter(|s| !s.trim().is_empty()).map(str::to_string),
        country_code: row["country"].as_u64().and_then(country_alpha2).map(str::to_string),
        headquarters: None,
        founded_year: row["start_date"].as_i64().and_then(year_of_unix),
        source_url: row["url"].as_str().filter(|u| u.starts_with("https://")).map(str::to_string),
        websites: row["websites"]
            .as_array()
            .map(|a| a.iter().filter_map(|w| w["url"].as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
        roles,
        works: Vec::new(),
        total_hint: Some(pending.len() as u32),
    };
    Some((page, pending))
}

/// Multiquery body for one batch of ids.
pub(super) fn games_multiquery(batch: &[PendingGame]) -> String {
    batch
        .chunks(IDS_PER_QUERY)
        .enumerate()
        .map(|(i, chunk)| {
            let ids = chunk.iter().map(|(id, _, _)| id.to_string()).collect::<Vec<_>>().join(",");
            format!(
                "query games \"g{i}\" {{ fields name,cover.image_id,first_release_date,category,game_type,status,version_parent,version_title,total_rating,rating,genres.id; where id = ({ids}); limit {IDS_PER_QUERY}; }};"
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Multiquery response → works, with roles taken from the pending list.
pub(super) fn parse_games(response: &Value, batch: &[PendingGame], now_unix: i64) -> Vec<CompanyWork> {
    let mut works = Vec::new();
    for query in response.as_array().into_iter().flatten() {
        for game in query["result"].as_array().into_iter().flatten() {
            let Some(id) = game["id"].as_u64() else { continue };
            let Some(title) = game["name"].as_str() else { continue };
            let (developed, published) = batch
                .iter()
                .find(|(pid, _, _)| *pid == id)
                .map(|(_, d, p)| (*d, *p))
                .unwrap_or((false, false));
            let mut roles = Vec::new();
            if developed { roles.push("developer".to_string()); }
            if published { roles.push("publisher".to_string()); }
            let release = game["first_release_date"].as_i64();
            // The same filters search applies (igdb::plain_search_verdict):
            // what search drops is dropped here too, except DLC and the
            // like, kept behind the page's "Include DLC" toggle.
            let verdict = plain_search_verdict(game);
            if verdict == PlainSearchVerdict::Excluded { continue; }
            let status = game["status"].as_u64();
            let is_vn = detect_vn(game);
            works.push(CompanyWork {
                external_id: format!("{}:{id}", if is_vn { "vnovel" } else { "game" }),
                title: title.to_string(),
                cover_url: game["cover"]["image_id"].as_str().map(|c| format!("{IGDB_IMAGE_COVER_BIG}/{c}.jpg")),
                year: release.and_then(year_of_unix),
                media_type: if is_vn { "vnovel".into() } else { "game".into() },
                roles,
                is_extra: verdict == PlainSearchVerdict::Extra,
                unreleased: match release {
                    Some(ts) => ts > now_unix,
                    None => true,
                } || status.is_some_and(|s| NEVER_RELEASED_STATUSES.contains(&s)),
                score: score_from_100(game["total_rating"].as_f64().or_else(|| game["rating"].as_f64())),
                is_adult: false,
                format: None,
            });
        }
    }
    works
}

pub(super) async fn fetch_first(app_handle: &tauri::AppHandle, provider_id: &str, company_id: u64) -> Result<(CompanyPage, WorksCursor), FetchError> {
    let auth = auth(app_handle).await?;
    let client = crate::http::http_client();
    let body = format!(
        "fields name,url,description,country,start_date,logo.image_id,websites.url,developed,published; where id = {company_id}; limit 1;"
    );
    let rows = igdb_query(client, &auth.client_id, &auth.token, IGDB_API_COMPANIES, &body)
        .await
        .map_err(FetchError::Api)?;
    let (page, pending) = parse_company(provider_id, &rows).ok_or(FetchError::NotFound)?;
    Ok((page, WorksCursor::Igdb { pending }))
}

/// Resolves the next batch of pending ids.
pub(super) async fn fetch_next(app_handle: &tauri::AppHandle, pending: &[PendingGame]) -> Result<(Vec<CompanyWork>, WorksCursor), FetchError> {
    let auth = auth(app_handle).await?;
    let take = pending.len().min(IDS_PER_QUERY * QUERIES_PER_REQUEST);
    let (batch, rest) = pending.split_at(take);
    let response = igdb_query(crate::http::http_client(), &auth.client_id, &auth.token, IGDB_API_MULTIQUERY, &games_multiquery(batch))
        .await
        .map_err(FetchError::Api)?;
    let works = parse_games(&response, batch, chrono::Utc::now().timestamp());
    Ok((works, WorksCursor::Igdb { pending: rest.to_vec() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const COMPANY: &str = include_str!("fixtures/igdb_company.json");
    const GAMES: &str = include_str!("fixtures/igdb_games.json");

    #[test]
    fn company_fixture_parses_header_and_pending_roles() {
        let rows: Value = serde_json::from_str(COMPANY).unwrap();
        let (page, pending) = parse_company("igdb:1020", &rows).unwrap();
        assert_eq!(page.name, "FromSoftware");
        assert_eq!(page.country_code.as_deref(), Some("JP"));
        assert_eq!(page.founded_year, Some(1986));
        assert_eq!(page.logo_url.as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_logo_med/cl5ab.png"));
        assert_eq!(page.websites, vec!["https://www.fromsoftware.jp"]);
        assert_eq!(page.roles, vec!["developer", "publisher"]);
        // 3 developed + 1 published-only; 7018 is both.
        assert_eq!(pending, vec![(7018, true, true), (1942, true, false), (119133, true, false), (555, false, true)]);
        assert_eq!(page.total_hint, Some(4));
        assert!(parse_company("igdb:1", &serde_json::json!([])).is_none());
    }

    #[test]
    fn games_fixture_flags_extras_unreleased_and_visual_novels() {
        let response: Value = serde_json::from_str(GAMES).unwrap();
        let pending = vec![(7018, true, true), (1942, true, false), (119133, true, false), (555, false, true)];
        let now = 1_700_000_000;
        let works = parse_games(&response, &pending, now);
        assert_eq!(works.len(), 4, "the cancelled game and the remaster are dropped like in search");
        let by_id = |id: &str| works.iter().find(|w| w.external_id == id).unwrap();

        let sekiro = by_id("game:7018");
        assert_eq!(sekiro.roles, vec!["developer", "publisher"]);
        assert_eq!(sekiro.year, Some(2019));
        assert_eq!(sekiro.cover_url.as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_cover_big/co2a23.jpg"));
        assert!(!sekiro.is_extra && !sekiro.unreleased);
        assert_eq!(sekiro.score, Some(9.1));

        assert!(by_id("game:1942").is_extra, "game_type 1 is DLC");
        assert!(by_id("game:119133").unreleased, "release date after now");
        let vn = by_id("vnovel:555");
        assert_eq!(vn.media_type, "vnovel");
        assert_eq!(vn.roles, vec!["publisher"]);
        assert!(vn.unreleased, "no release date at all");
    }

    #[test]
    fn multiquery_batches_ids_by_five_hundred() {
        let batch: Vec<PendingGame> = (1..=1001).map(|id| (id, true, false)).collect();
        let body = games_multiquery(&batch);
        assert_eq!(body.matches("query games").count(), 3);
        assert!(body.contains("\"g2\""));
        assert!(body.contains("where id = (1001)"));
    }
}
