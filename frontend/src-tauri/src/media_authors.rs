// Author profile CRUD and their relations to media entries — split out of
// media_catalog.rs.
use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;
use crate::media_catalog::{existing_catalog_ids, infer_type_from_id, infer_source_from_id};

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct DbMediaAuthor {
    pub external_id: String,
    pub name: String,
    pub image: Option<String>,
    pub role: Option<String>,
    pub url: Option<String>,
    // Full-profile fields, only ever populated by save_author_profile_and_relations
    // (the author's own page, after a live fetch) — save_media_authors (a
    // media page's lightweight author list) never touches these, see its
    // ON CONFLICT clause below.
    pub name_native: Option<String>,
    pub aliases_csv: Option<String>,
    pub biography: Option<String>,
    pub birth_date: Option<String>,
    pub death_date: Option<String>,
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
        // Upsert instead of INSERT OR REPLACE: a media page's author list
        // only ever carries name/image/url, never the full profile (bio/
        // native name/aliases/birth-death) — a full-row REPLACE would wipe
        // that out every time this ran after the author's own page had
        // already populated it.
        tx.execute(
            "INSERT INTO media_author (external_id, name, author_image_url, author_url, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(external_id) DO UPDATE SET
                name = excluded.name, author_image_url = excluded.author_image_url,
                author_url = excluded.author_url, updated_at = excluded.updated_at",
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

// Single-author lookup for the author's own page — mirrors characters.rs's
// get_character, used to decide (with sync_state) whether a fresh live
// fetch is due or the cached profile can render as-is.
#[tauri::command]
pub async fn get_author(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<DbMediaAuthor>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        "SELECT external_id, name, author_image_url, author_url, name_native, aliases_csv, biography, birth_date, death_date
         FROM media_author WHERE external_id = ?1",
        [&external_id],
        |row| Ok(DbMediaAuthor {
            external_id: row.get(0)?,
            name: row.get(1)?,
            image: row.get(2)?,
            url: row.get(3)?,
            role: None,
            name_native: row.get(4)?,
            aliases_csv: row.get(5)?,
            biography: row.get(6)?,
            birth_date: row.get(7)?,
            death_date: row.get(8)?,
        }),
    )
    .optional()
    .str_err()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthorWork {
    pub media_external_id: String,
    pub role: Option<String>,
    pub title: String,
    pub cover: Option<String>,
}

// Reverse of get_media_authors (keyed by author instead of media) — rebuilds
// the author page's "Works" grid from local data when sync_state says a live
// fetch isn't due yet.
#[tauri::command]
pub async fn get_author_works(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    author_external_id: String,
) -> Result<Vec<AuthorWork>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT mba.media_external_id, mba.role, mc.title_main, mc.cover_url
             FROM media_by_author mba
             LEFT JOIN media_catalog mc ON mc.external_id = mba.media_external_id
             WHERE mba.author_external_id = ?1",
        )
        .str_err()?;
    let rows = stmt
        .query_map([&author_external_id], |row| {
            Ok(AuthorWork {
                media_external_id: row.get(0)?,
                role: row.get(1)?,
                title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                cover: row.get(3)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
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
                ..Default::default()
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

    // 1. Save or replace the full author profile in media_author — this is
    // the author's own page after a live fetch, so (unlike save_media_authors)
    // it's the one place allowed to overwrite the rich profile fields too.
    tx.execute(
        "INSERT INTO media_author (
            external_id, name, author_image_url, author_url,
            name_native, aliases_csv, biography, birth_date, death_date, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(external_id) DO UPDATE SET
            name = excluded.name, author_image_url = excluded.author_image_url,
            author_url = excluded.author_url, name_native = excluded.name_native,
            aliases_csv = excluded.aliases_csv, biography = excluded.biography,
            birth_date = excluded.birth_date, death_date = excluded.death_date,
            updated_at = excluded.updated_at",
        rusqlite::params![
            &author.external_id,
            &author.name,
            &author.image,
            &author.url,
            &author.name_native,
            &author.aliases_csv,
            &author.biography,
            &author.birth_date,
            &author.death_date,
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
