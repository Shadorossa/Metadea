// Company pages (src/company_catalog): one cached provider response per
// company page id (`igdb:70`, `anilist-studio:11`, ...). `json` is the
// render-ready page plus its paging cursor, `fetched_at` unix seconds
// (TTL 7 days, stale-while-revalidate).
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS company_cache (
            provider_id TEXT PRIMARY KEY,
            json        TEXT NOT NULL,
            fetched_at  INTEGER NOT NULL
        );",
    )
}
