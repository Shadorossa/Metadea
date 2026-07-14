use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EpisodeHistoryEntry {
    pub id:             String,
    pub external_id:    String,
    pub episode_number: f64,
    pub watched_at:     String,
}

// Cap per fetch — this feeds a "recently watched" feed, not a full-history
// export, so there's no reason to ever pull the whole table across IPC.
const HISTORY_LIMIT: i64 = 30;

#[tauri::command]
pub async fn save_episode_history_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO episode_history (external_id, episode_number) VALUES (?1, ?2)",
        rusqlite::params![external_id, episode_number],
    ).str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn get_episode_history(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Vec<EpisodeHistoryEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT id, external_id, episode_number, watched_at
         FROM episode_history
         WHERE external_id = ?1
         ORDER BY watched_at DESC
         LIMIT ?2"
    ).str_err()?;
    let rows = stmt.query_map(rusqlite::params![external_id, HISTORY_LIMIT], |r| {
        Ok(EpisodeHistoryEntry {
            id:             r.get(0)?,
            external_id:    r.get(1)?,
            episode_number: r.get(2)?,
            watched_at:     r.get(3)?,
        })
    }).str_err()?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}
