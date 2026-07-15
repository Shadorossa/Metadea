// Comic Vine (comicvine.gamespot.com) — replaces OpenLibrary for the Comics
// tab specifically. OpenLibrary's own catalog is crowd-sourced and full of
// duplicate "work" records for the exact same comic (different contributors
// cataloging the same title separately); Comic Vine is curated specifically
// for comics (proper volume/issue structure) and doesn't have that problem
// nearly as badly. Routed through Tauri (not a direct browser fetch like
// OpenLibrary/TMDB/AniList) because Comic Vine's API doesn't send CORS
// headers — a browser fetch() to it is blocked outright regardless of the
// request itself being otherwise valid.
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

const COMICVINE_BASE: &str = "https://comicvine.gamespot.com/api";
const FIELD_LIST: &str = "id,name,image,start_year,publisher,count_of_issues,description,deck,site_detail_url";
// Only the singular /volume/ detail resource documents character_credits/
// concept_credits/person_credits as populated fields — the /search/ (list)
// resource above doesn't, so genres/cast/authors were always coming back
// empty when this list was reused for the single-volume detail fetch.
const VOLUME_DETAIL_FIELD_LIST: &str = "id,name,image,start_year,publisher,count_of_issues,description,deck,site_detail_url,character_credits,concept_credits,person_credits,first_issue,last_issue";
// first_issue/last_issue on the volume resource are only a minimal ref
// (id/name/issue_number, no cover_date) — one extra lightweight request per
// issue resolves the actual date, so the page can show a real start–end
// range instead of just start_year.
const ISSUE_DATE_FIELD_LIST: &str = "cover_date";

// Comic Vine prefixes every resource type's numeric id with a fixed code in
// detail-endpoint URLs (e.g. "4050-123" for volume 123) — this is the code
// for "volume" specifically, not a general-purpose id.
const VOLUME_RESOURCE_PREFIX: &str = "4050";

fn get_http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineImage {
    pub medium_url: Option<String>,
    pub small_url:  Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVinePublisher {
    pub name: Option<String>,
}

// Comic Vine's person credits (writer, artist, etc.) — `role` is a
// comma-separated string of roles (e.g. "writer, penciler").
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVinePersonCredit {
    pub id:   u64,
    pub name: String,
    pub role: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineIssueRef {
    pub id:           u64,
    pub name:         Option<String>,
    pub issue_number: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ComicVineVolume {
    pub id:                    u64,
    pub name:                  String,
    pub image:                 Option<ComicVineImage>,
    pub start_year:            Option<String>,
    pub publisher:             Option<ComicVinePublisher>,
    pub count_of_issues:       Option<u64>,
    pub description:           Option<String>,
    pub deck:                  Option<String>,
    pub site_detail_url:       Option<String>,
    #[serde(default)]
    pub character_credits:     Vec<ComicVineCharacterCredit>,
    #[serde(default)]
    pub concept_credits:       Vec<ComicVineConceptCredit>,
    #[serde(default)]
    pub person_credits:        Vec<ComicVinePersonCredit>,
    #[serde(default)]
    pub first_issue:           Option<ComicVineIssueRef>,
    #[serde(default)]
    pub last_issue:            Option<ComicVineIssueRef>,
    // Not part of Comic Vine's own JSON — resolved by comicvine_get_volume
    // with two extra lightweight requests (see ISSUE_DATE_FIELD_LIST) after
    // deserializing the volume response, since first_issue/last_issue above
    // are minimal refs without a cover_date.
    #[serde(default)]
    pub first_issue_cover_date: Option<String>,
    #[serde(default)]
    pub last_issue_cover_date:  Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComicVineSearchPage {
    pub volumes:  Vec<ComicVineVolume>,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
struct ComicVineSearchResponse {
    #[serde(default)]
    number_of_total_results: i64,
    #[serde(default)]
    results: Vec<ComicVineVolume>,
}

async fn comicvine_api_key(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let cfg = crate::igdb::read_env_config(app_handle.clone()).await?;
    cfg.comicvine_api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "Missing Comic Vine API key".to_string())
}

#[tauri::command]
pub async fn comicvine_search(
    app_handle: tauri::AppHandle,
    query: String,
    page: Option<u32>,
) -> Result<ComicVineSearchPage, String> {
    if query.trim().is_empty() {
        return Ok(ComicVineSearchPage { volumes: vec![], has_more: false });
    }

    let api_key = comicvine_api_key(&app_handle).await?;
    let client = get_http_client().str_err()?;

    const PAGE_SIZE: i64 = 50;
    let page = page.unwrap_or(1).max(1) as i64;
    let offset = (page - 1) * PAGE_SIZE;
    let limit_str = PAGE_SIZE.to_string();
    let offset_str = offset.to_string();

    let resp = client
        .get(format!("{COMICVINE_BASE}/search/"))
        .query(&[
            ("api_key", api_key.as_str()),
            ("format", "json"),
            ("query", query.as_str()),
            ("resources", "volume"),
            ("limit", limit_str.as_str()),
            ("offset", offset_str.as_str()),
            ("field_list", FIELD_LIST),
        ])
        // Comic Vine rejects requests with no User-Agent.
        .header("User-Agent", "Metadea (github.com/Shadorossa/Metadea)")
        .send()
        .await
        .map_err(|e| format!("Comic Vine request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Comic Vine error (HTTP {status}): {body}"));
    }

    let parsed = resp
        .json::<ComicVineSearchResponse>()
        .await
        .map_err(|e| format!("Comic Vine parse failed: {e}"))?;

    let has_more = offset + (parsed.results.len() as i64) < parsed.number_of_total_results;
    Ok(ComicVineSearchPage { volumes: parsed.results, has_more })
}

#[derive(Debug, Deserialize)]
struct ComicVineDetailResponse {
    results: Option<ComicVineVolume>,
}

#[tauri::command]
pub async fn comicvine_get_volume(
    app_handle: tauri::AppHandle,
    volume_id: u64,
) -> Result<Option<ComicVineVolume>, String> {
    let api_key = comicvine_api_key(&app_handle).await?;
    let client = get_http_client().str_err()?;

    let resp = client
        .get(format!("{COMICVINE_BASE}/volume/{VOLUME_RESOURCE_PREFIX}-{volume_id}/"))
        .query(&[
            ("api_key", api_key.as_str()),
            ("format", "json"),
            ("field_list", VOLUME_DETAIL_FIELD_LIST),
        ])
        .header("User-Agent", "Metadea (github.com/Shadorossa/Metadea)")
        .send()
        .await
        .map_err(|e| format!("Comic Vine request failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let mut parsed = resp
        .json::<ComicVineDetailResponse>()
        .await
        .map_err(|e| format!("Comic Vine parse failed: {e}"))?;

    if let Some(volume) = parsed.results.as_mut() {
        let first_id = volume.first_issue.as_ref().map(|i| i.id);
        let last_id = volume.last_issue.as_ref().map(|i| i.id);
        // Same id for a single-issue volume — no need to fetch it twice.
        let (first_date, last_date) = if first_id.is_some() && first_id == last_id {
            let date = match first_id { Some(id) => fetch_issue_cover_date(&client, &api_key, id).await, None => None };
            (date.clone(), date)
        } else {
            let first_date = match first_id { Some(id) => fetch_issue_cover_date(&client, &api_key, id).await, None => None };
            let last_date = match last_id { Some(id) => fetch_issue_cover_date(&client, &api_key, id).await, None => None };
            (first_date, last_date)
        };
        volume.first_issue_cover_date = first_date;
        volume.last_issue_cover_date = last_date;
    }

    Ok(parsed.results)
}

#[derive(Debug, Deserialize)]
struct ComicVineIssueDateResponse {
    results: Option<ComicVineIssueDate>,
}

#[derive(Debug, Deserialize, Default)]
struct ComicVineIssueDate {
    #[serde(default)]
    cover_date: Option<String>,
}

async fn fetch_issue_cover_date(client: &reqwest::Client, api_key: &str, issue_id: u64) -> Option<String> {
    let resp = client
        .get(format!("{COMICVINE_BASE}/issue/{ISSUE_RESOURCE_PREFIX}-{issue_id}/"))
        .query(&[
            ("api_key", api_key),
            ("format", "json"),
            ("field_list", ISSUE_DATE_FIELD_LIST),
        ])
        .header("User-Agent", "Metadea (github.com/Shadorossa/Metadea)")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    resp.json::<ComicVineIssueDateResponse>().await.ok()?.results?.cover_date
}

const ISSUE_FIELD_LIST: &str = "id,name,issue_number,image,cover_date,character_credits,concept_credits";

// Comic Vine's issue-level character credits — just id/name, no image
// (fetching a thumbnail per character would need a separate /character/
// request each, which doesn't scale for a cast that can be dozens of names).
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineCharacterCredit {
    pub id:   u64,
    pub name: String,
}

// Comic Vine's "concepts" are broad recurring themes (Time Travel, Multiverse,
// Superhero Teams, ...) — the closest thing it has to AniList-style tags.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineConceptCredit {
    pub id:   u64,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineIssue {
    pub id:                u64,
    pub name:              Option<String>,
    pub issue_number:      Option<String>,
    pub image:             Option<ComicVineImage>,
    pub cover_date:        Option<String>,
    #[serde(default)]
    pub character_credits: Vec<ComicVineCharacterCredit>,
    #[serde(default)]
    pub concept_credits:   Vec<ComicVineConceptCredit>,
}

#[derive(Debug, Deserialize)]
struct ComicVineIssuesResponse {
    #[serde(default)]
    results: Vec<ComicVineIssue>,
}

// Comic Vine's /volume/ resource lists its issues without cover images —
// fetching them needs the separate /issues/ resource, filtered by volume id.
// Comic Vine caps each request at 100 results, so a long-running series
// (100+ issues) needs multiple offset pages fetched in sequence — otherwise
// the list silently cuts off partway through instead of covering the whole
// run (mirrors fetch_open_lib_editions' own offset-paging loop).
#[tauri::command]
pub async fn comicvine_get_issues(
    app_handle: tauri::AppHandle,
    volume_id: u64,
) -> Result<Vec<ComicVineIssue>, String> {
    let api_key = comicvine_api_key(&app_handle).await?;
    let client = get_http_client().str_err()?;

    const LIMIT: u32 = 100;
    let filter = format!("volume:{volume_id}");
    let mut all_issues: Vec<ComicVineIssue> = Vec::new();
    let mut offset: u32 = 0;

    loop {
        let limit_str = LIMIT.to_string();
        let offset_str = offset.to_string();

        let resp = client
            .get(format!("{COMICVINE_BASE}/issues/"))
            .query(&[
                ("api_key", api_key.as_str()),
                ("format", "json"),
                ("filter", filter.as_str()),
                ("limit", limit_str.as_str()),
                ("offset", offset_str.as_str()),
                ("sort", "issue_number:asc"),
                ("field_list", ISSUE_FIELD_LIST),
            ])
            .header("User-Agent", "Metadea (github.com/Shadorossa/Metadea)")
            .send()
            .await
            .map_err(|e| format!("Comic Vine request failed: {e}"))?;

        if !resp.status().is_success() {
            break;
        }

        let parsed = resp
            .json::<ComicVineIssuesResponse>()
            .await
            .map_err(|e| format!("Comic Vine parse failed: {e}"))?;

        let page_len = parsed.results.len() as u32;
        all_issues.extend(parsed.results);

        if page_len < LIMIT {
            break;
        }
        offset += LIMIT;
    }

    // Comic Vine's own "sort=issue_number:asc" sorts issue_number as a
    // string ("1", "10", "11", "12", "2", ...) rather than numerically —
    // re-sort here using the parsed numeric value, falling back to id order
    // for anything non-numeric (annuals like "Annual 1" etc).
    all_issues.sort_by(|a, b| {
        let na = a.issue_number.as_deref().and_then(|s| s.parse::<f64>().ok());
        let nb = b.issue_number.as_deref().and_then(|s| s.parse::<f64>().ok());
        match (na, nb) {
            (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.id.cmp(&b.id),
        }
    });

    Ok(all_issues)
}

// Comic Vine's issue resource-type prefix (distinct from VOLUME_RESOURCE_PREFIX).
const ISSUE_RESOURCE_PREFIX: &str = "4000";
const ISSUE_DETAIL_FIELD_LIST: &str = "id,name,issue_number,image,cover_date,description,deck,volume,character_credits,concept_credits,person_credits";

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineVolumeRef {
    pub id:   u64,
    pub name: String,
}

// Full single-issue detail — used for an issue's own media page (mirrors a
// game "Season" having its own trackable page, parented to the base game).
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineIssueDetail {
    pub id:                u64,
    pub name:              Option<String>,
    pub issue_number:      Option<String>,
    pub image:             Option<ComicVineImage>,
    pub cover_date:        Option<String>,
    pub description:       Option<String>,
    pub deck:              Option<String>,
    pub volume:            Option<ComicVineVolumeRef>,
    #[serde(default)]
    pub character_credits: Vec<ComicVineCharacterCredit>,
    #[serde(default)]
    pub concept_credits:   Vec<ComicVineConceptCredit>,
    #[serde(default)]
    pub person_credits:    Vec<ComicVinePersonCredit>,
}

#[derive(Debug, Deserialize)]
struct ComicVineIssueDetailResponse {
    results: Option<ComicVineIssueDetail>,
}

#[tauri::command]
pub async fn comicvine_get_issue(
    app_handle: tauri::AppHandle,
    issue_id: u64,
) -> Result<Option<ComicVineIssueDetail>, String> {
    let api_key = comicvine_api_key(&app_handle).await?;
    let client = get_http_client().str_err()?;

    let resp = client
        .get(format!("{COMICVINE_BASE}/issue/{ISSUE_RESOURCE_PREFIX}-{issue_id}/"))
        .query(&[
            ("api_key", api_key.as_str()),
            ("format", "json"),
            ("field_list", ISSUE_DETAIL_FIELD_LIST),
        ])
        .header("User-Agent", "Metadea (github.com/Shadorossa/Metadea)")
        .send()
        .await
        .map_err(|e| format!("Comic Vine request failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let parsed = resp
        .json::<ComicVineIssueDetailResponse>()
        .await
        .map_err(|e| format!("Comic Vine parse failed: {e}"))?;
    Ok(parsed.results)
}
