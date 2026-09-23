// Skip-segment support for the built-in player (aniskip.rs):
// - media_catalog.mal_id: MyAnimeList id resolved through AniList once and
//   kept on the row, since AniSkip keys everything by MAL id.
// - aniskip_segments: cached AniSkip responses per (MAL id, episode,
//   episode-length bucket); `json` is the raw body, `fetched_at` unix secs.
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn add_mal_id_and_aniskip_cache(tx: &Transaction) -> SqlResult<()> {
    super::add_column(tx, "ALTER TABLE media_catalog ADD COLUMN mal_id INTEGER")?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS aniskip_segments (
            mal_id                INTEGER NOT NULL,
            episode               INTEGER NOT NULL,
            episode_length_bucket INTEGER NOT NULL,
            json                  TEXT NOT NULL,
            fetched_at            INTEGER NOT NULL,
            PRIMARY KEY (mal_id, episode, episode_length_bucket)
        );",
    )
}
