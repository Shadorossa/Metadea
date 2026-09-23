// Ambient TV mode's wallpapers (src/wallpapers.rs): one resolved landscape
// image per work id (`movie:603`, `game:1942`, `anime:21`, ...). `url`/`kind`
// are NULL for a known "no wallpaper" answer (negative cache, 7 days); hits
// live 30 days. `kind` is `backdrop` | `artwork` | `screenshot` | `banner`.
// `fetched_at` unix seconds.
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS wallpaper_cache (
            external_id TEXT PRIMARY KEY,
            url         TEXT,
            kind        TEXT,
            fetched_at  INTEGER NOT NULL
        );",
    )
}
