// Sakuga clips from Sakugabooru (src/sakuga):
// - sakuga_http_cache: raw response bodies keyed by the request path + query
//   (`tag.json?...`, `post.xml?...`, `tag/related.json?...`). `empty` marks a
//   negative answer (no tags, no posts), which expires sooner. The TTL is
//   applied when reading (tags 30 days, posts 7 days, negatives 7 days).
// - sakuga_resolutions: which Sakugabooru tag a Metadea entity maps to.
//   kind = 'artist' (key: staff id, e.g. person:a123) or 'series' (key: the
//   anime's external id). `tag` NULL = "confirmed: no tag" (kept 7 days).
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS sakuga_http_cache (
            request_key TEXT PRIMARY KEY,
            body        TEXT NOT NULL,
            empty       INTEGER NOT NULL DEFAULT 0,
            fetched_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sakuga_resolutions (
            kind        TEXT NOT NULL CHECK (kind IN ('artist', 'series')),
            entity_key  TEXT NOT NULL,
            tag         TEXT,
            tag_count   INTEGER NOT NULL DEFAULT 0,
            resolved_at INTEGER NOT NULL,
            PRIMARY KEY (kind, entity_key)
        );",
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn tables_exist_after_migrating() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        for table in ["sakuga_http_cache", "sakuga_resolutions"] {
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "{table}");
        }
        assert!(conn
            .execute("INSERT INTO sakuga_resolutions (kind, entity_key, resolved_at) VALUES ('bogus', 'x', 1)", [])
            .is_err());
    }
}
