// Actors (voice actors and live-action actors) tied to a character — mirrors
// staff.rs's shape/commands one-for-one, keyed by character_external_id
// instead of media_external_id. Shared table for both roles since a person
// can plausibly be sourced from either AniList Staff (role='voice') or TMDB
// (role='actor') — see actors' own doc comment in db.rs.
use chrono::Utc;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize)]
pub struct CharacterActor {
    pub external_id: String,
    pub name: String,
    pub name_native: Option<String>,
    pub image_url: Option<String>,
    pub role: Option<String>,
    pub language: Option<String>,
}

#[tauri::command]
pub async fn get_character_actors(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    character_external_id: String,
) -> Result<Vec<CharacterActor>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT a.external_id, a.name, a.name_native, a.image_url, ca.role, ca.language
             FROM character_actors ca
             JOIN actors a ON a.external_id = ca.actor_external_id
             WHERE ca.character_external_id = ?1",
        )
        .str_err()?;
    let rows = stmt
        .query_map([&character_external_id], |row| {
            Ok(CharacterActor {
                external_id: row.get(0)?,
                name: row.get(1)?,
                name_native: row.get(2)?,
                image_url: row.get(3)?,
                role: row.get(4)?,
                language: row.get(5)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// Same "full curated list, so anything missing was deliberately removed"
// replace-in-place shape as save_characters_skeleton/save_staff_skeleton.
#[tauri::command]
pub async fn save_character_actors(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    character_external_id: String,
    actors: Vec<CharacterActor>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    let now = Utc::now().to_rfc3339();
    let mut seen = std::collections::HashSet::new();

    tx.execute(
        "DELETE FROM character_actors WHERE character_external_id = ?1",
        [&character_external_id],
    ).str_err()?;

    for actor in actors {
        if !seen.insert(actor.external_id.clone()) {
            continue;
        }

        tx.execute(
            "INSERT INTO actors (id, external_id, name, name_native, image_url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(external_id) DO UPDATE SET
                name = excluded.name, name_native = excluded.name_native,
                image_url = excluded.image_url, updated_at = excluded.updated_at",
            rusqlite::params![
                crate::db::generate_id(),
                &actor.external_id,
                &actor.name,
                &actor.name_native,
                &actor.image_url,
                &now,
            ],
        ).str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO character_actors (actor_external_id, character_external_id, role, language, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                &actor.external_id,
                &character_external_id,
                &actor.role,
                &actor.language,
                &now,
            ],
        ).str_err()?;
    }

    tx.commit().str_err()?;
    Ok(())
}
