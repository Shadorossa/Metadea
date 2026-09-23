// MyAnimeList list sync (src/mal): the import matches the user's MAL list
// against catalog rows by `media_catalog.mal_id` (added by migration 70 for
// AniSkip) before asking AniList, so that column needs an index — 1000-row
// list pages would otherwise scan the whole catalog per chunk.
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch("CREATE INDEX IF NOT EXISTS idx_media_catalog_mal_id ON media_catalog(mal_id);")
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn creates_the_mal_id_index_once() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::ensure_base_schema(&conn).unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        super::super::aniskip::add_mal_id_and_aniskip_cache(&tx).unwrap();
        super::migrate(&tx).unwrap();
        super::migrate(&tx).unwrap();
        let count: i64 = tx
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_media_catalog_mal_id'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
