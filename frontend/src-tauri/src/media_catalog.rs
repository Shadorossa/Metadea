use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::Manager;
use crate::db::ToStringErr;

// Fixed GitHub Release asset for the repo's shared community catalog —
// rebuilt by .github/workflows/update-database.yml (scripts/build-database.js)
// from every database/*.json a merged collaborative-catalog PR has added, and
// republished to the 'catalog-latest' release (asset overwritten in place)
// on every run. A Release asset instead of a branch-tracked raw file on
// purpose — committing the rebuilt .db straight to main on every merge would
// grow the repo's git history by a near-full binary copy forever, with no
// ceiling, at any real proposal volume.
const COMMUNITY_DB_URL: &str = "https://github.com/Shadorossa/Metadea/releases/download/catalog-latest/database.db";

// Batch existence check used by save_cached_saga / save_media_relations /
// save_author_profile_and_relations — each used to run one
// "SELECT EXISTS(...)" query per row inside its loop (N+1 against SQLite for
// an author with dozens of works, or a long saga). One IN-query up front is
// enough since every caller here only needs a yes/no per id, not row data.
fn existing_catalog_ids(
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

// The "type" half of a raw external_id (e.g. "anime:12345" -> "anime"),
// used to fill in the `type` column of a stub media_catalog row created
// for a relation target we haven't cataloged yet. split_once (not
// split().next(), which always yields at least one item and made the
// "anime" fallback unreachable) so a colon-less id actually falls back to
// "anime" instead of using the whole id string as the type. Shared by
// save_media_relations / save_author_profile_and_relations /
// import_proposal_bundle, which used to each carry their own copy.
// The saga chain (get_transitive_relation_ids' recursive CTE) only walks
// forward via a row's own media_external_id column, so every link needs its
// own outgoing edge — a PREQUEL saved on one side without the matching
// SEQUEL on the other silently breaks traversal partway through the saga.
// PrEditorModal already wrote both sides by hand (see REL_TYPE_TO_PAIR /
// its own SEQUEL+PREQUEL pair) but that only covered its own manual-save
// path; every other writer (a plain page view re-syncing relations from a
// live API fetch) saved one-sided edges. Centralizing it here means any
// current or future caller of save_media_relations/import_proposal_bundle
// gets the reciprocal edge for free.
//
// INSERT OR IGNORE (not REPLACE) at the call site — a curator may have
// deliberately classified the other side differently (e.g. SIDE_STORY
// instead of a plain SEQUEL), and a live API re-fetch must not clobber that.
fn reciprocal_relation(relation_type: &str) -> Option<(&'static str, &'static str)> {
    match relation_type {
        "SEQUEL"     => Some(("PREQUEL", "Prequel")),
        "PREQUEL"    => Some(("SEQUEL", "Sequel")),
        "SOURCE"     => Some(("ADAPTATION", "Adaptation")),
        "ADAPTATION" => Some(("SOURCE", "Source Material")),
        "EPISODE"    => Some(("PART_OF", "Part of")),
        "UPDATE"     => Some(("PART_OF", "Part of")),
        _ => None,
    }
}

// The downloaded community.db is a rebuilt-in-place, unversioned file — a
// stale download from just before some column existed would otherwise fail
// a query referencing it with "no such column". Shared by every optional-
// column guard in sync_community_catalog instead of each repeating its own
// `pragma_table_info` query.
fn attached_db_has_column(conn: &rusqlite::Connection, db: &str, table: &str, column: &str) -> bool {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM pragma_table_info('{table}', '{db}') WHERE name = '{column}'"),
        [],
        |r| r.get::<_, i64>(0),
    )
    .map(|c| c > 0)
    .unwrap_or(false)
}

fn infer_type_from_id(external_id: &str) -> String {
    external_id
        .split_once(':')
        .map(|(prefix, _)| prefix)
        .unwrap_or("anime")
        .to_string()
}

// A skeleton stub row (created for a relation/author target not yet
// cataloged locally) still knows exactly where it came from — the provider
// is implied by the external_id's own type prefix, same as cover/title/
// source are implied for any other skeleton entry. Mirrors the source
// string each mapper itself writes (anilist-mapper.ts, tmdb-mapper.ts,
// igdb-mapper.ts, openlibrary-mapper.ts, comicvine-mapper.ts).
fn infer_source_from_id(external_id: &str) -> Option<&'static str> {
    match infer_type_from_id(external_id).as_str() {
        "anime" | "manga" | "lnovel" => Some("anilist"),
        "movie" | "series" => Some("tmdb"),
        "game" | "vnovel" => Some("igdb"),
        "book" => Some("openlibrary"),
        "comic" => Some("comicvine"),
        _ => None,
    }
}

// Shared by save_media_saga_groups and import_proposal_bundle's bundle.saga_groups
// handling — both used to carry their own copy of this exact upsert-or-delete loop.
fn upsert_saga_groups(
    tx: &rusqlite::Transaction,
    groups: &std::collections::HashMap<String, String>,
) -> Result<(), String> {
    for (media_id, group_name) in groups {
        if group_name.is_empty() {
            tx.execute("DELETE FROM media_saga_groups WHERE media_external_id = ?1", [media_id]).str_err()?;
        } else {
            tx.execute(
                "INSERT OR REPLACE INTO media_saga_groups (media_external_id, group_name) VALUES (?1, ?2)",
                rusqlite::params![media_id, group_name],
            ).str_err()?;
        }
    }
    Ok(())
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

// Same as SELECT_ALL but excluding blocked rows — used by every read path
// that isn't a direct "look up this exact id" lookup (search, browse,
// relations, saga chains) so a blocked entry stays invisible everywhere
// except the editor used to block/unblock it. Backed by the
// visible_media_catalog view (db.rs) rather than repeating "blocked_at IS
// NULL" here and in every query that joins against media_catalog elsewhere
// in this file.
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

    let existing: Option<(String, String)> = conn
        .query_row(
            "SELECT id, created_at FROM media_catalog WHERE external_id = ?1",
            [&entry.external_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .str_err()?;

    if let Some((eid, eat)) = existing {
        if entry.id.is_empty() { entry.id = eid; }
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

    // authors_csv is a flat name-only display cache (see MediaPage.tsx) — the
    // real author relations (id, image, role, url) go through save_media_authors
    // / save_author_profile_and_relations into media_author/media_by_author.
    // This used to also parse authors_csv here and re-derive relational rows
    // from it, which (a) produced garbage names for any external_id containing
    // a colon (e.g. OpenLibrary's "author:/authors/OL123A" — split(':').nth(1)
    // returned the OpenLibrary key, not a name) and (b) wiped every real
    // author relation whenever authors_csv was empty, since the DELETE ran
    // unconditionally before the (then no-op) insert loop.

    Ok(entry)
}

// Records a failed live re-sync attempt without touching any other column —
// unlike save_catalog_entry (INSERT OR REPLACE against the full row), a
// failed fetch has no fresh data to write, so this only bumps the failure
// counter/message on whatever's already there. No-ops silently if the row
// doesn't exist yet (a cold first-visit failure has nothing to attach to;
// the next visit just retries since needsResync() treats a missing
// last_synced_at as always due).
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

// Narrow update for genres/tags discovered by a background fetch after the
// initial page render (Comic Vine's concepts, aggregated across every issue)
// — unlike save_catalog_entry (INSERT OR REPLACE against the full row), this
// only touches genres_csv/genres_tag_csv so it can't clobber every other
// column with stale/default values from a partial in-memory snapshot.
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

#[tauri::command]
pub async fn get_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<MediaCatalogEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        &format!("{} WHERE external_id = ?1", SELECT_ALL),
        [&external_id],
        row_to_entry,
    )
    .optional()
    .str_err()
}

#[tauri::command]
pub async fn delete_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM media_catalog WHERE external_id = ?1", [&external_id])
        .map(|_| ())
        .str_err()
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

// Admin/maintenance check for Settings > Entorno's "Detectar duplicados y
// huérfanos" button — read-only, doesn't touch anything. An "orphan" is a
// catalog row nothing else in the DB points to at all (not in the user's
// own library/lists/tiers, not part of any relation/saga/character
// appearance, not another row's parent) — safe to review for deletion via
// the existing delete_catalog_entry. A "duplicate" is two or more rows
// sharing the same (normalized title, type) — likely the same work
// cataloged twice under different external_ids (e.g. from two different
// source providers) — flagged for manual review only, never auto-merged.
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SagaEntry {
    #[serde(rename = "externalId")]
    pub external_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub format: Option<String>,
    #[serde(rename = "mediaType")]
    pub media_type: String,
    pub year: Option<i32>,
    pub month: Option<i32>,
    pub day: Option<i32>,
}

#[tauri::command]
pub async fn get_cached_saga(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<Vec<SagaEntry>>, String> {
    let conn = state.conn.lock().str_err()?;

    // 1. Check if the external_id is mapped to a saga
    let saga_id: Option<String> = conn
        .query_row(
            "SELECT saga_id FROM saga_relations WHERE media_external_id = ?1",
            [&external_id],
            |row| row.get(0),
        )
        .optional()
        .str_err()?;

    let saga_id = match saga_id {
        Some(sid) => sid,
        None => return Ok(None),
    };

    // 2. Fetch all entries related to this saga_id
    let mut stmt = conn
        .prepare(
            "SELECT mc.external_id, mc.title_main, mc.cover_url, mc.format, mc.type, mc.release_year, mc.release_month, mc.release_day
             FROM saga_relations sr
             JOIN visible_media_catalog mc ON mc.external_id = sr.media_external_id
             WHERE sr.saga_id = ?1",
        )
        .str_err()?;

    let entries: Vec<SagaEntry> = stmt
        .query_map([&saga_id], |row| {
            let external_id: String = row.get::<_, Option<String>>(0)?.unwrap_or_default();
            let title: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let cover: Option<String> = row.get(2)?;
            let format: Option<String> = row.get(3)?;
            let media_type: String = row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "anime".to_string());
            let year: Option<i32> = row.get(5)?;
            let month: Option<i32> = row.get(6)?;
            let day: Option<i32> = row.get(7)?;

            Ok(SagaEntry {
                external_id,
                title,
                cover,
                format,
                media_type,
                year,
                month,
                day,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    if entries.is_empty() {
        Ok(None)
    } else {
        // Sort entries by date locally to ensure correct timeline
        let mut sorted = entries;
        sorted.sort_by(|a, b| {
            let ay = a.year.unwrap_or(9999);
            let by = b.year.unwrap_or(9999);
            if ay != by {
                return ay.cmp(&by);
            }
            let am = a.month.unwrap_or(12);
            let bm = b.month.unwrap_or(12);
            if am != bm {
                return am.cmp(&bm);
            }
            let ad = a.day.unwrap_or(31);
            let bd = b.day.unwrap_or(31);
            ad.cmp(&bd)
        });
        Ok(Some(sorted))
    }
}

#[tauri::command]
pub async fn save_cached_saga(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    entries: Vec<SagaEntry>,
    saga_name: String,
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }

    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    // Anchor the saga_id on the lexicographically-smallest external_id rather
    // than entries[0] — the caller's array order isn't guaranteed (the TS side
    // sorts chronologically before calling, but nothing enforces that here),
    // and anchoring on array position meant saving the same saga twice with a
    // differently-ordered list would mint a second saga_id, orphaning the
    // previous saga_relations rows.
    let anchor = entries
        .iter()
        .min_by(|a, b| a.external_id.cmp(&b.external_id))
        .expect("entries is non-empty, checked above");
    let saga_id = anchor.external_id.clone();
    let final_saga_name = if saga_name.is_empty() { anchor.title.clone() } else { saga_name };

    // 1. Insert saga
    tx.execute(
        "INSERT OR REPLACE INTO sagas (id, name) VALUES (?1, ?2)",
        rusqlite::params![&saga_id, &final_saga_name],
    )
    .str_err()?;

    // 2. Insert entries into media_catalog (minimal metadata for caching) and relations
    let all_ids: Vec<String> = entries.iter().map(|e| e.external_id.clone()).collect();
    let existing_ids = existing_catalog_ids(&tx, &all_ids)?;

    // Remove stale members — previously this only INSERT OR REPLACED, so an
    // entry deliberately removed from the saga by the user would linger in
    // saga_relations indefinitely and keep appearing in getCachedSaga.
    // Delete the full old set first so the final set exactly matches what
    // was passed in.
    tx.execute(
        "DELETE FROM saga_relations WHERE saga_id = ?1",
        rusqlite::params![&saga_id],
    )
    .str_err()?;

    for entry in &entries {
        let now = Utc::now().to_rfc3339();

        if !existing_ids.contains(&entry.external_id) {
            tx.execute(
                "INSERT INTO media_catalog (
                    id, external_id, type, source, format, title_main, cover_url, release_year, release_month, release_day, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &entry.external_id,
                    &entry.media_type,
                    infer_source_from_id(&entry.external_id),
                    &entry.format,
                    &entry.title,
                    &entry.cover,
                    &entry.year,
                    &entry.month,
                    &entry.day,
                    &now,
                    &now,
                ],
            )
            .str_err()?;
        }

        // Insert relation
        tx.execute(
            "INSERT OR REPLACE INTO saga_relations (media_external_id, saga_id) VALUES (?1, ?2)",
            rusqlite::params![&entry.external_id, &saga_id],
        )
        .str_err()?;
    }

    tx.commit().str_err()?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct DbMediaRelation {
    /// Owning media for this relation — absent for save_media_relations/
    /// get_media_relations calls (the media_external_id is already the
    /// function's own parameter there), present when this row travels inside
    /// a ProposalBundle, which can carry relations for more than one media
    /// (a saga PR touches every entry in the chain, not just one).
    pub media_external_id: Option<String>,
    pub related_media_external_id: String,
    pub relation_type: String,
    pub type_label: String,
    pub title: String,
    pub cover: Option<String>,
}

#[tauri::command]
pub async fn save_media_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
    relations: Vec<DbMediaRelation>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    // Snapshot of related ids before the replace below, to diff against the
    // incoming list and keep deleted_relations in sync with what the caller
    // actually removed vs. kept/re-added.
    let previous_related_ids: HashSet<String> = {
        let mut stmt = tx.prepare(
            "SELECT related_media_external_id FROM media_relations WHERE media_external_id = ?1"
        ).str_err()?;
        let rows = stmt.query_map([&media_external_id], |r| r.get::<_, String>(0)).str_err()?;
        rows.filter_map(|r| r.ok()).collect()
    };

    tx.execute(
        "DELETE FROM media_relations WHERE media_external_id = ?1",
        [&media_external_id],
    )
    .str_err()?;

    let now = Utc::now().to_rfc3339();

    let all_ids: Vec<String> = relations.iter().map(|r| r.related_media_external_id.clone()).collect();
    let existing_ids = existing_catalog_ids(&tx, &all_ids)?;

    let new_related_ids: HashSet<String> = relations.iter()
        .filter(|r| r.related_media_external_id != media_external_id)
        .map(|r| r.related_media_external_id.clone())
        .collect();

    // A pair that existed before this save but is absent from the new list
    // was deliberately removed by whoever called this — tombstone it so a
    // future live/community relation merge doesn't silently bring it back.
    // Anything now present (kept or deliberately re-added) must not stay
    // tombstoned from an earlier deletion.
    for removed_id in previous_related_ids.difference(&new_related_ids) {
        tx.execute(
            "INSERT OR REPLACE INTO deleted_relations (media_external_id, related_media_external_id, deleted_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![&media_external_id, removed_id, &now],
        ).str_err()?;
    }
    for kept_id in &new_related_ids {
        tx.execute(
            "DELETE FROM deleted_relations WHERE media_external_id = ?1 AND related_media_external_id = ?2",
            rusqlite::params![&media_external_id, kept_id],
        ).str_err()?;
    }

    for rel in relations {
        // A media can't be related to itself — silently drop rather than
        // erroring, since this can only come from a bad merge/edit upstream
        // and shouldn't block saving everything else the user changed.
        if rel.related_media_external_id == media_external_id {
            continue;
        }

        tx.execute(
            "INSERT OR REPLACE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                &media_external_id,
                &rel.related_media_external_id,
                &rel.relation_type,
                &rel.type_label,
            ],
        )
        .str_err()?;

        if let Some((recip_type, recip_label)) = reciprocal_relation(&rel.relation_type) {
            tx.execute(
                "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![&rel.related_media_external_id, &media_external_id, recip_type, recip_label],
            )
            .str_err()?;
        }

        if !existing_ids.contains(&rel.related_media_external_id) {
            let rel_type = infer_type_from_id(&rel.related_media_external_id);
            tx.execute(
                "INSERT INTO media_catalog (
                    id, external_id, type, source, title_main, cover_url, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &rel.related_media_external_id,
                    &rel_type,
                    infer_source_from_id(&rel.related_media_external_id),
                    &rel.title,
                    &rel.cover,
                    &now,
                    &now,
                ],
            )
            .str_err()?;
        }
    }

    tx.commit().str_err()?;
    Ok(())
}

// Read side of the deleted_relations tombstone table — mergeAndPersistRelations
// (TS) calls this before merging a live/community relation list back in, so
// it can skip re-adding any pair the user deliberately removed here.
#[tauri::command]
pub async fn get_deleted_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT related_media_external_id FROM deleted_relations WHERE media_external_id = ?1"
    ).str_err()?;
    let rows = stmt.query_map([&media_external_id], |r| r.get::<_, String>(0)).str_err()?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub async fn get_media_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<DbMediaRelation>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT mr.related_media_external_id, mr.relation_type, mr.type_label, mc.title_main, mc.cover_url
             FROM media_relations mr
             JOIN visible_media_catalog mc ON mc.external_id = mr.related_media_external_id
             WHERE mr.media_external_id = ?1
             ORDER BY mr.rowid",
        )
        .str_err()?;

    let rows = stmt
        .query_map([&media_external_id], |row| {
            Ok(DbMediaRelation {
                media_external_id: None, // this query is already scoped to one media_external_id param
                related_media_external_id: row.get(0)?,
                relation_type: row.get(1)?,
                type_label: row.get(2)?,
                title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                cover: row.get(4)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

// Bulk fetch for the library grid's "group by edition/saga" toggle — grouping
// anime/manga/lnovel by SEQUEL/PREQUEL needs every relation up front to build
// the parent/child map client-side, instead of one get_media_relations round
// trip per library item (which is what the per-media query above is for).
#[tauri::command]
pub async fn get_all_media_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<DbMediaRelation>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT mr.media_external_id, mr.related_media_external_id, mr.relation_type, mr.type_label, mc.title_main, mc.cover_url
             FROM media_relations mr
             JOIN visible_media_catalog mc ON mc.external_id = mr.related_media_external_id",
        )
        .str_err()?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DbMediaRelation {
                media_external_id: row.get(0)?,
                related_media_external_id: row.get(1)?,
                relation_type: row.get(2)?,
                type_label: row.get(3)?,
                title: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                cover: row.get(5)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct DbMediaAuthor {
    pub external_id: String,
    pub name: String,
    pub image: Option<String>,
    pub role: Option<String>,
    pub url: Option<String>,
}

#[tauri::command]
pub async fn save_media_authors(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
    authors: Vec<DbMediaAuthor>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    tx.execute(
        "DELETE FROM media_by_author WHERE media_external_id = ?1",
        [&media_external_id],
    )
    .str_err()?;

    let now = Utc::now().to_rfc3339();

    for auth in authors {
        tx.execute(
            "INSERT OR REPLACE INTO media_author (external_id, name, author_image_url, author_url, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                &auth.external_id,
                &auth.name,
                &auth.image,
                &auth.url,
                &now,
            ],
        )
        .str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO media_by_author (media_external_id, author_external_id, role)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![
                &media_external_id,
                &auth.external_id,
                &auth.role,
            ],
        )
        .str_err()?;
    }

    tx.commit().str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn get_media_authors(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<DbMediaAuthor>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT ma.external_id, ma.name, ma.author_image_url, ma.author_url, mba.role
             FROM media_by_author mba
             JOIN media_author ma ON ma.external_id = mba.author_external_id
             WHERE mba.media_external_id = ?1",
        )
        .str_err()?;

    let rows = stmt
        .query_map([&media_external_id], |row| {
            Ok(DbMediaAuthor {
                external_id: row.get(0)?,
                name: row.get(1)?,
                image: row.get(2)?,
                url: row.get(3)?,
                role: row.get(4)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthorWorkRelation {
    pub media_external_id: String,
    pub role: Option<String>,
    pub title: String,
    pub cover: Option<String>,
}

#[tauri::command]
pub async fn save_author_profile_and_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    author: DbMediaAuthor,
    relations: Vec<AuthorWorkRelation>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    let now = Utc::now().to_rfc3339();

    // 1. Save or replace author profile in media_author
    tx.execute(
        "INSERT OR REPLACE INTO media_author (external_id, name, author_image_url, author_url, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            &author.external_id,
            &author.name,
            &author.image,
            &author.url,
            &now,
        ],
    )
    .str_err()?;

    // 2. Clear previous relations for this author in media_by_author
    tx.execute(
        "DELETE FROM media_by_author WHERE author_external_id = ?1",
        [&author.external_id],
    )
    .str_err()?;

    // 3. Save works and relationships
    let all_ids: Vec<String> = relations.iter().map(|r| r.media_external_id.clone()).collect();
    let existing_ids = existing_catalog_ids(&tx, &all_ids)?;

    for rel in relations {
        tx.execute(
            "INSERT OR REPLACE INTO media_by_author (media_external_id, author_external_id, role)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![
                &rel.media_external_id,
                &author.external_id,
                &rel.role,
            ],
        )
        .str_err()?;

        if !existing_ids.contains(&rel.media_external_id) {
            let rel_type = infer_type_from_id(&rel.media_external_id);
            tx.execute(
                "INSERT INTO media_catalog (id, external_id, type, source, title_main, cover_url, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![crate::db::generate_id(), &rel.media_external_id, &rel_type, infer_source_from_id(&rel.media_external_id), &rel.title, &rel.cover, &now, &now],
            ).str_err()?;
        }
    }

    tx.commit().str_err()?;
    Ok(())
}

// Downloads the repo's shared community catalog (built from merged
// collaborative-catalog PRs) and merges its rows into the local media_catalog.
// Uses INSERT OR IGNORE via ATTACH DATABASE so it only fills in ids the user
// doesn't already have locally — never overwrites a user's own library data,
// local edits, or anything fetched live from an API.
#[tauri::command]
pub async fn sync_community_catalog(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<i64, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .str_err()?;
    let resp = client
        .get(COMMUNITY_DB_URL)
        .send()
        .await
        .str_err()?;

    if !resp.status().is_success() {
        return Err(format!("Failed to download community catalog: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.str_err()?;

    let cache_dir = app_handle.path().app_cache_dir().str_err()?;
    std::fs::create_dir_all(&cache_dir).str_err()?;
    let temp_path = cache_dir.join("community_catalog_tmp.db");
    std::fs::write(&temp_path, &bytes).str_err()?;
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let imported = (|| -> Result<i64, String> {
        let conn = state.conn.lock().str_err()?;

        conn.execute("ATTACH DATABASE ?1 AS community", rusqlite::params![temp_path_str])
            .str_err()?;
        // Counts every row actually inserted/updated across the whole merge
        // below (new catalog entries, relations, characters, authors, sagas,
        // and the gap-filled banners/genres/etc.) — not just brand new
        // media_catalog rows — so the UI can tell "the community added
        // something for you" from "nothing changed" even when every title
        // involved was already in your local catalog.
        let mut changes: i64 = 0;
        let merge_result = (|| -> Result<(), String> {
            // Column list is explicit (not `SELECT *`) on purpose: DBs upgraded
            // via the `ALTER TABLE ... ADD COLUMN authors_csv` migration in
            // db.rs have authors_csv as their *last* physical column, while a
            // fresh DB (this downloaded community one included) has it inline
            // per METADEA_SCHEMA's CREATE TABLE text — position-based `SELECT *`
            // would silently shift every column after the mismatch into the
            // wrong field.
            // blocked_at is a curator flag ("hide this remaster/edition
            // everywhere") that IS meant to propagate community-wide, so a
            // blocked entry someone proposed reaches every other user's
            // catalog the same way any other collaborative-catalog field
            // does. Guarded by attached_db_has_column in case this
            // community.db predates the column.
            let possible_cols = [
                "id", "external_id", "authors_csv", "banners_csv", "country_code", "cover_url",
                "developer_badge", "favorites_count", "format", "genres_csv", "genres_tag_csv",
                "last_sync_error", "last_synced_at", "parent_id", "platforms_csv", "publishers_csv",
                "ratings_count", "release_day", "release_end_day", "release_end_month", "release_end_year",
                "release_month", "release_year", "score_global",
                "shop_links_csv", "source", "source_url", "status", "sync_failed_count", "synopsis",
                "time_length", "title_english", "title_main", "title_native", "title_romaji", "total_count", "total_count_2",
                "type"
            ];

            let mut select_cols = Vec::new();
            for col in possible_cols {
                if attached_db_has_column(&conn, "community", "media_catalog", col) {
                    select_cols.push(col);
                }
            }

            let has_blocked_col = attached_db_has_column(&conn, "community", "media_catalog", "blocked_at");
            
            let mut insert_cols_str = select_cols.join(", ");
            let mut select_cols_str = select_cols.join(", ");

            if has_blocked_col {
                insert_cols_str.push_str(", blocked_at");
                select_cols_str.push_str(", blocked_at");
            }

            insert_cols_str.push_str(", created_at, updated_at");
            select_cols_str.push_str(", created_at, updated_at");

            changes += conn.execute(
                &format!(
                    "INSERT OR IGNORE INTO media_catalog ({insert_cols_str})
                     SELECT {select_cols_str}
                     FROM community.media_catalog"
                ),
                [],
            ).str_err()? as i64;

            // For entries that already existed locally (the INSERT OR IGNORE
            // above only benefits brand-new rows), adopt a community block
            // that isn't reflected here yet — same "fill gaps only" shape as
            // the columns below, so a local unblock decision (blocked_at
            // already NULL after the user re-enabled it) is never
            // overwritten, but a fresh community-wide block still reaches
            // every other user's install once it merges.
            if has_blocked_col {
                changes += conn.execute(
                    "UPDATE media_catalog
                     SET blocked_at = (SELECT c.blocked_at FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id)
                     WHERE blocked_at IS NULL
                       AND EXISTS (SELECT 1 FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id AND c.blocked_at IS NOT NULL)",
                    [],
                ).str_err()? as i64;
            }

            // The INSERT OR IGNORE above only benefits entries the user's
            // local catalog doesn't have at all — for anything already
            // cached (the common case, since the live API sync populates
            // most rows before anyone ever opens the collaborative editor on
            // them), it's silently skipped. That's fine for fields the live
            // API sync keeps fresh (title, dates, score, status...), but
            // banners/genres/companies/authors are *only* ever set through
            // the collaborative catalog — an existing row can otherwise never
            // receive a merged PR's update to those fields. Fill them in only
            // where the local value is still empty, so a manual edit already
            // present locally (or a fresher live-synced value) is never
            // clobbered.
            // Same "fill gaps only" shape for every gap-fillable column —
            // built as one parameterized statement instead of five
            // hand-copied UPDATEs that used to drift if only one got edited.
            for col in ["banners_csv", "genres_csv", "genres_tag_csv", "publishers_csv", "authors_csv"] {
                if attached_db_has_column(&conn, "community", "media_catalog", col) {
                    changes += conn.execute(
                        &format!(
                            "UPDATE media_catalog
                             SET {col} = (SELECT c.{col} FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id)
                             WHERE ({col} IS NULL OR {col} = '')
                               AND blocked_at IS NULL
                               AND EXISTS (SELECT 1 FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id AND c.{col} IS NOT NULL AND c.{col} != '')"
                        ),
                        [],
                    ).str_err()? as i64;
                }
            }

            // Characters a PR carried over from the entry's already-cached
            // appearances (see PrEditorModal's bundle export) — merge both
            // the character rows and their media links the same "fill gaps
            // only" way.
            changes += conn.execute(
                "INSERT OR IGNORE INTO characters (id, external_id, name, name_native, aliases_csv, biography, image_url, reaction, created_at, updated_at)
                 SELECT id, external_id, name, name_native, aliases_csv, biography, image_url, reaction, created_at, updated_at FROM community.characters",
                [],
            ).str_err()? as i64;
            changes += conn.execute(
                "INSERT OR IGNORE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, added_at)
                 SELECT c.character_external_id, c.media_external_id, c.relation_type, c.character_name, c.added_at
                 FROM community.character_appearances c
                 WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                [],
            ).str_err()? as i64;

            // Relations (bundled-in episodes/updates, saga-derived prequel/
            // sequel, and any other relation a PR carried over) — same
            // fill-gaps merge, keyed by the table's own composite PK so this
            // never overwrites a relation the user's own API sync produced.
            // Excludes any pair the user has deliberately deleted locally:
            // the community catalog can carry an older relation (e.g. from a
            // different, earlier PR touching the same pair) that's since
            // been removed here — the exact same "can't tell a deletion
            // from never-synced" problem a live API resync has, so it gets
            // the same per-pair tombstone guard (see deleted_relations).
            changes += conn.execute(
                "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 SELECT c.media_external_id, c.related_media_external_id, c.relation_type, c.type_label
                 FROM community.media_relations c
                 WHERE c.media_external_id != c.related_media_external_id
                   AND NOT EXISTS (
                     SELECT 1 FROM deleted_relations dr
                     WHERE dr.media_external_id = c.media_external_id AND dr.related_media_external_id = c.related_media_external_id
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM blocked_media_catalog mc
                     WHERE mc.external_id IN (c.media_external_id, c.related_media_external_id)
                   )",
                [],
            ).str_err()? as i64;

            // Authors carried over the same "fill gaps only" way.
            changes += conn.execute(
                "INSERT OR IGNORE INTO media_author (external_id, name, author_image_url, author_url, created_at, updated_at)
                 SELECT external_id, name, author_image_url, author_url, created_at, updated_at FROM community.media_author",
                [],
            ).str_err()? as i64;
            changes += conn.execute(
                "INSERT OR IGNORE INTO media_by_author (media_external_id, author_external_id, role)
                 SELECT media_external_id, author_external_id, role FROM community.media_by_author c
                 WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                [],
            ).str_err()? as i64;

            // Custom saga display name and per-entry saga sub-group labels
            // (both editable in PrEditorModal, both exported in every PR
            // bundle — see saga_groups/saga_name there) — same fill-gaps
            // merge as everything else above. Guarded by a table-existence
            // check because these three tables were only added to
            // build-database.js's output alongside this merge; a community
            // catalog built by an older workflow run won't have them yet.
            let has_saga_tables: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM community.sqlite_master WHERE type = 'table' AND name = 'media_saga_groups'",
                    [],
                    |r| r.get(0),
                )
                .map(|c: i64| c > 0)
                .unwrap_or(false);

            if has_saga_tables {
                changes += conn.execute(
                    "INSERT OR IGNORE INTO media_saga_groups (media_external_id, group_name)
                     SELECT c.media_external_id, c.group_name FROM community.media_saga_groups c
                     WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                    [],
                ).str_err()? as i64;
                changes += conn.execute(
                    "INSERT OR IGNORE INTO sagas (id, name)
                     SELECT id, name FROM community.sagas",
                    [],
                ).str_err()? as i64;
                changes += conn.execute(
                    "INSERT OR IGNORE INTO saga_relations (media_external_id, saga_id)
                     SELECT c.media_external_id, c.saga_id FROM community.saga_relations c
                     WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                    [],
                ).str_err()? as i64;
            }

            // ── Community-side deletions ────────────────────────────────
            // The downloaded database.db is a full, current snapshot of the
            // community catalog — anything in community_synced_ids (this
            // client's snapshot from the *previous* sync) but missing from
            // community.media_catalog now was removed upstream (e.g. via a
            // merged collaborative-editor PR that deleted a saga entry).
            // Only actually deleted locally when the user doesn't have it in
            // their own library — a community removal must never touch
            // something the user is tracking. On a first-ever sync,
            // community_synced_ids is still empty, so nothing here matches
            // and nothing gets deleted — only the snapshot refresh below runs.
            let removed_ids: Vec<String> = {
                let mut stmt = conn.prepare(
                    "SELECT s.external_id FROM community_synced_ids s
                     WHERE NOT EXISTS (SELECT 1 FROM community.media_catalog c WHERE c.external_id = s.external_id)
                       AND NOT EXISTS (SELECT 1 FROM user_library l WHERE l.external_id = s.external_id)"
                ).str_err()?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0)).str_err()?;
                rows.collect::<Result<Vec<_>, _>>().str_err()?
            };

            if !removed_ids.is_empty() {
                // One DELETE per table for the whole batch instead of one
                // per table *per id* — same end result, a fraction of the
                // round trips against the connection.
                let placeholders = removed_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                let ids_params = rusqlite::params_from_iter(removed_ids.iter());
                conn.execute(&format!("DELETE FROM media_catalog WHERE external_id IN ({placeholders})"), ids_params).str_err()?;

                let ids_params = rusqlite::params_from_iter(removed_ids.iter().chain(removed_ids.iter()));
                conn.execute(
                    &format!("DELETE FROM media_relations WHERE media_external_id IN ({placeholders}) OR related_media_external_id IN ({placeholders})"),
                    ids_params,
                ).str_err()?;

                for (table, column) in [
                    ("character_appearances", "media_external_id"),
                    ("media_staff_relation", "media_external_id"),
                    ("media_by_author", "media_external_id"),
                    ("media_saga_groups", "media_external_id"),
                    ("saga_relations", "media_external_id"),
                ] {
                    let ids_params = rusqlite::params_from_iter(removed_ids.iter());
                    conn.execute(&format!("DELETE FROM {table} WHERE {column} IN ({placeholders})"), ids_params).str_err()?;
                }
            }
            changes += removed_ids.len() as i64;

            // Refresh the snapshot to the current community set so the next
            // sync's diff is against what's actually live now.
            conn.execute("DELETE FROM community_synced_ids", []).str_err()?;
            conn.execute(
                "INSERT INTO community_synced_ids (external_id) SELECT external_id FROM community.media_catalog",
                [],
            ).str_err()?;

            Ok(())
        })();
        conn.execute("DETACH DATABASE community", []).str_err()?;
        merge_result?;

        Ok(changes)
    })();

    let _ = std::fs::remove_file(&temp_path);

    imported
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ProposalBundle {
    pub media_catalog: MediaCatalogEntry,
    // DbMediaRelation already carries an optional media_external_id (see its
    // definition above) — no need for a near-identical ProposalRelation
    // struct that only differed by that one field.
    pub media_relations: Vec<DbMediaRelation>,
    pub characters: Vec<crate::characters::SkeletonCharacter>,
    pub media_authors: Vec<DbMediaAuthor>,
    pub saga_groups: Option<std::collections::HashMap<String, String>>,
    pub saga_name: Option<String>,
}

pub fn sync_local_proposals(db: &crate::db::MetadeaDb) -> Result<(), String> {
    let db_path = std::env::current_dir().unwrap_or_default();
    let mut database_dir = db_path.join("database");
    if !database_dir.exists() {
        if let Some(parent) = std::env::current_dir().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())) {
            database_dir = parent.join("database");
        }
    }

    if !database_dir.exists() {
        return Ok(());
    }

    let entries = std::fs::read_dir(database_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            match std::fs::read_to_string(&path) {
                Ok(content) => {
                    match serde_json::from_str::<ProposalBundle>(&content) {
                        Ok(bundle) => {
                            if let Err(e) = import_proposal_bundle(db, bundle) {
                                eprintln!("Failed to import bundle {:?}: {}", path, e);
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to deserialize bundle {:?}: {}", path, e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to read proposal file {:?}: {}", path, e);
                }
            }
        }
    }

    Ok(())
}

// import_proposal_bundle used to be one 275-line function covering all five
// bundle sections inline — split into one helper per section (still run
// inside the same transaction, so the whole import stays atomic) purely for
// readability; no behavior changes from the original SQL.
fn upsert_bundle_catalog_entry(tx: &rusqlite::Transaction, entry: &MediaCatalogEntry) -> Result<(), String> {
    let exists_val: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM media_catalog WHERE external_id = ?1",
            [&entry.external_id],
            |row| row.get(0),
        )
        .str_err()?;

    if exists_val == 0 {
        tx.execute(
            "INSERT INTO media_catalog (
                id, external_id, authors_csv, banners_csv, blocked_at, country_code, cover_url,
                developer_badge, favorites_count, format, genres_csv, genres_tag_csv,
                last_sync_error, last_synced_at, parent_id, platforms_csv, publishers_csv,
                ratings_count, release_day, release_end_day, release_end_month, release_end_year,
                release_month, release_year, score_global,
                shop_links_csv, source, source_url, status, sync_failed_count, synopsis,
                time_length, title_english, title_main, title_native, title_romaji, total_count, total_count_2,
                type, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38, ?39, ?40, ?41)",
            rusqlite::params![
                crate::db::generate_id(),
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
        )
        .str_err()?;
    } else {
        tx.execute(
            "UPDATE media_catalog SET
                authors_csv = ?1, banners_csv = ?2, blocked_at = ?3, country_code = ?4, cover_url = ?5,
                developer_badge = ?6, favorites_count = ?7, format = ?8, genres_csv = ?9,
                genres_tag_csv = ?10, last_sync_error = ?11, last_synced_at = ?12, parent_id = ?13,
                platforms_csv = ?14, publishers_csv = ?15, ratings_count = ?16, release_day = ?17,
                release_end_day = ?18, release_end_month = ?19, release_end_year = ?20,
                release_month = ?21, release_year = ?22, score_global = ?23, shop_links_csv = ?24,
                source = ?25, source_url = ?26, status = ?27, sync_failed_count = ?28,
                synopsis = ?29, time_length = ?30, title_english = ?31, title_main = ?32, title_native = ?33,
                title_romaji = ?34, total_count = ?35, total_count_2 = ?36, type = ?37,
                updated_at = ?38
             WHERE external_id = ?39",
            rusqlite::params![
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
                &entry.updated_at,
                &entry.external_id,
            ],
        )
        .str_err()?;
    }
    Ok(())
}

// Owners are the distinct media_external_id each row is tagged for
// (defaulting to this entry's own id when untagged) — only *their* existing
// relations get cleared before re-inserting the bundle's rows for them, in
// one statement instead of the previous O(owners × targets) DELETE-per-pair.
// Scoping the DELETE to owners also fixes a correctness bug: the old
// pairwise delete wiped *any* existing relation between two ids merely
// mentioned here, even if a different, unrelated PR had contributed it and
// this bundle never touches that owner at all. Returns the owner list since
// the saga_name section later needs it too.
fn replace_bundle_relations(
    tx: &rusqlite::Transaction,
    entry: &MediaCatalogEntry,
    relations: &[DbMediaRelation],
    now: &str,
) -> Result<Vec<String>, String> {
    let owners: Vec<String> = {
        let mut set = std::collections::HashSet::new();
        for rel in relations {
            set.insert(rel.media_external_id.clone().unwrap_or_else(|| entry.external_id.clone()));
        }
        set.into_iter().collect()
    };

    if !owners.is_empty() {
        let placeholders = owners.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM media_relations WHERE media_external_id IN ({})", placeholders);
        tx.execute(&sql, rusqlite::params_from_iter(owners.iter())).str_err()?;
    }

    // One batch existence check instead of a per-row query (was the same N+1
    // existing_catalog_ids was written to fix elsewhere in this file) — kept
    // mutable so a related id appearing more than once in the same bundle
    // still only gets its stub catalog row inserted once.
    let related_ids: Vec<String> = relations.iter().map(|r| r.related_media_external_id.clone()).collect();
    let mut known_ids = existing_catalog_ids(&tx, &related_ids)?;

    for rel in relations {
        let parent_id = rel.media_external_id.as_deref().unwrap_or(&entry.external_id);

        // A media can't be related to itself.
        if rel.related_media_external_id == parent_id {
            continue;
        }

        tx.execute(
            "INSERT OR REPLACE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                parent_id,
                &rel.related_media_external_id,
                &rel.relation_type,
                &rel.type_label,
            ],
        )
        .str_err()?;

        if let Some((recip_type, recip_label)) = reciprocal_relation(&rel.relation_type) {
            tx.execute(
                "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![&rel.related_media_external_id, parent_id, recip_type, recip_label],
            )
            .str_err()?;
        }

        if !known_ids.contains(&rel.related_media_external_id) {
            let rel_type = infer_type_from_id(&rel.related_media_external_id);

            tx.execute(
                "INSERT INTO media_catalog (
                    id, external_id, type, source, title_main, cover_url, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &rel.related_media_external_id,
                    &rel_type,
                    infer_source_from_id(&rel.related_media_external_id),
                    &rel.title,
                    &rel.cover,
                    now,
                    now,
                ],
            )
            .str_err()?;
            known_ids.insert(rel.related_media_external_id.clone());
        }
    }

    Ok(owners)
}

fn replace_bundle_characters(
    tx: &rusqlite::Transaction,
    entry: &MediaCatalogEntry,
    characters: &[crate::characters::SkeletonCharacter],
    now: &str,
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM character_appearances WHERE media_external_id = ?1",
        [&entry.external_id],
    )
    .str_err()?;

    for char in characters {
        tx.execute(
            "INSERT OR IGNORE INTO characters (id, external_id, name, image_url, reaction, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                crate::db::generate_id(),
                &char.external_id,
                &char.name,
                &char.image_url,
                None::<String>,
                now,
                now,
            ],
        )
        .str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                &char.external_id,
                &entry.external_id,
                &char.relation_type,
                &char.character_name,
                now,
            ],
        )
        .str_err()?;
    }
    Ok(())
}

fn replace_bundle_authors(
    tx: &rusqlite::Transaction,
    entry: &MediaCatalogEntry,
    authors: &[DbMediaAuthor],
    now: &str,
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM media_by_author WHERE media_external_id = ?1",
        [&entry.external_id],
    )
    .str_err()?;

    for auth in authors {
        tx.execute(
            "INSERT OR REPLACE INTO media_author (external_id, name, author_image_url, author_url, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                &auth.external_id,
                &auth.name,
                &auth.image,
                &auth.url,
                now,
            ],
        )
        .str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO media_by_author (media_external_id, author_external_id, role)
             VALUES (?1, ?2, ?3)",
            rusqlite::params![
                &entry.external_id,
                &auth.external_id,
                &auth.role,
            ],
        )
        .str_err()?;
    }
    Ok(())
}

fn upsert_bundle_saga_name(
    tx: &rusqlite::Transaction,
    entry: &MediaCatalogEntry,
    owners: &[String],
    saga_name: &str,
) -> Result<(), String> {
    let saga_id = owners.iter().min().cloned().unwrap_or_else(|| entry.external_id.clone());
    tx.execute(
        "INSERT OR REPLACE INTO sagas (id, name) VALUES (?1, ?2)",
        rusqlite::params![&saga_id, saga_name],
    )
    .str_err()?;

    for owner in owners {
        tx.execute(
            "INSERT OR REPLACE INTO saga_relations (saga_id, media_external_id) VALUES (?1, ?2)",
            rusqlite::params![&saga_id, owner],
        )
        .str_err()?;
    }
    Ok(())
}

pub fn import_proposal_bundle(db: &crate::db::MetadeaDb, bundle: ProposalBundle) -> Result<(), String> {
    let mut conn = db.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    let now = Utc::now().to_rfc3339();
    let entry = bundle.media_catalog;

    upsert_bundle_catalog_entry(&tx, &entry)?;
    let owners = replace_bundle_relations(&tx, &entry, &bundle.media_relations, &now)?;
    replace_bundle_characters(&tx, &entry, &bundle.characters, &now)?;
    replace_bundle_authors(&tx, &entry, &bundle.media_authors, &now)?;

    if let Some(saga_groups) = &bundle.saga_groups {
        upsert_saga_groups(&tx, saga_groups)?;
    }
    if let Some(saga_name) = &bundle.saga_name {
        upsert_bundle_saga_name(&tx, &entry, &owners, saga_name)?;
    }

    tx.commit().str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn get_transitive_relation_ids(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "WITH RECURSIVE saga_graph(id) AS (
            SELECT ?1
            UNION
            SELECT mr.related_media_external_id
            FROM media_relations mr
            JOIN saga_graph sg ON sg.id = mr.media_external_id
            JOIN visible_media_catalog mc ON mc.external_id = mr.related_media_external_id
            WHERE mr.relation_type IN ('PREQUEL', 'SEQUEL')
        )
        SELECT id FROM saga_graph"
    ).str_err()?;

    let rows = stmt.query_map([&media_external_id], |row| row.get::<_, String>(0)).str_err()?;
    let ids: Vec<String> = rows.filter_map(|r| r.ok()).collect();
    Ok(ids)
}

#[tauri::command]
pub async fn save_media_saga_groups(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    groups: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    upsert_saga_groups(&tx, &groups)?;
    tx.commit().str_err()
}

#[tauri::command]
// Scoped to the ids the caller actually cares about (the saga chain's
// transitive relation ids) rather than the whole table — media_saga_groups
// has no natural upper bound as the catalog grows, and every entry only
// ever needs the handful of groups belonging to its own saga.
pub async fn get_media_saga_groups(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut map = std::collections::HashMap::new();
    if media_external_ids.is_empty() {
        return Ok(map);
    }

    let conn = state.conn.lock().str_err()?;
    let placeholders = media_external_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT media_external_id, group_name FROM media_saga_groups WHERE media_external_id IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&sql).str_err()?;
    let params = rusqlite::params_from_iter(media_external_ids.iter());
    let rows = stmt.query_map(params, |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).str_err()?;

    for row in rows.filter_map(|r| r.ok()) {
        map.insert(row.0, row.1);
    }
    Ok(map)
}

#[tauri::command]
pub async fn get_saga_name(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Option<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let name: Option<String> = conn
        .query_row(
            "SELECT s.name FROM saga_relations sr JOIN sagas s ON s.id = sr.saga_id WHERE sr.media_external_id = ?1",
            [&media_external_id],
            |row| row.get(0),
        )
        .optional()
        .str_err()?;
    Ok(name)
}

// Bulk variant of get_saga_name — the library grid's saga grouping needs the
// assigned name (if any) for every owned work in one round trip instead of
// one get_saga_name call per item.
#[tauri::command]
pub async fn get_saga_names(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut map = std::collections::HashMap::new();
    if media_external_ids.is_empty() {
        return Ok(map);
    }

    let conn = state.conn.lock().str_err()?;
    let placeholders = media_external_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT sr.media_external_id, s.name FROM saga_relations sr JOIN sagas s ON s.id = sr.saga_id
         WHERE sr.media_external_id IN ({}) AND s.name != ''",
        placeholders
    );
    let mut stmt = conn.prepare(&sql).str_err()?;
    let params = rusqlite::params_from_iter(media_external_ids.iter());
    let rows = stmt.query_map(params, |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).str_err()?;

    for row in rows.filter_map(|r| r.ok()) {
        map.insert(row.0, row.1);
    }
    Ok(map)
}
