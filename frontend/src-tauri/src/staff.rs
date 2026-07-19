// Media staff (director, writer, composer, ...) — kept in its own table
// instead of `characters`, since it's a real-world credit rather than an
// in-universe character, even though the media page renders both with the
// same card layout. Mirrors characters.rs's shape/commands one-for-one.
use chrono::Utc;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaStaffMember {
    pub external_id: String,
    pub name: String,
    pub image_url: Option<String>,
    pub role: Option<String>,
}

// Reverse of "who's on staff for this media" isn't needed yet (no staff
// detail page exists the way character.astro does) — get_media_staff is
// the only read path for now, same as get_media_characters started out.
#[tauri::command]
pub async fn get_media_staff(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<MediaStaffMember>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT s.external_id, s.name, s.image_url, sa.role
             FROM media_staff_relation sa
             JOIN media_staff s ON s.external_id = sa.staff_external_id
             WHERE sa.media_external_id = ?1",
        )
        .str_err()?;
    let rows = stmt
        .query_map([&media_external_id], |row| {
            Ok(MediaStaffMember {
                external_id: row.get(0)?,
                name: row.get(1)?,
                image_url: row.get(2)?,
                role: row.get(3)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SkeletonStaffMember {
    pub external_id: String,
    pub name: String,
    pub image_url: Option<String>,
    pub role: Option<String>,
}

// Same "full curated list, so anything missing was deliberately removed"
// replace-in-place shape as save_characters_skeleton — this is the only
// writer today (called once per live media fetch, see MediaPage.tsx), no
// staff-editing UI exists yet.
#[tauri::command]
pub async fn save_staff_skeleton(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
    staff: Vec<SkeletonStaffMember>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    let now = Utc::now().to_rfc3339();
    let mut seen = std::collections::HashSet::new();

    tx.execute(
        "DELETE FROM media_staff_relation WHERE media_external_id = ?1",
        [&media_external_id],
    ).str_err()?;

    for member in staff {
        if !seen.insert(member.external_id.clone()) {
            continue;
        }

        tx.execute(
            "INSERT OR IGNORE INTO media_staff (id, external_id, name, image_url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                crate::db::generate_id(),
                &member.external_id,
                &member.name,
                &member.image_url,
                &now,
                &now,
            ],
        ).str_err()?;

        tx.execute(
            "INSERT OR REPLACE INTO media_staff_relation (staff_external_id, media_external_id, role, added_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                &member.external_id,
                &media_external_id,
                &member.role,
                &now,
            ],
        ).str_err()?;
    }

    tx.commit().str_err()?;
    Ok(())
}
