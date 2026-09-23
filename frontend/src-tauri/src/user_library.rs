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
    pub rating_2: Option<f64>,
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
    // Reconsumption ("rewatch / reread / replay") — see migrations/
    // reconsumption.rs. Both default to 0 so an older frontend payload (or
    // a caller that spreads a pre-migration row) keeps working unchanged.
    #[serde(default)]
    pub reconsumption_count: i64,
    #[serde(default)]
    pub reconsuming: i32,
}

fn default_user() -> String {
    "local".to_string()
}

const SELECT_BASE: &str = "
    SELECT id, user_id, external_id, type, status, rating, progress, progress_2,
           minutes_spent, is_favorite, is_platinum, tags, notes, added_at, updated_at,
           selected_platform, selected_version, started_at, finished_at, rating_2,
           reconsumption_count, reconsuming
    FROM user_library
    WHERE external_id NOT IN (SELECT external_id FROM blocked_media_catalog)";



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
        rating_2:         row.get(19)?,
        reconsumption_count: row.get::<_, Option<i64>>(20)?.unwrap_or(0),
        reconsuming:      row.get::<_, Option<i32>>(21)?.unwrap_or(0),
    })
}

// ─── reconsumption (rewatch / reread / replay) ────────────────────────────────

// Catalog totals a re-run snaps progress back to once it's completed again.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub(crate) struct WorkTotals {
    pub total_count: Option<f64>,
    pub total_count_2: Option<f64>,
}

fn load_work_totals(conn: &rusqlite::Connection, external_id: &str) -> Result<WorkTotals, String> {
    Ok(conn
        .query_row(
            "SELECT total_count, total_count_2 FROM media_catalog WHERE external_id = ?1",
            [external_id],
            |row| Ok(WorkTotals { total_count: row.get(0)?, total_count_2: row.get(1)? }),
        )
        .optional()
        .str_err()?
        .unwrap_or_default())
}

// The one place every save path (editor, auto-mark on watch/read, imports)
// funnels through, so the re-run rules live here and not in each caller:
//
// - While a re-run is in progress (`reconsuming = 1`, on the incoming entry
//   or on the stored row) the first run's started_at/finished_at are frozen:
//   whatever the caller sends for them is replaced by what's on disk.
// - Completing again while `reconsuming = 1` bumps reconsumption_count,
//   clears the flag and snaps progress/progress_2 back to the catalog totals
//   ("as it was"), returning the ordinal of this completion (2 for the
//   first rewatch) so the caller can log the `complete` event.
// - Anything else (including a completed entry with `reconsuming = 0`) is
//   left exactly as the caller sent it.
pub(crate) fn apply_reconsumption_transition(
    entry: &mut LibraryEntry,
    existing: Option<&LibraryEntry>,
    totals: WorkTotals,
) -> Option<i64> {
    let stored_run = existing.map(|e| e.reconsuming != 0).unwrap_or(false);
    if let Some(prev) = existing {
        if stored_run || entry.reconsuming != 0 {
            entry.started_at = prev.started_at.clone();
            entry.finished_at = prev.finished_at.clone();
        }
    }
    if entry.reconsuming != 0 && entry.status.as_deref() == Some("completed") {
        entry.reconsumption_count += 1;
        entry.reconsuming = 0;
        if let Some(total) = totals.total_count.filter(|t| *t > 0.0) {
            entry.progress = total;
        }
        if let Some(total) = totals.total_count_2.filter(|t| *t > 0.0) {
            entry.progress_2 = total;
        }
        return Some(entry.reconsumption_count + 1);
    }
    None
}

// A `complete` row in user_activity for the completion that just happened,
// dated today — the first run's finish date stays on the row and on its own
// occurrence-1 event (frontend/src/lib/profile/journey.ts writes that one).
pub(crate) fn log_completion_event(
    conn: &rusqlite::Connection,
    entry: &LibraryEntry,
    occurrence: i64,
    now: &str,
) -> Result<(), String> {
    let date = now.get(..10).unwrap_or(now);
    conn.execute(
        "INSERT INTO user_activity (id, date, event_type, external_id, media_type, timestamp, occurrence)
         VALUES (?1, ?2, 'complete', ?3, ?4, ?5, ?6)",
        rusqlite::params![
            crate::db::generate_id(), date, &entry.external_id, &entry.entry_type, now, occurrence,
        ],
    )
    .map(|_| ())
    .str_err()
}

#[tauri::command]
pub async fn save_library_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    entry: LibraryEntry,
) -> Result<LibraryEntry, String> {
    let mut conn = state.conn.lock().str_err()?;
    save_library_entry_in(&mut conn, entry)
}

// The command's body, on a bare connection so tests can drive it. One
// transaction: the row, its favorites-list mirror and the completion event
// commit together or not at all.
pub(crate) fn save_library_entry_in(
    conn: &mut rusqlite::Connection,
    mut entry: LibraryEntry,
) -> Result<LibraryEntry, String> {
    let conn = conn.transaction().str_err()?;

    let is_blocked: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM blocked_media_catalog WHERE external_id = ?1)",
        [&entry.external_id],
        |row| row.get(0),
    ).str_err()?;
    if is_blocked {
        return Err("Cannot add a work hidden from Metadea to the library".into());
    }

    // A bundle (e.g. "Final Fantasy VII Remake Intergrade") is never a real,
    // separately-playable work of its own — it's just a display grouping
    // over its actual contents (see the frontend's library-grouping.ts,
    // which already renders it that way whenever its contents are ALSO
    // logged individually). Logging the bundle itself directly used to
    // still silently succeed through this same command regardless — from
    // the media page's own quick status/rating widget, not just the
    // editor (which already redirects a bundle's own "editar log" to its
    // contents' tabs instead of letting the bundle be logged) — leaving a
    // redundant, phantom "completed" entry alongside the real entries for
    // its actual contents. Refused here instead, at the one place every
    // save path funnels through, so no caller (present or future) can
    // recreate it.
    let format: Option<String> = conn
        .query_row(
            "SELECT format FROM media_catalog WHERE external_id = ?1",
            [&entry.external_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .str_err()?
        .flatten();
    if format.as_deref() == Some("BUNDLE") {
        return Err(format!("Cannot log a bundle directly: {}", entry.external_id));
    }

    // The stored row (not just id/added_at): the reconsumption rules below
    // need its dates and its in-progress-re-run flag.
    let existing = conn
        .query_row(
            &format!("{} AND external_id = ?1", SELECT_BASE),
            [&entry.external_id],
            row_to_entry,
        )
        .optional()
        .str_err()?;

    if let Some(prev) = &existing {
        if entry.id.is_empty() { entry.id = prev.id.clone(); }
        entry.added_at = prev.added_at.clone();
    }

    let totals = load_work_totals(&conn, &entry.external_id)?;
    let completed_occurrence = apply_reconsumption_transition(&mut entry, existing.as_ref(), totals);

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
            selected_platform, selected_version, started_at, finished_at, rating_2,
            reconsumption_count, reconsuming
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
        rusqlite::params![
            &entry.id, &entry.user_id, &entry.external_id, &entry.entry_type,
            &entry.status, &entry.rating, entry.progress, entry.progress_2,
            entry.minutes_spent, entry.is_favorite, entry.is_platinum,
            &tags_json, &entry.notes, &entry.added_at, &entry.updated_at,
            &entry.selected_platform, &entry.selected_version,
            &entry.started_at, &entry.finished_at, &entry.rating_2,
            entry.reconsumption_count, entry.reconsuming,
        ],
    ).str_err()?;

    if let Some(occurrence) = completed_occurrence {
        log_completion_event(&conn, &entry, occurrence, &now)?;
    }

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

    conn.commit().str_err()?;
    Ok(entry)
}

#[cfg(test)]
mod reconsumption_tests {
    use super::*;

    fn entry(external_id: &str, status: &str) -> LibraryEntry {
        LibraryEntry {
            id: String::new(), user_id: "local".into(), external_id: external_id.into(),
            entry_type: "anime".into(), status: Some(status.into()), rating: None, rating_2: None,
            progress: 0.0, progress_2: 0.0, minutes_spent: 0.0, is_favorite: 0, is_platinum: 0,
            tags: None, notes: None, added_at: None, updated_at: None,
            selected_platform: None, selected_version: None,
            started_at: Some("2020-01-01".into()), finished_at: Some("2020-02-01".into()),
            reconsumption_count: 0, reconsuming: 0,
        }
    }

    fn completion_events(conn: &rusqlite::Connection, external_id: &str) -> Vec<Option<i64>> {
        let mut stmt = conn.prepare(
            "SELECT occurrence FROM user_activity WHERE external_id = ?1 AND event_type = 'complete' ORDER BY timestamp",
        ).unwrap();
        stmt.query_map([external_id], |r| r.get(0)).unwrap().flatten().collect()
    }

    #[test]
    fn fields_round_trip_through_save_and_read() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();
        let mut e = entry("anime:1", "completed");
        e.reconsumption_count = 2;
        save_library_entry_in(&mut conn, e).unwrap();
        let loaded = load_library_entry(&conn, "anime:1").unwrap().unwrap();
        assert_eq!(loaded.reconsumption_count, 2);
        assert_eq!(loaded.reconsuming, 0);

        // A payload without the new fields (older frontend) deserializes to 0/0.
        let json = r#"{"id":"","user_id":"local","external_id":"anime:9","type":"anime","status":null,
            "rating":null,"rating_2":null,"tags":null,"notes":null,"added_at":null,"updated_at":null,
            "selected_platform":null,"selected_version":null,"started_at":null,"finished_at":null}"#;
        let parsed: LibraryEntry = serde_json::from_str(json).unwrap();
        assert_eq!((parsed.reconsumption_count, parsed.reconsuming), (0, 0));
    }

    #[test]
    fn completing_a_re_run_bumps_the_count_keeps_dates_and_logs_the_event() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO media_catalog (external_id, type, title_main, total_count, total_count_2) VALUES ('anime:1', 'anime', 'X', 12, 3)",
            [],
        ).unwrap();
        let mut first = entry("anime:1", "completed");
        first.progress = 12.0;
        save_library_entry_in(&mut conn, first).unwrap();
        assert!(completion_events(&conn, "anime:1").is_empty(), "first completion is the frontend journey's job");

        // Toggle "re-watching": status back to in-progress, new run from 0.
        let mut rerun = entry("anime:1", "watching");
        rerun.reconsuming = 1;
        // The auto-mark flows overwrite dates with "today" — frozen here.
        rerun.started_at = Some("2026-09-23".into());
        rerun.finished_at = None;
        rerun.progress = 3.0;
        let saved = save_library_entry_in(&mut conn, rerun).unwrap();
        assert_eq!(saved.started_at.as_deref(), Some("2020-01-01"));
        assert_eq!(saved.finished_at.as_deref(), Some("2020-02-01"));
        assert_eq!(saved.progress, 3.0);
        assert_eq!((saved.reconsumption_count, saved.reconsuming), (0, 1));

        // Completed again (editor or auto-mark): count += 1, flag off,
        // progress snapped back to the catalog totals, dates untouched.
        let mut done = entry("anime:1", "completed");
        done.reconsuming = 1;
        done.progress = 12.0;
        done.finished_at = Some("2026-09-30".into());
        let saved = save_library_entry_in(&mut conn, done).unwrap();
        assert_eq!((saved.reconsumption_count, saved.reconsuming), (1, 0));
        assert_eq!((saved.progress, saved.progress_2), (12.0, 3.0));
        assert_eq!(saved.finished_at.as_deref(), Some("2020-02-01"));
        assert_eq!(completion_events(&conn, "anime:1"), vec![Some(2)]);

        // A completed entry with reconsuming = 0 is saved verbatim (dates included).
        let mut plain = load_library_entry(&conn, "anime:1").unwrap().unwrap();
        plain.finished_at = Some("2021-05-05".into());
        let saved = save_library_entry_in(&mut conn, plain).unwrap();
        assert_eq!(saved.finished_at.as_deref(), Some("2021-05-05"));
        assert_eq!(saved.reconsumption_count, 1);
        assert_eq!(completion_events(&conn, "anime:1").len(), 1);
    }

    #[test]
    fn transition_is_pure_over_the_incoming_entry() {
        let prev = entry("manga:1", "completed");
        let mut e = entry("manga:1", "completed");
        e.reconsuming = 1;
        e.reconsumption_count = 4; // stepper edited in the same save
        let occ = apply_reconsumption_transition(&mut e, Some(&prev), WorkTotals { total_count: None, total_count_2: Some(20.0) });
        assert_eq!(occ, Some(6));
        assert_eq!((e.reconsumption_count, e.reconsuming), (5, 0));
        assert_eq!(e.progress, 0.0, "unknown total leaves progress alone");
        assert_eq!(e.progress_2, 20.0);

        let mut untouched = entry("manga:2", "reading");
        assert_eq!(apply_reconsumption_transition(&mut untouched, None, WorkTotals::default()), None);
        assert_eq!(untouched.reconsuming, 0);
    }
}

#[tauri::command]
pub async fn get_library_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<LibraryEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    load_library_entry(&conn, &external_id)
}

pub(crate) fn load_library_entry(
    conn: &rusqlite::Connection,
    external_id: &str,
) -> Result<Option<LibraryEntry>, String> {
    conn.query_row(
        &format!("{} AND external_id = ?1", SELECT_BASE),
        [external_id],
        row_to_entry,
    )
    .optional()
    .str_err()
}

#[tauri::command]
pub async fn delete_library_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM user_library WHERE external_id = ?1", [&external_id])
        .map(|_| ())
        .str_err()
}

// Settings > Preferencias > Contenido's "delete all ratings" — wipes the
// user's own score off every library entry without touching anything else
// (notes, progress, status, ...). A single UPDATE, not per-row saves
// through save_library_entry, so this can't partially fail mid-way and
// doesn't churn added_at/other fields save_library_entry would otherwise
// also rewrite.
#[tauri::command]
pub async fn clear_all_ratings(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE user_library SET rating = NULL, updated_at = ?1 WHERE rating IS NOT NULL",
        [&now],
    )
    .map(|_| ())
    .str_err()
}

#[tauri::command]
pub async fn get_all_library_entries(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<LibraryEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    load_all_library_entries(&conn)
}

// The rows behind get_all_library_entries, shared with the Home bundle
// (home_bundle.rs) so both read the exact same set.
pub(crate) fn load_all_library_entries(
    conn: &rusqlite::Connection,
) -> Result<Vec<LibraryEntry>, String> {
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
        "SELECT month, external_id FROM monthly_history
         WHERE external_id NOT IN (SELECT external_id FROM blocked_media_catalog)
         ORDER BY month DESC, position"
    ).str_err()?;
    let rows: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .str_err()?.filter_map(|r| r.ok()).collect();
    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (month, eid) in rows {
        map.entry(month).or_default().push(eid);
    }
    serde_json::to_string(&map).str_err()
}

// Typed counterpart of read_monthly_history: the same {month: [external_id]}
// map as a real object over IPC instead of a JSON string.
pub(crate) fn load_monthly_history(
    conn: &rusqlite::Connection,
) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    let mut stmt = conn.prepare(
        "SELECT month, external_id FROM monthly_history
         WHERE external_id NOT IN (SELECT external_id FROM blocked_media_catalog)
         ORDER BY month DESC, position"
    ).str_err()?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .str_err()?;
    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (month, eid) in rows.flatten() {
        map.entry(month).or_default().push(eid);
    }
    Ok(map)
}

#[tauri::command]
pub async fn read_monthly_history_typed(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    let conn = state.conn.lock().str_err()?;
    load_monthly_history(&conn)
}

#[tauri::command]
pub async fn write_monthly_history(state: tauri::State<'_, crate::db::MetadeaDb>, content: String) -> Result<(), String> {
    let map: std::collections::HashMap<String, Vec<String>> = serde_json::from_str(&content).str_err()?;
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    // `content` is always the complete map (read via read_monthly_history), so a
    // month absent here means "cleared" — wipe the whole table before rewriting,
    // not just the months that still have entries, or removals never persist.
    tx.execute("DELETE FROM monthly_history", []).str_err()?;
    for (month, ids) in &map {
        for (pos, id) in ids.iter().enumerate() {
            tx.execute(
                "INSERT INTO monthly_history (month, external_id, position) VALUES (?1, ?2, ?3)",
                rusqlite::params![month, id, pos as i64],
            ).str_err()?;
        }
    }
    tx.commit().str_err()
}


// ─── user_journey (relational) ────────────────────────────────────────────────

#[tauri::command]
pub async fn read_user_journey(state: tauri::State<'_, crate::db::MetadeaDb>) -> Result<String, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT date, external_id, event_type, media_type, progress_start, progress_end, timestamp, occurrence
         FROM user_activity
         WHERE external_id NOT IN (SELECT external_id FROM blocked_media_catalog)
         ORDER BY date DESC, timestamp"
    ).str_err()?;

    struct Row { date: String, ext_id: String, etype: String, mtype: Option<String>, pstart: Option<i64>, pend: Option<i64>, ts: String, occurrence: Option<i64> }
    let rows: Vec<Row> = stmt.query_map([], |r| Ok(Row {
        date: r.get(0)?, ext_id: r.get(1)?, etype: r.get(2)?,
        mtype: r.get(3)?, pstart: r.get(4)?, pend: r.get(5)?, ts: r.get(6)?, occurrence: r.get(7)?,
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
        if let Some(occ) = row.occurrence { event["occurrence"] = occ.into(); }
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

// Typed counterpart of read_user_journey — same shape as the JSON it
// returns (frontend/src/lib/tauri/user-journey.ts's DayJourney/
// UserJourneyEvent, camelCase keys, progressStart/progressEnd omitted when
// unset), as real values over IPC instead of a string to JSON.parse.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JourneyEvent {
    pub external_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub media_type: Option<String>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_start: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_end: Option<i64>,
    // Which completion a `complete` event is (1 = first finish, 2 = first
    // rewatch, ...); absent on rows written before migrations/reconsumption.rs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occurrence: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JourneyDay {
    pub date: String,
    pub events: Vec<JourneyEvent>,
}

pub(crate) fn load_user_journey(conn: &rusqlite::Connection) -> Result<Vec<JourneyDay>, String> {
    let mut stmt = conn.prepare(
        "SELECT date, external_id, event_type, media_type, progress_start, progress_end, timestamp, occurrence
         FROM user_activity
         WHERE external_id NOT IN (SELECT external_id FROM blocked_media_catalog)
         ORDER BY date DESC, timestamp"
    ).str_err()?;
    let rows = stmt.query_map([], |r| Ok((
        r.get::<_, String>(0)?,
        JourneyEvent {
            external_id: r.get(1)?,
            event_type: r.get(2)?,
            media_type: r.get(3)?,
            progress_start: r.get(4)?,
            progress_end: r.get(5)?,
            timestamp: r.get(6)?,
            occurrence: r.get(7)?,
        },
    ))).str_err()?;

    // Group by date, preserving the SQL's descending order.
    let mut days: Vec<JourneyDay> = Vec::new();
    for (date, event) in rows.flatten() {
        match days.last_mut() {
            Some(last) if last.date == date => last.events.push(event),
            _ => days.push(JourneyDay { date, events: vec![event] }),
        }
    }
    Ok(days)
}

#[cfg(test)]
mod typed_read_tests {
    use super::*;

    #[test]
    fn typed_journey_serializes_to_the_same_shape_as_the_string_command() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO user_activity (date, event_type, external_id, media_type, progress_start, progress_end, timestamp)
             VALUES ('2024-02-01', 'progress', 'anime:1', 'anime', 1, 3, '2024-02-01T10:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO user_activity (date, event_type, external_id, media_type, timestamp)
             VALUES ('2024-02-01', 'complete', 'anime:2', NULL, '2024-02-01T11:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO user_activity (date, event_type, external_id, media_type, timestamp)
             VALUES ('2024-01-01', 'start', 'anime:1', 'anime', '2024-01-01T09:00:00Z')",
            [],
        ).unwrap();

        let typed = serde_json::to_value(load_user_journey(&conn).unwrap()).unwrap();
        assert_eq!(typed, serde_json::json!([
            { "date": "2024-02-01", "events": [
                { "externalId": "anime:1", "type": "progress", "mediaType": "anime", "timestamp": "2024-02-01T10:00:00Z", "progressStart": 1, "progressEnd": 3 },
                { "externalId": "anime:2", "type": "complete", "mediaType": null, "timestamp": "2024-02-01T11:00:00Z" },
            ]},
            { "date": "2024-01-01", "events": [
                { "externalId": "anime:1", "type": "start", "mediaType": "anime", "timestamp": "2024-01-01T09:00:00Z" },
            ]},
        ]));
    }

    #[test]
    fn typed_monthly_history_and_favorites_group_like_their_string_commands() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        conn.execute("INSERT INTO monthly_history (month, external_id, position) VALUES ('2024-01', 'anime:2', 1), ('2024-01', 'anime:1', 0)", []).unwrap();
        let history = load_monthly_history(&conn).unwrap();
        assert_eq!(history["2024-01"], vec!["anime:1".to_string(), "anime:2".to_string()]);

        conn.execute("INSERT INTO user_lists (key, name, is_fav) VALUES ('anime_fav', 'x', 1)", []).unwrap();
        conn.execute("INSERT INTO user_list_items (list_key, external_id, position) VALUES ('anime_fav', 'anime:1', 0)", []).unwrap();
        let favs = crate::user_lists::load_user_favorites(&conn).unwrap();
        assert_eq!(favs["anime"], vec!["anime:1".to_string()]);
        assert!(favs["manga"].is_empty(), "every known type is present, empty or not");
        assert_eq!(favs.len(), 10);
    }
}

#[tauri::command]
pub async fn read_user_journey_typed(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<JourneyDay>, String> {
    let conn = state.conn.lock().str_err()?;
    load_user_journey(&conn)
}

#[tauri::command]
pub async fn write_user_journey(state: tauri::State<'_, crate::db::MetadeaDb>, content: String) -> Result<(), String> {
    let days: Vec<serde_json::Value> = serde_json::from_str(&content).str_err()?;
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    // Full replace — journey.ts always writes the complete array. Wrapped in
    // a transaction (same pattern as write_monthly_history above) so the
    // DELETE and every re-INSERT commit together — without this, an
    // interruption (crash, power loss) between the DELETE and the loop
    // finishing used to leave user_activity empty except for whatever had
    // already been reinserted, permanently losing the rest of the journey.
    tx.execute("DELETE FROM user_activity", []).str_err()?;
    for day in &days {
        let date = day.get("date").and_then(|x| x.as_str()).unwrap_or("");
        if let Some(events) = day.get("events").and_then(|x| x.as_array()) {
            for event in events {
                let ext_id = event.get("externalId").and_then(|x| x.as_str()).unwrap_or("");
                let etype  = event.get("type").and_then(|x| x.as_str()).unwrap_or("");
                let mtype  = event.get("mediaType").and_then(|x| x.as_str());
                let pstart = event.get("progressStart").and_then(|x| x.as_i64());
                let pend   = event.get("progressEnd").and_then(|x| x.as_i64());
                let occurrence = event.get("occurrence").and_then(|x| x.as_i64());
                let ts     = event.get("timestamp").and_then(|x| x.as_str()).unwrap_or(date);
                let id     = crate::db::generate_id();
                if ext_id.is_empty() || etype.is_empty() { continue; }
                tx.execute(
                    "INSERT INTO user_activity (id, date, external_id, event_type, media_type, progress_start, progress_end, timestamp, occurrence) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    rusqlite::params![id, date, ext_id, etype, mtype, pstart, pend, ts, occurrence],
                ).str_err()?;
            }
        }
    }
    tx.commit().str_err()
}
