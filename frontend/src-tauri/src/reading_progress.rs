// Where the in-app reader (comic_reader.rs / epub_reader) last left off
// inside one issue/chapter/volume file — same "resume position" idea as
// resume_position.rs's video seconds. Comics store a page number; EPUBs
// store (chapter_index, chapter_fraction) plus the byte-weighted percent
// of the book read, and mirror chapter_index + 1 into page_number so
// everything that only knows the page shape keeps working. See
// migrations 52 and 72 for the table shapes.
use crate::db::ToStringErr;
use rusqlite::OptionalExtension;
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct ReadingProgress {
    pub page_number: i64,
    pub total_pages: Option<i64>,
    pub chapter_index: Option<i64>,
    pub chapter_fraction: Option<f64>,
    pub percent: Option<f64>,
}

#[tauri::command]
pub async fn get_reading_progress(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
) -> Result<Option<ReadingProgress>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        "SELECT page_number, total_pages, chapter_index, chapter_fraction, percent
         FROM reading_progress WHERE external_id = ?1 AND episode_number = ?2",
        rusqlite::params![external_id, episode_number],
        |r| Ok(ReadingProgress {
            page_number: r.get(0)?,
            total_pages: r.get(1)?,
            chapter_index: r.get(2)?,
            chapter_fraction: r.get(3)?,
            percent: r.get(4)?,
        }),
    )
    .optional()
    .str_err()
}

// The three EPUB columns are optional so the comic reader's existing call
// (no chapter fields) keeps deserialising; a comic save leaves them NULL.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_reading_progress(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
    page_number: i64,
    total_pages: Option<i64>,
    chapter_index: Option<i64>,
    chapter_fraction: Option<f64>,
    percent: Option<f64>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO reading_progress (external_id, episode_number, page_number, total_pages, chapter_index, chapter_fraction, percent, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
         ON CONFLICT(external_id, episode_number) DO UPDATE SET
            page_number = ?3, total_pages = COALESCE(?4, total_pages),
            chapter_index = ?5, chapter_fraction = ?6, percent = ?7,
            updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![external_id, episode_number, page_number, total_pages, chapter_index, chapter_fraction, percent],
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

#[tauri::command]
pub async fn get_comic_bookmarks(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
) -> Result<Vec<i64>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT page_number FROM comic_bookmarks WHERE external_id = ?1 AND episode_number = ?2 ORDER BY page_number ASC"
    ).str_err()?;
    let rows = stmt.query_map(rusqlite::params![external_id, episode_number], |r| r.get(0)).str_err()?;
    let mut out = Vec::new();
    for page in rows.flatten() {
        out.push(page);
    }
    Ok(out)
}

#[tauri::command]
pub async fn toggle_comic_bookmark(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
    page_number: i64,
) -> Result<bool, String> {
    let conn = state.conn.lock().str_err()?;
    let deleted = conn.execute(
        "DELETE FROM comic_bookmarks WHERE external_id = ?1 AND episode_number = ?2 AND page_number = ?3",
        rusqlite::params![external_id, episode_number, page_number],
    ).str_err()?;

    if deleted > 0 {
        Ok(false)
    } else {
        conn.execute(
            "INSERT INTO comic_bookmarks (external_id, episode_number, page_number) VALUES (?1, ?2, ?3)",
            rusqlite::params![external_id, episode_number, page_number],
        ).str_err()?;
        Ok(true)
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct EpubBookmark {
    pub id: i64,
    pub chapter_index: i64,
    pub chapter_fraction: f64,
    pub label: Option<String>,
}

#[tauri::command]
pub async fn get_epub_bookmarks(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
) -> Result<Vec<EpubBookmark>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT id, chapter_index, chapter_fraction, label FROM epub_bookmarks
         WHERE external_id = ?1 AND episode_number = ?2 ORDER BY chapter_index ASC, chapter_fraction ASC"
    ).str_err()?;
    let rows = stmt
        .query_map(rusqlite::params![external_id, episode_number], |r| Ok(EpubBookmark {
            id: r.get(0)?,
            chapter_index: r.get(1)?,
            chapter_fraction: r.get(2)?,
            label: r.get(3)?,
        }))
        .str_err()?;
    Ok(rows.flatten().collect())
}

#[tauri::command]
pub async fn add_epub_bookmark(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episode_number: f64,
    chapter_index: i64,
    chapter_fraction: f64,
    label: Option<String>,
) -> Result<i64, String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO epub_bookmarks (external_id, episode_number, chapter_index, chapter_fraction, label)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![external_id, episode_number, chapter_index, chapter_fraction.clamp(0.0, 1.0), label],
    ).str_err()?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn delete_epub_bookmark(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    id: i64,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM epub_bookmarks WHERE id = ?1", rusqlite::params![id]).str_err()?;
    Ok(())
}
