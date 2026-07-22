use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use crate::db::ToStringErr;

// Rebuilt-in-place GitHub Release asset (scripts/build-database.js), not a
// branch-tracked file — a branch commit would bloat git history with a
// near-full binary copy on every merge.
pub(crate) const COMMUNITY_DB_URL: &str = "https://github.com/Shadorossa/Metadea/releases/download/catalog-latest/database.db";

// One IN-query instead of N+1 SELECT EXISTS per row.
pub(crate) fn existing_catalog_ids(
    tx: &rusqlite::Transaction,
    ids: &[String],
) -> Result<HashSet<String>, String> {
    if ids.is_empty() {
        return Ok(HashSet::new());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT external_id FROM media_catalog WHERE external_id IN ({})",
        placeholders
    );
    let mut stmt = tx.prepare(&sql).str_err()?;
    let params = rusqlite::params_from_iter(ids.iter());
    let found = stmt
        .query_map(params, |row| row.get::<_, String>(0))
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(found)
}

// The other side's edge (SEQUEL<->PREQUEL, etc.) — get_transitive_relation_ids'
// recursive CTE only walks forward via media_external_id, so a one-sided
// write silently breaks traversal partway through a saga. Callers use
// INSERT OR IGNORE with this, not REPLACE: a curator may have deliberately
// classified the other side differently (e.g. SIDE_STORY over plain SEQUEL).
pub(crate) fn reciprocal_relation(relation_type: &str) -> Option<(&'static str, &'static str)> {
    match relation_type {
        "SEQUEL"     => Some(("PREQUEL", "Prequel")),
        "PREQUEL"    => Some(("SEQUEL", "Sequel")),
        "SOURCE"     => Some(("ADAPTATION", "Adaptation")),
        "ADAPTATION" => Some(("ADAPTATION", "Adaptation")),
        "EPISODE"    => Some(("PART_OF", "Part of")),
        "UPDATE"     => Some(("PART_OF", "Part of")),
        _ => None,
    }
}

// external_id's own prefix as its type (e.g. "anime:123" -> "anime");
// colon-less ids fall back to "anime".
pub(crate) fn infer_type_from_id(external_id: &str) -> String {
    external_id
        .split_once(':')
        .map(|(prefix, _)| prefix)
        .unwrap_or("anime")
        .to_string()
}

// A stub row's source, inferred from its type prefix — mirrors the source
// string each live mapper writes (anilist/tmdb/igdb/openlibrary/comicvine).
pub(crate) fn infer_source_from_id(external_id: &str) -> Option<&'static str> {
    match infer_type_from_id(external_id).as_str() {
        "anime" | "manga" | "lnovel" => Some("anilist"),
        "movie" | "series" => Some("tmdb"),
        "game" | "vnovel" => Some("igdb"),
        "book" => Some("openlibrary"),
        "comic" => Some("comicvine"),
        _ => None,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[derive(Default)]
pub struct MediaCatalogEntry {
    pub id: String,
    pub external_id: String,
    pub authors_csv: Option<String>,
    pub banners_csv: Option<String>,
    pub blocked_at: Option<String>,
    pub country_code: Option<String>,
    pub cover_url: Option<String>,
    pub developer_badge: Option<String>,
    pub favorites_count: Option<i32>,
    pub format: Option<String>,
    pub genres_csv: Option<String>,
    pub genres_tag_csv: Option<String>,
    pub last_sync_error: Option<String>,
    pub last_synced_at: Option<String>,
    pub parent_id: Option<String>,
    pub platforms_csv: Option<String>,
    pub publishers_csv: Option<String>,
    pub ratings_count: Option<i32>,
    pub release_day: Option<i32>,
    pub release_end_day: Option<i32>,
    pub release_end_month: Option<i32>,
    pub release_end_year: Option<i32>,
    pub release_month: Option<i32>,
    pub release_year: Option<i32>,
    pub score_global: Option<f64>,
    pub shop_links_csv: Option<String>,
    pub source: Option<String>,
    pub source_url: Option<String>,
    pub status: Option<String>,
    pub sync_failed_count: Option<i32>,
    pub synopsis: Option<String>,
    pub time_length: Option<i32>,
    pub title_english: Option<String>,
    pub title_main: Option<String>,
    pub title_native: Option<String>,
    pub title_romaji: Option<String>,
    pub total_count: Option<i32>,
    pub total_count_2: Option<i32>,
    pub r#type: String,
    pub created_at: String,
    pub updated_at: String,
}

const SELECT_ALL: &str = "
    SELECT id, external_id, authors_csv, banners_csv, blocked_at, country_code, cover_url,
           developer_badge, favorites_count, format, genres_csv, genres_tag_csv,
           last_sync_error, last_synced_at, parent_id, platforms_csv, publishers_csv,
           ratings_count, release_day, release_end_day, release_end_month, release_end_year,
           release_month, release_year, score_global,
           shop_links_csv, source, source_url, status, sync_failed_count, synopsis,
           time_length, title_english, title_main, title_native, title_romaji, total_count, total_count_2,
           type, created_at, updated_at
    FROM media_catalog";

// Same as SELECT_ALL but excludes blocked rows (visible_media_catalog view,
// db.rs) — used by every read path except a direct id lookup.
const SELECT_VISIBLE: &str = "
    SELECT id, external_id, authors_csv, banners_csv, blocked_at, country_code, cover_url,
           developer_badge, favorites_count, format, genres_csv, genres_tag_csv,
           last_sync_error, last_synced_at, parent_id, platforms_csv, publishers_csv,
           ratings_count, release_day, release_end_day, release_end_month, release_end_year,
           release_month, release_year, score_global,
           shop_links_csv, source, source_url, status, sync_failed_count, synopsis,
           time_length, title_english, title_main, title_native, title_romaji, total_count, total_count_2,
           type, created_at, updated_at
    FROM visible_media_catalog";

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaCatalogEntry> {
    Ok(MediaCatalogEntry {
        id:                  row.get::<_, Option<String>>(0)?.unwrap_or_default(),
        external_id:         row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        authors_csv:         row.get(2)?,
        banners_csv:         row.get(3)?,
        blocked_at:          row.get(4)?,
        country_code:        row.get(5)?,
        cover_url:           row.get(6)?,
        developer_badge:     row.get(7)?,
        favorites_count:     row.get(8)?,
        format:              row.get(9)?,
        genres_csv:          row.get(10)?,
        genres_tag_csv:      row.get(11)?,
        last_sync_error:     row.get(12)?,
        last_synced_at:      row.get(13)?,
        parent_id:           row.get(14)?,
        platforms_csv:       row.get(15)?,
        publishers_csv:      row.get(16)?,
        ratings_count:       row.get(17)?,
        release_day:         row.get(18)?,
        release_end_day:     row.get(19)?,
        release_end_month:   row.get(20)?,
        release_end_year:    row.get(21)?,
        release_month:       row.get(22)?,
        release_year:        row.get(23)?,
        score_global:        row.get(24)?,
        shop_links_csv:      row.get(25)?,
        source:              row.get(26)?,
        source_url:          row.get(27)?,
        status:              row.get(28)?,
        sync_failed_count:   row.get(29)?,
        synopsis:            row.get(30)?,
        time_length:         row.get(31)?,
        title_english:       row.get(32)?,
        title_main:          row.get(33)?,
        title_native:        row.get(34)?,
        title_romaji:        row.get(35)?,
        total_count:         row.get(36)?,
        total_count_2:       row.get(37)?,
        r#type:              row.get::<_, Option<String>>(38)?.unwrap_or_default(),
        created_at:          row.get::<_, Option<String>>(39)?.unwrap_or_default(),
        updated_at:          row.get::<_, Option<String>>(40)?.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn save_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    mut entry: MediaCatalogEntry,
) -> Result<MediaCatalogEntry, String> {
    let conn = state.conn.lock().str_err()?;

    let numeric_suffix = entry.external_id.split_once(':').map(|(_, id)| id);

    let existing: Option<(String, String, String)> = if let Some(num_id) = numeric_suffix {
        let vnovel_id = format!("vnovel:{num_id}");
        let game_id = format!("game:{num_id}");
        conn.query_row(
            "SELECT id, external_id, created_at FROM media_catalog WHERE external_id = ?1 OR external_id = ?2 OR external_id = ?3",
            [&entry.external_id, &vnovel_id, &game_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .str_err()?
    } else {
        conn.query_row(
            "SELECT id, external_id, created_at FROM media_catalog WHERE external_id = ?1",
            [&entry.external_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .str_err()?
    };

    if let Some((eid, orig_ext_id, eat)) = existing {
        if entry.id.is_empty() { entry.id = eid; }
        entry.external_id = orig_ext_id;
        entry.created_at = eat;
    }

    if entry.id.is_empty() { entry.id = crate::db::generate_id(); }
    if entry.created_at.is_empty() { entry.created_at = Utc::now().to_rfc3339(); }
    entry.updated_at = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO media_catalog (
            id, external_id, authors_csv, banners_csv, blocked_at, country_code, cover_url,
            developer_badge, favorites_count, format, genres_csv, genres_tag_csv,
            last_sync_error, last_synced_at, parent_id, platforms_csv, publishers_csv,
            ratings_count, release_day, release_end_day, release_end_month, release_end_year,
            release_month, release_year, score_global,
            shop_links_csv, source, source_url, status, sync_failed_count, synopsis,
            time_length, title_english, title_main, title_native, title_romaji, total_count, total_count_2,
            type, created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,?36,?37,?38,?39,?40,?41)",
        rusqlite::params![
            &entry.id,
            &entry.external_id,
            &entry.authors_csv,
            &entry.banners_csv,
            &entry.blocked_at,
            &entry.country_code,
            &entry.cover_url,
            &entry.developer_badge,
            &entry.favorites_count,
            &entry.format,
            &entry.genres_csv,
            &entry.genres_tag_csv,
            &entry.last_sync_error,
            &entry.last_synced_at,
            &entry.parent_id,
            &entry.platforms_csv,
            &entry.publishers_csv,
            &entry.ratings_count,
            &entry.release_day,
            &entry.release_end_day,
            &entry.release_end_month,
            &entry.release_end_year,
            &entry.release_month,
            &entry.release_year,
            &entry.score_global,
            &entry.shop_links_csv,
            &entry.source,
            &entry.source_url,
            &entry.status,
            &entry.sync_failed_count,
            &entry.synopsis,
            &entry.time_length,
            &entry.title_english,
            &entry.title_main,
            &entry.title_native,
            &entry.title_romaji,
            &entry.total_count,
            &entry.total_count_2,
            &entry.r#type,
            &entry.created_at,
            &entry.updated_at,
        ],
    ).str_err()?;

    // authors_csv is just a flat display cache (MediaPage.tsx) — real author
    // relations go through save_media_authors/save_author_profile_and_relations.
    Ok(entry)
}

// Bumps the failure counter/message only — unlike save_catalog_entry, a
// failed fetch has no fresh row data to write.
#[tauri::command]
pub async fn mark_catalog_sync_failed(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    error: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "UPDATE media_catalog
         SET sync_failed_count = COALESCE(sync_failed_count, 0) + 1,
             last_sync_error = ?2
         WHERE external_id = ?1",
        rusqlite::params![external_id, error],
    ).str_err()?;
    Ok(())
}

// Narrow update for genres/tags discovered by a background fetch (Comic
// Vine's aggregated concepts) — touches only these two columns.
#[tauri::command]
pub async fn update_catalog_genres(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    genres_csv: Option<String>,
    genres_tag_csv: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "UPDATE media_catalog
         SET genres_csv = ?2,
             genres_tag_csv = ?3
         WHERE external_id = ?1",
        rusqlite::params![external_id, genres_csv, genres_tag_csv],
    ).str_err()?;
    Ok(())
}

// Lets the frontend strip blocked entries out of a live API fetch's raw
// relations, which have no idea a title was blocked locally.
#[tauri::command]
pub async fn get_blocked_external_ids(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare("SELECT external_id FROM blocked_media_catalog").str_err()?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0)).str_err()?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub async fn get_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<MediaCatalogEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    if let Some((_, num_id)) = external_id.split_once(':') {
        let vnovel_id = format!("vnovel:{num_id}");
        let game_id = format!("game:{num_id}");
        conn.query_row(
            &format!("{} WHERE external_id = ?1 OR external_id = ?2 OR external_id = ?3", SELECT_ALL),
            [&external_id, &vnovel_id, &game_id],
            row_to_entry,
        )
        .optional()
        .str_err()
    } else {
        conn.query_row(
            &format!("{} WHERE external_id = ?1", SELECT_ALL),
            [&external_id],
            row_to_entry,
        )
        .optional()
        .str_err()
    }
}

#[tauri::command]
pub async fn delete_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    if let Some((_, num_id)) = external_id.split_once(':') {
        let vnovel_id = format!("vnovel:{num_id}");
        let game_id = format!("game:{num_id}");
        conn.execute(
            "DELETE FROM media_catalog WHERE external_id = ?1 OR external_id = ?2 OR external_id = ?3",
            [&external_id, &vnovel_id, &game_id],
        )
        .map(|_| ())
        .str_err()
    } else {
        conn.execute("DELETE FROM media_catalog WHERE external_id = ?1", [&external_id])
            .map(|_| ())
            .str_err()
    }
}

#[derive(Debug, Serialize)]
pub struct CatalogHealthEntry {
    pub external_id: String,
    pub title_main: String,
    pub r#type: String,
}

#[derive(Debug, Serialize)]
pub struct CatalogHealthReport {
    pub orphans: Vec<CatalogHealthEntry>,
    pub duplicates: Vec<CatalogHealthEntry>,
}

fn row_to_health_entry(row: &rusqlite::Row) -> rusqlite::Result<CatalogHealthEntry> {
    Ok(CatalogHealthEntry {
        external_id: row.get(0)?,
        title_main: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        r#type: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
    })
}

// Settings > Entorno's "Detectar duplicados y huérfanos" — read-only.
// Orphan: nothing else in the DB references this row. Duplicate: two+ rows
// share the same (normalized title, type), e.g. cataloged twice under
// different external_ids. Flagged for manual review only, never auto-merged.
#[tauri::command]
pub async fn find_catalog_health_issues(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<CatalogHealthReport, String> {
    let conn = state.conn.lock().str_err()?;

    let mut orphan_stmt = conn.prepare(
        "SELECT mc.external_id, mc.title_main, mc.type
         FROM media_catalog mc
         WHERE NOT EXISTS (SELECT 1 FROM user_library ul WHERE ul.external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM user_list_items uli WHERE uli.external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM tier_list_items tli WHERE tli.external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM media_relations mr WHERE mr.media_external_id = mc.external_id OR mr.related_media_external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM character_appearances ca WHERE ca.media_external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM saga_relations sr WHERE sr.media_external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM media_catalog child WHERE child.parent_id = mc.external_id)
         ORDER BY mc.updated_at DESC",
    ).str_err()?;
    let orphans = orphan_stmt
        .query_map([], row_to_health_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    let mut dup_stmt = conn.prepare(
        "SELECT external_id, title_main, type FROM media_catalog
         WHERE title_main IS NOT NULL AND trim(title_main) != ''
           AND (lower(trim(title_main)), type) IN (
             SELECT lower(trim(title_main)), type FROM media_catalog
             WHERE title_main IS NOT NULL AND trim(title_main) != ''
             GROUP BY lower(trim(title_main)), type
             HAVING COUNT(*) > 1
           )
         ORDER BY lower(trim(title_main))",
    ).str_err()?;
    let duplicates = dup_stmt
        .query_map([], row_to_health_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    Ok(CatalogHealthReport { orphans, duplicates })
}

#[tauri::command]
pub async fn get_all_catalog_entries(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<MediaCatalogEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(SELECT_ALL).str_err()?;
    let entries = stmt
        .query_map([], row_to_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn search_catalog(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    query: String,
) -> Result<Vec<MediaCatalogEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = conn.prepare(
        &format!("{} WHERE lower(title_main) LIKE ?1 OR lower(title_romaji) LIKE ?1 OR lower(title_native) LIKE ?1", SELECT_VISIBLE),
    ).str_err()?;
    let entries = stmt
        .query_map([&pattern], row_to_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}
