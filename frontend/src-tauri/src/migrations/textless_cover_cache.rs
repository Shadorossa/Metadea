// "Prefer clean (textless) covers" (src/textless_covers.rs): one resolved
// answer per work id (`movie:603`, `game:1942`, ...). `url`/`kind` are NULL
// for a known "no textless version" answer (negative cache); `kind` is
// `poster` or `art` (key art the cards center-crop). `fetched_at` unix
// seconds, TTL 30 days.
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS textless_cover_cache (
            external_id TEXT PRIMARY KEY,
            url         TEXT,
            kind        TEXT,
            fetched_at  INTEGER NOT NULL
        );",
    )
}
