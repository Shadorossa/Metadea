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
    // Local-only display order — never enforced across installs, since
    // save_story_arc/hydration never write it for anything but a brand-new
    // arc (see its own comment). Each curator's manual ordering stays theirs.
    pub sort_order: i64,
}

// Shared by both commands below — every arc that has at least one item
// pointing at any of the given media ids, each returned with ALL of its
// items (not just the ones matching an input id), so a curator editing e.g.
// Bleach Sennen Kessen-hen Part 1 can see and adjust the whole "Thousand
// Year Blood War" arc's other 3 parts too, not just its own slice.
fn story_arcs_for_media_ids(
    conn: &rusqlite::Connection,
    media_external_ids: &[String],
) -> Result<Vec<StoryArc>, String> {
    if media_external_ids.is_empty() {
        return Ok(vec![]);
    }

    let id_placeholders = media_external_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let arc_ids: Vec<String> = {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT DISTINCT arc_id FROM story_arc_items WHERE media_external_id IN ({id_placeholders})"
            ))
            .str_err()?;
        let id_params: Vec<&dyn rusqlite::ToSql> = media_external_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let rows = stmt.query_map(id_params.as_slice(), |r| r.get::<_, String>(0)).str_err()?;
        rows.filter_map(|r| r.ok()).collect()
    };
    if arc_ids.is_empty() {
        return Ok(vec![]);
    }

    let placeholders = arc_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let mut arcs_stmt = conn
        .prepare(&format!(
            "SELECT id, name, image_base64, sort_order FROM story_arcs WHERE id IN ({placeholders}) ORDER BY sort_order, name"
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
                sort_order: row.get(3)?,
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

#[tauri::command]
pub async fn get_story_arcs_for_media(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<StoryArc>, String> {
    let conn = state.conn.lock().str_err()?;
    story_arcs_for_media_ids(&conn, &[media_external_id])
}

// Batched counterpart of get_story_arcs_for_media — one query (one DB-mutex
// acquisition) covering every id in the saga at once, instead of the
// frontend firing one IPC call per saga member. SagaViewerModal used to do
// exactly that via Promise.all: "parallel" from JS's side, but MetadeaDb's
// single Mutex<Connection> means those N calls actually queued up one after
// another on the Rust side anyway, so a long saga (Bleach's TV + several
// movies/OVAs) paid N round trips' worth of IPC + lock-acquisition overhead
// for no real concurrency gained.
#[tauri::command]
pub async fn get_story_arcs_for_media_batch(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_ids: Vec<String>,
) -> Result<Vec<StoryArc>, String> {
    let conn = state.conn.lock().str_err()?;
    story_arcs_for_media_ids(&conn, &media_external_ids)
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

    // Only matters for a brand-new arc — the UPDATE branch below never
    // touches sort_order, so an existing arc keeps whatever position the
    // curator already gave it via reorder_story_arcs.
    let next_sort_order: i64 = tx
        .query_row("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM story_arcs", [], |r| r.get(0))
        .str_err()?;

    tx.execute(
        "INSERT INTO story_arcs (id, name, image_base64, sort_order, updated_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET name = ?2, image_base64 = ?3, updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![&arc_id, &arc.name, &arc.image_base64, next_sort_order],
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

// Curator-driven manual reordering (drag/move in the editor) — sets
// sort_order to each id's position in the given list. Only meant for arcs
// already known to belong together (e.g. everything get_story_arcs_for_media
// just returned for one saga); doesn't touch arcs outside that list.
#[tauri::command]
pub async fn reorder_story_arcs(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    arc_ids: Vec<String>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    for (index, arc_id) in arc_ids.iter().enumerate() {
        tx.execute(
            "UPDATE story_arcs SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![index as i64, arc_id],
        )
        .str_err()?;
    }
    tx.commit().str_err()?;
    Ok(())
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
