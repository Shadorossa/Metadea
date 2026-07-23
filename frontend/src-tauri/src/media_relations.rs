// Relation CRUD between two catalog entries (prequel/sequel, bundled-in,
// adaptation, etc.) — split out of media_catalog.rs.
use chrono::Utc;
use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;
use crate::media_catalog::{existing_catalog_ids, reciprocal_relation, infer_type_from_id, infer_source_from_id};

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct DbMediaRelation {
    /// Owning media for this relation — absent for save_media_relations/
    /// get_media_relations calls (the media_external_id is already the
    /// function's own parameter there), present when this row travels inside
    /// a ProposalBundle, which can carry relations for more than one media
    /// (a saga PR touches every entry in the chain, not just one).
    pub media_external_id: Option<String>,
    pub related_media_external_id: String,
    pub relation_type: String,
    pub type_label: String,
    pub title: String,
    pub cover: Option<String>,
    /// The related media's own format — only used to give the skeleton
    /// media_catalog row this same command creates for a not-yet-cataloged
    /// related title a real format, instead of leaving that column blank.
    pub format: Option<String>,
}

#[tauri::command]
pub async fn save_media_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
    relations: Vec<DbMediaRelation>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    // Snapshot of related ids before the replace below, to diff against the
    // incoming list and keep deleted_relations in sync with what the caller
    // actually removed vs. kept/re-added.
    let previous_related_ids: HashSet<String> = {
        let mut stmt = tx.prepare(
            "SELECT related_media_external_id FROM media_relations WHERE media_external_id = ?1"
        ).str_err()?;
        let rows = stmt.query_map([&media_external_id], |r| r.get::<_, String>(0)).str_err()?;
        rows.filter_map(|r| r.ok()).collect()
    };

    tx.execute(
        "DELETE FROM media_relations WHERE media_external_id = ?1",
        [&media_external_id],
    )
    .str_err()?;

    let now = Utc::now().to_rfc3339();

    let all_ids: Vec<String> = relations.iter().map(|r| r.related_media_external_id.clone()).collect();
    let existing_ids = existing_catalog_ids(&tx, &all_ids)?;

    let new_related_ids: HashSet<String> = relations.iter()
        .filter(|r| r.related_media_external_id != media_external_id)
        .map(|r| r.related_media_external_id.clone())
        .collect();

    // A pair that existed before this save but is absent from the new list
    // was deliberately removed by whoever called this — tombstone it so a
    // future live/community relation merge doesn't silently bring it back.
    // Anything now present (kept or deliberately re-added) must not stay
    // tombstoned from an earlier deletion.
    for removed_id in previous_related_ids.difference(&new_related_ids) {
        tx.execute(
            "INSERT OR REPLACE INTO deleted_relations (media_external_id, related_media_external_id, deleted_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![&media_external_id, removed_id, &now],
        ).str_err()?;
    }
    for kept_id in &new_related_ids {
        tx.execute(
            "DELETE FROM deleted_relations WHERE media_external_id = ?1 AND related_media_external_id = ?2",
            rusqlite::params![&media_external_id, kept_id],
        ).str_err()?;
    }

    for rel in relations {
        // A media can't be related to itself — silently drop rather than
        // erroring, since this can only come from a bad merge/edit upstream
        // and shouldn't block saving everything else the user changed.
        if rel.related_media_external_id == media_external_id {
            continue;
        }

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

        if let Some((recip_type, recip_label)) = reciprocal_relation(&rel.relation_type) {
            tx.execute(
                "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![&rel.related_media_external_id, &media_external_id, recip_type, recip_label],
            )
            .str_err()?;
        }

        if !existing_ids.contains(&rel.related_media_external_id) {
            let rel_type = infer_type_from_id(&rel.related_media_external_id);
            tx.execute(
                "INSERT OR IGNORE INTO media_catalog (
                    id, external_id, type, source, format, title_main, cover_url, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &rel.related_media_external_id,
                    &rel_type,
                    infer_source_from_id(&rel.related_media_external_id),
                    &rel.format,
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

// Read side of the deleted_relations tombstone table — mergeAndPersistRelations
// (TS) calls this before merging a live/community relation list back in, so
// it can skip re-adding any pair the user deliberately removed here.
#[tauri::command]
pub async fn get_deleted_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT related_media_external_id FROM deleted_relations WHERE media_external_id = ?1"
    ).str_err()?;
    let rows = stmt.query_map([&media_external_id], |r| r.get::<_, String>(0)).str_err()?;
    Ok(rows.filter_map(|r| r.ok()).collect())
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
             JOIN visible_media_catalog mc ON mc.external_id = mr.related_media_external_id
             WHERE mr.media_external_id = ?1
             ORDER BY mr.rowid",
        )
        .str_err()?;

    let rows = stmt
        .query_map([&media_external_id], |row| {
            Ok(DbMediaRelation {
                media_external_id: None, // this query is already scoped to one media_external_id param
                related_media_external_id: row.get(0)?,
                relation_type: row.get(1)?,
                type_label: row.get(2)?,
                title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                cover: row.get(4)?,
                format: None,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

// Same as get_media_relations but joined against the plain media_catalog
// table (not visible_media_catalog) — the collaborative-catalog editor
// (PrEditorModal) is exactly where a curator needs to see/manage a relation
// pointing at a blocked entry (e.g. the "is a version of" link to the base
// game it was blocked in favor of), so it must never have blocked rows
// filtered out the way every other read path deliberately does.
#[tauri::command]
pub async fn get_media_relations_for_editor(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<DbMediaRelation>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            "SELECT mr.related_media_external_id, mr.relation_type, mr.type_label, mc.title_main, mc.cover_url
             FROM media_relations mr
             JOIN media_catalog mc ON mc.external_id = mr.related_media_external_id
             WHERE mr.media_external_id = ?1
             ORDER BY mr.rowid",
        )
        .str_err()?;

    let rows = stmt
        .query_map([&media_external_id], |row| {
            Ok(DbMediaRelation {
                media_external_id: None,
                related_media_external_id: row.get(0)?,
                relation_type: row.get(1)?,
                type_label: row.get(2)?,
                title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                cover: row.get(4)?,
                format: None,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

// Bulk fetch for the library grid's "group by edition/saga" toggle — grouping
// anime/manga/lnovel by SEQUEL/PREQUEL needs every relation up front to build
// the parent/child map client-side, instead of one get_media_relations round
// trip per library item (which is what the per-media query above is for).
#[tauri::command]
pub async fn get_all_media_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<DbMediaRelation>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare(
            // ORDER BY mr.rowid — same convention as get_media_relations.
            // save_media_relations always deletes+reinserts a media's whole
            // relation list in the curated (possibly drag-reordered) array
            // order, so rowid IS that order. Without this, the profile
            // library's bundle grouping (groupBundles) — the only caller of
            // this bulk query — showed a bundle's "Contains" children in
            // whatever order SQLite's query planner happened to return them,
            // not the order curated in the editor.
            "SELECT mr.media_external_id, mr.related_media_external_id, mr.relation_type, mr.type_label, mc.title_main, mc.cover_url
             FROM media_relations mr
             JOIN visible_media_catalog mc ON mc.external_id = mr.related_media_external_id
             ORDER BY mr.rowid",
        )
        .str_err()?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DbMediaRelation {
                media_external_id: row.get(0)?,
                related_media_external_id: row.get(1)?,
                relation_type: row.get(2)?,
                type_label: row.get(3)?,
                title: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                cover: row.get(5)?,
                format: None,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}
