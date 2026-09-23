// "How long to beat" (src/time_to_beat): one row per `game:<id>` /
// `vnovel:<id>`. Lengths in seconds (main story / main + extras /
// completionist), `length_bucket` VNDB's 1–5 estimate when it has no
// minutes, `source` igdb | vndb, `fetched_at` unix seconds. A row with every
// length NULL is a cached "nothing known" (TTL 7 days; data 30 days).
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS time_to_beat_cache (
            external_id           TEXT PRIMARY KEY,
            main_seconds          INTEGER,
            extra_seconds         INTEGER,
            completionist_seconds INTEGER,
            votes                 INTEGER,
            length_bucket         INTEGER,
            source                TEXT NOT NULL,
            fetched_at            INTEGER NOT NULL
        );",
    )
}
