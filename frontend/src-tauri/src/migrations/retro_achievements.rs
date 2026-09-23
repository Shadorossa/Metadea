//! RetroAchievements tables: the per-entry game link and the response cache
//! (see src/retro_achievements). `create_tables` is idempotent so the unit
//! tests of that module can build them on a bare in-memory connection.

use rusqlite::{Connection, Result as SqlResult, Transaction};

pub(crate) fn create_tables(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS retro_achievements_links (
            external_id TEXT PRIMARY KEY,
            ra_game_id  INTEGER NOT NULL,
            matched_by  TEXT NOT NULL CHECK(matched_by IN ('hash','name','manual')),
            rom_hash    TEXT,
            updated_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_retro_achievements_links_game ON retro_achievements_links(ra_game_id);
        CREATE TABLE IF NOT EXISTS retro_achievements_cache (
            key        TEXT PRIMARY KEY,
            json       TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        );",
    )
}

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    create_tables(tx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_both_tables_and_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        create_tables(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('retro_achievements_links', 'retro_achievements_cache')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }
}
