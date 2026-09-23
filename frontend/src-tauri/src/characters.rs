use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use crate::db::ToStringErr;
use crate::media_catalog::{existing_catalog_ids, infer_type_from_id, infer_source_from_id};

fn image_data_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle.path().app_data_dir().str_err()
}

fn resolve_character_image(data_dir: &std::path::Path, image: &mut Option<String>) -> Result<(), String> {
    *image = crate::image_storage::resolve_image_value(data_dir, image.take())?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CharacterEntry {
    pub id: String,
    pub external_id: String,
    pub name: String,
    pub name_native: Option<String>,
    /// Comma-separated alternative names (AniList's name.alternative list).
    pub aliases_csv: Option<String>,
    pub biography: Option<String>,
    pub image_url: Option<String>,
    pub reaction: Option<String>,
    pub gender: Option<String>,
    /// AniList's own field — a free-form string ("17", "17-18"), not always numeric.
    pub age: Option<String>,
    pub blood_type: Option<String>,
    pub dob_year: Option<i32>,
    pub dob_month: Option<i32>,
    pub dob_day: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

/// A legacy TMDB cast key plus the work it was cached from. Old keys used
/// TMDB's opaque `credit_id`; the frontend resolves that credit to the
/// deterministic person-id + work-id form before asking Rust to migrate it.
#[derive(Debug, Serialize)]
pub struct LegacyTmdbCharacterAppearance {
    pub character_external_id: String,
    pub media_external_id: String,
}

#[derive(Debug, Deserialize)]
pub struct CharacterIdRemap {
    pub old_external_id: String,
    pub new_external_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct CharacterAppearance {
    pub media_external_id: String,
    pub relation_type: Option<String>,
    /// The role/character name an actor plays in this media (TMDB movies/
    /// series) — distinct from relation_type, which holds anime relation
    /// kinds (MAIN/SUPPORTING) for AniList characters.
    pub character_name: Option<String>,
    /// Only used to seed a media_catalog stub (see save_character_appearances)
    /// when this appearance's own media isn't cataloged yet — not persisted
    /// on the character_appearances row itself.
    pub title: Option<String>,
    pub cover: Option<String>,
}

const SELECT_CHARACTER: &str =
    "SELECT id, external_id, name, name_native, aliases_csv, biography, image_url, reaction,
            gender, age, blood_type, dob_year, dob_month, dob_day, created_at, updated_at
     FROM characters";

fn row_to_character(row: &rusqlite::Row<'_>) -> rusqlite::Result<CharacterEntry> {
    Ok(CharacterEntry {
        id: row.get(0)?,
        external_id: row.get(1)?,
        name: row.get(2)?,
        name_native: row.get(3)?,
        aliases_csv: row.get(4)?,
        biography: row.get(5)?,
        image_url: row.get(6)?,
        reaction: row.get(7)?,
        gender: row.get(8)?,
        age: row.get(9)?,
        blood_type: row.get(10)?,
        dob_year: row.get(11)?,
        dob_month: row.get(12)?,
        dob_day: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

// Arity is dictated by the frontend `invoke("save_character", …)` contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn save_character(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    name: String,
    image_url: Option<String>,
    name_native: Option<String>,
    aliases_csv: Option<String>,
    biography: Option<String>,
    gender: Option<String>,
    age: Option<String>,
    blood_type: Option<String>,
    dob_year: Option<i32>,
    dob_month: Option<i32>,
    dob_day: Option<i32>,
) -> Result<CharacterEntry, String> {
    let stored_image_url = image_url.as_deref().map(|image| {
        crate::image_storage::store_image_value(&image_data_dir(&app_handle)?, "characters", &external_id, image)
    }).transpose()?;
    let conn = state.conn.lock().str_err()?;

    let existing: Option<(String, String, Option<String>)> = conn
        .query_row(
            "SELECT id, created_at, reaction FROM characters WHERE external_id = ?1",
            [&external_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .str_err()?;

    let (id, created_at, reaction) = match existing {
        Some((id, created_at, reaction)) => (id, created_at, reaction),
        None => (crate::db::generate_id(), Utc::now().to_rfc3339(), None),
    };
    let updated_at = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO characters (
            id, external_id, name, name_native, aliases_csv, biography, image_url, reaction,
            gender, age, blood_type, dob_year, dob_month, dob_day, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        rusqlite::params![
            &id, &external_id, &name, &name_native, &aliases_csv, &biography, &stored_image_url, &reaction,
            &gender, &age, &blood_type, &dob_year, &dob_month, &dob_day, &created_at, &updated_at,
        ],
    ).str_err()?;

    Ok(CharacterEntry {
        id, external_id, name, name_native, aliases_csv, biography, image_url, reaction,
        gender, age, blood_type, dob_year, dob_month, dob_day, created_at, updated_at,
    })
}

#[tauri::command]
pub async fn get_character(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<CharacterEntry>, String> {
    let mut character = {
        let conn = state.conn.lock().str_err()?;
        conn.query_row(
            &format!("{} WHERE external_id = ?1", SELECT_CHARACTER),
            [&external_id],
            row_to_character,
        )
        .optional()
        .str_err()?
    };
    if let Some(character) = &mut character {
        resolve_character_image(&image_data_dir(&app_handle)?, &mut character.image_url)?;
    }
    Ok(character)
}

// Bulk fetch for local-only UI that needs every cached character's name/cover
// without a per-id round trip — e.g. the profile Favorites tab, which used to
// resolve character title/cover via a media_catalog row that shouldn't have
// existed for a character in the first place (see save_character in
// character.astro instead of a duplicate media_catalog entry).
#[tauri::command]
pub async fn get_all_characters(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<CharacterEntry>, String> {
    let mut rows: Vec<CharacterEntry> = {
        let conn = state.conn.lock().str_err()?;
        load_all_characters(&conn)?
    };
    let data_dir = image_data_dir(&app_handle)?;
    for row in &mut rows { resolve_character_image(&data_dir, &mut row.image_url)?; }
    Ok(rows)
}

pub(crate) fn load_all_characters(conn: &rusqlite::Connection) -> Result<Vec<CharacterEntry>, String> {
    let mut stmt = conn.prepare(SELECT_CHARACTER).str_err()?;
    let collected = stmt.query_map([], row_to_character)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(collected)
}

// Same rows as get_all_characters, but image_url is the portrait's file
// path (or its remote URL, untouched) instead of an inlined base64 data
// URL — see image_storage::resolve_reference_path. Callers wrap it with
// wrapAssetUrl before using it as an <img src>.
pub(crate) fn resolve_character_images_light(
    data_dir: &std::path::Path,
    rows: &mut [CharacterEntry],
) -> Result<(), String> {
    for row in rows {
        row.image_url = crate::image_storage::resolve_image_path_value(data_dir, row.image_url.take())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_all_characters_light(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<CharacterEntry>, String> {
    let mut rows: Vec<CharacterEntry> = {
        let conn = state.conn.lock().str_err()?;
        load_all_characters(&conn)?
    };
    resolve_character_images_light(&image_data_dir(&app_handle)?, &mut rows)?;
    Ok(rows)
}

#[tauri::command]
pub async fn search_characters_db(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    query: String,
) -> Result<Vec<CharacterEntry>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let tokens: Vec<String> = trimmed
        .split_whitespace()
        .map(|s| format!("%{}%", s.to_lowercase()))
        .collect();
    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let mut sql = String::from(
        "SELECT DISTINCT c.id, c.external_id, c.name, c.name_native, c.aliases_csv, c.biography, c.image_url,
                c.reaction, c.gender, c.age, c.blood_type, c.dob_year, c.dob_month, c.dob_day, c.created_at, c.updated_at
         FROM characters c
         LEFT JOIN character_appearances ca ON ca.character_external_id = c.external_id
         WHERE "
    );

    for (i, _) in tokens.iter().enumerate() {
        if i > 0 {
            sql.push_str(" AND ");
        }
        sql.push_str(&format!(
            "(lower(c.name) LIKE ?{0} OR lower(COALESCE(c.name_native, '')) LIKE ?{0} OR lower(COALESCE(c.aliases_csv, '')) LIKE ?{0} OR lower(COALESCE(ca.character_name, '')) LIKE ?{0})",
            i + 1
        ));
    }
    sql.push_str(" ORDER BY c.name ASC LIMIT 60");

    let mut rows: Vec<CharacterEntry> = {
        let conn = state.conn.lock().str_err()?;
        let mut stmt = conn.prepare(&sql).str_err()?;
        let params = rusqlite::params_from_iter(tokens.iter());
        let collected = stmt.query_map(params, row_to_character)
            .str_err()?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };
    let data_dir = image_data_dir(&app_handle)?;
    for row in &mut rows { resolve_character_image(&data_dir, &mut row.image_url)?; }
    Ok(rows)
}

#[tauri::command]
pub async fn delete_character(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM character_appearances WHERE character_external_id = ?1", [&external_id]).str_err()?;
    conn.execute("DELETE FROM characters WHERE external_id = ?1", [&external_id]).str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn set_character_reaction(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    reaction: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    let now = Utc::now().to_rfc3339();
    let updated = conn
        .execute(
            "UPDATE characters SET reaction = ?1, updated_at = ?2 WHERE external_id = ?3",
            rusqlite::params![&reaction, &now, &external_id],
        )
        .str_err()?;
    if updated == 0 {
        return Err("Character not found; save it before setting a reaction".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn save_character_appearances(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    character_external_id: String,
    appearances: Vec<CharacterAppearance>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    let now = Utc::now().to_rfc3339();

    // Preserve each existing (media, position) pairing before wiping this
    // character's rows — save_characters_skeleton (the media-side writer)
    // sets position from AniList's own role-sorted cast order; blindly
    // delete+reinsert here would hand every one of this character's rows a
    // fresh rowid, and since get_media_characters falls back to rowid once
    // position is unset, that used to silently shove this character to the
    // end of every OTHER (untouched) character's list for the same media.
    let mut existing_positions: std::collections::HashMap<String, Option<i32>> = std::collections::HashMap::new();
    {
        let mut stmt = tx.prepare(
            "SELECT media_external_id, position FROM character_appearances WHERE character_external_id = ?1"
        ).str_err()?;
        let rows = stmt.query_map([&character_external_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<i32>>(1)?))
        }).str_err()?;
        for r in rows.filter_map(|r| r.ok()) {
            existing_positions.insert(r.0, r.1);
        }
    }

    // Full curated list, so anything missing was deliberately removed —
    // this used to only INSERT OR REPLACE, so a removed appearance's old
    // row never actually went away and would reappear on next load.
    tx.execute(
        "DELETE FROM character_appearances WHERE character_external_id = ?1",
        [&character_external_id],
    ).str_err()?;

    // Same stub-catalog seeding save_media_relations does for a relation
    // target that isn't cataloged yet — a character's appearance list is the
    // other direction of that same "media -> media" reference (media <-
    // character here), so opening a character page should be just as able to
    // seed cover/type/format for a work it links to as opening a media page.
    let all_ids: Vec<String> = appearances.iter().map(|a| a.media_external_id.clone()).collect();
    let existing_ids = existing_catalog_ids(&tx, &all_ids)?;

    for a in appearances {
        // A brand-new appearance (never seen before) has no known cast
        // position — NULL sorts last, which is the reasonable default until
        // that media's own skeleton resync fills it in for real.
        let position = existing_positions.get(&a.media_external_id).copied().flatten();
        tx.execute(
            "INSERT OR REPLACE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, position, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![&character_external_id, &a.media_external_id, &a.relation_type, &a.character_name, &position, &now],
        ).str_err()?;

        if !existing_ids.contains(&a.media_external_id) {
            let media_type = infer_type_from_id(&a.media_external_id);
            tx.execute(
                "INSERT OR IGNORE INTO media_catalog (
                    id, external_id, type, source, title_main, cover_url, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &a.media_external_id,
                    &media_type,
                    infer_source_from_id(&a.media_external_id),
                    &a.title,
                    &a.cover,
                    &now,
                    &now,
                ],
            ).str_err()?;
        }
    }
    tx.commit().str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn get_character_appearances(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    character_external_id: String,
) -> Result<Vec<CharacterAppearance>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare("SELECT ca.media_external_id, ca.relation_type, ca.character_name
                  FROM character_appearances ca
                  JOIN visible_media_catalog mc ON mc.external_id = ca.media_external_id
                  WHERE ca.character_external_id = ?1")
        .str_err()?;
    let rows = stmt
        .query_map([&character_external_id], |row| {
            Ok(CharacterAppearance {
                media_external_id: row.get(0)?,
                relation_type: row.get(1)?,
                character_name: row.get(2)?,
                title: None,
                cover: None,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaCharacter {
    pub external_id: String,
    pub name: String,
    pub image_url: Option<String>,
    pub relation_type: Option<String>,
    pub character_name: Option<String>,
    pub merged_character_external_id: Option<String>,
}

// Reverse of get_character_appearances (which is keyed by character) — used
// by PrEditorModal to carry a media's already-cached characters along into a
// collaborative-catalog PR bundle instead of losing them (the editor itself
// has no character-editing UI; this just republishes what was already synced
// locally from the API).
#[tauri::command]
pub async fn get_media_characters(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<MediaCharacter>, String> {
    let mut rows: Vec<MediaCharacter> = {
    let conn = state.conn.lock().str_err()?;

    // Editions inherit the base game's cast for display only. Walk the
    // BASE_EDITION chain to its root (with a cycle/depth guard), and use it
    // only when that edition actually has a cached cast. No appearance rows
    // are created for the remaster.
    let base_id: Option<String> = conn.query_row(
        "WITH RECURSIVE base_chain(external_id, depth, path) AS (
             SELECT related_media_external_id, 1,
                    '|' || ?1 || '|' || related_media_external_id || '|'
             FROM media_relations
             WHERE media_external_id = ?1 AND relation_type = 'BASE_EDITION'
               AND EXISTS (
                   SELECT 1 FROM media_catalog mc
                   WHERE mc.external_id = ?1
                     AND UPPER(COALESCE(mc.format, '')) IN ('REMASTER', 'EXPANDED_GAME')
               )
             UNION ALL
             SELECT r.related_media_external_id, b.depth + 1,
                    b.path || r.related_media_external_id || '|'
             FROM media_relations r
             JOIN base_chain b ON r.media_external_id = b.external_id
             WHERE r.relation_type = 'BASE_EDITION'
               AND b.depth < 16
               AND instr(b.path, '|' || r.related_media_external_id || '|') = 0
         )
         SELECT external_id FROM base_chain ORDER BY depth DESC LIMIT 1",
        [&media_external_id],
        |row| row.get(0),
    ).optional().str_err()?;
    let cast_media_id = if let Some(base_id) = base_id {
        let has_base_cast: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM character_appearances WHERE media_external_id = ?1)",
            [&base_id],
            |row| row.get(0),
        ).str_err()?;
        if has_base_cast { base_id } else { media_external_id.clone() }
    } else {
        media_external_id.clone()
    };
    let mut stmt = conn
        .prepare(
            "SELECT c.external_id, c.name, c.image_url, ca.relation_type, ca.character_name, cm.canonical_character_external_id
             FROM character_appearances ca
             JOIN characters c ON c.external_id = ca.character_external_id
             LEFT JOIN character_merges cm ON cm.source_character_external_id = c.external_id
             WHERE ca.media_external_id = ?1
               -- An editor-created canonical appearance is useful on the
               -- canonical character page, but the media's cast must retain
               -- the source identity that actually belongs to this work.
               -- Its card redirects through cm, so never render both cards.
               AND NOT EXISTS (
                 SELECT 1
                 FROM character_appearances source_ca
                 JOIN character_merges source_cm
                   ON source_cm.source_character_external_id = source_ca.character_external_id
                 WHERE source_ca.media_external_id = ca.media_external_id
                   AND source_cm.canonical_character_external_id = ca.character_external_id
                   AND source_ca.character_external_id <> ca.character_external_id
               )
             ORDER BY
                (ca.position IS NULL), ca.position,
                 CASE ca.relation_type WHEN 'MAIN' THEN 0 WHEN 'SUPPORTING' THEN 1 WHEN 'CAMEO' THEN 2 WHEN 'BACKGROUND' THEN 3 ELSE 4 END",
        )
        .str_err()?;
    let rows: Vec<MediaCharacter> = stmt
        .query_map([&cast_media_id], |row| {
            Ok(MediaCharacter {
                external_id: row.get(0)?,
                name: row.get(1)?,
                image_url: row.get(2)?,
                relation_type: row.get(3)?,
                character_name: row.get(4)?,
                merged_character_external_id: row.get(5)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    rows
    };
    let data_dir = image_data_dir(&app_handle)?;
    for row in &mut rows { resolve_character_image(&data_dir, &mut row.image_url)?; }
    Ok(rows)
}

#[tauri::command]
pub async fn get_legacy_tmdb_character_appearances(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<LegacyTmdbCharacterAppearance>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT DISTINCT character_external_id, media_external_id
         FROM character_appearances
         WHERE character_external_id LIKE 'character:ms:%'
           AND (
             -- Older keys used the opaque TMDB credit id as the whole suffix.
             instr(substr(character_external_id, 14), ':') = 0
             -- An intermediate format included the media type in the suffix.
             OR character_external_id LIKE '%:series:%'
             OR character_external_id LIKE '%:movie:%'
           )"
    ).str_err()?;
    let rows = stmt.query_map([], |row| {
        Ok(LegacyTmdbCharacterAppearance {
            character_external_id: row.get(0)?,
            media_external_id: row.get(1)?,
        })
    }).str_err()?
        .filter_map(|row| row.ok())
        .collect();
    Ok(rows)
}

#[tauri::command]
pub async fn remap_tmdb_character_ids(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    remaps: Vec<CharacterIdRemap>,
) -> Result<usize, String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    let mut moved = 0usize;
    let mut seen = std::collections::HashSet::new();

    for remap in remaps {
        if !remap.old_external_id.starts_with("character:ms:")
            || !remap.new_external_id.starts_with("character:ms:")
            || remap.old_external_id == remap.new_external_id
            || !seen.insert(remap.old_external_id.clone())
        {
            continue;
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM characters WHERE external_id = ?1)",
            [&remap.old_external_id],
            |row| row.get(0),
        ).str_err()?;
        if !exists { continue; }

        // Preserve the old row's local enrichment if a new deterministic row
        // was already created by a later visit to the same media page.
        tx.execute(
            "UPDATE characters
             SET name = CASE WHEN name = '' THEN COALESCE((SELECT name FROM characters WHERE external_id = ?2), '') ELSE name END,
                 name_native = COALESCE(name_native, (SELECT name_native FROM characters WHERE external_id = ?2)),
                 aliases_csv = CASE WHEN COALESCE(aliases_csv, '') = '' THEN (SELECT aliases_csv FROM characters WHERE external_id = ?2) ELSE aliases_csv END,
                 biography = COALESCE(biography, (SELECT biography FROM characters WHERE external_id = ?2)),
                 image_url = COALESCE(image_url, (SELECT image_url FROM characters WHERE external_id = ?2)),
                 reaction = COALESCE(reaction, (SELECT reaction FROM characters WHERE external_id = ?2))
             WHERE external_id = ?1",
            rusqlite::params![&remap.new_external_id, &remap.old_external_id],
        ).str_err()?;

        // Copy first and remove the legacy rows last. INSERT OR IGNORE keeps
        // an already-canonical relationship instead of overwriting it.
        tx.execute(
            "INSERT OR IGNORE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, position, added_at)
             SELECT ?2, media_external_id, relation_type, character_name, position, added_at
             FROM character_appearances WHERE character_external_id = ?1",
            rusqlite::params![&remap.old_external_id, &remap.new_external_id],
        ).str_err()?;
        tx.execute("DELETE FROM character_appearances WHERE character_external_id = ?1", [&remap.old_external_id]).str_err()?;
        tx.execute(
            "INSERT OR IGNORE INTO character_actors (actor_external_id, character_external_id, role, language, added_at)
             SELECT actor_external_id, ?2, role, language, added_at
             FROM character_actors WHERE character_external_id = ?1",
            rusqlite::params![&remap.old_external_id, &remap.new_external_id],
        ).str_err()?;
        tx.execute("DELETE FROM character_actors WHERE character_external_id = ?1", [&remap.old_external_id]).str_err()?;
        tx.execute(
            "INSERT OR IGNORE INTO character_merges (source_character_external_id, canonical_character_external_id, added_at)
             SELECT ?2, canonical_character_external_id, added_at
             FROM character_merges WHERE source_character_external_id = ?1",
            rusqlite::params![&remap.old_external_id, &remap.new_external_id],
        ).str_err()?;
        tx.execute("DELETE FROM character_merges WHERE source_character_external_id = ?1", [&remap.old_external_id]).str_err()?;
        tx.execute(
            "UPDATE character_merges SET canonical_character_external_id = ?2 WHERE canonical_character_external_id = ?1",
            rusqlite::params![&remap.old_external_id, &remap.new_external_id],
        ).str_err()?;
        tx.execute(
            "INSERT OR IGNORE INTO user_list_items (external_id, list_key, position, added_at)
             SELECT ?2, list_key, position, added_at FROM user_list_items WHERE external_id = ?1",
            rusqlite::params![&remap.old_external_id, &remap.new_external_id],
        ).str_err()?;
        tx.execute("DELETE FROM user_list_items WHERE external_id = ?1", [&remap.old_external_id]).str_err()?;
        tx.execute(
            "INSERT OR IGNORE INTO tier_list_items (external_id, position, tier_key, tier_list_id)
             SELECT ?2, position, tier_key, tier_list_id FROM tier_list_items WHERE external_id = ?1",
            rusqlite::params![&remap.old_external_id, &remap.new_external_id],
        ).str_err()?;
        tx.execute("DELETE FROM tier_list_items WHERE external_id = ?1", [&remap.old_external_id]).str_err()?;
        tx.execute("UPDATE OR IGNORE favorite_custom_images SET external_id = ?2 WHERE external_id = ?1", rusqlite::params![&remap.old_external_id, &remap.new_external_id]).str_err()?;
        tx.execute("DELETE FROM favorite_custom_images WHERE external_id = ?1", [&remap.old_external_id]).str_err()?;
        tx.execute("UPDATE user_activity SET external_id = ?2 WHERE external_id = ?1", rusqlite::params![&remap.old_external_id, &remap.new_external_id]).str_err()?;
        tx.execute("UPDATE OR IGNORE characters SET external_id = ?2 WHERE external_id = ?1", rusqlite::params![&remap.old_external_id, &remap.new_external_id]).str_err()?;
        tx.execute("DELETE FROM characters WHERE external_id = ?1", [&remap.old_external_id]).str_err()?;
        moved += 1;
    }
    tx.commit().str_err()?;
    Ok(moved)
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SkeletonCharacter {
    pub external_id: String,
    pub name: String,
    pub image_url: Option<String>,
    pub relation_type: Option<String>,
    pub character_name: Option<String>,
}

#[tauri::command]
pub async fn save_characters_skeleton(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
    characters: Vec<SkeletonCharacter>,
) -> Result<(), String> {
    let data_dir = image_data_dir(&app_handle)?;
    let characters = characters.into_iter().map(|mut character| {
        if let Some(image_url) = character.image_url.as_deref() {
            character.image_url = Some(crate::image_storage::store_image_value(
                &data_dir, "characters", &character.external_id, image_url,
            )?);
        }
        Ok(character)
    }).collect::<Result<Vec<_>, String>>()?;
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    let now = Utc::now().to_rfc3339();
    let mut seen = std::collections::HashSet::new();

    // `characters` is always the full curated list for this media (the PR
    // editor's Personajes grid), so anything missing from it was
    // deliberately removed — clear existing rows first or removals never
    // persist (same class of bug fixed in media_catalog::import_proposal_bundle).
    tx.execute(
        "DELETE FROM character_appearances WHERE media_external_id = ?1",
        [&media_external_id],
    ).str_err()?;

    for (index, char) in characters.into_iter().enumerate() {
        if !seen.insert(char.external_id.clone()) {
            continue;
        }

        tx.execute(
            "INSERT OR IGNORE INTO characters (id, external_id, name, image_url, reaction, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                crate::db::generate_id(),
                &char.external_id,
                &char.name,
                &char.image_url,
                None::<String>,
                &now,
                &now,
            ],
        ).str_err()?;

        // `index` is this media's own cast order (AniList's own
        // sort: [ROLE, RELEVANCE] when this came from a live fetch — MAIN
        // characters first) — stored so it survives independently of a
        // later per-character rewrite (see save_character_appearances).
        tx.execute(
            "INSERT OR REPLACE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, position, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                &char.external_id,
                &media_external_id,
                &char.relation_type,
                &char.character_name,
                index as i32,
                &now,
            ],
        ).str_err()?;
    }

    tx.commit().str_err()?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CharacterMerge {
    pub external_id: String,
    pub name: String,
    pub image_url: Option<String>,
}

#[tauri::command]
pub async fn get_character_merges(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    canonical_character_external_id: String,
) -> Result<Vec<CharacterMerge>, String> {
    let mut rows: Vec<CharacterMerge> = {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT m.source_character_external_id, COALESCE(c.name, m.source_character_external_id), c.image_url
         FROM character_merges m
         LEFT JOIN characters c ON c.external_id = m.source_character_external_id
         WHERE m.canonical_character_external_id = ?1
         ORDER BY COALESCE(c.name, m.source_character_external_id)",
    ).str_err()?;
    let rows: Vec<CharacterMerge> = stmt.query_map([&canonical_character_external_id], |row| {
        Ok(CharacterMerge {
            external_id: row.get(0)?,
            name: row.get(1)?,
            image_url: row.get(2)?,
        })
    }).str_err()?.filter_map(|row| row.ok()).collect();
    drop(stmt);
    rows
    };
    let data_dir = image_data_dir(&app_handle)?;
    for row in &mut rows { resolve_character_image(&data_dir, &mut row.image_url)?; }
    Ok(rows)
}

#[tauri::command]
pub async fn get_character_merge_target(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    source_character_external_id: String,
) -> Result<Option<String>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        "WITH RECURSIVE redirects(external_id, depth, path) AS (
             SELECT canonical_character_external_id, 1,
                    '|' || ?1 || '|' || canonical_character_external_id || '|'
             FROM character_merges WHERE source_character_external_id = ?1
             UNION ALL
             SELECT m.canonical_character_external_id, r.depth + 1,
                    r.path || m.canonical_character_external_id || '|'
             FROM character_merges m
             JOIN redirects r ON m.source_character_external_id = r.external_id
             WHERE r.depth < 32
               AND instr(r.path, '|' || m.canonical_character_external_id || '|') = 0
         )
         SELECT external_id FROM redirects ORDER BY depth DESC LIMIT 1",
        [&source_character_external_id],
        |row| row.get(0),
    ).optional().str_err()
}

#[tauri::command]
pub async fn save_character_merges(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    canonical_character_external_id: String,
    source_character_external_ids: Vec<String>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    tx.execute(
        "DELETE FROM character_merges WHERE canonical_character_external_id = ?1",
        [&canonical_character_external_id],
    ).str_err()?;
    let mut seen = std::collections::HashSet::new();
    for source_id in source_character_external_ids {
        if source_id.trim().is_empty()
            || source_id == canonical_character_external_id
            || !seen.insert(source_id.clone())
        {
            continue;
        }
        tx.execute(
            "INSERT OR REPLACE INTO character_merges (source_character_external_id, canonical_character_external_id)
             VALUES (?1, ?2)",
            rusqlite::params![source_id, &canonical_character_external_id],
        ).str_err()?;
    }
    tx.commit().str_err()?;
    Ok(())
}
