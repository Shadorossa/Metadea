//! Game sessions owned by Rust (game_sessions.rs):
//! - game_sessions_log: one row per finished session that counted towards
//!   playtime (≥ 15 s, with a library id). Unix seconds. It backs
//!   `get_game_play_stats` (sessions count, last played, average session).
//!   Minutes still live in user_library.minutes_spent; this table only adds
//!   the per-session history.
//! - active_game_sessions: the in-memory registry mirrored to disk, so a
//!   Metadea restart mid-game can re-attach to the still-running process or
//!   close the session at its last heartbeat. `pids` is a comma-separated
//!   list; `running` is 0 until the game's process was actually seen;
//!   `paused_seconds` / `paused_since` track the pause menu's suspends (unix
//!   seconds), so the break reminder never counts paused time.
//! - game_break_settings: one row (id = 1), the break reminder interval in
//!   minutes (0 = off) and the clock alerts as JSON
//!   (`[{"time":"23:00","weekdaysOnly":false}]`), read by Rust's scheduler
//!   (game_break_reminder.rs).
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS game_sessions_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            external_id TEXT    NOT NULL,
            started_at  INTEGER NOT NULL,
            ended_at    INTEGER NOT NULL,
            seconds     INTEGER NOT NULL,
            platform    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_game_sessions_log_external
            ON game_sessions_log(external_id, ended_at);
        CREATE TABLE IF NOT EXISTS active_game_sessions (
            session_id          TEXT    PRIMARY KEY,
            external_id         TEXT    NOT NULL DEFAULT '',
            title               TEXT    NOT NULL DEFAULT '',
            cover_url           TEXT,
            platform            TEXT,
            launcher            TEXT    NOT NULL DEFAULT '',
            app_id              TEXT,
            install_path        TEXT,
            exe_path            TEXT,
            pids                TEXT    NOT NULL DEFAULT '',
            started_unix        INTEGER NOT NULL,
            last_heartbeat_unix INTEGER NOT NULL,
            running             INTEGER NOT NULL DEFAULT 0,
            paused_seconds      INTEGER NOT NULL DEFAULT 0,
            paused_since        INTEGER
        );
        CREATE TABLE IF NOT EXISTS game_break_settings (
            id               INTEGER PRIMARY KEY CHECK (id = 1),
            interval_minutes INTEGER NOT NULL DEFAULT 0,
            clock_alerts     TEXT    NOT NULL DEFAULT '[]'
        );",
    )
}
