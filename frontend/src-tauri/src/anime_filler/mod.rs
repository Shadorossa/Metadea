// Anime filler data from AnimeFillerList.com (frontend: lib/anime/filler*.ts).
//
// The site has no API, so this reads two kinds of HTML page (parse.rs):
// the show index `/shows` (slug + title, cached in `filler_shows`, refreshed
// weekly) and one show page `/shows/<slug>` per linked show (every episode's
// category, cached in `filler_episodes`). Etiquette, since it's someone
// else's hobby site:
// - every request names the app in its User-Agent;
// - at most one request per second across the whole app (a shared lock held
//   for the request's duration), one attempt each, never a retry loop;
// - a 403/429 (or a page that no longer parses) means "stop": the feature
//   quietly hides and nothing is fetched again for a day (`filler_meta`);
// - a show still airing is refetched at most weekly, a finished one never
//   again unless the user asks (the link popover's "Refresh").
//
// `filler_links` maps a catalog entry (an AniList anime, or a TMDB series)
// to a show slug plus the offset of its first episode in AnimeFillerList's
// absolute numbering; matching and offsets are computed by the frontend
// (lib/anime/filler-match.ts), which also marks user-picked links manual.

pub(crate) mod parse;

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::error_codes;
use parse::FillerKind;

const BASE_URL: &str = "https://www.animefillerlist.com";
const USER_AGENT: &str = concat!(
    "Metadea/",
    env!("CARGO_PKG_VERSION"),
    " (desktop app; +https://github.com/Shadorossa/Metadea; filler lists cached locally, refreshed weekly)"
);
const REQUEST_TIMEOUT_SECS: u64 = 12;
const MIN_REQUEST_INTERVAL: Duration = Duration::from_secs(1);

pub const DAY_SECS: i64 = 24 * 60 * 60;
pub const INDEX_TTL_SECS: i64 = 7 * DAY_SECS;
pub const AIRING_TTL_SECS: i64 = 7 * DAY_SECS;
/// After a 403/429 or a page that no longer parses.
pub const BACKOFF_SECS: i64 = DAY_SECS;
/// After a plain network failure (offline): short, in memory only, just so
/// a page full of anime doesn't hammer a dead connection.
const NETWORK_COOLDOWN_SECS: i64 = 10 * 60;
/// A forced refresh of a show fetched this recently is served from cache.
const FORCE_MIN_AGE_SECS: i64 = 60;

const META_BACKOFF_UNTIL: &str = "backoff_until";
const META_INDEX_FETCHED_AT: &str = "index_fetched_at";

static NETWORK_COOLDOWN_UNTIL: AtomicI64 = AtomicI64::new(0);

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

fn db_err(error: impl std::fmt::Display) -> String {
    error_codes::with_detail(error_codes::FILLER_DB, error)
}

// ── Wire types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FillerIndexShow {
    pub slug: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FillerLink {
    pub external_id: String,
    pub slug: String,
    pub episode_offset: i64,
    pub confidence: f64,
    pub manual: bool,
}

/// One show's cached episode categories, compact: canon (manga canon) is
/// everything up to `last_episode` that isn't listed.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FillerShowData {
    pub slug: String,
    pub title: String,
    pub fetched_at: Option<i64>,
    pub is_airing: bool,
    pub last_episode: i64,
    pub filler: Vec<i64>,
    pub mixed: Vec<i64>,
    pub anime_canon: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FillerInfo {
    pub link: FillerLink,
    /// `None` until the show page has been fetched once.
    pub show: Option<FillerShowData>,
}

// ── Cache (pure over a connection, so tests drive it) ───────────────────────

fn meta_get(conn: &Connection, key: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row("SELECT value FROM filler_meta WHERE key = ?1", [key], |row| row.get(0))
        .optional()
}

fn meta_set(conn: &Connection, key: &str, value: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO filler_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map(|_| ())
}

pub(crate) fn in_backoff(conn: &Connection, now: i64) -> rusqlite::Result<bool> {
    Ok(meta_get(conn, META_BACKOFF_UNTIL)?.is_some_and(|until| now < until))
}

pub(crate) fn start_backoff(conn: &Connection, now: i64) -> rusqlite::Result<()> {
    meta_set(conn, META_BACKOFF_UNTIL, now + BACKOFF_SECS)
}

pub(crate) fn index_is_stale(conn: &Connection, now: i64) -> rusqlite::Result<bool> {
    Ok(meta_get(conn, META_INDEX_FETCHED_AT)?.map_or(true, |at| now - at >= INDEX_TTL_SECS))
}

pub(crate) fn read_index(conn: &Connection) -> rusqlite::Result<Vec<FillerIndexShow>> {
    let mut stmt = conn.prepare("SELECT slug, title FROM filler_shows WHERE in_index = 1 ORDER BY title COLLATE NOCASE")?;
    let rows = stmt.query_map([], |row| Ok(FillerIndexShow { slug: row.get(0)?, title: row.get(1)? }))?;
    rows.collect()
}

/// Upserts the index; shows no longer listed stay (their episodes may still
/// back a link) but drop out of the searchable index.
pub(crate) fn write_index(conn: &mut Connection, shows: &[parse::IndexShow], now: i64) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE filler_shows SET in_index = 0", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO filler_shows (slug, title, in_index) VALUES (?1, ?2, 1)
             ON CONFLICT(slug) DO UPDATE SET title = excluded.title, in_index = 1",
        )?;
        for show in shows {
            stmt.execute(rusqlite::params![show.slug, show.title])?;
        }
    }
    meta_set(&tx, META_INDEX_FETCHED_AT, now)?;
    tx.commit()
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ShowFetchState {
    pub fetched_at: Option<i64>,
    pub is_airing: bool,
    pub failed_at: Option<i64>,
}

fn read_show_state(conn: &Connection, slug: &str) -> rusqlite::Result<Option<ShowFetchState>> {
    conn.query_row(
        "SELECT fetched_at, is_airing, failed_at FROM filler_shows WHERE slug = ?1",
        [slug],
        |row| {
            Ok(ShowFetchState {
                fetched_at: row.get(0)?,
                is_airing: row.get::<_, i64>(1)? != 0,
                failed_at: row.get(2)?,
            })
        },
    )
    .optional()
}

/// The refresh policy: never fetched → fetch; airing → weekly; finished →
/// only when forced. A recent per-show failure waits a day unless forced; a
/// forced refresh of something fetched a minute ago is not repeated.
pub(crate) fn show_needs_fetch(state: Option<ShowFetchState>, airing_hint: bool, force: bool, now: i64) -> bool {
    let Some(state) = state else { return true };
    if let Some(fetched_at) = state.fetched_at {
        if force {
            return now - fetched_at >= FORCE_MIN_AGE_SECS;
        }
        return (state.is_airing || airing_hint) && now - fetched_at >= AIRING_TTL_SECS;
    }
    force || state.failed_at.map_or(true, |failed| now - failed >= BACKOFF_SECS)
}

fn mark_show_failed(conn: &Connection, slug: &str, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO filler_shows (slug, title, in_index, failed_at) VALUES (?1, ?1, 0, ?2)
         ON CONFLICT(slug) DO UPDATE SET failed_at = excluded.failed_at",
        rusqlite::params![slug, now],
    )
    .map(|_| ())
}

/// Replaces a show's episodes. `is_airing` is the caller's hint (the linked
/// AniList entry is RELEASING) or a guess from the list having grown since
/// the previous fetch.
pub(crate) fn write_show_episodes(
    conn: &mut Connection,
    slug: &str,
    episodes: &BTreeMap<i64, FillerKind>,
    airing_hint: bool,
    now: i64,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let previous_last: Option<i64> = tx.query_row(
        "SELECT MAX(absolute_number) FROM filler_episodes WHERE slug = ?1",
        [slug],
        |row| row.get(0),
    )?;
    let new_last = episodes.keys().next_back().copied().unwrap_or(0);
    let grew = previous_last.is_some_and(|previous| new_last > previous);
    tx.execute("DELETE FROM filler_episodes WHERE slug = ?1", [slug])?;
    {
        let mut stmt = tx.prepare("INSERT INTO filler_episodes (slug, absolute_number, kind) VALUES (?1, ?2, ?3)")?;
        for (number, kind) in episodes {
            stmt.execute(rusqlite::params![slug, number, kind.as_str()])?;
        }
    }
    tx.execute(
        "INSERT INTO filler_shows (slug, title, in_index, fetched_at, is_airing, failed_at) VALUES (?1, ?1, 0, ?2, ?3, NULL)
         ON CONFLICT(slug) DO UPDATE SET fetched_at = excluded.fetched_at, is_airing = excluded.is_airing, failed_at = NULL",
        rusqlite::params![slug, now, (airing_hint || grew) as i64],
    )?;
    tx.commit()
}

fn read_shows(conn: &Connection, slugs: &[String]) -> rusqlite::Result<HashMap<String, FillerShowData>> {
    let mut out = HashMap::new();
    if slugs.is_empty() {
        return Ok(out);
    }
    let slugs_json = serde_json::to_string(slugs).unwrap_or_else(|_| "[]".into());
    let mut stmt = conn.prepare(
        "SELECT slug, title, fetched_at, is_airing FROM filler_shows
         WHERE fetched_at IS NOT NULL AND slug IN (SELECT value FROM json_each(?1))",
    )?;
    let shows = stmt.query_map([&slugs_json], |row| {
        Ok(FillerShowData {
            slug: row.get(0)?,
            title: row.get(1)?,
            fetched_at: row.get(2)?,
            is_airing: row.get::<_, i64>(3)? != 0,
            last_episode: 0,
            filler: Vec::new(),
            mixed: Vec::new(),
            anime_canon: Vec::new(),
        })
    })?;
    for show in shows {
        let show = show?;
        out.insert(show.slug.clone(), show);
    }
    let mut stmt = conn.prepare(
        "SELECT slug, absolute_number, kind FROM filler_episodes
         WHERE slug IN (SELECT value FROM json_each(?1)) ORDER BY slug, absolute_number",
    )?;
    let rows = stmt.query_map([&slugs_json], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (slug, number, kind) = row?;
        let Some(show) = out.get_mut(&slug) else { continue };
        show.last_episode = show.last_episode.max(number);
        match FillerKind::from_db(&kind) {
            Some(FillerKind::Filler) => show.filler.push(number),
            Some(FillerKind::Mixed) => show.mixed.push(number),
            Some(FillerKind::AnimeCanon) => show.anime_canon.push(number),
            _ => {}
        }
    }
    Ok(out)
}

pub(crate) fn read_show(conn: &Connection, slug: &str) -> rusqlite::Result<Option<FillerShowData>> {
    Ok(read_shows(conn, &[slug.to_string()])?.remove(slug))
}

fn row_to_link(row: &rusqlite::Row<'_>) -> rusqlite::Result<FillerLink> {
    Ok(FillerLink {
        external_id: row.get(0)?,
        slug: row.get(1)?,
        episode_offset: row.get(2)?,
        confidence: row.get(3)?,
        manual: row.get::<_, i64>(4)? != 0,
    })
}

/// Links (with their cached show data) for the given entries, or every link
/// when `external_ids` is `None`. Cache only — never touches the network.
pub(crate) fn read_infos(conn: &Connection, external_ids: Option<&[String]>) -> rusqlite::Result<Vec<FillerInfo>> {
    let links: Vec<FillerLink> = match external_ids {
        Some(ids) => {
            let ids_json = serde_json::to_string(ids).unwrap_or_else(|_| "[]".into());
            let mut stmt = conn.prepare(
                "SELECT media_external_id, slug, episode_offset, confidence, manual FROM filler_links
                 WHERE media_external_id IN (SELECT value FROM json_each(?1))",
            )?;
            let rows = stmt.query_map([ids_json], row_to_link)?;
            rows.collect::<rusqlite::Result<_>>()?
        }
        None => {
            let mut stmt = conn.prepare("SELECT media_external_id, slug, episode_offset, confidence, manual FROM filler_links")?;
            let rows = stmt.query_map([], row_to_link)?;
            rows.collect::<rusqlite::Result<_>>()?
        }
    };
    let mut slugs: Vec<String> = links.iter().map(|link| link.slug.clone()).collect();
    slugs.sort();
    slugs.dedup();
    let shows = read_shows(conn, &slugs)?;
    Ok(links
        .into_iter()
        .map(|link| {
            let show = shows.get(&link.slug).cloned();
            FillerInfo { link, show }
        })
        .collect())
}

pub(crate) fn write_link(conn: &Connection, link: &FillerLink, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO filler_links (media_external_id, slug, episode_offset, confidence, manual, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(media_external_id) DO UPDATE SET slug = excluded.slug, episode_offset = excluded.episode_offset,
             confidence = excluded.confidence, manual = excluded.manual, updated_at = excluded.updated_at",
        rusqlite::params![link.external_id, link.slug, link.episode_offset, link.confidence, link.manual as i64, now],
    )
    .map(|_| ())
}

fn is_valid_slug(slug: &str) -> bool {
    !slug.is_empty() && slug.len() <= 120 && slug.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

// ── Network ─────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
enum FetchOutcome {
    Body(String),
    /// 403 / 429: the site asked us to stop.
    Refused,
    /// 404 or another non-success status.
    Missing,
    /// Offline, DNS, timeout...
    Unreachable,
}

fn request_lock() -> &'static tokio::sync::Mutex<Option<Instant>> {
    static LOCK: OnceLock<tokio::sync::Mutex<Option<Instant>>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(None))
}

/// One GET, serialized app-wide and spaced at least a second from the
/// previous one. Never retried.
async fn polite_get(path: &str) -> FetchOutcome {
    let mut last = request_lock().lock().await;
    if let Some(previous) = *last {
        let elapsed = previous.elapsed();
        if elapsed < MIN_REQUEST_INTERVAL {
            tokio::time::sleep(MIN_REQUEST_INTERVAL - elapsed).await;
        }
    }
    let result = crate::http::http_client()
        .get(format!("{BASE_URL}{path}"))
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "text/html")
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .send()
        .await;
    let outcome = match result {
        Err(error) => {
            log::debug!("animefillerlist unreachable: {error}");
            FetchOutcome::Unreachable
        }
        Ok(response) => {
            let status = response.status().as_u16();
            if status == 403 || status == 429 {
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
    };
    *last = Some(Instant::now());
    outcome
}

fn network_cooling_down(now: i64) -> bool {
    now < NETWORK_COOLDOWN_UNTIL.load(Ordering::Relaxed)
}

fn note_unreachable(now: i64) {
    NETWORK_COOLDOWN_UNTIL.store(now + NETWORK_COOLDOWN_SECS, Ordering::Relaxed);
}

// ── Commands ────────────────────────────────────────────────────────────────

/// The cached show index, refreshed from `/shows` when it is older than a
/// week (or `force`) and the site isn't in backoff. Empty when nothing was
/// ever fetched — the frontend then hides every filler control.
#[tauri::command]
pub async fn filler_get_index(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    force: Option<bool>,
) -> Result<Vec<FillerIndexShow>, String> {
    let now = now_unix();
    let should_fetch = {
        let conn = state.conn.lock().map_err(db_err)?;
        (force.unwrap_or(false) || index_is_stale(&conn, now).map_err(db_err)?)
            && !in_backoff(&conn, now).map_err(db_err)?
            && !network_cooling_down(now)
    };
    if should_fetch {
        match polite_get("/shows").await {
            FetchOutcome::Body(html) => {
                let shows = parse::parse_show_index(&html);
                let mut conn = state.conn.lock().map_err(db_err)?;
                if shows.len() < 10 {
                    log::warn!("animefillerlist: show index no longer parses; backing off");
                    start_backoff(&conn, now).map_err(db_err)?;
                } else {
                    write_index(&mut conn, &shows, now).map_err(db_err)?;
                }
            }
            FetchOutcome::Refused | FetchOutcome::Missing => {
                let conn = state.conn.lock().map_err(db_err)?;
                start_backoff(&conn, now).map_err(db_err)?;
            }
            FetchOutcome::Unreachable => note_unreachable(now),
        }
    }
    let conn = state.conn.lock().map_err(db_err)?;
    read_index(&conn).map_err(db_err)
}

/// One show's episode categories: cache first, fetched when never fetched,
/// airing and a week old, or forced. `None` when the show has no data and
/// could not be fetched (backoff, offline, page changed shape).
#[tauri::command]
pub async fn filler_ensure_show(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    slug: String,
    airing: Option<bool>,
    force: Option<bool>,
) -> Result<Option<FillerShowData>, String> {
    if !is_valid_slug(&slug) {
        return Ok(None);
    }
    let now = now_unix();
    let airing_hint = airing.unwrap_or(false);
    let should_fetch = {
        let conn = state.conn.lock().map_err(db_err)?;
        let show_state = read_show_state(&conn, &slug).map_err(db_err)?;
        show_needs_fetch(show_state, airing_hint, force.unwrap_or(false), now)
            && !in_backoff(&conn, now).map_err(db_err)?
            && !network_cooling_down(now)
    };
    if should_fetch {
        match polite_get(&format!("/shows/{slug}")).await {
            FetchOutcome::Body(html) => {
                let mut conn = state.conn.lock().map_err(db_err)?;
                match parse::parse_show_page(&html) {
                    Some(episodes) => write_show_episodes(&mut conn, &slug, &episodes, airing_hint, now).map_err(db_err)?,
                    None => {
                        log::warn!("animefillerlist: /shows/{slug} no longer parses; backing off");
                        mark_show_failed(&conn, &slug, now).map_err(db_err)?;
                        start_backoff(&conn, now).map_err(db_err)?;
                    }
                }
            }
            FetchOutcome::Refused => {
                let conn = state.conn.lock().map_err(db_err)?;
                start_backoff(&conn, now).map_err(db_err)?;
            }
            FetchOutcome::Missing => {
                let conn = state.conn.lock().map_err(db_err)?;
                mark_show_failed(&conn, &slug, now).map_err(db_err)?;
            }
            FetchOutcome::Unreachable => note_unreachable(now),
        }
    }
    let conn = state.conn.lock().map_err(db_err)?;
    read_show(&conn, &slug).map_err(db_err)
}

/// Cached links + show data in one read: the given entries, or every link
/// when `external_ids` is omitted (library-wide effective totals).
#[tauri::command]
pub async fn filler_get_info(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_ids: Option<Vec<String>>,
) -> Result<Vec<FillerInfo>, String> {
    let conn = state.conn.lock().map_err(db_err)?;
    read_infos(&conn, external_ids.as_deref()).map_err(db_err)
}

#[tauri::command]
pub async fn filler_set_link(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    slug: String,
    episode_offset: i64,
    confidence: f64,
    manual: bool,
) -> Result<(), String> {
    if external_id.is_empty() || !is_valid_slug(&slug) || episode_offset < 0 {
        return Err(error_codes::FILLER_INVALID_LINK.to_string());
    }
    let conn = state.conn.lock().map_err(db_err)?;
    let link = FillerLink {
        external_id,
        slug,
        episode_offset,
        confidence: confidence.clamp(0.0, 1.0),
        manual,
    };
    write_link(&conn, &link, now_unix()).map_err(db_err)
}

#[tauri::command]
pub async fn filler_remove_link(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(db_err)?;
    conn.execute("DELETE FROM filler_links WHERE media_external_id = ?1", [external_id])
        .map(|_| ())
        .map_err(db_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> crate::db::MetadeaDb {
        crate::db::MetadeaDb::open_in_memory().unwrap()
    }

    fn state(fetched_at: Option<i64>, is_airing: bool, failed_at: Option<i64>) -> Option<ShowFetchState> {
        Some(ShowFetchState { fetched_at, is_airing, failed_at })
    }

    #[test]
    fn refresh_policy_airing_weekly_finished_never() {
        let now = 100 * DAY_SECS;
        assert!(show_needs_fetch(None, false, false, now));
        // Finished: never, whatever the age.
        assert!(!show_needs_fetch(state(Some(0), false, None), false, false, now));
        // Airing (stored guess or caller hint): after a week.
        assert!(!show_needs_fetch(state(Some(now - AIRING_TTL_SECS + 1), true, None), false, false, now));
        assert!(show_needs_fetch(state(Some(now - AIRING_TTL_SECS), true, None), false, false, now));
        assert!(show_needs_fetch(state(Some(now - AIRING_TTL_SECS), false, None), true, false, now));
        // Forced: yes, unless fetched within the last minute.
        assert!(show_needs_fetch(state(Some(0), false, None), false, true, now));
        assert!(!show_needs_fetch(state(Some(now - 10), false, None), false, true, now));
        // A failed, never-fetched show waits a day unless forced.
        assert!(!show_needs_fetch(state(None, false, Some(now - 60)), false, false, now));
        assert!(show_needs_fetch(state(None, false, Some(now - BACKOFF_SECS)), false, false, now));
        assert!(show_needs_fetch(state(None, false, Some(now - 60)), false, true, now));
    }

    #[test]
    fn backoff_and_index_staleness_live_in_meta() {
        let db = db();
        let conn = db.conn.lock().unwrap();
        assert!(!in_backoff(&conn, 1000).unwrap());
        start_backoff(&conn, 1000).unwrap();
        assert!(in_backoff(&conn, 1000 + BACKOFF_SECS - 1).unwrap());
        assert!(!in_backoff(&conn, 1000 + BACKOFF_SECS).unwrap());
        assert!(index_is_stale(&conn, 0).unwrap());
    }

    #[test]
    fn index_round_trips_and_unlisted_shows_drop_out() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        let shows = parse::parse_show_index(include_str!("../fixtures/animefillerlist/shows_index.html"));
        write_index(&mut conn, &shows, 500).unwrap();
        assert!(!index_is_stale(&conn, 500 + INDEX_TTL_SECS - 1).unwrap());
        assert!(index_is_stale(&conn, 500 + INDEX_TTL_SECS).unwrap());
        let index = read_index(&conn).unwrap();
        assert_eq!(index.len(), 10);
        assert_eq!(index[0], FillerIndexShow { slug: "attack-titan".into(), title: "Attack on Titan".into() });

        write_index(&mut conn, &shows[..2], 600).unwrap();
        assert_eq!(read_index(&conn).unwrap().len(), 2);
    }

    #[test]
    fn episodes_links_and_bulk_info_round_trip() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        let naruto = parse::parse_show_page(include_str!("../fixtures/animefillerlist/naruto_condensed.html")).unwrap();
        write_show_episodes(&mut conn, "naruto", &naruto, false, 1000).unwrap();
        let link = FillerLink { external_id: "anime:20".into(), slug: "naruto".into(), episode_offset: 0, confidence: 1.0, manual: false };
        write_link(&conn, &link, 1000).unwrap();
        // A link to a show never fetched carries no show data.
        let pending = FillerLink { external_id: "anime:1735".into(), slug: "naruto-shippuden".into(), episode_offset: 0, confidence: 0.95, manual: true };
        write_link(&conn, &pending, 1000).unwrap();

        let infos = read_infos(&conn, Some(&["anime:20".to_string(), "anime:999".to_string()])).unwrap();
        assert_eq!(infos.len(), 1);
        let show = infos[0].show.as_ref().unwrap();
        assert_eq!(show.last_episode, 220);
        assert_eq!(show.filler.len(), 1 + 1 + 6 + 6 + 78);
        assert_eq!(show.mixed.len(), 9);
        assert_eq!(show.anime_canon, vec![5, 13]);
        assert!(!show.is_airing);

        let all = read_infos(&conn, None).unwrap();
        assert_eq!(all.len(), 2);
        let shippuden = all.iter().find(|info| info.link.slug == "naruto-shippuden").unwrap();
        assert!(shippuden.link.manual);
        assert!(shippuden.show.is_none());

        // Refetch with more episodes → guessed airing; the set is replaced.
        let mut grown = naruto.clone();
        grown.insert(221, FillerKind::Filler);
        write_show_episodes(&mut conn, "naruto", &grown, false, 2000).unwrap();
        let show = read_show(&conn, "naruto").unwrap().unwrap();
        assert_eq!((show.last_episode, show.is_airing, show.fetched_at), (221, true, Some(2000)));
    }

    #[test]
    fn a_failed_show_is_remembered_without_losing_its_title() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        write_index(&mut conn, &[parse::IndexShow { slug: "bleach".into(), title: "Bleach".into() }], 1).unwrap();
        mark_show_failed(&conn, "bleach", 50).unwrap();
        let state = read_show_state(&conn, "bleach").unwrap().unwrap();
        assert_eq!(state, ShowFetchState { fetched_at: None, is_airing: false, failed_at: Some(50) });
        assert_eq!(read_index(&conn).unwrap()[0].title, "Bleach");
        assert!(read_show(&conn, "bleach").unwrap().is_none());
    }

    #[test]
    fn skip_filler_survives_saves_that_omit_it() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        let parse = |json: &str| -> crate::user_library::LibraryEntry { serde_json::from_str(json).unwrap() };
        let base = r#""id":"","user_id":"local","external_id":"anime:269","type":"anime","status":"watching",
            "rating":null,"rating_2":null,"tags":null,"notes":null,"added_at":null,"updated_at":null,
            "selected_platform":null,"selected_version":null,"started_at":null,"finished_at":null"#;
        let saved = crate::user_library::save_library_entry_in(&mut conn, parse(&format!("{{{base},\"progress\":3,\"skip_filler\":1}}"))).unwrap();
        assert_eq!(saved.skip_filler, Some(1));
        // An auto-mark save without the field keeps the stored choice.
        let saved = crate::user_library::save_library_entry_in(&mut conn, parse(&format!("{{{base},\"progress\":4}}"))).unwrap();
        assert_eq!(saved.skip_filler, Some(1));
        let loaded = crate::user_library::load_library_entry(&conn, "anime:269").unwrap().unwrap();
        assert_eq!((loaded.progress, loaded.skip_filler), (4.0, Some(1)));
        // An explicit 0 turns it back off.
        let saved = crate::user_library::save_library_entry_in(&mut conn, parse(&format!("{{{base},\"progress\":4,\"skip_filler\":0}}"))).unwrap();
        assert_eq!(saved.skip_filler, Some(0));
    }

    #[test]
    fn slugs_are_validated_before_any_request() {
        assert!(is_valid_slug("one-piece"));
        assert!(!is_valid_slug("../etc"));
        assert!(!is_valid_slug("naruto/episodes"));
        assert!(!is_valid_slug(""));
        assert!(USER_AGENT.starts_with("Metadea/"));
    }
}
