// Generic staleness/resync bookkeeping for every external_id-keyed entity,
// media_catalog included as of migration 32 — the single source of truth
// needsResync() (media-status.ts) reads from, replacing media_catalog's own
// former last_synced_at/sync_failed_count/last_sync_error columns.
use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SyncStateEntry {
    pub external_id: String,
    pub last_synced_at: Option<String>,
    pub sync_failed_count: Option<i32>,
    pub last_sync_error: Option<String>,
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncStateEntry> {
    Ok(SyncStateEntry {
        external_id: row.get(0)?,
        last_synced_at: row.get(1)?,
        sync_failed_count: row.get(2)?,
        last_sync_error: row.get(3)?,
    })
}

#[tauri::command]
pub async fn get_sync_state(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<SyncStateEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        "SELECT external_id, last_synced_at, sync_failed_count, last_sync_error
         FROM sync_state WHERE external_id = ?1",
        [&external_id],
        row_to_entry,
    )
    .optional()
    .str_err()
}

// Batched form for a list of entries (e.g. a grid of characters) — one
// query instead of one Tauri round-trip per row.
#[tauri::command]
pub async fn get_sync_states(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_ids: Vec<String>,
) -> Result<Vec<SyncStateEntry>, String> {
    if external_ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = state.conn.lock().str_err()?;
    let placeholders = external_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT external_id, last_synced_at, sync_failed_count, last_sync_error
         FROM sync_state WHERE external_id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql).str_err()?;
    let params = rusqlite::params_from_iter(external_ids.iter());
    let rows = stmt
        .query_map(params, row_to_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// A successful live fetch: resets the failure streak and stamps "now".
#[tauri::command]
pub async fn mark_synced(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO sync_state (external_id, last_synced_at, sync_failed_count, last_sync_error)
         VALUES (?1, ?2, 0, NULL)
         ON CONFLICT(external_id) DO UPDATE SET
            last_synced_at = excluded.last_synced_at, sync_failed_count = 0, last_sync_error = NULL",
        rusqlite::params![&external_id, &now],
    ).str_err()?;
    Ok(())
}

// A failed fetch — bumps the counter, keeps the row. Does NOT touch
// last_synced_at: the interval keeps counting from the last real success,
// not from this failed attempt.
#[tauri::command]
pub async fn mark_sync_failed(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    error: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO sync_state (external_id, sync_failed_count, last_sync_error)
         VALUES (?1, 1, ?2)
         ON CONFLICT(external_id) DO UPDATE SET
            sync_failed_count = COALESCE(sync_failed_count, 0) + 1, last_sync_error = excluded.last_sync_error",
        rusqlite::params![&external_id, &error],
    ).str_err()?;
    Ok(())
}

// Direct write of all 3 fields at once — used by mediaService.ts's
// persistToCatalog, which needs sync_failed_count to widen even on a
// *successful* fetch that brought no new data (not just genuine errors),
// a nuance mark_synced/mark_sync_failed's fixed reset-or-increment shapes
// don't cover.
#[tauri::command]
pub async fn set_sync_state(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    last_synced_at: Option<String>,
    sync_failed_count: Option<i32>,
    last_sync_error: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO sync_state (external_id, last_synced_at, sync_failed_count, last_sync_error)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(external_id) DO UPDATE SET
            last_synced_at = excluded.last_synced_at, sync_failed_count = excluded.sync_failed_count,
            last_sync_error = excluded.last_sync_error",
        rusqlite::params![&external_id, &last_synced_at, &sync_failed_count, &last_sync_error],
    ).str_err()?;
    Ok(())
}
