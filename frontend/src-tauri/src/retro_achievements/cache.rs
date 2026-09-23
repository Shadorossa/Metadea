//! SQLite-backed response cache for the RetroAchievements client. Every
//! remote read goes through here so the panel keeps working offline: a
//! fresh row is served as-is, an expired one is refreshed but still returned
//! when the refresh fails (the UI shows it as cached), and a missing one is
//! "unavailable".

use rusqlite::{Connection, OptionalExtension};

pub const TTL_GAME_PROGRESS_SECS: i64 = 10 * 60;
pub const TTL_PROFILE_PROGRESS_SECS: i64 = 10 * 60;
pub const TTL_HASH_LOOKUP_SECS: i64 = 24 * 60 * 60;
pub const TTL_GAME_LIST_SECS: i64 = 24 * 60 * 60;
pub const TTL_CONSOLES_SECS: i64 = 30 * 24 * 60 * 60;

pub struct CachedRow {
    pub json: String,
    pub fetched_at: i64,
    pub fresh: bool,
}

pub fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

/// The row for `key`, if any, flagged fresh when it is younger than `ttl_secs`.
pub fn read(conn: &Connection, key: &str, ttl_secs: i64, now: i64) -> rusqlite::Result<Option<CachedRow>> {
    conn.query_row(
        "SELECT json, fetched_at FROM retro_achievements_cache WHERE key = ?1",
        [key],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
    )
    .optional()
    .map(|row| row.map(|(json, fetched_at)| CachedRow { fresh: now - fetched_at < ttl_secs, json, fetched_at }))
}

pub fn write(conn: &Connection, key: &str, json: &str, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO retro_achievements_cache (key, json, fetched_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
        rusqlite::params![key, json, now],
    )?;
    Ok(())
}

pub fn game_progress_key(username: &str, game_id: u32) -> String {
    format!("game_progress:{}:{game_id}", username.to_lowercase())
}

pub fn profile_progress_key(username: &str) -> String {
    format!("profile_progress:{}", username.to_lowercase())
}

pub fn game_list_key(console_id: u32) -> String {
    format!("game_list:{console_id}")
}

pub fn hash_lookup_key(hash: &str) -> String {
    format!("hash:{}", hash.to_lowercase())
}

pub const CONSOLES_KEY: &str = "consoles";

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::migrations::retro_achievements::create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn a_missing_key_reads_as_none() {
        assert!(read(&conn(), "game_progress:x:1", TTL_GAME_PROGRESS_SECS, 1_000).unwrap().is_none());
    }

    #[test]
    fn a_row_is_fresh_within_its_ttl_and_stale_after() {
        let conn = conn();
        write(&conn, "k", "{}", 1_000).unwrap();
        let fresh = read(&conn, "k", 600, 1_000 + 599).unwrap().unwrap();
        assert!(fresh.fresh);
        assert_eq!(fresh.json, "{}");
        assert_eq!(fresh.fetched_at, 1_000);
        let stale = read(&conn, "k", 600, 1_000 + 600).unwrap().unwrap();
        assert!(!stale.fresh, "an expired row is still returned, only flagged stale");
    }

    #[test]
    fn writing_the_same_key_replaces_the_row() {
        let conn = conn();
        write(&conn, "k", "1", 10).unwrap();
        write(&conn, "k", "2", 20).unwrap();
        let row = read(&conn, "k", 60, 25).unwrap().unwrap();
        assert_eq!((row.json.as_str(), row.fetched_at), ("2", 20));
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM retro_achievements_cache", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn keys_are_case_insensitive_on_username_and_hash() {
        assert_eq!(game_progress_key("Nacho", 5), game_progress_key("nacho", 5));
        assert_eq!(hash_lookup_key("ABCDEF"), "hash:abcdef");
    }
}
