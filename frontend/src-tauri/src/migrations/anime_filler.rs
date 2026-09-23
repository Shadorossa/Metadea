// Anime filler lists from AnimeFillerList.com (src/anime_filler):
// - filler_shows: the site's show index (slug + title) plus, per show, when
//   its page was last fetched (`fetched_at`, NULL = never), whether it looks
//   like it's still airing, and the last failed attempt (`failed_at`).
//   `in_index` = 0 for a show no longer listed (kept for existing links).
// - filler_episodes: one row per episode in the show's absolute numbering;
//   kind is manga_canon | anime_canon | filler | mixed.
// - filler_links: catalog entry → show slug, the absolute number of the
//   entry's first episode minus one (`episode_offset`), the match
//   confidence and whether the user picked it (`manual`).
// - filler_meta: key/value (unix secs) — the day-long backoff after a
//   403/429 and when the index was last fetched.
// - user_library.skip_filler: the per-entry "Filler: Watched / Skipped"
//   choice (0 = watched, the default).
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS filler_shows (
            slug       TEXT PRIMARY KEY,
            title      TEXT NOT NULL,
            in_index   INTEGER NOT NULL DEFAULT 1,
            fetched_at INTEGER,
            is_airing  INTEGER NOT NULL DEFAULT 0,
            failed_at  INTEGER
        );
        CREATE TABLE IF NOT EXISTS filler_episodes (
            slug            TEXT NOT NULL,
            absolute_number INTEGER NOT NULL,
            kind            TEXT NOT NULL CHECK (kind IN ('manga_canon', 'anime_canon', 'filler', 'mixed')),
            PRIMARY KEY (slug, absolute_number)
        );
        CREATE TABLE IF NOT EXISTS filler_links (
            media_external_id TEXT PRIMARY KEY,
            slug              TEXT NOT NULL,
            episode_offset    INTEGER NOT NULL DEFAULT 0,
            confidence        REAL NOT NULL DEFAULT 0,
            manual            INTEGER NOT NULL DEFAULT 0,
            updated_at        INTEGER
        );
        CREATE TABLE IF NOT EXISTS filler_meta (
            key   TEXT PRIMARY KEY,
            value INTEGER NOT NULL
        );",
    )?;
    super::add_column(tx, "ALTER TABLE user_library ADD COLUMN skip_filler INTEGER NOT NULL DEFAULT 0")
}

#[cfg(test)]
mod tests {
    #[test]
    fn tables_and_column_exist_after_migrating() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        for table in ["filler_shows", "filler_episodes", "filler_links", "filler_meta"] {
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "{table}");
        }
        conn.execute("INSERT INTO user_library (external_id, type, user_id) VALUES ('anime:1', 'anime', 'local')", []).unwrap();
        let skip: i64 = conn.query_row("SELECT skip_filler FROM user_library", [], |r| r.get(0)).unwrap();
        assert_eq!(skip, 0);
        assert!(conn
            .execute("INSERT INTO filler_episodes (slug, absolute_number, kind) VALUES ('x', 1, 'bogus')", [])
            .is_err());
    }
}
