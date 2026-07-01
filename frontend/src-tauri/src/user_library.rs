use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibraryEntry {
    #[serde(default = "crate::db::generate_id")]
    pub id: String,
    #[serde(default = "default_user")]
    pub user_id: String,
    pub external_id: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub status: Option<String>,
    pub rating: Option<f64>,
    #[serde(default)]
    pub progress: f64,
    #[serde(default)]
    pub progress_2: f64,
    #[serde(default)]
    pub minutes_spent: f64,
    #[serde(default)]
    pub is_favorite: i32,
    #[serde(default)]
    pub is_platinum: i32,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
    pub added_at: Option<String>,
    pub updated_at: Option<String>,
    pub selected_platform: Option<String>,
    pub selected_version: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

fn default_user() -> String {
    "local".to_string()
}

const SELECT_ALL: &str = "
    SELECT id, user_id, external_id, type, status, rating, progress, progress_2,
           minutes_spent, is_favorite, is_platinum, tags, notes, added_at, updated_at,
           selected_platform, selected_version, started_at, finished_at
    FROM user_library";

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryEntry> {
    let tags_json: Option<String> = row.get(11)?;
    Ok(LibraryEntry {
        id:               row.get(0)?,
        user_id:          row.get(1)?,
        external_id:      row.get(2)?,
        entry_type:       row.get(3)?,
        status:           row.get(4)?,
        rating:           row.get(5)?,
        progress:         row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
        progress_2:       row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
        minutes_spent:    row.get::<_, Option<f64>>(8)?.unwrap_or(0.0),
        is_favorite:      row.get::<_, Option<i32>>(9)?.unwrap_or(0),
        is_platinum:      row.get::<_, Option<i32>>(10)?.unwrap_or(0),
        tags:             tags_json.as_deref().and_then(|s| serde_json::from_str(s).ok()),
        notes:            row.get(12)?,
        added_at:         row.get(13)?,
        updated_at:       row.get(14)?,
        selected_platform: row.get(15)?,
        selected_version: row.get(16)?,
        started_at:       row.get(17)?,
        finished_at:      row.get(18)?,
    })
}

#[tauri::command]
pub async fn save_library_entry(
    state: tauri::State<'_, crate::db::LibraryDb>,
    mut entry: LibraryEntry,
) -> Result<LibraryEntry, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let existing: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT id, added_at FROM user_library WHERE external_id = ?1",
            [&entry.external_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((eid, eat)) = existing {
        if entry.id.is_empty() { entry.id = eid; }
        entry.added_at = eat;
    }

    let now = Utc::now().to_rfc3339();
    if entry.id.is_empty() { entry.id = crate::db::generate_id(); }
    if entry.user_id.is_empty() { entry.user_id = "local".to_string(); }
    if entry.added_at.is_none() { entry.added_at = Some(now.clone()); }
    entry.updated_at = Some(now);

    let tags_json = entry.tags.as_ref().map(|t| serde_json::to_string(t).unwrap_or_default());

    conn.execute(
        "INSERT OR REPLACE INTO user_library (
            id, user_id, external_id, type, status, rating, progress, progress_2,
            minutes_spent, is_favorite, is_platinum, tags, notes, added_at, updated_at,
            selected_platform, selected_version, started_at, finished_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
        rusqlite::params![
            &entry.id, &entry.user_id, &entry.external_id, &entry.entry_type,
            &entry.status, &entry.rating, entry.progress, entry.progress_2,
            entry.minutes_spent, entry.is_favorite, entry.is_platinum,
            &tags_json, &entry.notes, &entry.added_at, &entry.updated_at,
            &entry.selected_platform, &entry.selected_version,
            &entry.started_at, &entry.finished_at,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(entry)
}

#[tauri::command]
pub async fn get_library_entry(
    state: tauri::State<'_, crate::db::LibraryDb>,
    external_id: String,
    entry_type: String,
) -> Result<Option<LibraryEntry>, String> {
    let _ = entry_type;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        &format!("{} WHERE external_id = ?1", SELECT_ALL),
        [&external_id],
        row_to_entry,
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_library_entry(
    state: tauri::State<'_, crate::db::LibraryDb>,
    external_id: String,
    entry_type: String,
) -> Result<(), String> {
    let _ = entry_type;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM user_library WHERE external_id = ?1", [&external_id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_library_entries(
    state: tauri::State<'_, crate::db::LibraryDb>,
) -> Result<Vec<LibraryEntry>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(SELECT_ALL).map_err(|e| e.to_string())?;
    let entries = stmt
        .query_map([], row_to_entry)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

// ─── user_metadata key-value helpers ─────────────────────────────────────────

fn read_meta(state: &crate::db::LibraryDb, key: &str, default: &str) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT value FROM user_metadata WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
    .map(|v: Option<String>| v.unwrap_or_else(|| default.to_string()))
}

fn write_meta(state: &crate::db::LibraryDb, key: &str, value: &str) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO user_metadata (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_monthly_history(state: tauri::State<'_, crate::db::LibraryDb>) -> Result<String, String> {
    read_meta(&state, "monthly_history", "{}")
}

#[tauri::command]
pub async fn write_monthly_history(state: tauri::State<'_, crate::db::LibraryDb>, content: String) -> Result<(), String> {
    write_meta(&state, "monthly_history", &content)
}

#[tauri::command]
pub async fn read_user_favorites(state: tauri::State<'_, crate::db::LibraryDb>) -> Result<String, String> {
    read_meta(&state, "user_favorites", "{}")
}

#[tauri::command]
pub async fn write_user_favorites(state: tauri::State<'_, crate::db::LibraryDb>, content: String) -> Result<(), String> {
    write_meta(&state, "user_favorites", &content)
}

#[tauri::command]
pub async fn read_user_journey(state: tauri::State<'_, crate::db::LibraryDb>) -> Result<String, String> {
    read_meta(&state, "user_journey", "[]")
}

#[tauri::command]
pub async fn write_user_journey(state: tauri::State<'_, crate::db::LibraryDb>, content: String) -> Result<(), String> {
    write_meta(&state, "user_journey", &content)
}

#[tauri::command]
pub async fn read_user_lists(state: tauri::State<'_, crate::db::LibraryDb>) -> Result<String, String> {
    read_meta(&state, "user_lists", "[]")
}

#[tauri::command]
pub async fn write_user_lists(state: tauri::State<'_, crate::db::LibraryDb>, content: String) -> Result<(), String> {
    write_meta(&state, "user_lists", &content)
}
