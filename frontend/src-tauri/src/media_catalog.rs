use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaCatalogEntry {
    pub id: String,
    pub external_id: String,
    pub parent_id: Option<String>,
    pub r#type: String,
    pub format: Option<String>,
    pub source: Option<String>,
    pub title_main: Option<String>,
    pub title_romaji: Option<String>,
    pub title_native: Option<String>,
    pub synopsis: Option<String>,
    pub cover_url: Option<String>,
    pub banners_csv: Option<String>,
    pub release_year: Option<i32>,
    pub release_month: Option<i32>,
    pub release_day: Option<i32>,
    pub time_length: Option<i32>,
    pub status: Option<String>,
    pub score_global: Option<f64>,
    pub favorites_count: Option<i32>,
    pub ratings_count: Option<i32>,
    pub total_count: Option<i32>,
    pub total_count_2: Option<i32>,
    pub genres_csv: Option<String>,
    pub genres_tag_csv: Option<String>,
    pub platforms_csv: Option<String>,
    pub companies_cache_csv: Option<String>,
    pub last_synced_at: Option<String>,
    pub sync_failed_count: Option<i32>,
    pub last_sync_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

const SELECT_ALL: &str = "
    SELECT external_id, id, parent_id, type, format, source,
           title_main, title_romaji, title_native, synopsis, cover_url,
           banners_csv, release_year, release_month, release_day,
           time_length, status, score_global, favorites_count,
           ratings_count, total_count, total_count_2, genres_csv,
           genres_tag_csv, platforms_csv, companies_cache_csv,
           last_synced_at, sync_failed_count, last_sync_error,
           created_at, updated_at
    FROM media_catalog";

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaCatalogEntry> {
    Ok(MediaCatalogEntry {
        external_id:         row.get(0)?,
        id:                  row.get(1)?,
        parent_id:           row.get(2)?,
        r#type:              row.get(3)?,
        format:              row.get(4)?,
        source:              row.get(5)?,
        title_main:          row.get(6)?,
        title_romaji:        row.get(7)?,
        title_native:        row.get(8)?,
        synopsis:            row.get(9)?,
        cover_url:           row.get(10)?,
        banners_csv:         row.get(11)?,
        release_year:        row.get(12)?,
        release_month:       row.get(13)?,
        release_day:         row.get(14)?,
        time_length:         row.get(15)?,
        status:              row.get(16)?,
        score_global:        row.get(17)?,
        favorites_count:     row.get(18)?,
        ratings_count:       row.get(19)?,
        total_count:         row.get(20)?,
        total_count_2:       row.get(21)?,
        genres_csv:          row.get(22)?,
        genres_tag_csv:      row.get(23)?,
        platforms_csv:       row.get(24)?,
        companies_cache_csv: row.get(25)?,
        last_synced_at:      row.get(26)?,
        sync_failed_count:   row.get(27)?,
        last_sync_error:     row.get(28)?,
        created_at:          row.get(29)?,
        updated_at:          row.get(30)?,
    })
}

#[tauri::command]
pub async fn save_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    mut entry: MediaCatalogEntry,
) -> Result<MediaCatalogEntry, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let existing: Option<(String, String)> = conn
        .query_row(
            "SELECT id, created_at FROM media_catalog WHERE external_id = ?1",
            [&entry.external_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((eid, eat)) = existing {
        if entry.id.is_empty() { entry.id = eid; }
        entry.created_at = eat;
    }

    if entry.id.is_empty() { entry.id = crate::db::generate_id(); }
    if entry.created_at.is_empty() { entry.created_at = Utc::now().to_rfc3339(); }
    entry.updated_at = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO media_catalog (
            external_id, id, parent_id, type, format, source,
            title_main, title_romaji, title_native, synopsis, cover_url,
            banners_csv, release_year, release_month, release_day,
            time_length, status, score_global, favorites_count,
            ratings_count, total_count, total_count_2, genres_csv,
            genres_tag_csv, platforms_csv, companies_cache_csv,
            last_synced_at, sync_failed_count, last_sync_error,
            created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31)",
        rusqlite::params![
            &entry.external_id, &entry.id, &entry.parent_id, &entry.r#type,
            &entry.format, &entry.source,
            &entry.title_main, &entry.title_romaji, &entry.title_native,
            &entry.synopsis, &entry.cover_url, &entry.banners_csv,
            &entry.release_year, &entry.release_month, &entry.release_day,
            &entry.time_length, &entry.status, &entry.score_global,
            &entry.favorites_count, &entry.ratings_count,
            &entry.total_count, &entry.total_count_2,
            &entry.genres_csv, &entry.genres_tag_csv,
            &entry.platforms_csv, &entry.companies_cache_csv,
            &entry.last_synced_at, &entry.sync_failed_count, &entry.last_sync_error,
            &entry.created_at, &entry.updated_at,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(entry)
}

#[tauri::command]
pub async fn get_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<MediaCatalogEntry>, String> {
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
pub async fn delete_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM media_catalog WHERE external_id = ?1", [&external_id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_catalog_entries(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<MediaCatalogEntry>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(SELECT_ALL).map_err(|e| e.to_string())?;
    let entries = stmt
        .query_map([], row_to_entry)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn search_catalog(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    query: String,
) -> Result<Vec<MediaCatalogEntry>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = conn.prepare(
        &format!("{} WHERE lower(title_main) LIKE ?1 OR lower(title_romaji) LIKE ?1 OR lower(title_native) LIKE ?1", SELECT_ALL),
    ).map_err(|e| e.to_string())?;
    let entries = stmt
        .query_map([&pattern], row_to_entry)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}
