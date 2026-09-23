//! Reconsumption counter ("rewatch / reread / replay", user_library.rs):
//! - user_library.reconsumption_count: how many times the work was finished
//!   AGAIN after its first completion (0 = only ever finished once, or not
//!   yet). The first run's started_at/finished_at are never rewritten by a
//!   later run.
//! - user_library.reconsuming: 1 while a re-run is in progress (status is
//!   back to watching/reading/playing and progress counts the new run from
//!   0); flips to 0 and bumps reconsumption_count when the work is completed
//!   again.
//! - user_activity.occurrence: which completion a `complete` event is — 1 for
//!   the first finish, 2 for the first rewatch, ... NULL on rows written
//!   before this migration means "the first one".
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    super::add_column(tx, "ALTER TABLE user_library ADD COLUMN reconsumption_count INTEGER NOT NULL DEFAULT 0")?;
    super::add_column(tx, "ALTER TABLE user_library ADD COLUMN reconsuming INTEGER NOT NULL DEFAULT 0")?;
    super::add_column(tx, "ALTER TABLE user_activity ADD COLUMN occurrence INTEGER")
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn column_names(conn: &Connection, table: &str) -> Vec<String> {
        conn.prepare(&format!("PRAGMA table_info({table})")).unwrap()
            .query_map([], |r| r.get::<_, String>(1)).unwrap()
            .flatten()
            .collect()
    }

    #[test]
    fn adds_the_reconsumption_columns_with_zero_defaults() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::ensure_base_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO user_library (id, external_id, type, user_id) VALUES ('x', 'anime:1', 'anime', 'local')",
            [],
        ).unwrap();
        super::super::run_migrations(&conn).unwrap();

        let cols = column_names(&conn, "user_library");
        assert!(cols.iter().any(|c| c == "reconsumption_count"), "{cols:?}");
        assert!(cols.iter().any(|c| c == "reconsuming"), "{cols:?}");
        assert!(column_names(&conn, "user_activity").iter().any(|c| c == "occurrence"));

        let (count, reconsuming): (i64, i64) = conn.query_row(
            "SELECT reconsumption_count, reconsuming FROM user_library WHERE external_id = 'anime:1'",
            [], |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!((count, reconsuming), (0, 0), "pre-existing rows read as never re-consumed");

        // Re-running is a no-op (add_column swallows the duplicate).
        super::super::run_migrations(&conn).unwrap();
    }
}
