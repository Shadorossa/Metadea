use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

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

const SELECT_BASE: &str = "
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
    state: tauri::State<'_, crate::db::MetadeaDb>,
    mut entry: LibraryEntry,
) -> Result<LibraryEntry, String> {
    let conn = state.conn.lock().str_err()?;

    let existing: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT id, added_at FROM user_library WHERE external_id = ?1",
            [&entry.external_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .str_err()?;

    if let Some((eid, eat)) = existing {
        if entry.id.is_empty() { entry.id = eid; }
        entry.added_at = eat;
    }

    let now = Utc::now().to_rfc3339();
    if entry.id.is_empty() { entry.id = crate::db::generate_id(); }
    if entry.user_id.is_empty() { entry.user_id = "local".to_string(); }
    if entry.added_at.is_none() { entry.added_at = Some(now.clone()); }
    entry.updated_at = Some(now.clone());

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
    ).str_err()?;

    // Sync fav list
    let fav_key = crate::user_lists::type_to_fav_key(&entry.entry_type);
    if entry.is_favorite != 0 {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO user_lists (key, name, is_fav) VALUES (?1, ?1, 1)",
            [&fav_key],
        );
        let max_pos: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) FROM user_list_items WHERE list_key = ?1",
                [&fav_key],
                |r| r.get(0),
            )
            .unwrap_or(-1);
        let _ = conn.execute(
            "INSERT OR IGNORE INTO user_list_items (list_key, external_id, position, added_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![fav_key, entry.external_id, max_pos + 1, now],
        );
    } else {
        let _ = conn.execute(
            "DELETE FROM user_list_items WHERE list_key = ?1 AND external_id = ?2",
            rusqlite::params![fav_key, entry.external_id],
        );
    }

    Ok(entry)
}

#[tauri::command]
pub async fn get_library_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    entry_type: String,
) -> Result<Option<LibraryEntry>, String> {
    let _ = entry_type;
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        &format!("{} WHERE external_id = ?1", SELECT_BASE),
        [&external_id],
        row_to_entry,
    )
    .optional()
    .str_err()
}

#[tauri::command]
pub async fn delete_library_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    entry_type: String,
) -> Result<(), String> {
    let _ = entry_type;
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM user_library WHERE external_id = ?1", [&external_id])
        .map(|_| ())
        .str_err()
}

#[tauri::command]
pub async fn get_all_library_entries(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<LibraryEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(SELECT_BASE).str_err()?;
    let entries = stmt
        .query_map([], row_to_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

// ─── monthly_history (relational) ─────────────────────────────────────────────

#[tauri::command]
pub async fn read_monthly_history(state: tauri::State<'_, crate::db::MetadeaDb>) -> Result<String, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT month, external_id FROM monthly_history ORDER BY month DESC, position"
    ).str_err()?;
    let rows: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .str_err()?.filter_map(|r| r.ok()).collect();
    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (month, eid) in rows {
        map.entry(month).or_default().push(eid);
    }
    serde_json::to_string(&map).str_err()
}

#[tauri::command]
pub async fn write_monthly_history(state: tauri::State<'_, crate::db::MetadeaDb>, content: String) -> Result<(), String> {
    let map: std::collections::HashMap<String, Vec<String>> = serde_json::from_str(&content).str_err()?;
    let conn = state.conn.lock().str_err()?;
    for (month, ids) in &map {
        conn.execute("DELETE FROM monthly_history WHERE month = ?1", [month]).str_err()?;
        for (pos, id) in ids.iter().enumerate() {
            conn.execute(
                "INSERT INTO monthly_history (month, external_id, position) VALUES (?1, ?2, ?3)",
                rusqlite::params![month, id, pos as i64],
            ).str_err()?;
        }
    }
    Ok(())
}

// ─── user_journey (relational) ────────────────────────────────────────────────

#[tauri::command]
pub async fn read_user_journey(state: tauri::State<'_, crate::db::MetadeaDb>) -> Result<String, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT date, external_id, event_type, media_type, progress_start, progress_end, timestamp
         FROM user_activity ORDER BY date DESC, timestamp"
    ).str_err()?;

    struct Row { date: String, ext_id: String, etype: String, mtype: Option<String>, pstart: Option<i64>, pend: Option<i64>, ts: String }
    let rows: Vec<Row> = stmt.query_map([], |r| Ok(Row {
        date: r.get(0)?, ext_id: r.get(1)?, etype: r.get(2)?,
        mtype: r.get(3)?, pstart: r.get(4)?, pend: r.get(5)?, ts: r.get(6)?
    })).str_err()?.filter_map(|r| r.ok()).collect();

    // Group by date (maintain descending order from SQL)
    let mut days: Vec<(String, Vec<serde_json::Value>)> = Vec::new();
    for row in rows {
        let mut event = serde_json::json!({
            "externalId": row.ext_id, "type": row.etype,
            "mediaType": row.mtype, "timestamp": row.ts,
        });
        if let Some(ps) = row.pstart { event["progressStart"] = ps.into(); }
        if let Some(pe) = row.pend { event["progressEnd"] = pe.into(); }
        if let Some(last) = days.last_mut() {
            if last.0 == row.date { last.1.push(event); continue; }
        }
        days.push((row.date, vec![event]));
    }
    let result: Vec<serde_json::Value> = days.into_iter()
        .map(|(date, events)| serde_json::json!({"date": date, "events": events}))
        .collect();
    serde_json::to_string(&result).str_err()
}

#[tauri::command]
pub async fn write_user_journey(state: tauri::State<'_, crate::db::MetadeaDb>, content: String) -> Result<(), String> {
    let days: Vec<serde_json::Value> = serde_json::from_str(&content).str_err()?;
    let conn = state.conn.lock().str_err()?;
    // Full replace — journey.ts always writes the complete array
    conn.execute("DELETE FROM user_activity", []).str_err()?;
    for day in &days {
        let date = day.get("date").and_then(|x| x.as_str()).unwrap_or("");
        if let Some(events) = day.get("events").and_then(|x| x.as_array()) {
            for event in events {
                let ext_id = event.get("externalId").and_then(|x| x.as_str()).unwrap_or("");
                let etype  = event.get("type").and_then(|x| x.as_str()).unwrap_or("");
                let mtype  = event.get("mediaType").and_then(|x| x.as_str());
                let pstart = event.get("progressStart").and_then(|x| x.as_i64());
                let pend   = event.get("progressEnd").and_then(|x| x.as_i64());
                let ts     = event.get("timestamp").and_then(|x| x.as_str()).unwrap_or(date);
                let id     = crate::db::generate_id();
                if ext_id.is_empty() || etype.is_empty() { continue; }
                conn.execute(
                    "INSERT INTO user_activity (id, date, external_id, event_type, media_type, progress_start, progress_end, timestamp) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    rusqlite::params![id, date, ext_id, etype, mtype, pstart, pend, ts],
                ).str_err()?;
            }
        }
    }
    Ok(())
}
