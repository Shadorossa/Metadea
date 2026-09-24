// Sakuga clips from Sakugabooru (frontend: lib/sakuga, components/sakuga).
//
// Sakugabooru is a Moebooru site with a public, keyless API. It lives in
// Rust rather than the webview because the site sends no CORS headers, a
// browser `fetch` can't set the User-Agent that identifies us, and the
// cache and the rate limit have to be shared by every window.
//
// Etiquette, since it's a small community site:
// - every request names the app in its User-Agent;
// - a token bucket: about one request a second, bursts of at most three,
//   app-wide (rate_limit.rs); never retried;
// - responses are cached in SQLite (`sakuga_http_cache`): tag lookups 30
//   days, post pages 7 days, empty answers 7 days;
// - a 403/429/503 pauses everything for half an hour, a network failure
//   for five minutes; stale cache is served meanwhile.
//
// Tags are never guessed (tags.rs): a staff member or a work maps to a tag
// only when `tag.json` lists one of its candidate names (for people, also a
// candidate spelled with different long vowels, when nothing matches
// exactly). The mapping, including "no tag", is cached in
// `sakuga_resolutions`.

pub(crate) mod posts;
pub(crate) mod rate_limit;
pub(crate) mod tags;

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;

use crate::error_codes;
use posts::{SakugaPostPage, MAX_LIMIT, MAX_PAGE};
use rate_limit::TokenBucket;
use tags::SakugaTag;

const BASE_URL: &str = "https://www.sakugabooru.com";
const USER_AGENT: &str = concat!(
    "Metadea/",
    env!("CARGO_PKG_VERSION"),
    " (desktop app; +https://github.com/Shadorossa/Metadea; responses cached locally, ~1 req/s)"
);
const REQUEST_TIMEOUT_SECS: u64 = 12;
const BURST: u32 = 3;
const REQUESTS_PER_SEC: f64 = 1.0;

pub const DAY_SECS: i64 = 24 * 60 * 60;
pub const TAG_TTL_SECS: i64 = 30 * DAY_SECS;
pub const POST_TTL_SECS: i64 = 7 * DAY_SECS;
pub const NEGATIVE_TTL_SECS: i64 = 7 * DAY_SECS;
const REFUSED_COOLDOWN_SECS: i64 = 30 * 60;
const NETWORK_COOLDOWN_SECS: i64 = 5 * 60;

/// Most tag lookups one resolution may make (each is cached on its own).
const MAX_ARTIST_LOOKUPS: usize = 4;
const MAX_SERIES_LOOKUPS: usize = 6;
const MAX_QUERY_TAGS: usize = 3;

const KIND_ARTIST: &str = "artist";
const KIND_SERIES: &str = "series";

static COOLDOWN_UNTIL: AtomicI64 = AtomicI64::new(0);

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

fn db_err(error: impl std::fmt::Display) -> String {
    error_codes::with_detail(error_codes::SAKUGA_DB, error)
}

// ── Cache (pure over a connection, so tests drive it) ───────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CacheKind {
    Tags,
    Posts,
}

/// Whether a cached body can be served without asking again.
pub(crate) fn is_fresh(kind: CacheKind, empty: bool, fetched_at: i64, now: i64) -> bool {
    let ttl = if empty {
        NEGATIVE_TTL_SECS
    } else {
        match kind {
            CacheKind::Tags => TAG_TTL_SECS,
            CacheKind::Posts => POST_TTL_SECS,
        }
    };
    now - fetched_at < ttl
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CachedBody {
    pub body: String,
    pub empty: bool,
    pub fetched_at: i64,
}

pub(crate) fn read_cached(conn: &Connection, key: &str) -> rusqlite::Result<Option<CachedBody>> {
    conn.query_row(
        "SELECT body, empty, fetched_at FROM sakuga_http_cache WHERE request_key = ?1",
        [key],
        |row| Ok(CachedBody { body: row.get(0)?, empty: row.get::<_, i64>(1)? != 0, fetched_at: row.get(2)? }),
    )
    .optional()
}

pub(crate) fn write_cached(conn: &Connection, key: &str, body: &str, empty: bool, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sakuga_http_cache (request_key, body, empty, fetched_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(request_key) DO UPDATE SET body = excluded.body, empty = excluded.empty, fetched_at = excluded.fetched_at",
        rusqlite::params![key, body, empty as i64, now],
    )
    .map(|_| ())
}

/// A resolution is kept 30 days when it found a tag, 7 when it didn't.
pub(crate) fn resolution_is_fresh(found: bool, resolved_at: i64, now: i64) -> bool {
    now - resolved_at < if found { TAG_TTL_SECS } else { NEGATIVE_TTL_SECS }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Resolution {
    pub tag: Option<SakugaTag>,
    pub resolved_at: i64,
}

pub(crate) fn read_resolution(conn: &Connection, kind: &str, key: &str) -> rusqlite::Result<Option<Resolution>> {
    conn.query_row(
        "SELECT tag, tag_count, resolved_at FROM sakuga_resolutions WHERE kind = ?1 AND entity_key = ?2",
        [kind, key],
        |row| {
            let name: Option<String> = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok(Resolution { tag: name.map(|name| SakugaTag { name, count }), resolved_at: row.get(2)? })
        },
    )
    .optional()
}

pub(crate) fn write_resolution(conn: &Connection, kind: &str, key: &str, tag: Option<&SakugaTag>, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sakuga_resolutions (kind, entity_key, tag, tag_count, resolved_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(kind, entity_key) DO UPDATE SET tag = excluded.tag, tag_count = excluded.tag_count, resolved_at = excluded.resolved_at",
        rusqlite::params![kind, key, tag.map(|t| t.name.as_str()), tag.map_or(0, |t| t.count), now],
    )
    .map(|_| ())
}

/// Staff id → artist tag for every already-resolved staff member among
/// `keys` (stale ones included: a badge is harmless). Never fetches.
pub(crate) fn cached_artist_tags(conn: &Connection, keys: &[String]) -> rusqlite::Result<HashMap<String, String>> {
    let keys_json = serde_json::to_string(keys).unwrap_or_else(|_| "[]".into());
    let mut stmt = conn.prepare(
        "SELECT entity_key, tag FROM sakuga_resolutions
         WHERE kind = 'artist' AND tag IS NOT NULL AND entity_key IN (SELECT value FROM json_each(?1))",
    )?;
    let rows = stmt.query_map([keys_json], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
    rows.collect()
}

fn request_key(path: &str, query: &[(&str, String)]) -> String {
    let query: Vec<String> = query.iter().map(|(k, v)| format!("{k}={v}")).collect();
    format!("{path}?{}", query.join("&"))
}

// ── Response parsing ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RawTag {
    name: String,
    #[serde(default)]
    count: i64,
}

fn parse_tag_listing(body: &str) -> Option<Vec<SakugaTag>> {
    let raw: Vec<RawTag> = serde_json::from_str(body).ok()?;
    Some(raw.into_iter().map(|tag| SakugaTag { name: tag.name, count: tag.count }).collect())
}

/// `tag/related.json` answers `{ "<tag>": [["name", count], ...] }`.
fn parse_related(body: &str) -> Option<Vec<SakugaTag>> {
    let raw: HashMap<String, Vec<(String, i64)>> = serde_json::from_str(body).ok()?;
    Some(
        raw.into_values()
            .next()
            .unwrap_or_default()
            .into_iter()
            .map(|(name, count)| SakugaTag { name, count })
            .collect(),
    )
}

// ── Network ─────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
enum FetchOutcome {
    Body(String),
    /// 403 / 429 / 503: the site asked us to slow down.
    Refused,
    /// Another non-success status.
    Missing,
    /// Offline, DNS, timeout...
    Unreachable,
}

fn bucket() -> &'static Mutex<TokenBucket> {
    static BUCKET: OnceLock<Mutex<TokenBucket>> = OnceLock::new();
    BUCKET.get_or_init(|| Mutex::new(TokenBucket::new(BURST, REQUESTS_PER_SEC)))
}

async fn throttle() {
    let wait = match bucket().lock() {
        Ok(mut bucket) => bucket.reserve(Instant::now()),
        Err(poisoned) => poisoned.into_inner().reserve(Instant::now()),
    };
    if !wait.is_zero() {
        tokio::time::sleep(wait).await;
    }
}

fn cooling_down(now: i64) -> bool {
    now < COOLDOWN_UNTIL.load(Ordering::Relaxed)
}

fn cool_down(now: i64, secs: i64) {
    COOLDOWN_UNTIL.fetch_max(now + secs, Ordering::Relaxed);
}

async fn polite_get(path: &str, query: &[(&str, String)]) -> FetchOutcome {
    throttle().await;
    let result = crate::http::http_client()
        .get(format!("{BASE_URL}{path}"))
        .query(query)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .send()
        .await;
    match result {
        Err(error) => {
            log::debug!("sakugabooru unreachable: {error}");
            FetchOutcome::Unreachable
        }
        Ok(response) => {
            let status = response.status().as_u16();
            if matches!(status, 403 | 429 | 503) {
                FetchOutcome::Refused
            } else if !response.status().is_success() {
                FetchOutcome::Missing
            } else {
                match response.text().await {
                    Ok(body) => FetchOutcome::Body(body),
                    Err(_) => FetchOutcome::Unreachable,
                }
            }
        }
    }
}

/// Cache first; otherwise one polite request. `classify` says whether a
/// body is an empty answer (`Some(true)`), a real one (`Some(false)`) or
/// unusable (`None`: not cached). `None` overall when there's nothing to
/// serve (offline, cooling down, unusable answer, no stale copy).
async fn cached_get(
    db: &crate::db::MetadeaDb,
    kind: CacheKind,
    path: &str,
    query: &[(&str, String)],
    classify: impl Fn(&str) -> Option<bool>,
) -> Result<Option<String>, String> {
    let key = request_key(path, query);
    let now = now_unix();
    let cached = {
        let conn = db.conn.lock().map_err(db_err)?;
        read_cached(&conn, &key).map_err(db_err)?
    };
    if let Some(hit) = &cached {
        if is_fresh(kind, hit.empty, hit.fetched_at, now) {
            return Ok(Some(hit.body.clone()));
        }
    }
    let stale = cached.map(|hit| hit.body);
    if cooling_down(now) {
        return Ok(stale);
    }
    match polite_get(path, query).await {
        FetchOutcome::Body(body) => match classify(&body) {
            Some(empty) => {
                let conn = db.conn.lock().map_err(db_err)?;
                write_cached(&conn, &key, &body, empty, now_unix()).map_err(db_err)?;
                Ok(Some(body))
            }
            None => {
                log::warn!("sakugabooru: unexpected answer for {path}; pausing");
                cool_down(now, REFUSED_COOLDOWN_SECS);
                Ok(stale)
            }
        },
        FetchOutcome::Refused => {
            cool_down(now, REFUSED_COOLDOWN_SECS);
            Ok(stale)
        }
        FetchOutcome::Missing => Ok(stale),
        FetchOutcome::Unreachable => {
            cool_down(now, NETWORK_COOLDOWN_SECS);
            Ok(stale)
        }
    }
}

/// `tag.json?name=<term>&type=<type>`: every tag of that type whose name
/// contains `term`. `None` when unavailable (so no negative is recorded).
async fn tag_listing(db: &crate::db::MetadeaDb, term: &str, tag_type: u8) -> Result<Option<Vec<SakugaTag>>, String> {
    let query = [("name", term.to_string()), ("type", tag_type.to_string()), ("limit", "0".to_string())];
    let body = cached_get(db, CacheKind::Tags, "/tag.json", &query, |body| parse_tag_listing(body).map(|tags| tags.is_empty())).await?;
    Ok(body.and_then(|body| parse_tag_listing(&body)))
}

fn fresh_resolution(db: &crate::db::MetadeaDb, kind: &str, key: &str) -> Result<Option<Resolution>, String> {
    let conn = db.conn.lock().map_err(db_err)?;
    let resolution = read_resolution(&conn, kind, key).map_err(db_err)?;
    Ok(resolution.filter(|r| resolution_is_fresh(r.tag.is_some(), r.resolved_at, now_unix())))
}

fn store_resolution(db: &crate::db::MetadeaDb, kind: &str, key: &str, tag: Option<&SakugaTag>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(db_err)?;
    write_resolution(&conn, kind, key, tag, now_unix()).map_err(db_err)
}

fn is_valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 200
}

// ── Commands ────────────────────────────────────────────────────────────────

/// The artist tag of a staff member (`staff_id`, e.g. `person:a123`), from
/// their name and alternative names. `None`: no tag, or not confirmable now.
#[tauri::command]
pub async fn sakuga_resolve_artist(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    staff_id: String,
    names: Vec<String>,
) -> Result<Option<SakugaTag>, String> {
    if !is_valid_key(&staff_id) {
        return Ok(None);
    }
    if let Some(resolution) = fresh_resolution(&state, KIND_ARTIST, &staff_id)? {
        return Ok(resolution.tag);
    }
    let mut candidates: Vec<String> = Vec::new();
    let mut terms: Vec<String> = Vec::new();
    for name in names.iter().take(6) {
        for candidate in tags::artist_candidates(name) {
            if !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
        for term in tags::artist_lookup_terms(name) {
            if !terms.contains(&term) {
                terms.push(term);
            }
        }
    }
    if candidates.is_empty() {
        return Ok(None);
    }
    // Terms in order of selectivity; the first one that confirms a tag ends
    // the search (the listing holds every spelling of the full name).
    let mut best: Option<SakugaTag> = None;
    let mut complete = true;
    for term in terms.iter().take(MAX_ARTIST_LOOKUPS) {
        match tag_listing(&state, term, 1).await? {
            Some(listed) => {
                best = tags::choose_artist_tag(&candidates, &listed);
                if best.is_some() {
                    break;
                }
            }
            None => complete = false,
        }
    }
    if best.is_some() || complete {
        store_resolution(&state, KIND_ARTIST, &staff_id, best.as_ref())?;
    }
    Ok(best)
}

/// The series tag of an anime (`external_id`), from its titles in order of
/// preference (romaji, English, each with and without a season suffix).
#[tauri::command]
pub async fn sakuga_resolve_series(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    titles: Vec<String>,
) -> Result<Option<SakugaTag>, String> {
    if !is_valid_key(&external_id) {
        return Ok(None);
    }
    if let Some(resolution) = fresh_resolution(&state, KIND_SERIES, &external_id)? {
        return Ok(resolution.tag);
    }
    let bases = tags::series_bases(&titles);
    if bases.is_empty() {
        return Ok(None);
    }
    let mut complete = true;
    for base in bases.iter().take(MAX_SERIES_LOOKUPS) {
        match tag_listing(&state, base, 3).await? {
            Some(listed) => {
                if let Some(found) = tags::choose_series_tag(base, &listed) {
                    store_resolution(&state, KIND_SERIES, &external_id, Some(&found))?;
                    return Ok(Some(found));
                }
            }
            None => complete = false,
        }
    }
    if complete {
        store_resolution(&state, KIND_SERIES, &external_id, None)?;
    }
    Ok(None)
}

/// Already-resolved artist tags for these staff ids. Cache only, so a staff
/// list can ask for every member without sending a single request.
#[tauri::command]
pub async fn sakuga_cached_artists(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    staff_ids: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let conn = state.conn.lock().map_err(db_err)?;
    cached_artist_tags(&conn, &staff_ids).map_err(db_err)
}

/// One page of posts carrying every tag in `tags`, most voted first.
/// Adult-rated posts only with `include_adult`.
#[tauri::command]
pub async fn sakuga_posts(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    tags: Vec<String>,
    page: u32,
    limit: u32,
    include_adult: bool,
) -> Result<Option<SakugaPostPage>, String> {
    if tags.is_empty() || tags.len() > MAX_QUERY_TAGS || !tags.iter().all(|tag| tags::is_valid_tag(tag)) {
        return Ok(None);
    }
    let page = page.clamp(1, MAX_PAGE);
    let limit = limit.clamp(1, MAX_LIMIT);
    let query = [
        ("tags", posts::build_query_tags(&tags, include_adult)),
        ("limit", limit.to_string()),
        ("page", page.to_string()),
    ];
    let body = cached_get(&state, CacheKind::Posts, "/post.xml", &query, |body| {
        posts::parse_post_xml(body).map(|(_, posts)| posts.is_empty())
    })
    .await?;
    let Some((total, raw)) = body.as_deref().and_then(posts::parse_post_xml) else {
        return Ok(None);
    };
    let raw_count = u32::try_from(raw.len()).unwrap_or(u32::MAX);
    Ok(Some(SakugaPostPage { posts: posts::filter_rating(raw, include_adult), total, page, limit, raw_count }))
}

/// The series an artist's posts are tagged with, most frequent first
/// (Sakugabooru's related-tags answer for copyright tags).
#[tauri::command]
pub async fn sakuga_related_series(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    artist_tag: String,
) -> Result<Vec<SakugaTag>, String> {
    if !tags::is_valid_tag(&artist_tag) {
        return Ok(Vec::new());
    }
    let query = [("tags", artist_tag), ("type", "copyright".to_string())];
    let body = cached_get(&state, CacheKind::Tags, "/tag/related.json", &query, |body| {
        parse_related(body).map(|tags| tags.is_empty())
    })
    .await?;
    Ok(body.as_deref().and_then(parse_related).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> crate::db::MetadeaDb {
        crate::db::MetadeaDb::open_in_memory().unwrap()
    }

    #[test]
    fn ttl_depends_on_kind_and_emptiness() {
        let now = 100 * DAY_SECS;
        assert!(is_fresh(CacheKind::Tags, false, now - 29 * DAY_SECS, now));
        assert!(!is_fresh(CacheKind::Tags, false, now - 30 * DAY_SECS, now));
        assert!(is_fresh(CacheKind::Posts, false, now - 6 * DAY_SECS, now));
        assert!(!is_fresh(CacheKind::Posts, false, now - 7 * DAY_SECS, now));
        // An empty tag lookup is retried after a week, not a month.
        assert!(!is_fresh(CacheKind::Tags, true, now - 7 * DAY_SECS, now));
        assert!(is_fresh(CacheKind::Tags, true, now - 6 * DAY_SECS, now));
    }

    #[test]
    fn resolutions_keep_found_tags_longer_than_misses() {
        let now = 100 * DAY_SECS;
        assert!(resolution_is_fresh(true, now - 29 * DAY_SECS, now));
        assert!(!resolution_is_fresh(true, now - 30 * DAY_SECS, now));
        assert!(!resolution_is_fresh(false, now - 7 * DAY_SECS, now));
        assert!(resolution_is_fresh(false, now - DAY_SECS, now));
    }

    #[test]
    fn cache_and_resolutions_round_trip() {
        let db = db();
        let conn = db.conn.lock().unwrap();
        let key = request_key("/tag.json", &[("name", "nakamura".into()), ("type", "1".into())]);
        assert_eq!(key, "/tag.json?name=nakamura&type=1");
        assert!(read_cached(&conn, &key).unwrap().is_none());
        write_cached(&conn, &key, "[]", true, 10).unwrap();
        write_cached(&conn, &key, "[{\"name\":\"a\",\"count\":1}]", false, 20).unwrap();
        assert_eq!(
            read_cached(&conn, &key).unwrap(),
            Some(CachedBody { body: "[{\"name\":\"a\",\"count\":1}]".into(), empty: false, fetched_at: 20 })
        );

        let tag = SakugaTag { name: "yutaka_nakamura".into(), count: 368 };
        write_resolution(&conn, KIND_ARTIST, "person:a1", Some(&tag), 5).unwrap();
        write_resolution(&conn, KIND_ARTIST, "person:a2", None, 5).unwrap();
        write_resolution(&conn, KIND_SERIES, "anime:1", Some(&tag), 5).unwrap();
        assert_eq!(read_resolution(&conn, KIND_ARTIST, "person:a1").unwrap().unwrap().tag, Some(tag));
        assert_eq!(read_resolution(&conn, KIND_ARTIST, "person:a2").unwrap().unwrap().tag, None);
        let badges = cached_artist_tags(&conn, &["person:a1".into(), "person:a2".into(), "anime:1".into()]).unwrap();
        assert_eq!(badges.len(), 1, "only artists with a tag get a badge");
        assert_eq!(badges["person:a1"], "yutaka_nakamura");
    }

    #[test]
    fn listings_parse_and_garbage_is_rejected() {
        let listed = parse_tag_listing(r#"[{"id":1,"name":"sousou_no_frieren","count":597,"type":3,"ambiguous":false}]"#).unwrap();
        assert_eq!(listed, vec![SakugaTag { name: "sousou_no_frieren".into(), count: 597 }]);
        assert_eq!(parse_tag_listing("[]"), Some(vec![]));
        assert!(parse_tag_listing("<html>").is_none());
        let related = parse_related(r#"{"yutaka_nakamura":[["my_hero_academia_series",42],["cowboy_bebop",30]]}"#).unwrap();
        assert_eq!(related[1], SakugaTag { name: "cowboy_bebop".into(), count: 30 });
    }

    #[test]
    fn cooldown_only_moves_forward() {
        cool_down(1000, 60);
        cool_down(1000, 5);
        assert!(cooling_down(1050));
        assert!(!cooling_down(1060));
        assert!(USER_AGENT.starts_with("Metadea/"));
    }
}
