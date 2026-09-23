//! Consistent copy of the live SQLite database.
//!
//! `VACUUM INTO` runs inside a read transaction on its own connection, so the
//! output is one consistent state of the database even while the app keeps
//! writing through the WAL — unlike copying `metadea.db` + `-wal` by hand.

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::path::Path;
use std::time::Duration;

pub fn snapshot_database(live_db: &Path, destination: &Path) -> Result<(), String> {
    use crate::error_codes::{with_detail, BACKUP_SNAPSHOT};
    if !live_db.is_file() {
        return Err(with_detail(BACKUP_SNAPSHOT, "database file missing"));
    }
    if destination.exists() {
        std::fs::remove_file(destination).map_err(|e| with_detail(BACKUP_SNAPSHOT, e))?;
    }
    let conn = Connection::open_with_flags(live_db, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| with_detail(BACKUP_SNAPSHOT, e))?;
    conn.busy_timeout(Duration::from_secs(15)).map_err(|e| with_detail(BACKUP_SNAPSHOT, e))?;
    conn.execute("VACUUM INTO ?1", [destination.to_string_lossy().as_ref()])
        .map_err(|e| with_detail(BACKUP_SNAPSHOT, e))?;
    Ok(())
}

/// Highest applied migration of the database at `path` (0 for a database
/// without the `schema_migrations` table).
pub fn schema_version_of(path: &Path) -> Result<i64, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::BACKUP_DB_INVALID, e))?;
    let has_table: Option<String> = conn
        .query_row("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'", [], |r| r.get(0))
        .optional()
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::BACKUP_DB_INVALID, e))?;
    if has_table.is_none() {
        return Ok(0);
    }
    Ok(crate::db::current_schema_version(&conn))
}

/// `PRAGMA quick_check` on a staged database before it replaces the live one.
pub fn check_integrity(path: &Path) -> Result<(), String> {
    use crate::error_codes::{with_detail, BACKUP_DB_INVALID};
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| with_detail(BACKUP_DB_INVALID, e))?;
    let result: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|e| with_detail(BACKUP_DB_INVALID, e))?;
    if result == "ok" {
        Ok(())
    } else {
        Err(with_detail(BACKUP_DB_INVALID, result))
    }
}

/// The newest schema this build can open (see `migrations::MIGRATIONS`).
pub fn supported_schema_version() -> i64 {
    crate::migrations::MIGRATIONS.iter().map(|(version, _)| *version).max().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::archive::sha256_file;

    fn live_db(dir: &Path) -> std::path::PathBuf {
        let path = dir.join("metadea.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations VALUES (1), (7);
             CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
             INSERT INTO notes (body) VALUES ('a'), ('b');",
        )
        .unwrap();
        // Kept open so part of the data only lives in the WAL.
        std::mem::forget(conn);
        path
    }

    #[test]
    fn snapshot_is_consistent_and_stable() {
        let dir = crate::backup::layout::tempdir("snapshot");
        let db = live_db(&dir);
        let first = dir.join("snap1.db");
        let second = dir.join("snap2.db");
        snapshot_database(&db, &first).unwrap();
        snapshot_database(&db, &second).unwrap();
        assert_eq!(schema_version_of(&first).unwrap(), 7);
        check_integrity(&first).unwrap();
        let conn = Connection::open(&first).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);
        // The scheduled Drive upload skips unchanged data by this hash.
        assert_eq!(sha256_file(&first).unwrap(), sha256_file(&second).unwrap());
    }

    #[test]
    fn supported_schema_is_the_last_migration() {
        assert!(supported_schema_version() >= 81);
    }
}
