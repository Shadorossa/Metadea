// Company pages (`/company?id=<provider>:<id>`): header + every work a
// developer / publisher / studio / producer / network has made, from the
// provider the id names (IGDB, AniList, TMDB) with the user's own keys, or
// from the local catalog when there is no provider for it (ComicVine), no
// key, or no connection.
//
// Cached in company_cache (one JSON row per provider id, TTL 7 days).
// `get_company_page` returns the cached row at once, flagged `stale` past the
// TTL so the page can render it and then call again with `force_refresh`
// (stale-while-revalidate). Large catalogues arrive in chunks: the first call
// stores a cursor and `load_more_company_works` resumes from it until
// `complete`.
mod anilist;
mod igdb;
mod local;
mod model;
// Shared with textless_covers.rs (same key, same TMDB_COMPANY_BUDGET pacing).
pub(crate) mod tmdb;

use rusqlite::{Connection, OptionalExtension};

use crate::db::ToStringErr;
use crate::error_codes;
use model::{collect_roles, merge_works, CachedCompany, CompanyPagePayload, CompanyProvider, WorksCursor};

pub const CACHE_TTL_SECS: i64 = 7 * 24 * 60 * 60;

#[derive(Debug)]
pub(crate) enum FetchError {
    KeysMissing,
    NotFound,
    Api(String),
}

impl FetchError {
    fn code(&self) -> String {
        match self {
            FetchError::KeysMissing => error_codes::COMPANY_KEYS_MISSING.to_string(),
            FetchError::NotFound => error_codes::COMPANY_NOT_FOUND.to_string(),
            FetchError::Api(detail) => error_codes::with_detail(error_codes::COMPANY_API, detail),
        }
    }
}

pub fn cache_is_fresh(fetched_at: i64, now: i64) -> bool {
    now - fetched_at < CACHE_TTL_SECS
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

pub(crate) fn read_cached(conn: &Connection, provider_id: &str) -> rusqlite::Result<Option<(CachedCompany, i64)>> {
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT json, fetched_at FROM company_cache WHERE provider_id = ?1",
            [provider_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    // A row this build can't read (older shape) is a cache miss.
    Ok(row.and_then(|(json, fetched_at)| serde_json::from_str(&json).ok().map(|c| (c, fetched_at))))
}

pub(crate) fn write_cached(conn: &Connection, provider_id: &str, cached: &CachedCompany, fetched_at: i64) -> Result<(), String> {
    let json = serde_json::to_string(cached).str_err()?;
    conn.execute(
        "INSERT INTO company_cache (provider_id, json, fetched_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(provider_id) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
        rusqlite::params![provider_id, json, fetched_at],
    )
    .str_err()?;
    Ok(())
}

fn payload(cached: CachedCompany, fetched_at: i64, now: i64) -> CompanyPagePayload {
    CompanyPagePayload {
        complete: cached.cursor.is_done(),
        stale: !cache_is_fresh(fetched_at, now),
        page: cached.page,
        fetched_at,
    }
}

async fn fetch_first(app_handle: &tauri::AppHandle, provider_id: &str, provider: &CompanyProvider) -> Result<CachedCompany, FetchError> {
    let (page, cursor) = match provider {
        CompanyProvider::Igdb(id) => {
            let (mut page, cursor) = igdb::fetch_first(app_handle, provider_id, *id).await?;
            // Most companies fit in the first batch; resolve it right away
            // so the page never renders a header with no works.
            let (works, cursor) = match &cursor {
                WorksCursor::Igdb { pending } if !pending.is_empty() => igdb::fetch_next(app_handle, pending).await?,
                _ => (Vec::new(), cursor),
            };
            merge_works(&mut page.works, works);
            (page, cursor)
        }
        CompanyProvider::AniListStudio(id) => {
            let (studio, cursor) = anilist::fetch_page(provider_id, *id, 1).await?;
            let mut page = studio.header;
            page.works = studio.works;
            if !page.works.is_empty() {
                page.roles = collect_roles(&page.works);
            }
            (page, cursor)
        }
        CompanyProvider::TmdbCompany(id) => tmdb::fetch_first(app_handle, provider_id, tmdb::TmdbKind::Company, *id).await?,
        CompanyProvider::TmdbNetwork(id) => tmdb::fetch_first(app_handle, provider_id, tmdb::TmdbKind::Network, *id).await?,
        CompanyProvider::ComicVine(_) => return Err(FetchError::NotFound),
    };
    Ok(CachedCompany { page, cursor })
}

fn local_payload(app_handle: &tauri::AppHandle, provider_id: &str, provider: &CompanyProvider) -> Result<Option<CompanyPagePayload>, String> {
    let db = tauri::Manager::state::<crate::db::MetadeaDb>(app_handle);
    let conn = db.conn.lock().str_err()?;
    let page = local::local_company_page(&conn, provider_id, provider).str_err()?;
    Ok(page.map(|page| CompanyPagePayload { page, fetched_at: now_unix(), stale: false, complete: true }))
}

#[tauri::command]
pub async fn get_company_page(
    app_handle: tauri::AppHandle,
    provider_id: String,
    force_refresh: bool,
) -> Result<CompanyPagePayload, String> {
    let provider = CompanyProvider::parse(&provider_id).ok_or_else(|| error_codes::COMPANY_ID_INVALID.to_string())?;
    let now = now_unix();
    let cached = {
        let db = tauri::Manager::state::<crate::db::MetadeaDb>(&app_handle);
        let conn = db.conn.lock().str_err()?;
        read_cached(&conn, &provider_id).str_err()?
    };
    if !force_refresh {
        if let Some((cached, fetched_at)) = cached {
            return Ok(payload(cached, fetched_at, now));
        }
    }

    match fetch_first(&app_handle, &provider_id, &provider).await {
        Ok(fresh) => {
            let db = tauri::Manager::state::<crate::db::MetadeaDb>(&app_handle);
            let conn = db.conn.lock().str_err()?;
            write_cached(&conn, &provider_id, &fresh, now)?;
            Ok(payload(fresh, now, now))
        }
        Err(error) => {
            log::debug!("company page {provider_id}: provider unavailable ({error:?})");
            // Offline first: a stale copy beats the local rows, and the local
            // rows beat an error. Nothing is cached from the fallback.
            if let Some((cached, fetched_at)) = cached {
                return Ok(payload(cached, fetched_at, now));
            }
            match local_payload(&app_handle, &provider_id, &provider)? {
                Some(local) => Ok(local),
                None => Err(error.code()),
            }
        }
    }
}

/// Resolves the next chunk of works after the cached cursor and stores it.
#[tauri::command]
pub async fn load_more_company_works(
    app_handle: tauri::AppHandle,
    provider_id: String,
) -> Result<CompanyPagePayload, String> {
    let provider = CompanyProvider::parse(&provider_id).ok_or_else(|| error_codes::COMPANY_ID_INVALID.to_string())?;
    let (mut cached, fetched_at) = {
        let db = tauri::Manager::state::<crate::db::MetadeaDb>(&app_handle);
        let conn = db.conn.lock().str_err()?;
        read_cached(&conn, &provider_id).str_err()?
    }
    .ok_or_else(|| error_codes::COMPANY_NOT_FOUND.to_string())?;

    let next = match (&cached.cursor, &provider) {
        (WorksCursor::Igdb { pending }, _) if !pending.is_empty() => Some(igdb::fetch_next(&app_handle, pending).await),
        (WorksCursor::AniList { next_page }, CompanyProvider::AniListStudio(id)) => Some(
            anilist::fetch_page(&provider_id, *id, *next_page).await.map(|(studio, cursor)| (studio.works, cursor)),
        ),
        (WorksCursor::Tmdb { movie_page, tv_page }, CompanyProvider::TmdbCompany(id)) => {
            Some(tmdb::fetch_next(&app_handle, tmdb::TmdbKind::Company, *id, *movie_page, *tv_page).await)
        }
        (WorksCursor::Tmdb { tv_page, .. }, CompanyProvider::TmdbNetwork(id)) => {
            Some(tmdb::fetch_next(&app_handle, tmdb::TmdbKind::Network, *id, None, *tv_page).await)
        }
        _ => None,
    };
    if let Some(next) = next {
        let (works, cursor) = next.map_err(|e| e.code())?;
        merge_works(&mut cached.page.works, works);
        for role in collect_roles(&cached.page.works) {
            if !cached.page.roles.contains(&role) {
                cached.page.roles.push(role);
            }
        }
        cached.cursor = cursor;
        let db = tauri::Manager::state::<crate::db::MetadeaDb>(&app_handle);
        let conn = db.conn.lock().str_err()?;
        write_cached(&conn, &provider_id, &cached, fetched_at)?;
    } else {
        cached.cursor = WorksCursor::Done;
    }
    Ok(payload(cached, fetched_at, now_unix()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::{CompanyPage, CompanyWork};

    #[test]
    fn cache_stays_fresh_for_seven_days() {
        assert!(cache_is_fresh(0, CACHE_TTL_SECS - 1));
        assert!(!cache_is_fresh(0, CACHE_TTL_SECS));
        assert!(!cache_is_fresh(0, CACHE_TTL_SECS * 3));
    }

    #[test]
    fn cache_round_trips_and_flags_staleness() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        assert!(read_cached(&conn, "igdb:1").unwrap().is_none());

        let cached = CachedCompany {
            page: CompanyPage {
                provider_id: "igdb:1".into(),
                name: "Nintendo".into(),
                works: vec![CompanyWork { external_id: "game:1".into(), ..Default::default() }],
                ..Default::default()
            },
            cursor: WorksCursor::Igdb { pending: vec![(2, true, false)] },
        };
        write_cached(&conn, "igdb:1", &cached, 100).unwrap();
        let (read, fetched_at) = read_cached(&conn, "igdb:1").unwrap().unwrap();
        assert_eq!(read, cached);
        assert_eq!(fetched_at, 100);

        let fresh = payload(read.clone(), fetched_at, 100 + CACHE_TTL_SECS - 1);
        assert!(!fresh.stale);
        assert!(!fresh.complete, "one id still pending");
        let stale = payload(read, fetched_at, 100 + CACHE_TTL_SECS);
        assert!(stale.stale);

        // Same key overwrites.
        let done = CachedCompany { cursor: WorksCursor::Done, ..cached };
        write_cached(&conn, "igdb:1", &done, 200).unwrap();
        let (read, fetched_at) = read_cached(&conn, "igdb:1").unwrap().unwrap();
        assert_eq!(fetched_at, 200);
        assert!(payload(read, fetched_at, 200).complete);
    }

    #[test]
    fn unreadable_rows_are_a_cache_miss() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        conn.execute("INSERT INTO company_cache (provider_id, json, fetched_at) VALUES ('igdb:9', 'not json', 1)", []).unwrap();
        assert!(read_cached(&conn, "igdb:9").unwrap().is_none());
    }

    #[test]
    fn fetch_errors_map_to_codes() {
        assert_eq!(FetchError::KeysMissing.code(), "E_COMPANY_KEYS_MISSING");
        assert_eq!(FetchError::NotFound.code(), "E_COMPANY_NOT_FOUND");
        assert_eq!(FetchError::Api("HTTP 500".into()).code(), "E_COMPANY_API: HTTP 500");
    }
}
