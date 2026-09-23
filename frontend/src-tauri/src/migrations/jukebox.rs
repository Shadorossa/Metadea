//! Jukebox favourites (media_themes.rs, `get_favorite_themes` & co.):
//! - favorite_themes: the user's starred openings/endings, one row per
//!   (external_id, slug) of media_theme, in the order the queue plays them
//!   (`position`, dense from 0). `added_at` is unix seconds, kept so a
//!   "recently starred" sort is possible later without another migration.
//!   Not a foreign key on purpose: media_theme is a cache that
//!   save_media_themes drops and re-fills, and a star must survive that.
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS favorite_themes (
            external_id TEXT    NOT NULL,
            slug        TEXT    NOT NULL,
            position    INTEGER NOT NULL DEFAULT 0,
            added_at    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (external_id, slug)
        );
        CREATE INDEX IF NOT EXISTS idx_favorite_themes_position ON favorite_themes(position);",
    )
}
