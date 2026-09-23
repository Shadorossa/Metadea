//! Home's "Continue watching" card (player/continue_frame.rs,
//! continue_watching.rs):
//! - continue_watching_frame: where the built-in player last stopped in an
//!   episode — position, duration and the path of the video frame captured
//!   there (NULL when the capture failed). One row per (external_id,
//!   episode_number), overwritten on every stop; kept apart from
//!   episode_resume_position because that row is deleted once the episode
//!   is marked watched, while the card still wants the last session.
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS continue_watching_frame (
            external_id      TEXT NOT NULL,
            episode_number   REAL NOT NULL,
            frame_path       TEXT,
            position_seconds REAL NOT NULL DEFAULT 0,
            duration_seconds REAL NOT NULL DEFAULT 0,
            updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (external_id, episode_number)
        );
        CREATE INDEX IF NOT EXISTS idx_continue_watching_frame_updated ON continue_watching_frame(updated_at);",
    )
}
