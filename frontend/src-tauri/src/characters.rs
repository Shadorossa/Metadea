use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CharacterEntry {
    pub id: String,
    pub external_id: String,
    pub name: String,
    pub image_url: Option<String>,
    pub reaction: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CharacterAppearance {
    pub media_external_id: String,
    pub relation_type: Option<String>,
}

const SELECT_CHARACTER: &str =
    "SELECT id, external_id, name, image_url, reaction, created_at, updated_at FROM characters";

fn row_to_character(row: &rusqlite::Row<'_>) -> rusqlite::Result<CharacterEntry> {
    Ok(CharacterEntry {
        id: row.get(0)?,
        external_id: row.get(1)?,
        name: row.get(2)?,
        image_url: row.get(3)?,
        reaction: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

#[tauri::command]
pub async fn save_character(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    name: String,
    image_url: Option<String>,
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
        "INSERT OR REPLACE INTO characters (id, external_id, name, image_url, reaction, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![&id, &external_id, &name, &image_url, &reaction, &created_at, &updated_at],
    ).str_err()?;

    Ok(CharacterEntry { id, external_id, name, image_url, reaction, created_at, updated_at })
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
    let conn = state.conn.lock().str_err()?;
    let now = Utc::now().to_rfc3339();
    for a in appearances {
        conn.execute(
            "INSERT OR REPLACE INTO character_appearances (character_external_id, media_external_id, relation_type, added_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![&character_external_id, &a.media_external_id, &a.relation_type, &now],
        ).str_err()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_character_appearances(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    character_external_id: String,
) -> Result<Vec<CharacterAppearance>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare("SELECT media_external_id, relation_type FROM character_appearances WHERE character_external_id = ?1")
        .str_err()?;
    let rows = stmt
        .query_map([&character_external_id], |row| {
            Ok(CharacterAppearance {
                media_external_id: row.get(0)?,
                relation_type: row.get(1)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}
