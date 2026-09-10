// Where the in-app reader (comic_reader.rs) last left off inside one
// issue/chapter/volume file — same "resume position" idea as
// resume_position.rs's VLC seconds, just a page number instead. See db.rs
// migration 52's own comment for the table shape.
use crate::db::ToStringErr;
use rusqlite::OptionalExtension;
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct ReadingProgress {
    pub page_number: i64,
    pub total_pages: Option<i64>,
}

#[tauri::command]
pub async fn get_reading_progress(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
) -> Result<Option<ReadingProgress>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        "SELECT page_number, total_pages FROM reading_progress WHERE external_id = ?1 AND episode_number = ?2",
        rusqlite::params![external_id, episode_number],
        |r| Ok(ReadingProgress { page_number: r.get(0)?, total_pages: r.get(1)? }),
    )
    .optional()
    .str_err()
}

#[tauri::command]
pub async fn save_reading_progress(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
    page_number: i64,
    total_pages: Option<i64>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO reading_progress (external_id, episode_number, page_number, total_pages, updated_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
         ON CONFLICT(external_id, episode_number) DO UPDATE SET page_number = ?3, total_pages = COALESCE(?4, total_pages), updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![external_id, episode_number, page_number, total_pages],
    ).str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn clear_reading_progress(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "DELETE FROM reading_progress WHERE external_id = ?1 AND episode_number = ?2",
        rusqlite::params![external_id, episode_number],
    ).str_err()?;
    Ok(())
}
