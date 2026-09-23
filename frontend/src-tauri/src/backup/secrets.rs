//! Saved credentials are DPAPI-encrypted for the Windows user that saved
//! them (`utils::encrypt_secret`). A backup restored on another machine or
//! account carries blobs this user cannot decrypt, and the plaintext
//! fallback for pre-encryption rows would otherwise hand them to the APIs as
//! if they were keys. Before a restore is activated, such values are cleared
//! so the user simply reconnects those accounts.

use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

/// DPAPI blob header: `dwVersion = 1` followed by the provider GUID
/// {df9d8cd0-1501-11d1-8c7a-00c04fc297eb} in little-endian layout.
#[cfg(target_os = "windows")]
const DPAPI_HEADER: &[u8] = &[
    0x01, 0x00, 0x00, 0x00, 0xd0, 0x8c, 0x9d, 0xdf, 0x01, 0x15, 0xd1, 0x11, 0x8c, 0x7a, 0x00, 0xc0, 0x4f, 0xc2, 0x97, 0xeb,
];

/// True for a stored value that is an encrypted secret this user cannot
/// decrypt. Legacy plaintext values are never "foreign".
pub fn is_foreign_secret(stored: &str) -> bool {
    if stored.is_empty() || crate::utils::decrypt_secret(stored).is_ok() {
        return false;
    }
    looks_encrypted(stored)
}

#[cfg(target_os = "windows")]
fn looks_encrypted(stored: &str) -> bool {
    crate::utils::base64_decode(stored).is_ok_and(|bytes| bytes.starts_with(DPAPI_HEADER))
}

// Off Windows secrets are only base64, which always decodes.
#[cfg(not(target_os = "windows"))]
fn looks_encrypted(_stored: &str) -> bool {
    false
}

fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |_| Ok(()))
        .optional()
        .map(|found| found.is_some())
}

/// Clears undecryptable API keys (`app_env`) and drops undecryptable sessions
/// (`user_sessions`) in the staged database. Returns how many were cleared.
pub fn clear_foreign_secrets(db_path: &Path) -> Result<u32, String> {
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut cleared = 0u32;
    if table_exists(&tx, "app_env").map_err(|e| e.to_string())? {
        let rows: Vec<(String, String)> = {
            let mut stmt = tx.prepare("SELECT name, value FROM app_env WHERE value != ''").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        for (name, value) in rows {
            if is_foreign_secret(&value) {
                tx.execute("UPDATE app_env SET value = '' WHERE name = ?1", params![name]).map_err(|e| e.to_string())?;
                cleared += 1;
            }
        }
    }
    if table_exists(&tx, "user_sessions").map_err(|e| e.to_string())? {
        let rows: Vec<(String, String)> = {
            let mut stmt = tx.prepare("SELECT service, token FROM user_sessions").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        for (service, token) in rows {
            if is_foreign_secret(&token) {
                tx.execute("DELETE FROM user_sessions WHERE service = ?1", params![service]).map_err(|e| e.to_string())?;
                cleared += 1;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(cleared)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_own_and_plaintext_values() {
        let own = crate::utils::encrypt_secret("key").unwrap();
        assert!(!is_foreign_secret(&own));
        assert!(!is_foreign_secret("plain-api-key"));
        assert!(!is_foreign_secret(""));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn clears_blobs_from_another_machine() {
        let mut foreign = DPAPI_HEADER.to_vec();
        foreign.extend_from_slice(&[0x42; 64]);
        let foreign = crate::utils::base64_encode(&foreign);
        assert!(is_foreign_secret(&foreign));

        let dir = crate::backup::layout::tempdir("secrets");
        let db = dir.join("metadea.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE app_env (name TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
             CREATE TABLE user_sessions (service TEXT PRIMARY KEY, token TEXT NOT NULL DEFAULT '');",
        )
        .unwrap();
        let own = crate::utils::encrypt_secret("mine").unwrap();
        conn.execute("INSERT INTO app_env VALUES ('steam_api_key', ?1), ('tmdb_api_key', ?2), ('ra_username', 'nacho')", params![foreign, own]).unwrap();
        conn.execute("INSERT INTO user_sessions VALUES ('mal', ?1), ('github', ?2)", params![foreign, own]).unwrap();
        drop(conn);

        assert_eq!(clear_foreign_secrets(&db).unwrap(), 2);
        let conn = Connection::open(&db).unwrap();
        let steam: String = conn.query_row("SELECT value FROM app_env WHERE name = 'steam_api_key'", [], |r| r.get(0)).unwrap();
        let tmdb: String = conn.query_row("SELECT value FROM app_env WHERE name = 'tmdb_api_key'", [], |r| r.get(0)).unwrap();
        let sessions: i64 = conn.query_row("SELECT COUNT(*) FROM user_sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(steam, "");
        assert_eq!(tmdb, own);
        assert_eq!(sessions, 1);
        drop(conn);
        let _ = std::fs::remove_dir_all(dir);
    }
}
