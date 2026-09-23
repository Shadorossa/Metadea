//! Yearly Bingo replaces the "Challenge {year}" tab (migration 79's goals +
//! resolutions, and the social_* mirrors migration 80 added for visited
//! profiles) — those tables are dropped with their rows.
//! - yearly_bingo: one board per year (yearly_bingo.rs). `items` is a JSON
//!   array of 1–49 cells (its length is the board's size, 16 by default),
//!   in grid order, each null (empty) or a snapshot
//!   {external_id, title, cover_url, media_type} taken when the work was
//!   picked. Not a foreign key: a work needn't be in the library (or even
//!   cached in media_catalog). The edit lock (Jan 10 of `year`, local date)
//!   is computed, not stored. created_at / updated_at are unix seconds.
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "DROP TABLE IF EXISTS yearly_goals;
        DROP TABLE IF EXISTS yearly_resolutions;
        DROP TABLE IF EXISTS yearly_resolution_settings;
        DROP TABLE IF EXISTS social_yearly_goals;
        DROP TABLE IF EXISTS social_yearly_resolutions;
        DROP TABLE IF EXISTS social_yearly_resolution_settings;
        CREATE TABLE IF NOT EXISTS yearly_bingo (
            year       INTEGER PRIMARY KEY,
            items      TEXT    NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    )
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn drops_the_challenge_tables_and_creates_the_board_table() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE yearly_goals (year INTEGER, media_type TEXT, target INTEGER);
            INSERT INTO yearly_goals VALUES (2026, 'book', 12);
            CREATE TABLE social_yearly_resolutions (social_user_id TEXT, year INTEGER, external_id TEXT);",
        )
        .unwrap();
        let tx = conn.transaction().unwrap();
        super::migrate(&tx).unwrap();
        tx.commit().unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(tables, vec!["yearly_bingo".to_string()]);
    }
}
