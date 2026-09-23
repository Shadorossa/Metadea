// Comic Vine story-arc import (src/comicvine.rs): one cached answer per key
// (`arc:<id>`, `issue:<id>`, `issue-arcs:<id>`, `volume-arcs:<id>`). `json`
// is the serialized answer, `fetched_at` unix seconds (TTL 30 days).
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS comicvine_arc_cache (
            cache_key  TEXT PRIMARY KEY,
            json       TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        );",
    )
}
