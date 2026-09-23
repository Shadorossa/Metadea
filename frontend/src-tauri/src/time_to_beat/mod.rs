// "How long to beat" for games and visual novels, from the official sources
// the app already uses: IGDB's `game_time_to_beats` for `game:<id>` and
// `vnovel:<id>` (both are IGDB ids), and VNDB's vote-averaged reading time
// for visual novels, preferred when a VNDB entry matches reliably.
//
// Cached in time_to_beat_cache, one row per external id: data for 30 days,
// a "nothing known" row (every length NULL) for 7 days. Offline or without
// IGDB keys the stale row is served and no negative is written, since
// nothing was actually learned.
mod igdb;
mod vndb;

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::ToStringErr;

pub const POSITIVE_TTL_SECS: i64 = 30 * 24 * 60 * 60;
pub const NEGATIVE_TTL_SECS: i64 = 7 * 24 * 60 * 60;
/// One page's worth; a grid asking for more reads the cache only.
const MAX_QUERIES: usize = 200;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TimeToBeatData {
    pub main_seconds: Option<i64>,
    pub extra_seconds: Option<i64>,
    pub completionist_seconds: Option<i64>,
    pub votes: Option<i64>,
    /// VNDB's 1 (very short) – 5 (very long), only when there are no minutes.
    pub length_bucket: Option<u8>,
    /// `igdb` | `vndb`.
    pub source: String,
}

impl TimeToBeatData {
    pub fn has_data(&self) -> bool {
        self.main_seconds.is_some()
            || self.extra_seconds.is_some()
            || self.completionist_seconds.is_some()
            || self.length_bucket.is_some()
    }

    fn negative(source: &str) -> Self {
        Self { main_seconds: None, extra_seconds: None, completionist_seconds: None, votes: None, length_bucket: None, source: source.into() }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeToBeatQuery {
    external_id: String,
    /// Title and release year, used to look a visual novel up on VNDB.
    title: Option<String>,
    release_year: Option<i32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeToBeat {
    external_id: String,
    main_seconds: Option<i64>,
    extra_seconds: Option<i64>,
    completionist_seconds: Option<i64>,
    votes: Option<i64>,
    length_bucket: Option<u8>,
    source: String,
    fetched_at: i64,
}

impl TimeToBeat {
    fn new(external_id: &str, data: TimeToBeatData, fetched_at: i64) -> Self {
        Self {
            external_id: external_id.to_string(),
            main_seconds: data.main_seconds,
            extra_seconds: data.extra_seconds,
            completionist_seconds: data.completionist_seconds,
            votes: data.votes,
            length_bucket: data.length_bucket,
            source: data.source,
            fetched_at,
        }
    }
}

/// `game:<n>` / `vnovel:<n>` → (is_vn, IGDB id). Anything else has no
/// time-to-beat source.
pub(crate) fn parse_external_id(external_id: &str) -> Option<(bool, u64)> {
    let (kind, id) = external_id.split_once(':')?;
    let is_vn = match kind {
        "game" => false,
        "vnovel" => true,
        _ => return None,
    };
    id.parse::<u64>().ok().filter(|id| *id > 0).map(|id| (is_vn, id))
}

pub fn cache_is_fresh(data: &TimeToBeatData, fetched_at: i64, now: i64) -> bool {
    let ttl = if data.has_data() { POSITIVE_TTL_SECS } else { NEGATIVE_TTL_SECS };
    now - fetched_at < ttl
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

pub(crate) fn read_cached(conn: &Connection, external_id: &str) -> rusqlite::Result<Option<(TimeToBeatData, i64)>> {
    conn.query_row(
        "SELECT main_seconds, extra_seconds, completionist_seconds, votes, length_bucket, source, fetched_at
         FROM time_to_beat_cache WHERE external_id = ?1",
        [external_id],
        |row| {
            Ok((
                TimeToBeatData {
                    main_seconds: row.get(0)?,
                    extra_seconds: row.get(1)?,
                    completionist_seconds: row.get(2)?,
                    votes: row.get(3)?,
                    length_bucket: row.get(4)?,
                    source: row.get(5)?,
                },
                row.get(6)?,
            ))
        },
    )
    .optional()
}

pub(crate) fn write_cached(conn: &Connection, external_id: &str, data: &TimeToBeatData, fetched_at: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO time_to_beat_cache
            (external_id, main_seconds, extra_seconds, completionist_seconds, votes, length_bucket, source, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(external_id) DO UPDATE SET
            main_seconds = excluded.main_seconds, extra_seconds = excluded.extra_seconds,
            completionist_seconds = excluded.completionist_seconds, votes = excluded.votes,
            length_bucket = excluded.length_bucket, source = excluded.source, fetched_at = excluded.fetched_at",
        rusqlite::params![
            external_id, data.main_seconds, data.extra_seconds, data.completionist_seconds,
            data.votes, data.length_bucket, data.source, fetched_at
        ],
    )?;
    Ok(())
}

fn with_conn<T>(app_handle: &tauri::AppHandle, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
    let db = tauri::Manager::state::<crate::db::MetadeaDb>(app_handle);
    let conn = db.conn.lock().str_err()?;
    f(&conn).str_err()
}

/// Time to beat for each query that has any, cache first. Works with no
/// data (or no source for it) are simply absent from the result.
#[tauri::command]
pub async fn get_time_to_beat(app_handle: tauri::AppHandle, queries: Vec<TimeToBeatQuery>) -> Result<Vec<TimeToBeat>, String> {
    let now = now_unix();
    let mut queries: Vec<TimeToBeatQuery> = queries.into_iter().filter(|q| parse_external_id(&q.external_id).is_some()).collect();
    queries.truncate(MAX_QUERIES);

    let cached: Vec<Option<(TimeToBeatData, i64)>> = with_conn(&app_handle, |conn| {
        queries.iter().map(|q| read_cached(conn, &q.external_id)).collect()
    })?;

    let mut out = Vec::new();
    let mut stale: HashMap<String, (TimeToBeatData, i64)> = HashMap::new();
    let mut to_fetch: Vec<&TimeToBeatQuery> = Vec::new();
    for (query, cached) in queries.iter().zip(cached) {
        match cached {
            Some((data, fetched_at)) if cache_is_fresh(&data, fetched_at, now) => {
                if data.has_data() {
                    out.push(TimeToBeat::new(&query.external_id, data, fetched_at));
                }
            }
            Some(row) => {
                stale.insert(query.external_id.clone(), row);
                to_fetch.push(query);
            }
            None => to_fetch.push(query),
        }
    }

    let mut fresh: Vec<(String, TimeToBeatData)> = Vec::new();
    let mut unresolved: Vec<&TimeToBeatQuery> = Vec::new();

    // Visual novels: VNDB first, one title search each; IGDB for the rest.
    for query in to_fetch {
        let is_vn = parse_external_id(&query.external_id).is_some_and(|(vn, _)| vn);
        let title = query.title.as_deref().map(str::trim).filter(|t| !t.is_empty());
        if let (true, Some(title)) = (is_vn, title) {
            match vndb::fetch(title, query.release_year).await {
                Ok(Some(data)) => {
                    fresh.push((query.external_id.clone(), data));
                    continue;
                }
                Ok(None) => {}
                Err(e) => log::debug!("time to beat: VNDB lookup for {} failed ({e})", query.external_id),
            }
        }
        unresolved.push(query);
    }

    let mut ids: Vec<u64> = unresolved.iter().filter_map(|q| parse_external_id(&q.external_id).map(|(_, id)| id)).collect();
    ids.sort_unstable();
    ids.dedup();
    match igdb::fetch(&app_handle, &ids).await {
        Ok(Some(found)) => {
            let by_id: HashMap<u64, TimeToBeatData> = found.into_iter().collect();
            for query in &unresolved {
                let Some((_, id)) = parse_external_id(&query.external_id) else { continue };
                let data = by_id.get(&id).cloned().unwrap_or_else(|| TimeToBeatData::negative("igdb"));
                fresh.push((query.external_id.clone(), data));
            }
        }
        Ok(None) => {}
        Err(e) => log::debug!("time to beat: IGDB request failed ({e})"),
    }

    with_conn(&app_handle, |conn| {
        for (external_id, data) in &fresh {
            write_cached(conn, external_id, data, now)?;
        }
        Ok(())
    })?;
    for (external_id, data) in fresh {
        stale.remove(&external_id);
        if data.has_data() {
            out.push(TimeToBeat::new(&external_id, data, now));
        }
    }
    // Whatever couldn't be refreshed: the old answer beats none.
    for (external_id, (data, fetched_at)) in stale {
        if data.has_data() {
            out.push(TimeToBeat::new(&external_id, data, fetched_at));
        }
    }
    Ok(out)
}

/// Cache only, stale rows included — for sorting a whole grid without a
/// request per game.
#[tauri::command]
pub fn get_cached_time_to_beat(app_handle: tauri::AppHandle, external_ids: Vec<String>) -> Result<Vec<TimeToBeat>, String> {
    with_conn(&app_handle, |conn| {
        let mut out = Vec::new();
        for external_id in external_ids.iter().filter(|id| parse_external_id(id).is_some()) {
            if let Some((data, fetched_at)) = read_cached(conn, external_id)? {
                if data.has_data() {
                    out.push(TimeToBeat::new(external_id, data, fetched_at));
                }
            }
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        let tx = conn.transaction().unwrap();
        crate::migrations::time_to_beat_cache::migrate(&tx).unwrap();
        tx.commit().unwrap();
        conn
    }

    fn data(main: Option<i64>) -> TimeToBeatData {
        TimeToBeatData { main_seconds: main, extra_seconds: None, completionist_seconds: None, votes: Some(3), length_bucket: None, source: "igdb".into() }
    }

    #[test]
    fn positive_rows_live_30_days_and_negative_rows_7() {
        let day = 24 * 60 * 60;
        let positive = data(Some(3600));
        let negative = TimeToBeatData::negative("igdb");
        assert!(cache_is_fresh(&positive, 0, 29 * day));
        assert!(!cache_is_fresh(&positive, 0, 30 * day));
        assert!(cache_is_fresh(&negative, 0, 6 * day));
        assert!(!cache_is_fresh(&negative, 0, 7 * day));
    }

    #[test]
    fn a_bucket_alone_counts_as_data() {
        let mut bucket_only = TimeToBeatData::negative("vndb");
        assert!(!bucket_only.has_data());
        bucket_only.length_bucket = Some(2);
        assert!(bucket_only.has_data());
    }

    #[test]
    fn cache_round_trips_and_upserts() {
        let conn = conn();
        assert!(read_cached(&conn, "game:1").unwrap().is_none());
        write_cached(&conn, "game:1", &data(Some(3600)), 100).unwrap();
        write_cached(&conn, "game:1", &data(Some(7200)), 200).unwrap();
        let (row, fetched_at) = read_cached(&conn, "game:1").unwrap().unwrap();
        assert_eq!(row, data(Some(7200)));
        assert_eq!(fetched_at, 200);
        write_cached(&conn, "vnovel:2", &TimeToBeatData::negative("igdb"), 300).unwrap();
        assert!(!read_cached(&conn, "vnovel:2").unwrap().unwrap().0.has_data());
    }

    #[test]
    fn only_igdb_backed_ids_have_a_source() {
        assert_eq!(parse_external_id("game:1942"), Some((false, 1942)));
        assert_eq!(parse_external_id("vnovel:5"), Some((true, 5)));
        assert_eq!(parse_external_id("anime:5"), None);
        assert_eq!(parse_external_id("game:abc"), None);
        assert_eq!(parse_external_id("game:0"), None);
    }
}
