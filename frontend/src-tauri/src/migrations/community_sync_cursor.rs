// Cursor of the last community catalog download that sync_community_catalog
// (community_sync.rs) merged: the HTTP validators sent back as
// If-None-Match/If-Modified-Since on the next launch, and the file's SHA-256
// so an identical download is never merged again. One row (id = 1); no row
// means "never merged", so the next sync downloads and merges in full.
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS community_sync_cursor (
            id             INTEGER PRIMARY KEY CHECK (id = 1),
            etag           TEXT,
            last_modified  TEXT,
            content_sha256 TEXT NOT NULL,
            synced_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );",
    )
}
