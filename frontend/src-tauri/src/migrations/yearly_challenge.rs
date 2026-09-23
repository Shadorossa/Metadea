//! Yearly challenge (yearly_challenge.rs, profile "Challenge {year}" tab):
//! - yearly_goals: per (year, media_type) target count of completions.
//!   `count_reconsumption` = 1 counts re-watches/re-reads/replays (the
//!   `complete` events in user_activity with occurrence 2+) toward the goal; 0
//!   counts only first completions (user_library.finished_at).
//! - yearly_resolutions: the "must consume this year" list, one row per work
//!   in display order (`position`, dense from 0; `added_at` unix seconds).
//!   Not a foreign key: a work needn't be in the library (or even cached in
//!   media_catalog) to be a resolution.
//! - yearly_resolution_settings: the list's chosen size (1..=100) and
//!   `locked_at`, the last local date (YYYY-MM-DD) the list can be edited on,
//!   written with every save (kept for reference; the window itself is enforced
//!   from the local date by yearly_challenge.rs).
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS yearly_goals (
            year                INTEGER NOT NULL,
            media_type          TEXT    NOT NULL,
            target              INTEGER NOT NULL,
            count_reconsumption INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (year, media_type)
        );
        CREATE TABLE IF NOT EXISTS yearly_resolutions (
            year        INTEGER NOT NULL,
            external_id TEXT    NOT NULL,
            position    INTEGER NOT NULL DEFAULT 0,
            added_at    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (year, external_id)
        );
        CREATE TABLE IF NOT EXISTS yearly_resolution_settings (
            year      INTEGER PRIMARY KEY,
            size      INTEGER NOT NULL,
            locked_at TEXT
        );",
    )
}
