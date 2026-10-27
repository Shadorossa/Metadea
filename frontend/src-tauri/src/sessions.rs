// Tokens kept in `user_sessions` (one row per service: 'anilist', 'github',
// 'app_auth', MAL's OAuth tokens). Every service used to carry its own copy
// of these three queries, and the copies drifted: AniList and GitHub read
// with the strict `decrypt_secret`, so a token saved in plaintext before
// v0.5.5 started encrypting failed every read instead of being upgraded on
// the next save like app_auth's.
use rusqlite::{Connection, OptionalExtension};

use crate::db::ToStringErr;

/// Encrypts and upserts `token` (and `username`, when given) for `service`.
pub(crate) fn save_session_token(conn: &Connection, service: &str, token: &str, username: Option<&str>) -> Result<(), String> {
    let encrypted = crate::utils::encrypt_secret(token)?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO user_sessions (service, token, username, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(service) DO UPDATE SET
             token = excluded.token,
             username = COALESCE(excluded.username, user_sessions.username),
             updated_at = excluded.updated_at",
        rusqlite::params![service, encrypted, username, now],
    )
    .map(|_| ())
    .str_err()
}

/// The decrypted token and stored username for `service`. Rows written
/// before tokens were encrypted are plaintext and are returned as-is.
pub(crate) fn load_session_token(conn: &Connection, service: &str) -> Result<Option<(String, Option<String>)>, String> {
    conn.query_row(
        "SELECT token, username FROM user_sessions WHERE service = ?1",
        [service],
        |row| Ok((crate::utils::decrypt_secret_or_plaintext(&row.get::<_, String>(0)?), row.get(1)?)),
    )
    .optional()
    .str_err()
}

pub(crate) fn delete_session_token(conn: &Connection, service: &str) -> Result<(), String> {
    conn.execute("DELETE FROM user_sessions WHERE service = ?1", [service])
        .map(|_| ())
        .str_err()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_upgrades_plaintext_and_keeps_the_username() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();

        save_session_token(&conn, "app_auth", "secret", Some("nacho")).unwrap();
        let stored: String = conn.query_row("SELECT token FROM user_sessions WHERE service = 'app_auth'", [], |r| r.get(0)).unwrap();
        assert_ne!(stored, "secret");
        assert_eq!(load_session_token(&conn, "app_auth").unwrap(), Some(("secret".into(), Some("nacho".into()))));

        // A save without a username keeps the stored one.
        save_session_token(&conn, "app_auth", "rotated", None).unwrap();
        assert_eq!(load_session_token(&conn, "app_auth").unwrap(), Some(("rotated".into(), Some("nacho".into()))));

        // Pre-v0.5.5 plaintext row.
        conn.execute("INSERT INTO user_sessions (service, token, updated_at) VALUES ('github', 'gho_plain', 'x')", []).unwrap();
        assert_eq!(load_session_token(&conn, "github").unwrap(), Some(("gho_plain".into(), None)));

        delete_session_token(&conn, "github").unwrap();
        assert_eq!(load_session_token(&conn, "github").unwrap(), None);
    }
}
