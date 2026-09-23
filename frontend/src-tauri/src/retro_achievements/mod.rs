//! RetroAchievements integration for emulated games: credentials come from
//! `app_env` (igdb_env.rs stores them encrypted like the other API keys),
//! the Web API client lives in client.rs, responses are cached in SQLite
//! (cache.rs) so the panel works offline, and a library entry is tied to an
//! RA game through retro_achievements_links (links.rs) by ROM hash
//! (hash.rs), by title (matching.rs) or by hand.
//!
//! Metadea only displays progress — unlocking happens in RA-enabled emulators.

pub mod cache;
pub mod client;
pub mod consoles;
pub mod hash;
pub mod links;
mod matching;

use std::future::Future;

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::Manager;

use crate::db::{MetadeaDb, ToStringErr};
use crate::error_codes;
use client::{RaConsole, RaCredentials, RaGameListEntry, RaGameProgress, RaProfileProgress, RaRecentUnlock};
use links::RaLink;

/// A remote read with its provenance, so the UI can tell fresh from cached
/// from stale (served from cache because the refresh failed).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaCached<T> {
    pub data: T,
    pub fetched_at: i64,
    pub from_cache: bool,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaStatus {
    pub configured: bool,
    pub username: Option<String>,
    pub hash_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaHashLookup {
    pub hash: String,
    pub game_id: Option<u32>,
    /// "game_list" (offline, from the cached console list), "cache" or "remote".
    pub source: String,
}

pub const ENV_USERNAME: &str = "ra_username";
pub const ENV_API_KEY: &str = "ra_api_key";

fn credentials(db: &MetadeaDb) -> Result<Option<RaCredentials>, String> {
    let conn = db.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare("SELECT name, value FROM app_env WHERE name IN (?1, ?2) AND value != ''")
        .str_err()?;
    let rows: Vec<(String, String)> = stmt
        .query_map([ENV_USERNAME, ENV_API_KEY], |r| Ok((r.get(0)?, r.get(1)?)))
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    let mut username = None;
    let mut api_key = None;
    for (name, value) in rows {
        let plain = crate::utils::decrypt_secret_or_plaintext(&value);
        if name == ENV_USERNAME {
            username = Some(plain);
        } else {
            api_key = Some(plain);
        }
    }
    Ok(match (username, api_key) {
        (Some(username), Some(api_key)) if !username.trim().is_empty() && !api_key.trim().is_empty() => {
            Some(RaCredentials { username: username.trim().to_string(), api_key: api_key.trim().to_string() })
        }
        _ => None,
    })
}

fn require_credentials(db: &MetadeaDb) -> Result<RaCredentials, String> {
    credentials(db)?.ok_or_else(|| error_codes::RA_NOT_CONFIGURED.to_string())
}

fn read_cache(db: &MetadeaDb, key: &str, ttl: i64) -> Result<Option<cache::CachedRow>, String> {
    let conn = db.conn.lock().str_err()?;
    cache::read(&conn, key, ttl, cache::now_unix()).str_err()
}

fn write_cache(db: &MetadeaDb, key: &str, json: &str) -> Result<(), String> {
    let conn = db.conn.lock().str_err()?;
    cache::write(&conn, key, json, cache::now_unix()).str_err()
}

/// Cache-first read: a fresh row is returned as-is (unless `force`), an
/// expired or missing one triggers `fetch`; when that fails but an old row
/// exists, the old row is returned flagged stale instead of an error.
async fn cached_fetch<T, F>(
    db: &MetadeaDb,
    key: &str,
    ttl: i64,
    force: bool,
    fetch: F,
    parse: fn(&str) -> Result<T, String>,
) -> Result<RaCached<T>, String>
where
    T: Serialize + DeserializeOwned,
    F: Future<Output = Result<String, String>>,
{
    let existing = read_cache(db, key, ttl)?;
    if let Some(row) = existing.as_ref().filter(|row| row.fresh && !force) {
        return Ok(RaCached { data: parse(&row.json)?, fetched_at: row.fetched_at, from_cache: true, stale: false });
    }
    match fetch.await {
        Ok(body) => {
            let data = parse(&body)?;
            write_cache(db, key, &body)?;
            Ok(RaCached { data, fetched_at: cache::now_unix(), from_cache: false, stale: false })
        }
        Err(err) => match existing {
            Some(row) => Ok(RaCached { data: parse(&row.json)?, fetched_at: row.fetched_at, from_cache: true, stale: true }),
            None => Err(err),
        },
    }
}

async fn game_list(db: &MetadeaDb, creds: &RaCredentials, console_id: u32) -> Result<Vec<RaGameListEntry>, String> {
    let key = cache::game_list_key(console_id);
    let cached = cached_fetch(
        db,
        &key,
        cache::TTL_GAME_LIST_SECS,
        false,
        client::fetch_game_list_json(creds, console_id),
        client::parse_game_list,
    )
    .await?;
    Ok(cached.data)
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ra_status(app_handle: tauri::AppHandle) -> Result<RaStatus, String> {
    let db = app_handle.state::<MetadeaDb>();
    let creds = credentials(&db)?;
    Ok(RaStatus {
        configured: creds.is_some(),
        username: creds.map(|c| c.username),
        hash_available: hash::default_hasher().is_available(),
    })
}

/// RA console id for a Metadea platform, from its IGDB platform id or the
/// ROM scanner's `rom_platform`; None when RA has no set for that system.
#[tauri::command]
pub fn ra_console_for_platform(igdb_platform_id: Option<i64>, rom_platform: Option<String>) -> Option<u32> {
    igdb_platform_id
        .and_then(consoles::ra_console_for_igdb_platform)
        .or_else(|| rom_platform.as_deref().and_then(consoles::ra_console_for_rom_platform))
}

#[tauri::command]
pub async fn ra_get_link(app_handle: tauri::AppHandle, external_id: String) -> Result<Option<RaLink>, String> {
    let db = app_handle.state::<MetadeaDb>();
    let conn = db.conn.lock().str_err()?;
    links::get(&conn, &external_id).str_err()
}

#[tauri::command]
pub async fn ra_set_link(
    app_handle: tauri::AppHandle,
    external_id: String,
    ra_game_id: u32,
    matched_by: String,
    rom_hash: Option<String>,
) -> Result<RaLink, String> {
    if external_id.trim().is_empty() || ra_game_id == 0 || !links::MATCHED_BY.contains(&matched_by.as_str()) {
        return Err(error_codes::RA_LINK_INVALID.to_string());
    }
    let db = app_handle.state::<MetadeaDb>();
    let conn = db.conn.lock().str_err()?;
    links::set(&conn, &external_id, ra_game_id, &matched_by, rom_hash.as_deref()).str_err()?;
    links::get(&conn, &external_id).str_err()?.ok_or_else(|| error_codes::RA_LINK_INVALID.to_string())
}

#[tauri::command]
pub async fn ra_remove_link(app_handle: tauri::AppHandle, external_id: String) -> Result<(), String> {
    let db = app_handle.state::<MetadeaDb>();
    let conn = db.conn.lock().str_err()?;
    links::remove(&conn, &external_id).str_err()
}

/// Hashes the ROM the way RA does and resolves the hash to a game id:
/// first against the console's cached game list (offline), then the hash
/// cache, then RA's unauthenticated lookup.
#[tauri::command]
pub async fn ra_lookup_by_hash(app_handle: tauri::AppHandle, rom_path: String, console_id: u32) -> Result<RaHashLookup, String> {
    let hasher = hash::default_hasher();
    if !hasher.is_available() {
        return Err(error_codes::RA_HASH_UNAVAILABLE.to_string());
    }
    if console_id == 0 {
        return Err(error_codes::RA_CONSOLE_UNSUPPORTED.to_string());
    }
    let path = rom_path.clone();
    let hash = tauri::async_runtime::spawn_blocking(move || hasher.hash_rom(&path, console_id))
        .await
        .map_err(|e| error_codes::with_detail(error_codes::RA_HASH_FAILED, e))??;

    let db = app_handle.state::<MetadeaDb>();
    // Any cached list, fresh or not: a hash → id pairing does not go stale.
    if let Some(row) = read_cache(&db, &cache::game_list_key(console_id), i64::MAX)? {
        let list = client::parse_game_list(&row.json)?;
        if let Some(game_id) = client::hash_index(&list).get(hash.as_str()) {
            return Ok(RaHashLookup { hash, game_id: Some(*game_id), source: "game_list".into() });
        }
    }
    let key = cache::hash_lookup_key(&hash);
    if let Some(row) = read_cache(&db, &key, cache::TTL_HASH_LOOKUP_SECS)?.filter(|row| row.fresh) {
        return Ok(RaHashLookup { hash, game_id: client::parse_hash_lookup(&row.json)?, source: "cache".into() });
    }
    let body = client::fetch_hash_lookup_json(&hash).await?;
    let game_id = client::parse_hash_lookup(&body)?;
    write_cache(&db, &key, &body)?;
    Ok(RaHashLookup { hash, game_id, source: "remote".into() })
}

#[tauri::command]
pub async fn ra_match_by_name(app_handle: tauri::AppHandle, title: String, console_id: u32) -> Result<Option<RaGameListEntry>, String> {
    let db = app_handle.state::<MetadeaDb>();
    let creds = require_credentials(&db)?;
    let list = game_list(&db, &creds, console_id).await?;
    Ok(matching::best_match(&title, &list).cloned())
}

#[tauri::command]
pub async fn ra_search_games(app_handle: tauri::AppHandle, console_id: u32, query: String) -> Result<Vec<RaGameListEntry>, String> {
    let db = app_handle.state::<MetadeaDb>();
    let creds = require_credentials(&db)?;
    let list = game_list(&db, &creds, console_id).await?;
    Ok(matching::search(&query, &list, 50).into_iter().cloned().collect())
}

#[tauri::command]
pub async fn ra_get_game_progress(
    app_handle: tauri::AppHandle,
    ra_game_id: u32,
    force_refresh: Option<bool>,
) -> Result<RaCached<RaGameProgress>, String> {
    let db = app_handle.state::<MetadeaDb>();
    let creds = require_credentials(&db)?;
    let key = cache::game_progress_key(&creds.username, ra_game_id);
    cached_fetch(
        &db,
        &key,
        cache::TTL_GAME_PROGRESS_SECS,
        force_refresh.unwrap_or(false),
        client::fetch_game_progress_json(&creds, ra_game_id),
        client::parse_game_progress,
    )
    .await
}

#[tauri::command]
pub async fn ra_get_profile_progress(
    app_handle: tauri::AppHandle,
    force_refresh: Option<bool>,
) -> Result<RaCached<RaProfileProgress>, String> {
    let db = app_handle.state::<MetadeaDb>();
    let creds = require_credentials(&db)?;
    let key = cache::profile_progress_key(&creds.username);
    cached_fetch(
        &db,
        &key,
        cache::TTL_PROFILE_PROGRESS_SECS,
        force_refresh.unwrap_or(false),
        client::fetch_profile_progress_json(&creds),
        client::parse_profile_progress,
    )
    .await
}

/// Unlocks of the last `minutes` (default 60). Never cached: it is only
/// asked right after a session ends.
#[tauri::command]
pub async fn ra_get_recent_unlocks(app_handle: tauri::AppHandle, minutes: Option<u32>) -> Result<Vec<RaRecentUnlock>, String> {
    let db = app_handle.state::<MetadeaDb>();
    let creds = require_credentials(&db)?;
    let body = client::fetch_recent_unlocks_json(&creds, minutes.unwrap_or(60).clamp(1, 60 * 24 * 7)).await?;
    client::parse_recent_unlocks(&body)
}

#[tauri::command]
pub async fn ra_get_consoles(app_handle: tauri::AppHandle) -> Result<RaCached<Vec<RaConsole>>, String> {
    let db = app_handle.state::<MetadeaDb>();
    let creds = require_credentials(&db)?;
    cached_fetch(
        &db,
        cache::CONSOLES_KEY,
        cache::TTL_CONSOLES_SECS,
        false,
        client::fetch_consoles_json(&creds),
        client::parse_consoles,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db_with_credentials(username: &str, api_key: &str) -> MetadeaDb {
        let db = MetadeaDb::open_in_memory().unwrap();
        {
            let conn = db.conn.lock().unwrap();
            for (name, value) in [(ENV_USERNAME, username), (ENV_API_KEY, api_key)] {
                conn.execute(
                    "INSERT INTO app_env (name, value, updated_at) VALUES (?1, ?2, '2026-01-01')",
                    rusqlite::params![name, value],
                )
                .unwrap();
            }
        }
        db
    }

    #[test]
    fn credentials_need_both_a_username_and_a_key() {
        assert!(credentials(&MetadeaDb::open_in_memory().unwrap()).unwrap().is_none());
        assert!(credentials(&db_with_credentials("nacho", "")).unwrap().is_none());
        let creds = credentials(&db_with_credentials(" nacho ", "key123")).unwrap().unwrap();
        assert_eq!((creds.username.as_str(), creds.api_key.as_str()), ("nacho", "key123"));
        let err = require_credentials(&MetadeaDb::open_in_memory().unwrap()).unwrap_err();
        assert_eq!(err, "E_RA_NOT_CONFIGURED");
    }

    #[test]
    fn credentials_written_encrypted_by_write_env_config_read_back() {
        let encrypted_user = crate::utils::encrypt_secret("nacho").unwrap();
        let encrypted_key = crate::utils::encrypt_secret("key123").unwrap();
        let creds = credentials(&db_with_credentials(&encrypted_user, &encrypted_key)).unwrap().unwrap();
        assert_eq!((creds.username.as_str(), creds.api_key.as_str()), ("nacho", "key123"));
    }

    #[test]
    fn console_lookup_prefers_igdb_then_falls_back_to_rom_platform() {
        assert_eq!(ra_console_for_platform(Some(20), None), Some(18));
        assert_eq!(ra_console_for_platform(None, Some("ps2".into())), Some(21));
        assert_eq!(ra_console_for_platform(Some(37), Some("gamecube".into())), Some(16));
        assert_eq!(ra_console_for_platform(Some(37), Some("3ds".into())), None);
        assert_eq!(ra_console_for_platform(None, None), None);
    }

    #[test]
    fn cached_fetch_serves_fresh_rows_refreshes_expired_ones_and_falls_back_when_offline() {
        tauri::async_runtime::block_on(cached_fetch_scenario());
    }

    async fn cached_fetch_scenario() {
        let db = MetadeaDb::open_in_memory().unwrap();
        let key = "test:key";
        // Nothing cached and the fetch fails: the error propagates.
        let err = cached_fetch(&db, key, 60, false, async { Err::<String, String>("E_RA_NETWORK".into()) }, parse_ok)
            .await
            .unwrap_err();
        assert_eq!(err, "E_RA_NETWORK");
        // A successful fetch is stored.
        let first = cached_fetch(&db, key, 60, false, async { Ok::<String, String>("\"one\"".into()) }, parse_ok).await.unwrap();
        assert_eq!((first.data.as_str(), first.from_cache, first.stale), ("one", false, false));
        // Fresh: the fetch is not even awaited.
        let second = cached_fetch(&db, key, 60, false, async { panic!("must not fetch") }, parse_ok).await.unwrap();
        assert_eq!((second.data.as_str(), second.from_cache, second.stale), ("one", true, false));
        // force=true bypasses a fresh row.
        let forced = cached_fetch(&db, key, 60, true, async { Ok::<String, String>("\"two\"".into()) }, parse_ok).await.unwrap();
        assert_eq!((forced.data.as_str(), forced.from_cache), ("two", false));
        // Expired (ttl 0) and offline: the old row comes back flagged stale.
        let stale = cached_fetch(&db, key, 0, false, async { Err::<String, String>("E_RA_NETWORK".into()) }, parse_ok).await.unwrap();
        assert_eq!((stale.data.as_str(), stale.from_cache, stale.stale), ("two", true, true));
    }

    fn parse_ok(body: &str) -> Result<String, String> {
        serde_json::from_str(body).map_err(|e| e.to_string())
    }

    #[cfg(not(rcheevos_vendored))]
    #[test]
    fn hash_lookup_reports_the_unavailable_code_without_the_vendored_hasher() {
        assert!(!hash::default_hasher().is_available());
        assert_eq!(hash::default_hasher().hash_rom("x.nds", 18), Err("E_RA_HASH_UNAVAILABLE".to_string()));
    }
}
