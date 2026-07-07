use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::Manager;
use crate::db::ToStringErr;

// Raw GitHub URL for the repo's shared community catalog — rebuilt by
// .github/workflows/update-database.yml (scripts/build-database.js) from
// every database/*.json a merged collaborative-catalog PR has added, so this
// always reflects main without the app needing GitHub API auth to read it.
const COMMUNITY_DB_URL: &str = "https://raw.githubusercontent.com/Shadorossa/Metadea/main/database.db";

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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[derive(Default)]
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
    pub authors_csv: Option<String>,
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
           authors_csv, last_synced_at, sync_failed_count, last_sync_error,
           created_at, updated_at
    FROM media_catalog";

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaCatalogEntry> {
    Ok(MediaCatalogEntry {
        external_id:         row.get::<_, Option<String>>(0)?.unwrap_or_default(),
        id:                  row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        parent_id:           row.get(2)?,
        r#type:              row.get::<_, Option<String>>(3)?.unwrap_or_default(),
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
        authors_csv:         row.get(26)?,
        last_synced_at:      row.get(27)?,
        sync_failed_count:   row.get(28)?,
        last_sync_error:     row.get(29)?,
        created_at:          row.get::<_, Option<String>>(30)?.unwrap_or_default(),
        updated_at:          row.get::<_, Option<String>>(31)?.unwrap_or_default(),
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
            external_id, id, parent_id, type, format, source,
            title_main, title_romaji, title_native, synopsis, cover_url,
            banners_csv, release_year, release_month, release_day,
            time_length, status, score_global, favorites_count,
            ratings_count, total_count, total_count_2, genres_csv,
            genres_tag_csv, platforms_csv, companies_cache_csv,
            authors_csv, last_synced_at, sync_failed_count, last_sync_error,
            created_at, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32)",
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
            &entry.authors_csv,
            &entry.last_synced_at, &entry.sync_failed_count, &entry.last_sync_error,
            &entry.created_at, &entry.updated_at,
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
        &format!("{} WHERE lower(title_main) LIKE ?1 OR lower(title_romaji) LIKE ?1 OR lower(title_native) LIKE ?1", SELECT_ALL),
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
             JOIN media_catalog mc ON mc.external_id = sr.media_external_id
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
    let saga_name = anchor.title.clone();

    // 1. Insert saga
    tx.execute(
        "INSERT OR REPLACE INTO sagas (id, name) VALUES (?1, ?2)",
        rusqlite::params![&saga_id, &saga_name],
    )
    .str_err()?;

    // 2. Insert entries into media_catalog (minimal metadata for caching) and relations
    let all_ids: Vec<String> = entries.iter().map(|e| e.external_id.clone()).collect();
    let existing_ids = existing_catalog_ids(&tx, &all_ids)?;

    for entry in &entries {
        let now = Utc::now().to_rfc3339();

        if !existing_ids.contains(&entry.external_id) {
            tx.execute(
                "INSERT INTO media_catalog (
                    id, external_id, type, format, title_main, cover_url, release_year, release_month, release_day, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &entry.external_id,
                    &entry.media_type,
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

#[derive(Debug, Serialize, Deserialize)]
pub struct DbMediaRelation {
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

    tx.execute(
        "DELETE FROM media_relations WHERE media_external_id = ?1",
        [&media_external_id],
    )
    .str_err()?;

    let now = Utc::now().to_rfc3339();

    let all_ids: Vec<String> = relations.iter().map(|r| r.related_media_external_id.clone()).collect();
    let existing_ids = existing_catalog_ids(&tx, &all_ids)?;

    for rel in relations {
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

        if !existing_ids.contains(&rel.related_media_external_id) {
            // split_once (not split().next(), which always yields at least
            // one item and made the "anime" fallback unreachable) so a
            // colon-less id actually falls back to "anime" instead of using
            // the whole id string as the type.
            let rel_type = rel.related_media_external_id
                .split_once(':')
                .map(|(prefix, _)| prefix)
                .unwrap_or("anime")
                .to_string();
            tx.execute(
                "INSERT INTO media_catalog (
                    id, external_id, type, title_main, cover_url, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &rel.related_media_external_id,
                    &rel_type,
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
             JOIN media_catalog mc ON mc.external_id = mr.related_media_external_id
             WHERE mr.media_external_id = ?1",
        )
        .str_err()?;

    let rows = stmt
        .query_map([&media_external_id], |row| {
            Ok(DbMediaRelation {
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
            let rel_type = rel.media_external_id
                .split_once(':')
                .map(|(prefix, _)| prefix)
                .unwrap_or("anime")
                .to_string();
            tx.execute(
                "INSERT INTO media_catalog (id, external_id, type, title_main, cover_url, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![crate::db::generate_id(), &rel.media_external_id, &rel_type, &rel.title, &rel.cover, &now, &now],
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
    let client = reqwest::Client::new();
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

        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM media_catalog", [], |r| r.get(0))
            .str_err()?;

        conn.execute("ATTACH DATABASE ?1 AS community", rusqlite::params![temp_path_str])
            .str_err()?;
        let merge_result = (|| -> Result<(), String> {
            // Column list is explicit (not `SELECT *`) on purpose: DBs upgraded
            // via the `ALTER TABLE ... ADD COLUMN authors_csv` migration in
            // db.rs have authors_csv as their *last* physical column, while a
            // fresh DB (this downloaded community one included) has it inline
            // per METADEA_SCHEMA's CREATE TABLE text — position-based `SELECT *`
            // would silently shift every column after the mismatch into the
            // wrong field.
            conn.execute(
                "INSERT OR IGNORE INTO media_catalog (
                    id, external_id, parent_id, type, format, source,
                    title_main, title_romaji, title_native, synopsis, cover_url, banners_csv,
                    release_year, release_month, release_day, time_length, status, score_global,
                    favorites_count, ratings_count, total_count, total_count_2,
                    genres_csv, genres_tag_csv, platforms_csv, companies_cache_csv, authors_csv,
                    last_synced_at, sync_failed_count, last_sync_error, created_at, updated_at
                 )
                 SELECT
                    id, external_id, parent_id, type, format, source,
                    title_main, title_romaji, title_native, synopsis, cover_url, banners_csv,
                    release_year, release_month, release_day, time_length, status, score_global,
                    favorites_count, ratings_count, total_count, total_count_2,
                    genres_csv, genres_tag_csv, platforms_csv, companies_cache_csv, authors_csv,
                    last_synced_at, sync_failed_count, last_sync_error, created_at, updated_at
                 FROM community.media_catalog",
                [],
            ).str_err()?;

            // Characters a PR carried over from the entry's already-cached
            // appearances (see PrEditorModal's bundle export) — merge both
            // the character rows and their media links the same "fill gaps
            // only" way.
            conn.execute(
                "INSERT OR IGNORE INTO characters (id, external_id, name, image_url, reaction, created_at, updated_at)
                 SELECT id, external_id, name, image_url, reaction, created_at, updated_at FROM community.characters",
                [],
            ).str_err()?;
            conn.execute(
                "INSERT OR IGNORE INTO character_appearances (character_external_id, media_external_id, relation_type, added_at)
                 SELECT character_external_id, media_external_id, relation_type, added_at FROM community.character_appearances",
                [],
            ).str_err()?;

            // Relations (bundled-in episodes/updates, saga-derived prequel/
            // sequel, and any other relation a PR carried over) — same
            // fill-gaps merge, keyed by the table's own composite PK so this
            // never overwrites a relation the user's own API sync produced.
            conn.execute(
                "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 SELECT media_external_id, related_media_external_id, relation_type, type_label FROM community.media_relations",
                [],
            ).str_err()?;

            // Authors carried over the same "fill gaps only" way.
            conn.execute(
                "INSERT OR IGNORE INTO media_author (external_id, name, author_image_url, author_url, created_at, updated_at)
                 SELECT external_id, name, author_image_url, author_url, created_at, updated_at FROM community.media_author",
                [],
            ).str_err()?;
            conn.execute(
                "INSERT OR IGNORE INTO media_by_author (media_external_id, author_external_id, role)
                 SELECT media_external_id, author_external_id, role FROM community.media_by_author",
                [],
            ).str_err()?;

            Ok(())
        })();
        conn.execute("DETACH DATABASE community", []).str_err()?;
        merge_result?;

        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM media_catalog", [], |r| r.get(0))
            .str_err()?;

        Ok(after - before)
    })();

    let _ = std::fs::remove_file(&temp_path);

    imported
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ProposalRelation {
    pub media_external_id: Option<String>,
    pub related_media_external_id: String,
    pub relation_type: String,
    pub type_label: String,
    pub title: String,
    pub cover: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ProposalBundle {
    pub media_catalog: MediaCatalogEntry,
    pub media_relations: Vec<ProposalRelation>,
    pub characters: Vec<crate::characters::SkeletonCharacter>,
    pub media_authors: Vec<DbMediaAuthor>,
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

pub fn import_proposal_bundle(db: &crate::db::MetadeaDb, bundle: ProposalBundle) -> Result<(), String> {
    let mut conn = db.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    let now = Utc::now().to_rfc3339();

    // 1. Save media_catalog
    let entry = bundle.media_catalog;
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
                id, external_id, parent_id, type, format, source, title_main, title_romaji, title_native,
                synopsis, cover_url, banners_csv, release_year, release_month, release_day, time_length,
                status, score_global, favorites_count, ratings_count, total_count, total_count_2,
                genres_csv, genres_tag_csv, platforms_csv, companies_cache_csv, authors_csv, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29)",
            rusqlite::params![
                crate::db::generate_id(),
                &entry.external_id,
                &entry.parent_id,
                &entry.r#type,
                &entry.format,
                &entry.source,
                &entry.title_main,
                &entry.title_romaji,
                &entry.title_native,
                &entry.synopsis,
                &entry.cover_url,
                &entry.banners_csv,
                &entry.release_year,
                &entry.release_month,
                &entry.release_day,
                &entry.time_length,
                &entry.status,
                &entry.score_global,
                &entry.favorites_count,
                &entry.ratings_count,
                &entry.total_count,
                &entry.total_count_2,
                &entry.genres_csv,
                &entry.genres_tag_csv,
                &entry.platforms_csv,
                &entry.companies_cache_csv,
                &entry.authors_csv,
                &entry.created_at,
                &entry.updated_at,
            ],
        )
        .str_err()?;
    } else {
        tx.execute(
            "UPDATE media_catalog SET
                parent_id = ?1, type = ?2, format = ?3, source = ?4, title_main = ?5, title_romaji = ?6, title_native = ?7,
                synopsis = ?8, cover_url = ?9, banners_csv = ?10, release_year = ?11, release_month = ?12, release_day = ?13, time_length = ?14,
                status = ?15, score_global = ?16, favorites_count = ?17, ratings_count = ?18, total_count = ?19, total_count_2 = ?20,
                genres_csv = ?21, genres_tag_csv = ?22, platforms_csv = ?23, companies_cache_csv = ?24, authors_csv = ?25, updated_at = ?26
             WHERE external_id = ?27",
            rusqlite::params![
                &entry.parent_id,
                &entry.r#type,
                &entry.format,
                &entry.source,
                &entry.title_main,
                &entry.title_romaji,
                &entry.title_native,
                &entry.synopsis,
                &entry.cover_url,
                &entry.banners_csv,
                &entry.release_year,
                &entry.release_month,
                &entry.release_day,
                &entry.time_length,
                &entry.status,
                &entry.score_global,
                &entry.favorites_count,
                &entry.ratings_count,
                &entry.total_count,
                &entry.total_count_2,
                &entry.genres_csv,
                &entry.genres_tag_csv,
                &entry.platforms_csv,
                &entry.companies_cache_csv,
                &entry.authors_csv,
                &entry.updated_at,
                &entry.external_id,
            ],
        )
        .str_err()?;
    }

    // 2. Save media_relations
    tx.execute(
        "DELETE FROM media_relations WHERE media_external_id = ?1",
        [&entry.external_id],
    )
    .str_err()?;

    for rel in &bundle.media_relations {
        let parent_id = rel.media_external_id.as_deref().unwrap_or(&entry.external_id);
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

        let rel_exists: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM media_catalog WHERE external_id = ?1",
                [&rel.related_media_external_id],
                |row| row.get(0),
            )
            .str_err()?;

        if rel_exists == 0 {
            let rel_type = rel.related_media_external_id
                .split_once(':')
                .map(|(prefix, _)| prefix)
                .unwrap_or("anime")
                .to_string();

            tx.execute(
                "INSERT INTO media_catalog (
                    id, external_id, type, title_main, cover_url, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &rel.related_media_external_id,
                    &rel_type,
                    &rel.title,
                    &rel.cover,
                    &now,
                    &now,
                ],
            )
            .str_err()?;
        }
    }

    // 3. Save characters
    tx.execute(
        "DELETE FROM character_appearances WHERE media_external_id = ?1",
        [&entry.external_id],
    )
    .str_err()?;

    for char in &bundle.characters {
        tx.execute(
            "INSERT OR IGNORE INTO characters (id, external_id, name, image_url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                crate::db::generate_id(),
                &char.external_id,
                &char.name,
                &char.image_url,
                &now,
                &now,
            ],
        )
        .str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO character_appearances (character_external_id, media_external_id, relation_type, added_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                &char.external_id,
                &entry.external_id,
                &char.relation_type,
                &now,
            ],
        )
        .str_err()?;
    }

    // 4. Save authors
    tx.execute(
        "DELETE FROM media_by_author WHERE media_external_id = ?1",
        [&entry.external_id],
    )
    .str_err()?;

    for auth in &bundle.media_authors {
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
                &entry.external_id,
                &auth.external_id,
                &auth.role,
            ],
        )
        .str_err()?;
    }

    tx.commit().str_err()?;
    Ok(())
}
