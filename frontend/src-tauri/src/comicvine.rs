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
use crate::igdb::RequestBudget;
use crate::error_codes::{with_detail, COMICVINE_API, COMICVINE_KEY_MISSING, COMICVINE_NETWORK};

const COMICVINE_BASE: &str = "https://comicvine.gamespot.com/api";
// Comic Vine allows 200 requests per resource per hour and additionally
// throttles bursts ("velocity detection") — one shared hourly quota across
// every resource keeps this app comfortably under the per-resource one, and
// the 250 ms gap keeps a typed-search burst from tripping the velocity check.
static COMICVINE_BUDGET: RequestBudget = RequestBudget::new(
    200,
    std::time::Duration::from_secs(3600),
    std::time::Duration::from_millis(250),
);
const FIELD_LIST: &str = "id,name,image,start_year,publisher,count_of_issues,description,deck,site_detail_url";
// Only the singular /volume/ detail resource documents character_credits/
// concept_credits/person_credits as populated fields — the /search/ (list)
// resource above doesn't, so genres/cast/authors were always coming back
// empty when this list was reused for the single-volume detail fetch.
const VOLUME_DETAIL_FIELD_LIST: &str = "id,name,image,start_year,publisher,count_of_issues,description,deck,site_detail_url,character_credits,concept_credits,person_credits,first_issue,last_issue";
// first_issue/last_issue on the volume resource are only a minimal ref
// (id/name/issue_number, no cover_date) — one extra lightweight request per
// issue resolves the actual date, so the page can show a real start–end
// range instead of just start_year. Also pulls character/concept credits:
// in practice Comic Vine volume editors rarely fill in the volume's own
// character_credits/concept_credits (that's the "list of characters/concepts
// that appear in this volume" field from the docs), even though the field is
// documented as available — issue-level credits are what's actually kept up
// to date, so the first issue's cast/concepts are used as a fallback sample
// when the volume-level fields come back empty.
const ISSUE_DATE_FIELD_LIST: &str = "cover_date";
const ISSUE_ENRICHMENT_FIELD_LIST: &str = "cover_date,character_credits,concept_credits";

// Comic Vine prefixes every resource type's numeric id with a fixed code in
// detail-endpoint URLs (e.g. "4050-123" for volume 123) — this is the code
// for "volume" specifically, not a general-purpose id.
const VOLUME_RESOURCE_PREFIX: &str = "4050";

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineImage {
    pub medium_url: Option<String>,
    pub small_url:  Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVinePublisher {
    pub id:   Option<u64>,
    pub name: Option<String>,
}

// Comic Vine's person credits (writer, artist, etc.) — `role` is a
// comma-separated string of roles (e.g. "writer, penciler").
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVinePersonCredit {
    pub id:    u64,
    pub name:  String,
    pub role:  Option<String>,
    #[serde(default)]
    pub image: Option<ComicVineImage>,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct ComicVineCharacterSearchPage {
    pub characters: Vec<ComicVineCharacterCredit>,
    pub has_more:    bool,
}

#[derive(Debug, Deserialize)]
struct ComicVineCharacterSearchResponse {
    #[serde(default)]
    number_of_total_results: i64,
    #[serde(default)]
    results: Vec<ComicVineCharacterCredit>,
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
    let client = crate::http::http_client();

    const PAGE_SIZE: i64 = 100;
    let page = page.unwrap_or(1).max(1) as i64;
    let offset = (page - 1) * PAGE_SIZE;
    let limit_str = PAGE_SIZE.to_string();
    let offset_str = offset.to_string();

    COMICVINE_BUDGET.acquire().await;

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

// Comic Vine characters are real, independently-searchable entities (unlike
// TMDB, which only has "character" as a text field on a cast credit, not its
// own resource) — same /search/ endpoint as comicvine_search above, just
// asking for the "character" resource instead of "volume".
#[tauri::command]
pub async fn comicvine_search_characters(
    app_handle: tauri::AppHandle,
    query: String,
    page: Option<u32>,
) -> Result<ComicVineCharacterSearchPage, String> {
    if query.trim().is_empty() {
        return Ok(ComicVineCharacterSearchPage { characters: vec![], has_more: false });
    }

    let api_key = comicvine_api_key(&app_handle).await?;
    let client = crate::http::http_client();

    const PAGE_SIZE: i64 = 100;
    let page = page.unwrap_or(1).max(1) as i64;
    let offset = (page - 1) * PAGE_SIZE;
    let limit_str = PAGE_SIZE.to_string();
    let offset_str = offset.to_string();

    COMICVINE_BUDGET.acquire().await;

    let resp = client
        .get(format!("{COMICVINE_BASE}/search/"))
        .query(&[
            ("api_key", api_key.as_str()),
            ("format", "json"),
            ("query", query.as_str()),
            ("resources", "character"),
            ("limit", limit_str.as_str()),
            ("offset", offset_str.as_str()),
            ("field_list", "id,name,image,publisher,deck,description"),
        ])
        .send()
        .await
        .map_err(|e| format!("Comic Vine request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Comic Vine error (HTTP {status}): {body}"));
    }

    let parsed = resp
        .json::<ComicVineCharacterSearchResponse>()
        .await
        .map_err(|e| format!("Comic Vine parse failed: {e}"))?;

    let has_more = offset + (parsed.results.len() as i64) < parsed.number_of_total_results;
    Ok(ComicVineCharacterSearchPage { characters: parsed.results, has_more })
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
    let client = crate::http::http_client();

    COMICVINE_BUDGET.acquire().await;

    let resp = client
        .get(format!("{COMICVINE_BASE}/volume/{VOLUME_RESOURCE_PREFIX}-{volume_id}/"))
        .query(&[
            ("api_key", api_key.as_str()),
            ("format", "json"),
            ("field_list", VOLUME_DETAIL_FIELD_LIST),
        ])
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

        let first_enrichment = match first_id {
            Some(id) => fetch_issue_enrichment(client, &api_key, id).await,
            None => None,
        };
        // Same id for a single-issue volume — no need to fetch it twice.
        let last_date = if last_id.is_some() && last_id == first_id {
            first_enrichment.as_ref().and_then(|e| e.cover_date.clone())
        } else {
            match last_id { Some(id) => fetch_issue_cover_date(client, &api_key, id).await, None => None }
        };

        volume.last_issue_cover_date = last_date;
        if let Some(enrichment) = first_enrichment {
            volume.first_issue_cover_date = enrichment.cover_date;
            if volume.character_credits.is_empty() {
                volume.character_credits = enrichment.character_credits;
            }
            if volume.concept_credits.is_empty() {
                volume.concept_credits = enrichment.concept_credits;
            }
        }

        enrich_character_images(client, &api_key, &mut volume.character_credits).await;
        enrich_person_images(client, &api_key, &mut volume.person_credits).await;
    }

    Ok(parsed.results)
}

#[derive(Debug, Deserialize, Default)]
struct ComicVineImageLookupEntry {
    id:                u64,
    #[serde(default)]
    image:             Option<ComicVineImage>,
}

#[derive(Debug, Deserialize)]
struct ComicVineImageLookupResponse {
    #[serde(default)]
    results: Vec<ComicVineImageLookupEntry>,
}

// Batched id-lookup against a list resource (e.g. /characters/, /people/)
// with filter=id:1|2|3 — a single request for the whole cast instead of one
// per id. Individual /character/{id}/ or /person/{id}/ detail requests are
// known to intermittently 505 on Comic Vine's own end (see their API forums),
// which silently dropped images when this fetched one credit at a time.
async fn fetch_images_by_ids(client: &reqwest::Client, api_key: &str, resource_plural: &str, ids: &[u64]) -> std::collections::HashMap<u64, ComicVineImage> {
    let mut map = std::collections::HashMap::new();
    if ids.is_empty() {
        return map;
    }

    // Comic Vine caps list responses at 100 — a cast/creator list this long
    // for a single volume is exceedingly rare, so only the first 100 unique
    // ids get an image rather than adding another paging loop for it.
    let ids_str: Vec<String> = ids.iter().take(100).map(|id| id.to_string()).collect();
    let filter = format!("id:{}", ids_str.join("|"));

    COMICVINE_BUDGET.acquire().await;

    let resp = match client
        .get(format!("{COMICVINE_BASE}/{resource_plural}/"))
        .query(&[
            ("api_key", api_key),
            ("format", "json"),
            ("filter", filter.as_str()),
            ("field_list", "id,image"),
            ("limit", "100"),
        ])
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return map,
    };

    if !resp.status().is_success() {
        return map;
    }

    if let Ok(parsed) = resp.json::<ComicVineImageLookupResponse>().await {
        for entry in parsed.results {
            if let Some(image) = entry.image {
                map.insert(entry.id, image);
            }
        }
    }

    map
}

async fn enrich_character_images(client: &reqwest::Client, api_key: &str, credits: &mut [ComicVineCharacterCredit]) {
    let ids: Vec<u64> = credits.iter().map(|c| c.id).collect();
    let images = fetch_images_by_ids(client, api_key, "characters", &ids).await;
    for credit in credits.iter_mut() {
        credit.image = images.get(&credit.id).cloned();
    }
}

async fn enrich_person_images(client: &reqwest::Client, api_key: &str, credits: &mut [ComicVinePersonCredit]) {
    let ids: Vec<u64> = credits.iter().map(|c| c.id).collect();
    let images = fetch_images_by_ids(client, api_key, "people", &ids).await;
    for credit in credits.iter_mut() {
        credit.image = images.get(&credit.id).cloned();
    }
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

#[derive(Debug, Deserialize)]
struct ComicVineIssueEnrichmentResponse {
    results: Option<ComicVineIssueEnrichment>,
}

#[derive(Debug, Deserialize, Default)]
struct ComicVineIssueEnrichment {
    #[serde(default)]
    cover_date:        Option<String>,
    #[serde(default)]
    character_credits: Vec<ComicVineCharacterCredit>,
    #[serde(default)]
    concept_credits:   Vec<ComicVineConceptCredit>,
}

async fn fetch_issue_enrichment(client: &reqwest::Client, api_key: &str, issue_id: u64) -> Option<ComicVineIssueEnrichment> {
    COMICVINE_BUDGET.acquire().await;
    let resp = client
        .get(format!("{COMICVINE_BASE}/issue/{ISSUE_RESOURCE_PREFIX}-{issue_id}/"))
        .query(&[
            ("api_key", api_key),
            ("format", "json"),
            ("field_list", ISSUE_ENRICHMENT_FIELD_LIST),
        ])
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    resp.json::<ComicVineIssueEnrichmentResponse>().await.ok()?.results
}

#[derive(Debug, Serialize)]
pub struct ComicVineVolumeCast {
    pub characters: Vec<ComicVineCharacterCredit>,
    pub concepts:   Vec<ComicVineConceptCredit>,
}

// Aggregates cast/concepts across every issue of a volume — the volume
// resource's own character_credits/concept_credits fields are rarely kept
// up to date by Comic Vine editors (see comicvine_get_volume's fallback to
// just the first issue), so a full cast needs each issue's own credits.
// `issue_ids` comes from the frontend's already-fetched comicvine_get_issues
// list (no need to refetch the issue list itself here) — this only pays for
// the N per-issue detail requests plus one image request per unique
// character, all run concurrently.
#[tauri::command]
pub async fn comicvine_get_issues_cast(
    app_handle: tauri::AppHandle,
    issue_ids: Vec<u64>,
) -> Result<ComicVineVolumeCast, String> {
    let api_key = comicvine_api_key(&app_handle).await?;
    let client = crate::http::http_client();

    let fetches = issue_ids.iter().map(|&id| fetch_issue_enrichment(client, &api_key, id));
    let results = futures::future::join_all(fetches).await;

    let mut characters: Vec<ComicVineCharacterCredit> = Vec::new();
    let mut seen_chars = std::collections::HashSet::new();
    let mut concepts: Vec<ComicVineConceptCredit> = Vec::new();
    let mut seen_concepts = std::collections::HashSet::new();

    for enrichment in results.into_iter().flatten() {
        for c in enrichment.character_credits {
            if seen_chars.insert(c.id) {
                characters.push(c);
            }
        }
        for c in enrichment.concept_credits {
            if seen_concepts.insert(c.id) {
                concepts.push(c);
            }
        }
    }

    enrich_character_images(client, &api_key, &mut characters).await;

    Ok(ComicVineVolumeCast { characters, concepts })
}

async fn fetch_issue_cover_date(client: &reqwest::Client, api_key: &str, issue_id: u64) -> Option<String> {
    COMICVINE_BUDGET.acquire().await;
    let resp = client
        .get(format!("{COMICVINE_BASE}/issue/{ISSUE_RESOURCE_PREFIX}-{issue_id}/"))
        .query(&[
            ("api_key", api_key),
            ("format", "json"),
            ("field_list", ISSUE_DATE_FIELD_LIST),
        ])
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    resp.json::<ComicVineIssueDateResponse>().await.ok()?.results?.cover_date
}

const ISSUE_FIELD_LIST: &str = "id,name,issue_number,image,cover_date,character_credits,concept_credits";

// Comic Vine's character credits — id/name only from the issue/volume
// response; `image` is filled in separately (see enrich_character_images)
// since the credit object itself never includes it, only the standalone
// /character/{id}/ resource does.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineCharacterCredit {
    pub id:          u64,
    pub name:        String,
    #[serde(default)]
    pub image:       Option<ComicVineImage>,
    pub publisher:   Option<ComicVinePublisher>,
    pub deck:        Option<String>,
    pub description: Option<String>,
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
    let client = crate::http::http_client();

    const LIMIT: u32 = 100;
    let filter = format!("volume:{volume_id}");
    let mut all_issues: Vec<ComicVineIssue> = Vec::new();
    let mut offset: u32 = 0;

    loop {
        let limit_str = LIMIT.to_string();
        let offset_str = offset.to_string();

        COMICVINE_BUDGET.acquire().await;

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
    all_issues.sort_by(|a, b| compare_issue_numbers(a.issue_number.as_deref(), a.id, b.issue_number.as_deref(), b.id));

    Ok(all_issues)
}

// Numeric issue order ("2" before "10"); non-numeric numbers (annuals) go
// last, in id order.
fn compare_issue_numbers(a: Option<&str>, a_id: u64, b: Option<&str>, b_id: u64) -> std::cmp::Ordering {
    let na = a.and_then(|s| s.trim().parse::<f64>().ok());
    let nb = b.and_then(|s| s.trim().parse::<f64>().ok());
    match (na, nb) {
        (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal).then(a_id.cmp(&b_id)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a_id.cmp(&b_id),
    }
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
    let client = crate::http::http_client();

    COMICVINE_BUDGET.acquire().await;

    let resp = client
        .get(format!("{COMICVINE_BASE}/issue/{ISSUE_RESOURCE_PREFIX}-{issue_id}/"))
        .query(&[
            ("api_key", api_key.as_str()),
            ("format", "json"),
            ("field_list", ISSUE_DETAIL_FIELD_LIST),
        ])
        .send()
        .await
        .map_err(|e| format!("Comic Vine request failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let mut parsed = resp
        .json::<ComicVineIssueDetailResponse>()
        .await
        .map_err(|e| format!("Comic Vine parse failed: {e}"))?;

    if let Some(issue) = parsed.results.as_mut() {
        enrich_character_images(client, &api_key, &mut issue.character_credits).await;
        enrich_person_images(client, &api_key, &mut issue.person_credits).await;
    }

    Ok(parsed.results)
}

// ── Story arcs (the story-arc editor's "Import from ComicVine") ─────────────
//
// A Comic Vine story arc (resource 4045, e.g. "Arrancar Saga" 4045-56251)
// lists its issues as bare refs — id/name only, no issue_number and no
// volume — so turning an arc into a range of one Metadea work takes the arc,
// then its issues' numbers/volumes/descriptions (a manga tankōbon's
// description lists the chapters it collects; the frontend's
// lib/media/story-arcs/comicvine-chapters.ts parses them). Listing every arc
// of a volume needs each issue's story_arc_credits, which only the
// single-issue detail resource exposes: the scan walks the volume's issues
// in order and skips every issue an already-found arc covers, so a 70-volume
// manga costs roughly one request per arc instead of one per volume (an arc
// nested entirely inside another one can be missed that way). Every answer
// is cached in comicvine_arc_cache for 30 days.
//
// These commands return `E_COMICVINE_*` codes (error_codes.rs); the older
// commands above still return prose.

const STORY_ARC_RESOURCE_PREFIX: &str = "4045";
// "isssue" is Comic Vine's own spelling of the field.
const STORY_ARC_FIELD_LIST: &str = "id,name,deck,description,image,issues,first_appeared_in_issue,count_of_isssue_appearances,publisher";
const STORY_ARC_SEARCH_FIELD_LIST: &str = "id,name,deck,image,first_appeared_in_issue,count_of_isssue_appearances,publisher";
const ISSUE_SUMMARY_FIELD_LIST: &str = "id,issue_number,name,volume,description,cover_date";
const ISSUE_ARC_CREDITS_FIELD_LIST: &str = "id,story_arc_credits";
const ARC_CACHE_TTL_SECS: i64 = 30 * 24 * 60 * 60;
// Comic Vine caps a list response (and so an id:1|2|3 filter) at 100.
const ISSUE_BATCH_SIZE: usize = 100;
// Network requests one volume scan may spend (of the 200/hour budget); a
// scan that hits it comes back with `complete: false` and is not cached as
// a whole, but every per-issue answer it did get is, so a retry resumes.
const MAX_ARC_SCAN_REQUESTS: usize = 120;

fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// An `{id, name}` ref (story arc issue list, story_arc_credits, an issue's volume).
#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct ComicVineResourceRef {
    pub id:   u64,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineStoryArc {
    pub id:                         u64,
    #[serde(default)]
    pub name:                       Option<String>,
    #[serde(default)]
    pub deck:                       Option<String>,
    #[serde(default)]
    pub description:                Option<String>,
    #[serde(default)]
    pub image:                      Option<ComicVineImage>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub issues:                     Vec<ComicVineResourceRef>,
    #[serde(default)]
    pub first_appeared_in_issue:    Option<ComicVineIssueRef>,
    #[serde(default, alias = "count_of_isssue_appearances")]
    pub count_of_issue_appearances: Option<u64>,
    #[serde(default)]
    pub publisher:                  Option<ComicVinePublisher>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ComicVineIssueSummary {
    pub id:           u64,
    #[serde(default)]
    pub issue_number: Option<String>,
    #[serde(default)]
    pub name:         Option<String>,
    #[serde(default)]
    pub volume:       Option<ComicVineResourceRef>,
    #[serde(default)]
    pub description:  Option<String>,
    #[serde(default)]
    pub cover_date:   Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComicVineStoryArcSearchPage {
    pub story_arcs: Vec<ComicVineStoryArc>,
    pub has_more:   bool,
}

/// Every story arc touching a volume, plus all of the volume's issues (with
/// descriptions) in numeric order. `complete` is false when the scan stopped
/// at MAX_ARC_SCAN_REQUESTS.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ComicVineVolumeArcs {
    pub volume_id: u64,
    pub arcs:      Vec<ComicVineStoryArc>,
    pub issues:    Vec<ComicVineIssueSummary>,
    pub complete:  bool,
}

#[derive(Debug, Deserialize, Default)]
struct ComicVineIssueArcCredits {
    #[serde(default, deserialize_with = "null_as_default")]
    story_arc_credits: Vec<ComicVineResourceRef>,
}

// -- Response envelope ------------------------------------------------------------

// Comic Vine wraps every answer in {status_code, error, number_of_total_results,
// results}; status 1 is OK, 101 "object not found" (results is then `[]`,
// even on a detail resource). Anything else (100 bad key, 107 rate limited)
// is an API error.
#[derive(Debug, Deserialize)]
struct ComicVineEnvelope {
    #[serde(default)]
    status_code:             Option<i64>,
    #[serde(default)]
    error:                   Option<String>,
    #[serde(default)]
    number_of_total_results: i64,
    #[serde(default)]
    results:                 serde_json::Value,
}

fn parse_envelope(body: &str) -> Result<ComicVineEnvelope, String> {
    let envelope: ComicVineEnvelope = serde_json::from_str(body).map_err(|e| with_detail(COMICVINE_API, e))?;
    match envelope.status_code {
        None | Some(1) => Ok(envelope),
        Some(101) => Ok(ComicVineEnvelope { results: serde_json::Value::Null, ..envelope }),
        Some(code) => Err(with_detail(COMICVINE_API, format!("status {code}: {}", envelope.error.as_deref().unwrap_or("")))),
    }
}

fn parse_detail<T: serde::de::DeserializeOwned>(body: &str) -> Result<Option<T>, String> {
    let envelope = parse_envelope(body)?;
    match envelope.results {
        serde_json::Value::Object(_) => serde_json::from_value(envelope.results).map(Some).map_err(|e| with_detail(COMICVINE_API, e)),
        _ => Ok(None),
    }
}

fn parse_list<T: serde::de::DeserializeOwned>(body: &str) -> Result<(Vec<T>, i64), String> {
    let envelope = parse_envelope(body)?;
    let total = envelope.number_of_total_results;
    match envelope.results {
        serde_json::Value::Array(_) => serde_json::from_value(envelope.results).map(|items| (items, total)).map_err(|e| with_detail(COMICVINE_API, e)),
        _ => Ok((Vec::new(), total)),
    }
}

fn parse_story_arc_response(body: &str) -> Result<Option<ComicVineStoryArc>, String> {
    parse_detail(body)
}

fn parse_issue_summaries_response(body: &str) -> Result<Vec<ComicVineIssueSummary>, String> {
    parse_list(body).map(|(issues, _)| issues)
}

fn parse_issue_arc_credits_response(body: &str) -> Result<Vec<ComicVineResourceRef>, String> {
    Ok(parse_detail::<ComicVineIssueArcCredits>(body)?.map(|c| c.story_arc_credits).unwrap_or_default())
}

// -- Transport --------------------------------------------------------------------

async fn arc_api_key(app_handle: &tauri::AppHandle) -> Result<String, String> {
    comicvine_api_key(app_handle).await.map_err(|_| COMICVINE_KEY_MISSING.to_string())
}

// One budgeted GET. The reqwest error is stripped of its URL, which carries
// the api_key query parameter.
async fn comicvine_get(client: &reqwest::Client, api_key: &str, path: &str, params: &[(&str, &str)]) -> Result<String, String> {
    COMICVINE_BUDGET.acquire().await;
    let mut query: Vec<(&str, &str)> = vec![("api_key", api_key), ("format", "json")];
    query.extend_from_slice(params);
    let resp = client
        .get(format!("{COMICVINE_BASE}{path}"))
        .query(&query)
        .send()
        .await
        .map_err(|e| with_detail(COMICVINE_NETWORK, e.without_url()))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(with_detail(COMICVINE_API, format!("HTTP {status}")));
    }
    resp.text().await.map_err(|e| with_detail(COMICVINE_NETWORK, e.without_url()))
}

// -- Cache (comicvine_arc_cache) --------------------------------------------------

pub(crate) fn arc_cache_read(conn: &rusqlite::Connection, key: &str, now: i64) -> rusqlite::Result<Option<String>> {
    use rusqlite::OptionalExtension;
    let row: Option<(String, i64)> = conn
        .prepare_cached("SELECT json, fetched_at FROM comicvine_arc_cache WHERE cache_key = ?1")?
        .query_row([key], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?;
    Ok(row.filter(|(_, fetched_at)| now - fetched_at < ARC_CACHE_TTL_SECS).map(|(json, _)| json))
}

pub(crate) fn arc_cache_write(conn: &rusqlite::Connection, rows: &[(String, String)], now: i64) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO comicvine_arc_cache (cache_key, json, fetched_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(cache_key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
        )?;
        for (key, json) in rows {
            stmt.execute(rusqlite::params![key, json, now])?;
        }
    }
    tx.commit()
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

// Cache failures only cost a refetch, so they are logged, never returned.
fn cache_get<T: serde::de::DeserializeOwned>(app_handle: &tauri::AppHandle, key: &str) -> Option<T> {
    let db = tauri::Manager::state::<crate::db::MetadeaDb>(app_handle);
    let conn = db.conn.lock().ok()?;
    match arc_cache_read(&conn, key, now_unix()) {
        Ok(json) => json.and_then(|json| serde_json::from_str(&json).ok()),
        Err(error) => {
            log::warn!("comicvine arc cache: read failed ({error})");
            None
        }
    }
}

fn cache_put<T: Serialize>(app_handle: &tauri::AppHandle, entries: &[(String, &T)]) {
    let rows: Vec<(String, String)> = entries
        .iter()
        .filter_map(|(key, value)| serde_json::to_string(value).ok().map(|json| (key.clone(), json)))
        .collect();
    if rows.is_empty() {
        return;
    }
    let db = tauri::Manager::state::<crate::db::MetadeaDb>(app_handle);
    let Ok(conn) = db.conn.lock() else { return };
    if let Err(error) = arc_cache_write(&conn, &rows, now_unix()) {
        log::warn!("comicvine arc cache: write failed ({error})");
    }
}

fn arc_cache_key(id: u64) -> String { format!("arc:{id}") }
fn issue_cache_key(id: u64) -> String { format!("issue:{id}") }
fn issue_arcs_cache_key(id: u64) -> String { format!("issue-arcs:{id}") }
fn volume_arcs_cache_key(id: u64) -> String { format!("volume-arcs:{id}") }

// -- Fetchers (cache-aware; the bool is "spent a network request") ----------------

async fn story_arc_cached(app_handle: &tauri::AppHandle, client: &reqwest::Client, api_key: &str, id: u64) -> Result<(Option<ComicVineStoryArc>, bool), String> {
    if let Some(arc) = cache_get::<ComicVineStoryArc>(app_handle, &arc_cache_key(id)) {
        return Ok((Some(arc), false));
    }
    let path = format!("/story_arc/{STORY_ARC_RESOURCE_PREFIX}-{id}/");
    let body = comicvine_get(client, api_key, &path, &[("field_list", STORY_ARC_FIELD_LIST)]).await?;
    let arc = parse_story_arc_response(&body)?;
    if let Some(arc) = &arc {
        cache_put(app_handle, &[(arc_cache_key(id), arc)]);
    }
    Ok((arc, true))
}

async fn issue_arc_credits_cached(app_handle: &tauri::AppHandle, client: &reqwest::Client, api_key: &str, id: u64) -> Result<(Vec<ComicVineResourceRef>, bool), String> {
    if let Some(credits) = cache_get::<Vec<ComicVineResourceRef>>(app_handle, &issue_arcs_cache_key(id)) {
        return Ok((credits, false));
    }
    let path = format!("/issue/{ISSUE_RESOURCE_PREFIX}-{id}/");
    let body = comicvine_get(client, api_key, &path, &[("field_list", ISSUE_ARC_CREDITS_FIELD_LIST)]).await?;
    let credits = parse_issue_arc_credits_response(&body)?;
    cache_put(app_handle, &[(issue_arcs_cache_key(id), &credits)]);
    Ok((credits, true))
}

fn cache_issue_summaries(app_handle: &tauri::AppHandle, issues: &[ComicVineIssueSummary]) {
    let entries: Vec<(String, &ComicVineIssueSummary)> = issues.iter().map(|i| (issue_cache_key(i.id), i)).collect();
    cache_put(app_handle, &entries);
}

// Every issue of a volume with its description, 100 per page, numeric order.
async fn volume_issue_summaries(client: &reqwest::Client, api_key: &str, volume_id: u64) -> Result<Vec<ComicVineIssueSummary>, String> {
    let filter = format!("volume:{volume_id}");
    let limit = ISSUE_BATCH_SIZE.to_string();
    let mut all: Vec<ComicVineIssueSummary> = Vec::new();
    let mut offset = 0usize;
    loop {
        let offset_str = offset.to_string();
        let body = comicvine_get(client, api_key, "/issues/", &[
            ("filter", filter.as_str()),
            ("limit", limit.as_str()),
            ("offset", offset_str.as_str()),
            ("field_list", ISSUE_SUMMARY_FIELD_LIST),
        ]).await?;
        let (page, total) = parse_list::<ComicVineIssueSummary>(&body)?;
        let page_len = page.len();
        all.extend(page);
        offset += page_len;
        if page_len < ISSUE_BATCH_SIZE || offset as i64 >= total {
            break;
        }
    }
    sort_issue_summaries(&mut all);
    Ok(all)
}

fn sort_issue_summaries(issues: &mut [ComicVineIssueSummary]) {
    issues.sort_by(|a, b| compare_issue_numbers(a.issue_number.as_deref(), a.id, b.issue_number.as_deref(), b.id));
}

/// Unique ids in first-seen order, split into Comic Vine's 100-id pages.
fn issue_id_batches(ids: &[u64]) -> Vec<Vec<u64>> {
    let mut seen = std::collections::HashSet::new();
    let unique: Vec<u64> = ids.iter().copied().filter(|id| seen.insert(*id)).collect();
    unique.chunks(ISSUE_BATCH_SIZE).map(<[u64]>::to_vec).collect()
}

// -- Commands ---------------------------------------------------------------------

#[tauri::command]
pub async fn comicvine_search_story_arcs(
    app_handle: tauri::AppHandle,
    query: String,
    page: Option<u32>,
) -> Result<ComicVineStoryArcSearchPage, String> {
    if query.trim().is_empty() {
        return Ok(ComicVineStoryArcSearchPage { story_arcs: vec![], has_more: false });
    }
    let api_key = arc_api_key(&app_handle).await?;
    const PAGE_SIZE: i64 = 100;
    let offset = (i64::from(page.unwrap_or(1).max(1)) - 1) * PAGE_SIZE;
    let limit_str = PAGE_SIZE.to_string();
    let offset_str = offset.to_string();
    let body = comicvine_get(crate::http::http_client(), &api_key, "/search/", &[
        ("query", query.as_str()),
        ("resources", "story_arc"),
        ("limit", limit_str.as_str()),
        ("offset", offset_str.as_str()),
        ("field_list", STORY_ARC_SEARCH_FIELD_LIST),
    ]).await?;
    let (story_arcs, total) = parse_list::<ComicVineStoryArc>(&body)?;
    let has_more = offset + (story_arcs.len() as i64) < total;
    Ok(ComicVineStoryArcSearchPage { story_arcs, has_more })
}

#[tauri::command]
pub async fn comicvine_get_story_arc(
    app_handle: tauri::AppHandle,
    story_arc_id: u64,
) -> Result<Option<ComicVineStoryArc>, String> {
    if let Some(arc) = cache_get::<ComicVineStoryArc>(&app_handle, &arc_cache_key(story_arc_id)) {
        return Ok(Some(arc));
    }
    let api_key = arc_api_key(&app_handle).await?;
    story_arc_cached(&app_handle, crate::http::http_client(), &api_key, story_arc_id).await.map(|(arc, _)| arc)
}

/// Number, volume and description of each issue, in the order asked (ids
/// Comic Vine does not know are left out); 100 ids per request.
#[tauri::command]
pub async fn comicvine_get_issues_batch(
    app_handle: tauri::AppHandle,
    issue_ids: Vec<u64>,
) -> Result<Vec<ComicVineIssueSummary>, String> {
    let mut found: std::collections::HashMap<u64, ComicVineIssueSummary> = std::collections::HashMap::new();
    let mut missing: Vec<u64> = Vec::new();
    for &id in &issue_ids {
        match cache_get::<ComicVineIssueSummary>(&app_handle, &issue_cache_key(id)) {
            Some(issue) => { found.insert(id, issue); }
            None => missing.push(id),
        }
    }

    if !missing.is_empty() {
        let api_key = arc_api_key(&app_handle).await?;
        let client = crate::http::http_client();
        let limit = ISSUE_BATCH_SIZE.to_string();
        for batch in issue_id_batches(&missing) {
            let filter = format!("id:{}", batch.iter().map(u64::to_string).collect::<Vec<_>>().join("|"));
            let body = comicvine_get(client, &api_key, "/issues/", &[
                ("filter", filter.as_str()),
                ("limit", limit.as_str()),
                ("field_list", ISSUE_SUMMARY_FIELD_LIST),
            ]).await?;
            let issues = parse_issue_summaries_response(&body)?;
            cache_issue_summaries(&app_handle, &issues);
            found.extend(issues.into_iter().map(|issue| (issue.id, issue)));
        }
    }

    let mut seen = std::collections::HashSet::new();
    Ok(issue_ids
        .iter()
        .filter(|id| seen.insert(**id))
        .filter_map(|id| found.remove(id))
        .collect())
}

#[tauri::command]
pub async fn comicvine_story_arcs_for_volume(
    app_handle: tauri::AppHandle,
    volume_id: u64,
    refresh: Option<bool>,
) -> Result<ComicVineVolumeArcs, String> {
    let cache_key = volume_arcs_cache_key(volume_id);
    if !refresh.unwrap_or(false) {
        if let Some(cached) = cache_get::<ComicVineVolumeArcs>(&app_handle, &cache_key) {
            return Ok(cached);
        }
    }

    let api_key = arc_api_key(&app_handle).await?;
    let client = crate::http::http_client();
    let issues = volume_issue_summaries(client, &api_key, volume_id).await?;
    cache_issue_summaries(&app_handle, &issues);

    let mut covered: std::collections::HashSet<u64> = std::collections::HashSet::new();
    let mut seen_arcs: std::collections::HashSet<u64> = std::collections::HashSet::new();
    let mut arcs: Vec<ComicVineStoryArc> = Vec::new();
    let mut requests = 0usize;
    let mut complete = true;

    for issue in &issues {
        if covered.contains(&issue.id) {
            continue;
        }
        if requests >= MAX_ARC_SCAN_REQUESTS {
            complete = false;
            break;
        }
        let (credits, fetched) = issue_arc_credits_cached(&app_handle, client, &api_key, issue.id).await?;
        requests += usize::from(fetched);
        covered.insert(issue.id);
        for credit in credits {
            if !seen_arcs.insert(credit.id) {
                continue;
            }
            let (arc, fetched) = story_arc_cached(&app_handle, client, &api_key, credit.id).await?;
            requests += usize::from(fetched);
            if let Some(arc) = arc {
                covered.extend(arc.issues.iter().map(|i| i.id));
                arcs.push(arc);
            }
        }
    }

    let result = ComicVineVolumeArcs { volume_id, arcs, issues, complete };
    if complete {
        cache_put(&app_handle, &[(cache_key, &result)]);
    }
    Ok(result)
}

#[cfg(test)]
mod story_arc_tests {
    use super::*;

    const STORY_ARC: &str = include_str!("fixtures/comicvine/story_arc.json");
    const ISSUES_BATCH: &str = include_str!("fixtures/comicvine/issues_batch.json");
    const ISSUE_ARC_CREDITS: &str = include_str!("fixtures/comicvine/issue_story_arc_credits.json");

    fn cache_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        crate::migrations::comicvine_arc_cache::migrate(&tx).unwrap();
        tx.commit().unwrap();
        conn
    }

    #[test]
    fn parses_a_story_arc_with_its_issue_refs() {
        let arc = parse_story_arc_response(STORY_ARC).unwrap().expect("arc");
        assert_eq!(arc.id, 56251);
        assert_eq!(arc.name.as_deref(), Some("Arrancar Saga"));
        assert_eq!(arc.count_of_issue_appearances, Some(6));
        assert_eq!(arc.issues.len(), 6);
        assert_eq!(arc.issues[0], ComicVineResourceRef { id: 139412, name: Some("Be My Family or Not".into()) });
        assert_eq!(arc.first_appeared_in_issue.as_ref().and_then(|i| i.issue_number.as_deref()), Some("21"));
        assert_eq!(arc.publisher.as_ref().and_then(|p| p.name.as_deref()), Some("Viz"));
        assert!(arc.image.as_ref().and_then(|i| i.medium_url.as_deref()).is_some_and(|u| u.starts_with("https://")));
    }

    #[test]
    fn cached_story_arcs_round_trip_through_serde() {
        let arc = parse_story_arc_response(STORY_ARC).unwrap().unwrap();
        let json = serde_json::to_string(&arc).unwrap();
        let back: ComicVineStoryArc = serde_json::from_str(&json).unwrap();
        assert_eq!(back.count_of_issue_appearances, Some(6));
        assert_eq!(back.issues, arc.issues);
    }

    #[test]
    fn not_found_is_none_and_api_errors_carry_the_code() {
        let not_found = r#"{"error":"Object Not Found","status_code":101,"results":[]}"#;
        assert!(parse_story_arc_response(not_found).unwrap().is_none());
        let bad_key = r#"{"error":"Invalid API Key","status_code":100,"results":[]}"#;
        assert!(parse_story_arc_response(bad_key).unwrap_err().starts_with("E_COMICVINE_API"));
        assert!(parse_story_arc_response("<html>").unwrap_err().starts_with("E_COMICVINE_API"));
    }

    #[test]
    fn parses_an_issue_batch_with_volumes_and_descriptions() {
        let mut issues = parse_issue_summaries_response(ISSUES_BATCH).unwrap();
        assert_eq!(issues.len(), 4);
        sort_issue_summaries(&mut issues);
        let numbers: Vec<&str> = issues.iter().filter_map(|i| i.issue_number.as_deref()).collect();
        assert_eq!(numbers, ["21", "22", "23", "100"]);
        assert_eq!(issues[0].volume.as_ref().map(|v| v.id), Some(18923));
        assert!(issues[0].description.as_deref().unwrap_or("").contains("Chapter 182"));
        // A null description or volume name does not break the page.
        assert!(issues.iter().any(|i| i.description.is_none()));
        assert!(issues.iter().any(|i| i.volume.as_ref().is_some_and(|v| v.name.is_none())));
    }

    #[test]
    fn parses_story_arc_credits_and_tolerates_null() {
        let credits = parse_issue_arc_credits_response(ISSUE_ARC_CREDITS).unwrap();
        assert_eq!(credits.iter().map(|c| c.id).collect::<Vec<_>>(), [56251, 56252]);
        let null_credits = r#"{"status_code":1,"results":{"id":1,"story_arc_credits":null}}"#;
        assert!(parse_issue_arc_credits_response(null_credits).unwrap().is_empty());
    }

    #[test]
    fn batches_unique_ids_by_hundred() {
        let ids: Vec<u64> = (1..=250).chain([5, 6]).collect();
        let batches = issue_id_batches(&ids);
        assert_eq!(batches.iter().map(Vec::len).collect::<Vec<_>>(), [100, 100, 50]);
        assert_eq!(batches[0][0], 1);
    }

    #[test]
    fn cache_round_trips_and_expires_after_thirty_days() {
        let conn = cache_conn();
        arc_cache_write(&conn, &[("arc:1".into(), "{\"id\":1}".into())], 1_000).unwrap();
        assert_eq!(arc_cache_read(&conn, "arc:1", 1_000 + ARC_CACHE_TTL_SECS - 1).unwrap().as_deref(), Some("{\"id\":1}"));
        assert!(arc_cache_read(&conn, "arc:1", 1_000 + ARC_CACHE_TTL_SECS).unwrap().is_none());
        arc_cache_write(&conn, &[("arc:1".into(), "{\"id\":2}".into())], 5_000).unwrap();
        assert_eq!(arc_cache_read(&conn, "arc:1", 5_001).unwrap().as_deref(), Some("{\"id\":2}"));
        assert!(arc_cache_read(&conn, "arc:2", 5_001).unwrap().is_none());
    }
}
