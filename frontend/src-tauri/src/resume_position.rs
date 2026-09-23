// Where the built-in player's position was last seen for an episode that
// hasn't been marked watched yet — lets "Reproducir" reopen it at that
// second instead of always starting an episode over from 0. Persisted (see
// migration 43) so it survives closing the app, not just the player.
use crate::db::ToStringErr;
use rusqlite::OptionalExtension;

#[tauri::command]
pub async fn get_resume_position(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
) -> Result<Option<f64>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        "SELECT position_seconds FROM episode_resume_position WHERE external_id = ?1 AND episode_number = ?2",
        rusqlite::params![external_id, episode_number],
        |r| r.get(0),
    )
    .optional()
    .str_err()
}

#[tauri::command]
pub async fn save_resume_position(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
    position_seconds: f64,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO episode_resume_position (external_id, episode_number, position_seconds, updated_at)
         VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
         ON CONFLICT(external_id, episode_number) DO UPDATE SET position_seconds = ?3, updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![external_id, episode_number, position_seconds],
    ).str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn clear_resume_position(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "DELETE FROM episode_resume_position WHERE external_id = ?1 AND episode_number = ?2",
        rusqlite::params![external_id, episode_number],
    ).str_err()?;
    Ok(())
}
