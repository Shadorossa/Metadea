// Migrations that repair a schema an earlier version left behind: a
// column the base schema had but no migration added, and a table a
// migration edited in place after release. Bodies are unchanged from when
// they lived in mod.rs: installs have already run them.
use rusqlite::{Result as SqlResult, Transaction};

use super::add_column;

pub(super) fn add_missing_custom_color(tx: &Transaction) -> SqlResult<()> {
    // custom_color has been part of the base (fresh-install) schema for
    // a long time, but never had a matching migration here — any
    // database created before it was added is missing this column
    // entirely. get_user_info's SELECT names it explicitly, so on those
    // databases *every* call failed outright with "no such column:
    // custom_color" — silently swallowed by the frontend's tauriTry
    // fallback into `{}`, making bio/display_name/font/theme/
    // rating_system all silently read back as their hardcoded JS
    // defaults on every load, even though save_user_info was writing
    // the real values correctly the whole time. A fresh database already
    // has this column, so "duplicate column" here is expected and harmless.
    add_column(tx, "ALTER TABLE user_profile ADD COLUMN custom_color TEXT NOT NULL DEFAULT '#c084fc'")
}

pub(super) fn recreate_media_theme_with_slug(tx: &Transaction) -> SqlResult<()> {
    // Migration 56 (m56 in mod.rs) was edited in place (to switch the
    // primary key from (external_id, theme_type, sequence) to (external_id, slug))
    // after some installs had already run it — CREATE TABLE IF NOT
    // EXISTS is a no-op against a table that already exists with the
    // OLD (slug-less) schema, so those installs got stuck on it,
    // failing every save with "no column named slug". Pure cache data
    // (fully re-fetched from animethemes.moe on the next visit to any
    // anime's "Temas" tab, same as media_episode), so dropping and
    // recreating loses nothing that matters.
    tx.execute_batch(
        "DROP TABLE IF EXISTS media_theme;
         CREATE TABLE media_theme (
            external_id  TEXT NOT NULL,
            slug         TEXT NOT NULL,
            theme_type   TEXT NOT NULL,
            sequence     INTEGER NOT NULL,
            song_title   TEXT,
            artists      TEXT,
            episodes     TEXT,
            video_url    TEXT,
            PRIMARY KEY (external_id, slug)
         );",
    )
}
