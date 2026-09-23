// MyAnimeList API v2 calls: list-status writes, the user's list pages and
// the profile. Every request goes through `request()`, which serialises
// calls behind a 3-per-second gate and retries 429/5xx with backoff. Hosts
// are fixed constants — nothing from the network or the webview ever picks
// the URL (paging recomputes the offset instead of following `paging.next`).
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error_codes;

pub const API_BASE: &str = "https://api.myanimelist.net/v2";
/// ≤ 3 requests per second.
pub const MIN_INTERVAL: Duration = Duration::from_millis(334);
pub const MAX_ATTEMPTS: u32 = 3;
const PAGE_LIMIT: usize = 1000;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

pub const ANIME_STATUSES: [&str; 5] = ["watching", "completed", "on_hold", "dropped", "plan_to_watch"];
pub const MANGA_STATUSES: [&str; 5] = ["reading", "completed", "on_hold", "dropped", "plan_to_read"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListKind {
    Anime,
    Manga,
}

impl ListKind {
    pub fn parse(kind: &str) -> Result<Self, String> {
        match kind {
            "anime" => Ok(Self::Anime),
            "manga" => Ok(Self::Manga),
            other => Err(error_codes::with_detail(error_codes::MAL_API, format!("unknown list kind '{other}'"))),
        }
    }

    fn path_segment(self) -> &'static str {
        match self {
            Self::Anime => "anime",
            Self::Manga => "manga",
        }
    }

    fn list_segment(self) -> &'static str {
        match self {
            Self::Anime => "animelist",
            Self::Manga => "mangalist",
        }
    }
}

// ─── Payloads (what the frontend sends, already in MAL's vocabulary) ─────────

#[derive(Debug, Default, Deserialize)]
pub struct AnimeListUpdate {
    pub status: Option<String>,
    pub score: Option<i64>,
    pub num_watched_episodes: Option<i64>,
    pub start_date: Option<String>,
    pub finish_date: Option<String>,
    pub is_rewatching: Option<bool>,
    pub num_times_rewatched: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
pub struct MangaListUpdate {
    pub status: Option<String>,
    pub score: Option<i64>,
    pub num_chapters_read: Option<i64>,
    pub num_volumes_read: Option<i64>,
    pub start_date: Option<String>,
    pub finish_date: Option<String>,
    pub is_rereading: Option<bool>,
    pub num_times_reread: Option<i64>,
}

pub type Form = Vec<(&'static str, String)>;

fn validated_status(status: &Option<String>, allowed: &[&str]) -> Result<Option<String>, String> {
    match status.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s) if allowed.contains(&s) => Ok(Some(s.to_string())),
        Some(s) => Err(error_codes::with_detail(error_codes::MAL_API, format!("invalid list status '{s}'"))),
    }
}

fn validated_score(score: Option<i64>) -> Result<Option<i64>, String> {
    match score {
        None => Ok(None),
        Some(s) if (0..=10).contains(&s) => Ok(Some(s)),
        Some(s) => Err(error_codes::with_detail(error_codes::MAL_API, format!("score {s} outside 0..=10"))),
    }
}

/// `YYYY-MM-DD` only; an empty value is "not sent" rather than an error, so
/// a cleared local date simply leaves MAL's untouched.
fn validated_date(date: &Option<String>) -> Result<Option<String>, String> {
    let Some(d) = date.as_deref().map(str::trim).filter(|d| !d.is_empty()) else { return Ok(None) };
    let ok = d.len() == 10
        && d.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() });
    if ok {
        Ok(Some(d.to_string()))
    } else {
        Err(error_codes::with_detail(error_codes::MAL_API, format!("date '{d}' is not YYYY-MM-DD")))
    }
}

fn count(value: Option<i64>) -> Option<String> {
    value.map(|v| v.max(0).to_string())
}

fn push(form: &mut Form, key: &'static str, value: Option<String>) {
    if let Some(value) = value {
        form.push((key, value));
    }
}

pub fn anime_form(update: &AnimeListUpdate) -> Result<Form, String> {
    let mut form = Form::new();
    push(&mut form, "status", validated_status(&update.status, &ANIME_STATUSES)?);
    push(&mut form, "score", validated_score(update.score)?.map(|s| s.to_string()));
    push(&mut form, "num_watched_episodes", count(update.num_watched_episodes));
    push(&mut form, "start_date", validated_date(&update.start_date)?);
    push(&mut form, "finish_date", validated_date(&update.finish_date)?);
    push(&mut form, "is_rewatching", update.is_rewatching.map(|b| b.to_string()));
    push(&mut form, "num_times_rewatched", count(update.num_times_rewatched));
    Ok(form)
}

pub fn manga_form(update: &MangaListUpdate) -> Result<Form, String> {
    let mut form = Form::new();
    push(&mut form, "status", validated_status(&update.status, &MANGA_STATUSES)?);
    push(&mut form, "score", validated_score(update.score)?.map(|s| s.to_string()));
    push(&mut form, "num_chapters_read", count(update.num_chapters_read));
    push(&mut form, "num_volumes_read", count(update.num_volumes_read));
    push(&mut form, "start_date", validated_date(&update.start_date)?);
    push(&mut form, "finish_date", validated_date(&update.finish_date)?);
    push(&mut form, "is_rereading", update.is_rereading.map(|b| b.to_string()));
    push(&mut form, "num_times_reread", count(update.num_times_reread));
    Ok(form)
}

// ─── Rate limit + retry policy (pure, tested) ────────────────────────────────

pub fn delay_before_next(last: Option<Instant>, now: Instant) -> Duration {
    match last {
        Some(last) => MIN_INTERVAL.saturating_sub(now.saturating_duration_since(last)),
        None => Duration::ZERO,
    }
}

pub fn should_retry(status: u16) -> bool {
    status == 429 || (500..=599).contains(&status)
}

/// 500 ms, 1 s, 2 s, ... for attempt 1, 2, 3, ...
pub fn retry_delay(attempt: u32) -> Duration {
    Duration::from_millis(500u64.saturating_mul(1u64 << attempt.saturating_sub(1).min(6)))
}

fn throttle() -> &'static tokio::sync::Mutex<Option<Instant>> {
    static GATE: OnceLock<tokio::sync::Mutex<Option<Instant>>> = OnceLock::new();
    GATE.get_or_init(|| tokio::sync::Mutex::new(None))
}

async fn wait_turn() {
    let mut last = throttle().lock().await;
    let wait = delay_before_next(*last, Instant::now());
    if !wait.is_zero() {
        tokio::time::sleep(wait).await;
    }
    *last = Some(Instant::now());
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

pub struct Response {
    pub status: u16,
    pub body: String,
}

/// One authenticated call against `API_BASE + path`. Retries 429/5xx up to
/// `MAX_ATTEMPTS` with backoff; a 401 is `E_MAL_AUTH`, any other failure
/// `E_MAL_API` with the status and a body snippet as detail.
pub async fn request(access_token: &str, method: reqwest::Method, path: &str, form: Option<&Form>) -> Result<Response, String> {
    let url = format!("{API_BASE}{path}");
    let mut attempt = 1;
    loop {
        wait_turn().await;
        let mut builder = crate::http::http_client()
            .request(method.clone(), &url)
            .timeout(REQUEST_TIMEOUT)
            .bearer_auth(access_token)
            .header("Accept", "application/json");
        if let Some(form) = form {
            builder = builder.form(form);
        }
        let outcome = match builder.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                let body = response.text().await.map_err(|e| error_codes::with_detail(error_codes::MAL_NETWORK, e))?;
                Ok(Response { status, body })
            }
            Err(e) => Err(error_codes::with_detail(error_codes::MAL_NETWORK, e)),
        };
        match outcome {
            Ok(response) if response.status == 401 => {
                return Err(error_codes::with_detail(error_codes::MAL_AUTH, "401 unauthorized"));
            }
            Ok(response) if should_retry(response.status) && attempt < MAX_ATTEMPTS => {
                log::debug!("mal: {} on {path}, retrying (attempt {attempt})", response.status);
            }
            Ok(response) if (200..300).contains(&response.status) => return Ok(response),
            Ok(response) => {
                let snippet: String = response.body.chars().take(160).collect();
                return Err(error_codes::with_detail(error_codes::MAL_API, format!("{} {snippet}", response.status)));
            }
            Err(error) if attempt < MAX_ATTEMPTS => log::debug!("mal: {error}, retrying (attempt {attempt})"),
            Err(error) => return Err(error),
        }
        tokio::time::sleep(retry_delay(attempt)).await;
        attempt += 1;
    }
}

pub async fn update_list_status(access_token: &str, kind: ListKind, mal_id: i64, form: &Form) -> Result<(), String> {
    request(access_token, reqwest::Method::PATCH, &format!("/{}/{mal_id}/my_list_status", kind.path_segment()), Some(form))
        .await
        .map(|_| ())
}

pub async fn delete_list_status(access_token: &str, kind: ListKind, mal_id: i64) -> Result<(), String> {
    match request(access_token, reqwest::Method::DELETE, &format!("/{}/{mal_id}/my_list_status", kind.path_segment()), None).await {
        Ok(_) => Ok(()),
        // Not on the list is the state we wanted.
        Err(error) if error.starts_with(error_codes::MAL_API) && error.contains(": 404 ") => Ok(()),
        Err(error) => Err(error),
    }
}

// ─── Profile ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub picture: Option<String>,
}

pub async fn fetch_profile(access_token: &str) -> Result<Profile, String> {
    let response = request(access_token, reqwest::Method::GET, "/users/@me", None).await?;
    serde_json::from_str(&response.body).map_err(|e| error_codes::with_detail(error_codes::MAL_API, format!("profile: {e}")))
}

// ─── The user's list ──────────────────────────────────────────────────────────

/// One row of `/users/@me/{anime,manga}list`, normalised so the frontend
/// sees the same shape for both kinds (`progress` = episodes or chapters,
/// `progress_volumes` only meaningful for manga).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ListItem {
    pub mal_id: i64,
    pub title: String,
    pub status: String,
    pub score: i64,
    pub progress: i64,
    pub progress_volumes: i64,
    pub is_repeating: bool,
    pub start_date: Option<String>,
    pub finish_date: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Deserialize)]
struct ListPage {
    #[serde(default)]
    data: Vec<ListRow>,
    #[serde(default)]
    paging: Paging,
}

#[derive(Deserialize, Default)]
struct Paging {
    #[serde(default)]
    next: Option<String>,
}

#[derive(Deserialize)]
struct ListRow {
    node: ListNode,
    #[serde(default)]
    list_status: Option<ListStatus>,
}

#[derive(Deserialize)]
struct ListNode {
    id: i64,
    #[serde(default)]
    title: String,
}

#[derive(Deserialize, Default)]
struct ListStatus {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    score: i64,
    #[serde(default)]
    num_episodes_watched: i64,
    #[serde(default)]
    num_chapters_read: i64,
    #[serde(default)]
    num_volumes_read: i64,
    #[serde(default)]
    is_rewatching: bool,
    #[serde(default)]
    is_rereading: bool,
    #[serde(default)]
    start_date: Option<String>,
    #[serde(default)]
    finish_date: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
}

/// Parses one page; the bool says whether MAL reports another page.
pub fn parse_list_page(body: &str, kind: ListKind) -> Result<(Vec<ListItem>, bool), String> {
    let page: ListPage = serde_json::from_str(body).map_err(|e| error_codes::with_detail(error_codes::MAL_API, format!("list page: {e}")))?;
    let items = page
        .data
        .into_iter()
        .filter_map(|row| {
            let status = row.list_status?;
            let list_status = status.status.clone()?;
            let progress = match kind {
                ListKind::Anime => status.num_episodes_watched,
                ListKind::Manga => status.num_chapters_read,
            };
            Some(ListItem {
                mal_id: row.node.id,
                title: row.node.title,
                status: list_status,
                score: status.score.clamp(0, 10),
                progress: progress.max(0),
                progress_volumes: if kind == ListKind::Manga { status.num_volumes_read.max(0) } else { 0 },
                is_repeating: status.is_rewatching || status.is_rereading,
                start_date: status.start_date.filter(|d| !d.is_empty()),
                finish_date: status.finish_date.filter(|d| !d.is_empty()),
                updated_at: status.updated_at,
            })
        })
        .collect();
    Ok((items, page.paging.next.is_some()))
}

pub fn list_page_path(kind: ListKind, offset: usize) -> String {
    format!("/users/@me/{}?fields=list_status&limit={PAGE_LIMIT}&offset={offset}&nsfw=true", kind.list_segment())
}

pub async fn fetch_whole_list(access_token: &str, kind: ListKind) -> Result<Vec<ListItem>, String> {
    let mut items = Vec::new();
    let mut offset = 0;
    loop {
        let response = request(access_token, reqwest::Method::GET, &list_page_path(kind, offset), None).await?;
        let (page_items, has_next) = parse_list_page(&response.body, kind)?;
        let fetched = page_items.len();
        items.extend(page_items);
        // A page shorter than the limit is the last one whatever `paging`
        // says, so a misreported `next` can never loop forever.
        if !has_next || fetched < PAGE_LIMIT {
            return Ok(items);
        }
        offset += PAGE_LIMIT;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anime_form_keeps_only_provided_fields_in_mal_vocabulary() {
        let form = anime_form(&AnimeListUpdate {
            status: Some("watching".into()),
            score: Some(8),
            num_watched_episodes: Some(12),
            start_date: Some("2026-01-05".into()),
            finish_date: Some(String::new()),
            is_rewatching: None,
            num_times_rewatched: Some(2),
        })
        .unwrap();
        assert_eq!(
            form,
            vec![
                ("status", "watching".to_string()),
                ("score", "8".to_string()),
                ("num_watched_episodes", "12".to_string()),
                ("start_date", "2026-01-05".to_string()),
                ("num_times_rewatched", "2".to_string()),
            ]
        );
        assert!(anime_form(&AnimeListUpdate::default()).unwrap().is_empty());
    }

    #[test]
    fn manga_form_uses_manga_statuses_and_both_counters() {
        let form = manga_form(&MangaListUpdate {
            status: Some("plan_to_read".into()),
            score: Some(0),
            num_chapters_read: Some(-3),
            num_volumes_read: Some(2),
            start_date: None,
            finish_date: None,
            is_rereading: Some(true),
            num_times_reread: Some(1),
        })
        .unwrap();
        assert_eq!(
            form,
            vec![
                ("status", "plan_to_read".to_string()),
                ("score", "0".to_string()),
                ("num_chapters_read", "0".to_string()),
                ("num_volumes_read", "2".to_string()),
                ("is_rereading", "true".to_string()),
                ("num_times_reread", "1".to_string()),
            ]
        );
    }

    #[test]
    fn forms_reject_foreign_statuses_scores_and_dates() {
        let bad_status = AnimeListUpdate { status: Some("reading".into()), ..Default::default() };
        assert!(anime_form(&bad_status).unwrap_err().starts_with("E_MAL_API"));
        let bad_manga = MangaListUpdate { status: Some("watching".into()), ..Default::default() };
        assert!(manga_form(&bad_manga).is_err());
        let bad_score = AnimeListUpdate { score: Some(11), ..Default::default() };
        assert!(anime_form(&bad_score).is_err());
        let bad_date = AnimeListUpdate { finish_date: Some("05/01/2026".into()), ..Default::default() };
        assert!(anime_form(&bad_date).is_err());
        let partial_date = AnimeListUpdate { finish_date: Some("2026-01".into()), ..Default::default() };
        assert!(anime_form(&partial_date).is_err());
    }

    #[test]
    fn retry_policy() {
        assert!(should_retry(429));
        assert!(should_retry(503));
        assert!(!should_retry(404));
        assert!(!should_retry(401));
        assert_eq!(retry_delay(1), Duration::from_millis(500));
        assert_eq!(retry_delay(2), Duration::from_millis(1000));
        assert_eq!(retry_delay(3), Duration::from_millis(2000));
    }

    #[test]
    fn throttle_spaces_requests_a_third_of_a_second_apart() {
        let now = Instant::now();
        assert_eq!(delay_before_next(None, now), Duration::ZERO);
        let wait = delay_before_next(Some(now), now + Duration::from_millis(100));
        assert_eq!(wait, Duration::from_millis(234));
        assert_eq!(delay_before_next(Some(now), now + Duration::from_secs(2)), Duration::ZERO);
    }

    const ANIME_PAGE: &str = r#"{
      "data": [
        {"node": {"id": 21, "title": "One Piece", "main_picture": {"medium": "x", "large": "y"}},
         "list_status": {"status": "watching", "score": 9, "num_episodes_watched": 1100, "is_rewatching": false,
                         "updated_at": "2026-09-01T10:00:00+00:00", "start_date": "2010-04-01"}},
        {"node": {"id": 5114, "title": "FMA: Brotherhood"},
         "list_status": {"status": "completed", "score": 10, "num_episodes_watched": 64, "is_rewatching": true,
                         "updated_at": "2020-01-01T00:00:00+00:00", "start_date": "2019-12-01", "finish_date": "2020-01-01"}},
        {"node": {"id": 1, "title": "No status"}}
      ],
      "paging": {"next": "https://api.myanimelist.net/v2/users/@me/animelist?offset=1000&limit=1000"}
    }"#;

    #[test]
    fn anime_list_fixture_parses_and_reports_the_next_page() {
        let (items, has_next) = parse_list_page(ANIME_PAGE, ListKind::Anime).unwrap();
        assert!(has_next);
        assert_eq!(items.len(), 2, "rows without a list_status are dropped");
        assert_eq!(
            items[0],
            ListItem {
                mal_id: 21,
                title: "One Piece".into(),
                status: "watching".into(),
                score: 9,
                progress: 1100,
                progress_volumes: 0,
                is_repeating: false,
                start_date: Some("2010-04-01".into()),
                finish_date: None,
                updated_at: Some("2026-09-01T10:00:00+00:00".into()),
            }
        );
        assert!(items[1].is_repeating);
        assert_eq!(items[1].finish_date.as_deref(), Some("2020-01-01"));
    }

    const MANGA_PAGE: &str = r#"{
      "data": [
        {"node": {"id": 2, "title": "Berserk"},
         "list_status": {"status": "reading", "score": 0, "num_volumes_read": 41, "num_chapters_read": 370, "is_rereading": false,
                         "updated_at": "2026-01-01T00:00:00+00:00"}}
      ],
      "paging": {}
    }"#;

    #[test]
    fn manga_list_fixture_maps_chapters_to_progress_and_volumes_separately() {
        let (items, has_next) = parse_list_page(MANGA_PAGE, ListKind::Manga).unwrap();
        assert!(!has_next);
        assert_eq!(items[0].progress, 370);
        assert_eq!(items[0].progress_volumes, 41);
        assert_eq!(items[0].score, 0);
        assert_eq!(items[0].start_date, None);
        assert!(parse_list_page("<html>", ListKind::Manga).unwrap_err().starts_with("E_MAL_API"));
    }

    #[test]
    fn list_paths_are_fixed_and_offset_driven() {
        assert_eq!(list_page_path(ListKind::Anime, 0), "/users/@me/animelist?fields=list_status&limit=1000&offset=0&nsfw=true");
        assert_eq!(list_page_path(ListKind::Manga, 2000), "/users/@me/mangalist?fields=list_status&limit=1000&offset=2000&nsfw=true");
        assert_eq!(ListKind::parse("anime"), Ok(ListKind::Anime));
        assert!(ListKind::parse("novel").is_err());
    }

    #[test]
    fn profile_fixture_parses() {
        let profile: Profile = serde_json::from_str(r#"{"id": 42, "name": "shadorossa", "picture": "https://cdn/x.jpg", "joined_at": "2015-01-01T00:00:00+00:00"}"#).unwrap();
        assert_eq!(profile, Profile { id: 42, name: "shadorossa".into(), picture: Some("https://cdn/x.jpg".into()) });
        let bare: Profile = serde_json::from_str(r#"{"id": 1, "name": "x"}"#).unwrap();
        assert_eq!(bare.picture, None);
    }
}
