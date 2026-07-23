use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;
use crate::media_catalog::{existing_catalog_ids, infer_type_from_id, infer_source_from_id};

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

#[tauri::command]
pub async fn save_character(
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
            &id, &external_id, &name, &name_native, &aliases_csv, &biography, &image_url, &reaction,
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
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<CharacterEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        &format!("{} WHERE external_id = ?1", SELECT_CHARACTER),
        [&external_id],
        row_to_character,
    )
    .optional()
    .str_err()
}

// Bulk fetch for local-only UI that needs every cached character's name/cover
// without a per-id round trip — e.g. the profile Favorites tab, which used to
// resolve character title/cover via a media_catalog row that shouldn't have
// existed for a character in the first place (see save_character in
// character.astro instead of a duplicate media_catalog entry).
#[tauri::command]
pub async fn get_all_characters(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<CharacterEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(SELECT_CHARACTER).str_err()?;
    let rows = stmt
        .query_map([], row_to_character)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
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
        .prepare("SELECT media_external_id, relation_type, character_name FROM character_appearances WHERE character_external_id = ?1")
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
}

// Reverse of get_character_appearances (which is keyed by character) — used
// by PrEditorModal to carry a media's already-cached characters along into a
// collaborative-catalog PR bundle instead of losing them (the editor itself
// has no character-editing UI; this just republishes what was already synced
// locally from the API).
#[tauri::command]
pub async fn get_media_characters(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<MediaCharacter>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT c.external_id, c.name, c.image_url, ca.relation_type, ca.character_name
             FROM character_appearances ca
             JOIN characters c ON c.external_id = ca.character_external_id
             WHERE ca.media_external_id = ?1
             ORDER BY
                (ca.position IS NULL), ca.position,
                CASE ca.relation_type WHEN 'MAIN' THEN 0 WHEN 'SUPPORTING' THEN 1 WHEN 'BACKGROUND' THEN 2 ELSE 3 END",
        )
        .str_err()?;
    let rows = stmt
        .query_map([&media_external_id], |row| {
            Ok(MediaCharacter {
                external_id: row.get(0)?,
                name: row.get(1)?,
                image_url: row.get(2)?,
                relation_type: row.get(3)?,
                character_name: row.get(4)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
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
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
    characters: Vec<SkeletonCharacter>,
) -> Result<(), String> {
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
