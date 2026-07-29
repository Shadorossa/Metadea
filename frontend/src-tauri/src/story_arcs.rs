// Story arcs (e.g. Bleach's "Sociedad de Almas"/"Arrancar", or a multi-part
// saga entry collapsing into one "Thousand Year Blood War" arc) — see
// db.rs migration 41's own comment for why this is two tables rather than
// a column on media_relations.
use serde::{Deserialize, Serialize};
use crate::db::{generate_id, ToStringErr};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct StoryArcItem {
    pub id: String,
    pub media_external_id: String,
    pub ep_start: Option<i64>,
    pub ep_end: Option<i64>,
    pub position: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct StoryArc {
    pub id: String,
    pub name: String,
    pub image_base64: Option<String>,
    pub items: Vec<StoryArcItem>,
}

// Every arc that has at least one item pointing at this media — returned
// with ALL of its items (not just the one for this media), so a curator
// editing e.g. Bleach Sennen Kessen-hen Part 1 can see and adjust the whole
// "Thousand Year Blood War" arc's other 3 parts too, not just its own slice.
#[tauri::command]
pub async fn get_story_arcs_for_media(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<StoryArc>, String> {
    let conn = state.conn.lock().str_err()?;

    let arc_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT DISTINCT arc_id FROM story_arc_items WHERE media_external_id = ?1")
            .str_err()?;
        let rows = stmt.query_map([&media_external_id], |r| r.get::<_, String>(0)).str_err()?;
        rows.filter_map(|r| r.ok()).collect()
    };
    if arc_ids.is_empty() {
        return Ok(vec![]);
    }

    let placeholders = arc_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut arcs_stmt = conn
        .prepare(&format!(
            "SELECT id, name, image_base64 FROM story_arcs WHERE id IN ({placeholders}) ORDER BY name"
        ))
        .str_err()?;
    let arc_params: Vec<&dyn rusqlite::ToSql> = arc_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let mut arcs: Vec<StoryArc> = arcs_stmt
        .query_map(arc_params.as_slice(), |row| {
            Ok(StoryArc {
                id: row.get(0)?,
                name: row.get(1)?,
                image_base64: row.get(2)?,
                items: vec![],
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    let mut items_stmt = conn
        .prepare(
            "SELECT id, arc_id, media_external_id, ep_start, ep_end, position
             FROM story_arc_items WHERE arc_id = ?1 ORDER BY position",
        )
        .str_err()?;
    for arc in &mut arcs {
        let items = items_stmt
            .query_map([&arc.id], |row| {
                Ok(StoryArcItem {
                    id: row.get(0)?,
                    media_external_id: row.get(2)?,
                    ep_start: row.get(3)?,
                    ep_end: row.get(4)?,
                    position: row.get(5)?,
                })
            })
            .str_err()?
            .filter_map(|r| r.ok())
            .collect();
        arc.items = items;
    }

    Ok(arcs)
}

// Upsert: empty id creates a new arc, an existing id updates name/image and
// fully replaces its item list (delete+reinsert — same convention as
// save_media_relations, simpler than diffing since an arc realistically
// only ever has a handful of items).
#[tauri::command]
pub async fn save_story_arc(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    arc: StoryArc,
) -> Result<String, String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    let arc_id = if arc.id.is_empty() { generate_id() } else { arc.id.clone() };

    tx.execute(
        "INSERT INTO story_arcs (id, name, image_base64, updated_at)
         VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET name = ?2, image_base64 = ?3, updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![&arc_id, &arc.name, &arc.image_base64],
    )
    .str_err()?;

    tx.execute("DELETE FROM story_arc_items WHERE arc_id = ?1", [&arc_id]).str_err()?;
    for (index, item) in arc.items.iter().enumerate() {
        tx.execute(
            "INSERT INTO story_arc_items (id, arc_id, media_external_id, ep_start, ep_end, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                generate_id(),
                &arc_id,
                &item.media_external_id,
                &item.ep_start,
                &item.ep_end,
                index as i64,
            ],
        )
        .str_err()?;
    }

    tx.commit().str_err()?;
    Ok(arc_id)
}

#[tauri::command]
pub async fn delete_story_arc(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    arc_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM story_arcs WHERE id = ?1", [&arc_id]).str_err()?;
    Ok(())
}
