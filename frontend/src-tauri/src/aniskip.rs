// AniSkip client for the built-in player's "skip opening / ending" button
// (frontend/src/components/player/hooks/usePlayerSkipSegments.ts).
//
// Fixed host, no auth, a 2 s timeout: the service is a nicety, so when it is
// down the command answers "no segments" and the user simply never sees the
// button. Results are cached in `aniskip_segments` per (MAL id, episode,
// episode-length bucket) — a hit for 7 days, a miss for 24 h — so an
// episode rewatched offline still gets its segments.
//
// The MAL id itself is resolved by the frontend through AniList and stored in
// `media_catalog.mal_id` (get/set_catalog_mal_id below); this module never
// talks to AniList.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::ToStringErr;

const ANISKIP_BASE: &str = "https://api.aniskip.com/v2/skip-times";
const REQUEST_TIMEOUT_SECS: u64 = 2;

pub const TTL_HIT_SECS: i64 = 7 * 24 * 60 * 60;
pub const TTL_MISS_SECS: i64 = 24 * 60 * 60;
/// Episode lengths are rounded to the nearest multiple of this many seconds
/// before they key the cache (and the request), so a 23:40 release and a
/// 24:05 release of the same episode share one entry.
pub const LENGTH_BUCKET_SECS: i64 = 60;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AniskipSegment {
    /// `op`, `ed`, `recap`, `mixed-op`, `mixed-ed` — as AniSkip reports it.
    pub skip_type: String,
    pub start_secs: f64,
    pub end_secs: f64,
}

#[derive(Debug, Deserialize)]
struct AniskipResponse {
    #[serde(default)]
    found: bool,
    #[serde(default)]
    results: Vec<AniskipResult>,
}

#[derive(Debug, Deserialize)]
struct AniskipResult {
    interval: AniskipInterval,
    #[serde(rename = "skipType")]
    skip_type: String,
}

#[derive(Debug, Deserialize)]
struct AniskipInterval {
    #[serde(rename = "startTime")]
    start_time: f64,
    #[serde(rename = "endTime")]
    end_time: f64,
}

pub fn bucket_episode_length(episode_length_secs: f64) -> i64 {
    if !episode_length_secs.is_finite() || episode_length_secs <= 0.0 {
        return 0;
    }
    (episode_length_secs / LENGTH_BUCKET_SECS as f64).round() as i64 * LENGTH_BUCKET_SECS
}

/// The response body → segments, with malformed or empty intervals dropped.
/// A body that is not AniSkip's shape at all yields `None` (not cached).
pub fn parse_response(body: &str) -> Option<Vec<AniskipSegment>> {
    let response: AniskipResponse = serde_json::from_str(body).ok()?;
    if !response.found {
        return Some(Vec::new());
    }
    Some(
        response
            .results
            .into_iter()
            .filter(|result| {
                result.interval.start_time.is_finite()
                    && result.interval.end_time.is_finite()
                    && result.interval.end_time > result.interval.start_time
            })
            .map(|result| AniskipSegment {
                skip_type: result.skip_type,
                start_secs: result.interval.start_time.max(0.0),
                end_secs: result.interval.end_time,
            })
            .collect(),
    )
}

pub fn request_url(mal_id: i64, episode: i64, episode_length_bucket: i64) -> String {
    format!(
        "{ANISKIP_BASE}/{mal_id}/{episode}?types[]=op&types[]=ed&types[]=recap&types[]=mixed-op&types[]=mixed-ed&episodeLength={episode_length_bucket}"
    )
}

/// Whether a cached row is still trusted: a hit for [`TTL_HIT_SECS`], a
/// negative result for [`TTL_MISS_SECS`].
pub fn cache_is_fresh(segments: &[AniskipSegment], fetched_at: i64, now: i64) -> bool {
    let ttl = if segments.is_empty() { TTL_MISS_SECS } else { TTL_HIT_SECS };
    now - fetched_at < ttl
}

pub fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn read_cached(
    conn: &Connection,
    mal_id: i64,
    episode: i64,
    bucket: i64,
) -> rusqlite::Result<Option<(Vec<AniskipSegment>, i64)>> {
    let row = conn
        .query_row(
            "SELECT json, fetched_at FROM aniskip_segments WHERE mal_id = ?1 AND episode = ?2 AND episode_length_bucket = ?3",
            rusqlite::params![mal_id, episode, bucket],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    Ok(row.and_then(|(json, fetched_at)| parse_response(&json).map(|segments| (segments, fetched_at))))
}

pub fn write_cached(conn: &Connection, mal_id: i64, episode: i64, bucket: i64, json: &str, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO aniskip_segments (mal_id, episode, episode_length_bucket, json, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(mal_id, episode, episode_length_bucket) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
        rusqlite::params![mal_id, episode, bucket, json, now],
    )
    .map(|_| ())
}

/// Network fetch. `Ok(None)` means "AniSkip has nothing" (a 404 with
/// `found: false`); `Err` means the service could not be asked — nothing is
/// cached in that case so the next episode tries again.
async fn fetch_remote(url: &str) -> Result<String, String> {
    let response = crate::http::http_client()
        .get(url)
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .header("Accept", "application/json")
        .send()
        .await
        .str_err()?;
    let status = response.status();
    if status.as_u16() == 404 {
        return Ok(r#"{"found":false,"results":[]}"#.to_string());
    }
    if !status.is_success() {
        return Err(format!("aniskip status {status}"));
    }
    response.text().await.str_err()
}

/// Segments for one episode: cache first, AniSkip when the cache is cold or
/// stale. Never fails over the network — an unreachable service is an empty
/// list (a stale cached row is preferred over that when it exists).
#[tauri::command]
pub async fn aniskip_get_segments(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    mal_id: i64,
    episode: i64,
    episode_length: f64,
) -> Result<Vec<AniskipSegment>, String> {
    if mal_id <= 0 || episode <= 0 {
        return Ok(Vec::new());
    }
    let bucket = bucket_episode_length(episode_length);
    let now = now_unix();
    let cached = {
        let conn = state.conn.lock().str_err()?;
        read_cached(&conn, mal_id, episode, bucket).str_err()?
    };
    if let Some((segments, fetched_at)) = &cached {
        if cache_is_fresh(segments, *fetched_at, now) {
            return Ok(segments.clone());
        }
    }
    match fetch_remote(&request_url(mal_id, episode, bucket)).await {
        Ok(body) => match parse_response(&body) {
            Some(segments) => {
                let conn = state.conn.lock().str_err()?;
                write_cached(&conn, mal_id, episode, bucket, &body, now).str_err()?;
                Ok(segments)
            }
            None => {
                log::debug!("aniskip: unexpected response shape for mal {mal_id} ep {episode}");
                Ok(cached.map(|(segments, _)| segments).unwrap_or_default())
            }
        },
        Err(error) => {
            log::debug!("aniskip unavailable: {error}");
            Ok(cached.map(|(segments, _)| segments).unwrap_or_default())
        }
    }
}

#[tauri::command]
pub async fn get_catalog_mal_id(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<i64>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        "SELECT mal_id FROM media_catalog WHERE external_id = ?1",
        [external_id],
        |row| row.get::<_, Option<i64>>(0),
    )
    .optional()
    .str_err()
    .map(|row| row.flatten())
}

#[tauri::command]
pub async fn set_catalog_mal_id(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    mal_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "UPDATE media_catalog SET mal_id = ?2 WHERE external_id = ?1",
        rusqlite::params![external_id, mal_id],
    )
    .map(|_| ())
    .str_err()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
      "found": true,
      "results": [
        {"interval": {"startTime": 0.0, "endTime": 89.5}, "skipType": "op", "skipId": "a", "episodeLength": 1420.0},
        {"interval": {"startTime": 1330.0, "endTime": 1419.0}, "skipType": "ed", "skipId": "b", "episodeLength": 1420.0},
        {"interval": {"startTime": 50.0, "endTime": 40.0}, "skipType": "recap", "skipId": "c", "episodeLength": 1420.0}
      ],
      "message": "", "statusCode": 200
    }"#;

    #[test]
    fn response_fixture_parses_into_segments_and_drops_inverted_intervals() {
        let segments = parse_response(FIXTURE).unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0], AniskipSegment { skip_type: "op".into(), start_secs: 0.0, end_secs: 89.5 });
        assert_eq!(segments[1].skip_type, "ed");
        assert_eq!(segments[1].start_secs, 1330.0);
    }

    #[test]
    fn not_found_is_an_empty_list_and_garbage_is_none() {
        assert_eq!(parse_response(r#"{"found":false,"results":[],"message":"No skip times found","statusCode":404}"#), Some(vec![]));
        assert_eq!(parse_response("<html>"), None);
    }

    #[test]
    fn episode_lengths_share_a_bucket_within_thirty_seconds() {
        assert_eq!(bucket_episode_length(1420.0), 1440);
        assert_eq!(bucket_episode_length(1445.0), 1440);
        assert_eq!(bucket_episode_length(1470.1), 1500);
        assert_eq!(bucket_episode_length(0.0), 0);
        assert_eq!(bucket_episode_length(f64::NAN), 0);
    }

    #[test]
    fn hits_stay_fresh_a_week_and_misses_a_day() {
        let hit = vec![AniskipSegment { skip_type: "op".into(), start_secs: 0.0, end_secs: 90.0 }];
        assert!(cache_is_fresh(&hit, 0, TTL_HIT_SECS - 1));
        assert!(!cache_is_fresh(&hit, 0, TTL_HIT_SECS));
        assert!(cache_is_fresh(&[], 0, TTL_MISS_SECS - 1));
        assert!(!cache_is_fresh(&[], 0, TTL_MISS_SECS));
    }

    #[test]
    fn cache_round_trips_through_sqlite() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        assert!(read_cached(&conn, 1, 1, 1440).unwrap().is_none());
        write_cached(&conn, 1, 1, 1440, FIXTURE, 100).unwrap();
        let (segments, fetched_at) = read_cached(&conn, 1, 1, 1440).unwrap().unwrap();
        assert_eq!(fetched_at, 100);
        assert_eq!(segments.len(), 2);
        // Same key overwrites instead of duplicating.
        write_cached(&conn, 1, 1, 1440, r#"{"found":false,"results":[]}"#, 200).unwrap();
        let (segments, fetched_at) = read_cached(&conn, 1, 1, 1440).unwrap().unwrap();
        assert_eq!(fetched_at, 200);
        assert!(segments.is_empty());
    }

    #[test]
    fn request_url_carries_every_type_and_the_bucketed_length() {
        let url = request_url(21, 3, 1440);
        assert!(url.starts_with("https://api.aniskip.com/v2/skip-times/21/3?"));
        assert!(url.contains("types[]=mixed-ed"));
        assert!(url.ends_with("episodeLength=1440"));
    }
}
