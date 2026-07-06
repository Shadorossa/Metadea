use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

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

    if let Some(ref authors) = entry.authors_csv {
        let _ = conn.execute("DELETE FROM media_by_author WHERE media_external_id = ?1", [&entry.external_id]);
        for author_id in authors.split(',') {
            let author_id = author_id.trim();
            if !author_id.is_empty() {
                let clean_id = if author_id.contains(':') {
                    author_id.to_string()
                } else {
                    format!("author:{}", author_id)
                };

                let name = if author_id.contains(':') {
                    author_id.split(':').nth(1).unwrap_or(author_id)
                } else {
                    author_id
                };

                let _ = conn.execute(
                    "INSERT OR IGNORE INTO media_author (external_id, name) VALUES (?1, ?2)",
                    rusqlite::params![&clean_id, name],
                );
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO media_by_author (media_external_id, author_external_id, role)
                     VALUES (?1, ?2, ?3)",
                    rusqlite::params![&entry.external_id, &clean_id, "AUTHOR"],
                );
            }
        }
    }

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

    // Use the first entry's externalId as the saga_id (it's stable and unique)
    let saga_id = entries[0].external_id.clone();
    let saga_name = entries[0].title.clone();

    // 1. Insert saga
    tx.execute(
        "INSERT OR REPLACE INTO sagas (id, name) VALUES (?1, ?2)",
        rusqlite::params![&saga_id, &saga_name],
    )
    .str_err()?;

    // 2. Insert entries into media_catalog (minimal metadata for caching) and relations
    for entry in &entries {
        let now = Utc::now().to_rfc3339();
        
        let exists_val: i32 = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM media_catalog WHERE external_id = ?1)",
                [&entry.external_id],
                |row| row.get(0),
            )
            .str_err()?;
        let exists = exists_val == 1;

        if !exists {
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

        let exists_val: i32 = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM media_catalog WHERE external_id = ?1)",
                [&rel.related_media_external_id],
                |row| row.get(0),
            )
            .str_err()?;

        if exists_val == 0 {
            let rel_type = rel.related_media_external_id.split(':').next().unwrap_or("anime").to_string();
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

#[derive(Debug, Serialize, Deserialize)]
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

        let exists_val: i32 = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM media_catalog WHERE external_id = ?1)",
            [&rel.media_external_id],
            |row| row.get(0)
        ).str_err()?;

        if exists_val == 0 {
            let rel_type = rel.media_external_id.split(':').next().unwrap_or("anime").to_string();
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
