// Fixtures shared by the unit tests of every module (compiled for tests only).
use std::path::PathBuf;

/// A fresh, uniquely named folder under the system temp dir.
pub(crate) fn tempdir(tag: &str) -> PathBuf {
    let mut bytes = [0u8; 8];
    getrandom::getrandom(&mut bytes).unwrap();
    let dir = std::env::temp_dir().join(format!("metadea-test-{tag}-{}-{}", std::process::id(), u64::from_le_bytes(bytes)));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A fresh in-memory database with every migration, view and pragma applied.
pub(crate) fn db() -> crate::db::MetadeaDb {
    crate::db::MetadeaDb::open_in_memory().unwrap()
}

/// The single integer a `SELECT COUNT(*) …` (or similar) returns.
pub(crate) fn count(conn: &rusqlite::Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}
