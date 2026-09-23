// Relation CRUD between two catalog entries (prequel/sequel, bundled-in,
// adaptation, etc.) — split out of media_catalog.rs.
use chrono::Utc;
use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use rusqlite::OptionalExtension;
use crate::db::ToStringErr;
use crate::media_catalog::{existing_catalog_ids, reciprocal_relation, format_to_edition_relation, infer_type_from_id, infer_source_from_id};

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
    /// Release date of the related media — used for sorting relations by
    /// release date within each relation type category.
    pub release_day: Option<i32>,
    pub release_month: Option<i32>,
    pub release_year: Option<i32>,
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

        // BASE_EDITION's reciprocal isn't a fixed lookup like the rest —
        // the base game's own row needs to say WHICH kind of edition this
        // one is, which comes from this entry's own already-known catalog
        // format (REMASTER/REMAKE/DLC/...) rather than the relation_type
        // string alone. See format_to_edition_relation's own comment.
        let reciprocal = if rel.relation_type == "BASE_EDITION" {
            let format: Option<String> = tx.query_row(
                "SELECT format FROM media_catalog WHERE external_id = ?1",
                [&media_external_id],
                |row| row.get::<_, Option<String>>(0),
            ).ok().flatten();
            format.as_deref().and_then(format_to_edition_relation)
        } else {
            reciprocal_relation(&rel.relation_type)
        };

        if let Some((recip_type, recip_label)) = reciprocal {
            // The OTHER side's own tombstone, not media_external_id's (just
            // checked/rewritten above for ITS OWN direction only) — a
            // curator can deliberately remove JUST the reciprocal edge (game
            // 11169's own "Relaciones" no longer lists 427 as its
            // BASE_EDITION) while this side (427's REMAKE -> 11169) stays,
            // e.g. because IGDB's own live data still reports it. Blindly
            // REPLACE-ing here undid that removal every time this side's
            // relations got re-saved (a live /media?id=427 visit, most
            // visibly) — exactly the "I removed it and it keeps coming
            // back" bug this guard exists to close.
            let recip_deleted: bool = tx.query_row(
                "SELECT 1 FROM deleted_relations WHERE media_external_id = ?1 AND related_media_external_id = ?2",
                rusqlite::params![&rel.related_media_external_id, &media_external_id],
                |_| Ok(true),
            ).optional().str_err()?.unwrap_or(false);

            if !recip_deleted {
                // REPLACE, not IGNORE: a curator flipping an existing SOURCE<->
                // ADAPTATION (or PREQUEL<->SEQUEL/EPISODE<->PART_OF/UPDATE<->
                // PART_OF) pair in the editor must also flip the OTHER side's
                // already-existing row, not just skip it because a (now-stale,
                // contradictory) row is already there. IGNORE only ever helped
                // the very first time a pair was created, when the reciprocal
                // side genuinely didn't exist yet — from then on it silently
                // froze that side at whatever it was first written as.
                tx.execute(
                    "INSERT OR REPLACE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                     VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![&rel.related_media_external_id, &media_external_id, recip_type, recip_label],
                )
                .str_err()?;
            }
        }

        if !existing_ids.contains(&rel.related_media_external_id) {
            let rel_type = infer_type_from_id(&rel.related_media_external_id);
            tx.execute(
                "INSERT OR IGNORE INTO media_catalog (
                    id, external_id, type, source, format, title_main, cover_url, release_day, release_month, release_year, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &rel.related_media_external_id,
                    &rel_type,
                    infer_source_from_id(&rel.related_media_external_id),
                    &rel.format,
                    &rel.title,
                    &rel.cover,
                    &rel.release_day,
                    &rel.release_month,
                    &rel.release_year,
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

/// Replace provider-derived issue relations without writing user-deletion
/// tombstones. Issue lists are regenerated from ComicVine and may change when
/// a manga is remapped to a different volume; that is not a manual deletion.
#[tauri::command]
pub async fn replace_issue_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
    relations: Vec<DbMediaRelation>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    let now = Utc::now().to_rfc3339();
    let deleted_issue_ids: HashSet<String> = {
        let mut stmt = tx.prepare(
            "SELECT related_media_external_id FROM deleted_relations WHERE media_external_id = ?1",
        ).str_err()?;
        let rows = stmt.query_map([&media_external_id], |row| row.get::<_, String>(0)).str_err()?;
        rows.filter_map(|row| row.ok()).collect()
    };

    tx.execute(
        "DELETE FROM media_relations WHERE media_external_id = ?1 AND relation_type = 'ISSUE'",
        [&media_external_id],
    )
    .str_err()?;

    for rel in relations.into_iter().filter(|relation| relation.relation_type == "ISSUE") {
        if rel.related_media_external_id == media_external_id
            || deleted_issue_ids.contains(&rel.related_media_external_id)
        {
            continue;
        }

        tx.execute(
            "INSERT OR REPLACE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             VALUES (?1, ?2, 'ISSUE', ?3)",
            rusqlite::params![&media_external_id, &rel.related_media_external_id, &rel.type_label],
        )
        .str_err()?;

        tx.execute(
            "INSERT OR IGNORE INTO media_catalog (
                id, external_id, type, source, format, title_main, cover_url, release_day, release_month, release_year, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                crate::db::generate_id(),
                &rel.related_media_external_id,
                infer_type_from_id(&rel.related_media_external_id),
                infer_source_from_id(&rel.related_media_external_id),
                &rel.format,
                &rel.title,
                &rel.cover,
                &rel.release_day,
                &rel.release_month,
                &rel.release_year,
                &now,
                &now,
            ],
        )
        .str_err()?;
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

pub(crate) fn load_media_relations(
    conn: &rusqlite::Connection,
    media_external_id: &str,
    include_blocked: bool,
) -> Result<Vec<DbMediaRelation>, String> {
    let catalog_table = if include_blocked { "media_catalog" } else { "visible_media_catalog" };
    let query = format!(
        "SELECT mr.related_media_external_id, mr.relation_type, mr.type_label, mc.title_main, mc.cover_url, mc.release_day, mc.release_month, mc.release_year
         FROM media_relations mr
         JOIN {catalog_table} mc ON mc.external_id = mr.related_media_external_id
         WHERE mr.media_external_id = ?1
           AND UPPER(COALESCE(mc.format, '')) <> 'SUMMARY'
         ORDER BY mr.rowid"
    );
    let mut stmt = conn
        .prepare(&query)
        .str_err()?;

    let rows = stmt
        .query_map([media_external_id], |row| {
            Ok(DbMediaRelation {
                media_external_id: None, // this query is already scoped to one media_external_id param
                related_media_external_id: row.get(0)?,
                relation_type: row.get(1)?,
                type_label: row.get(2)?,
                title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                cover: row.get(4)?,
                format: None,
                release_day: row.get(5)?,
                release_month: row.get(6)?,
                release_year: row.get(7)?,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

#[tauri::command]
pub async fn get_media_relations(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<DbMediaRelation>, String> {
    let conn = state.conn.lock().str_err()?;
    load_media_relations(&conn, &media_external_id, false)
}

// The collaborative editor and Local's blocked-edition fallback need the
// complete BASE_EDITION chain, including intermediate blocked works.
#[tauri::command]
pub async fn get_media_relations_for_editor(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<DbMediaRelation>, String> {
    let conn = state.conn.lock().str_err()?;
    load_media_relations(&conn, &media_external_id, true)
}

// Semantic BASE_EDITION parents for Local's blocked-edition fallback. Older
// catalog data can store the edge on the base entry as REMASTER/REMAKE/etc.
// rather than on the edition as BASE_EDITION, so include both directions.
// Tombstones suppress the direction the curator removed. In particular, a
// tombstone on the base's reciprocal must not erase the blocked edition's
// still-present outgoing edge.
#[tauri::command]
pub async fn get_base_edition_candidates_for_redirect(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT candidate_external_id FROM (
             SELECT mr.related_media_external_id AS candidate_external_id,
                    0 AS direction_priority, mr.rowid AS relation_order
             FROM media_relations mr
             JOIN media_catalog candidate ON candidate.external_id = mr.related_media_external_id
             WHERE mr.media_external_id = ?1
               AND UPPER(TRIM(mr.relation_type)) = 'BASE_EDITION'
               AND UPPER(COALESCE(candidate.format, '')) <> 'SUMMARY'
               AND NOT EXISTS (
                   SELECT 1 FROM deleted_relations dr
                   WHERE dr.media_external_id = ?1
                     AND dr.related_media_external_id = mr.related_media_external_id
               )
             UNION ALL
             SELECT mr.media_external_id AS candidate_external_id,
                    1 AS direction_priority, mr.rowid AS relation_order
             FROM media_relations mr
             JOIN media_catalog candidate ON candidate.external_id = mr.media_external_id
             WHERE mr.related_media_external_id = ?1
               AND UPPER(TRIM(mr.relation_type)) IN ('REMASTER', 'REMAKE', 'EXPANDED_GAME', 'DLC', 'EXPANSION', 'STANDALONE')
               AND UPPER(COALESCE(candidate.format, '')) <> 'SUMMARY'
               AND NOT EXISTS (
                   SELECT 1 FROM deleted_relations dr
                   WHERE (dr.media_external_id = mr.media_external_id AND dr.related_media_external_id = ?1)
                      OR (dr.media_external_id = ?1 AND dr.related_media_external_id = mr.media_external_id)
               )
         )
         ORDER BY direction_priority, relation_order",
    ).str_err()?;
    let rows = stmt
        .query_map([&media_external_id], |row| row.get::<_, String>(0))
        .str_err()?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

// Bulk fetch for the profile's "group by edition/saga" toggle, which
// needs every relation up front to build the parent/child map client-side
// instead of one get_media_relations round trip per library item. Scoped:
// only edges touching one of
// the given ids (as owner OR related side), so the profile's saga/bundle
// grouping can ask for the library's own ids instead of every relation in
// the catalog. exclude_types drops relation kinds the caller never groups
// by — RECOMMENDATION is the big one: it fans out to ~10 edges per work and
// no grouping/stats code reads it. Chunked over the id list so a large
// library stays under SQLite's bound-variable cap, and run as two passes
// per chunk (owner side, related side) rather than one `a IN (..) OR b IN
// (..)` predicate: the planner answers that OR with a full scan of the PK
// index, while each single-side IN is an index search (PK for the owner
// side, idx_media_relations_related for the other). The results are merged
// and deduplicated by (owner, related) — an edge whose both sides are in
// the set matches from both passes — then re-sorted by rowid to keep
// the curated order: save_media_relations always deletes+reinserts a
// media's whole relation list in the curated (possibly drag-reordered)
// array order, so rowid IS that order (same convention as get_media_relations).
pub(crate) fn load_media_relations_for_ids(
    conn: &rusqlite::Connection,
    external_ids: &[String],
    exclude_types: Option<&[String]>,
) -> Result<Vec<DbMediaRelation>, String> {
    if external_ids.is_empty() {
        return Ok(Vec::new());
    }
    let excluded: Vec<String> = exclude_types
        .unwrap_or(&[])
        .iter()
        .map(|t| t.trim().to_uppercase())
        .filter(|t| !t.is_empty())
        .collect();

    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut rows: Vec<(i64, DbMediaRelation)> = Vec::new();
    for chunk in external_ids.chunks(crate::db::SQL_IN_CHUNK) {
    for side in ["mr.media_external_id", "mr.related_media_external_id"] {
        let sql = scoped_relations_sql(side, chunk.len(), excluded.len());
        let mut stmt = conn.prepare(&sql).str_err()?;
        let params = rusqlite::params_from_iter(chunk.iter().chain(excluded.iter()));
        let chunk_rows = stmt
            .query_map(params, |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    DbMediaRelation {
                        media_external_id: row.get(1)?,
                        related_media_external_id: row.get(2)?,
                        relation_type: row.get(3)?,
                        type_label: row.get(4)?,
                        title: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                        cover: row.get(6)?,
                        format: None,
                        release_day: row.get(7)?,
                        release_month: row.get(8)?,
                        release_year: row.get(9)?,
                    },
                ))
            })
            .str_err()?
            .filter_map(|r| r.ok());
        for (rowid, rel) in chunk_rows {
            let key = (
                rel.media_external_id.clone().unwrap_or_default(),
                rel.related_media_external_id.clone(),
            );
            if seen.insert(key) {
                rows.push((rowid, rel));
            }
        }
    }
    }
    rows.sort_by_key(|(rowid, _)| *rowid);
    Ok(rows.into_iter().map(|(_, rel)| rel).collect())
}

fn scoped_relations_sql(side_column: &str, id_count: usize, excluded_count: usize) -> String {
    let ids = crate::db::sql_placeholders(id_count);
    let exclude_clause = if excluded_count == 0 {
        String::new()
    } else {
        format!(
            " AND UPPER(mr.relation_type) NOT IN ({})",
            crate::db::sql_placeholders(excluded_count)
        )
    };
    format!(
        "SELECT mr.rowid, mr.media_external_id, mr.related_media_external_id, mr.relation_type, mr.type_label,
                mc.title_main, mc.cover_url, mc.release_day, mc.release_month, mc.release_year
         FROM media_relations mr
         JOIN visible_media_catalog mc ON mc.external_id = mr.related_media_external_id
         JOIN visible_media_catalog owner ON owner.external_id = mr.media_external_id
         WHERE {side_column} IN ({ids})
           AND UPPER(COALESCE(mc.format, '')) <> 'SUMMARY'{exclude_clause}"
    )
}

#[cfg(test)]
mod scoped_relation_tests {
    use super::*;

    fn seed(conn: &rusqlite::Connection) {
        for ext in ["anime:1", "anime:2", "anime:3", "anime:4", "anime:9"] {
            conn.execute(
                "INSERT INTO media_catalog (id, external_id, type, title_main) VALUES (?1, ?1, 'anime', ?1)",
                [ext],
            ).unwrap();
        }
        for (a, b, kind) in [
            ("anime:1", "anime:2", "SEQUEL"),
            ("anime:2", "anime:1", "PREQUEL"),
            ("anime:3", "anime:1", "RECOMMENDATION"),
            ("anime:1", "anime:9", "RECOMMENDATION"),
            ("anime:3", "anime:4", "SEQUEL"),
        ] {
            conn.execute(
                "INSERT INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 VALUES (?1, ?2, ?3, ?3)",
                rusqlite::params![a, b, kind],
            ).unwrap();
        }
    }

    fn pairs(rows: &[DbMediaRelation]) -> Vec<(String, String, String)> {
        rows.iter()
            .map(|r| (r.media_external_id.clone().unwrap(), r.related_media_external_id.clone(), r.relation_type.clone()))
            .collect()
    }

    #[test]
    fn returns_edges_touching_either_side_in_curated_order_without_duplicates() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        let rows = load_media_relations_for_ids(&conn, &["anime:1".into()], None).unwrap();
        assert_eq!(pairs(&rows), vec![
            ("anime:1".into(), "anime:2".into(), "SEQUEL".into()),
            ("anime:2".into(), "anime:1".into(), "PREQUEL".into()),
            ("anime:3".into(), "anime:1".into(), "RECOMMENDATION".into()),
            ("anime:1".into(), "anime:9".into(), "RECOMMENDATION".into()),
        ]);
        // Both sides in the set (possibly across chunks) still yields one row.
        let mut many: Vec<String> = (0..crate::db::SQL_IN_CHUNK).map(|i| format!("pad:{i}")).collect();
        many.insert(0, "anime:1".into());
        many.push("anime:2".into());
        let rows = load_media_relations_for_ids(&conn, &many, None).unwrap();
        assert_eq!(rows.len(), 4);
        assert!(load_media_relations_for_ids(&conn, &[], None).unwrap().is_empty());
    }

    #[test]
    fn exclude_types_drops_those_kinds_case_insensitively() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        let rows = load_media_relations_for_ids(
            &conn,
            &["anime:1".into()],
            Some(&["recommendation".to_string()]),
        ).unwrap();
        assert_eq!(pairs(&rows).len(), 2);
        assert!(rows.iter().all(|r| r.relation_type != "RECOMMENDATION"));
    }

    #[test]
    fn scoped_query_uses_indexes_on_both_sides_instead_of_scanning() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        for (side, expected_index) in [
            ("mr.media_external_id", "sqlite_autoindex_media_relations_1"),
            ("mr.related_media_external_id", "idx_media_relations_related"),
        ] {
            let sql = scoped_relations_sql(side, 3, 1);
            let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
            let plan: Vec<String> = stmt
                .query_map(rusqlite::params!["a", "b", "c", "RECOMMENDATION"], |r| r.get::<_, String>(3))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            let plan = plan.join("\n");
            assert!(!plan.contains("SCAN mr"), "{side}:\n{plan}");
            assert!(plan.contains(&format!("SEARCH mr USING INDEX {expected_index}")), "{side}:\n{plan}");
        }
    }
}

#[tauri::command]
pub async fn get_media_relations_for_ids(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_ids: Vec<String>,
    exclude_types: Option<Vec<String>>,
) -> Result<Vec<DbMediaRelation>, String> {
    let conn = state.conn.lock().str_err()?;
    load_media_relations_for_ids(&conn, &external_ids, exclude_types.as_deref())
}

// Purely local negative cache (see migration 47 in db.rs) — lets
// seasonResolve.ts skip re-asking AniList for a title's prequel/sequel once
// it's already confirmed there isn't one, instead of repeating that request
// every time the title's Local panel is opened.
#[tauri::command]
pub async fn get_anilist_pre_sequel_checked(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<bool, String> {
    let conn = state.conn.lock().str_err()?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM anilist_pre_sequel WHERE external_id = ?1)",
            [&external_id],
            |row| row.get(0),
        )
        .str_err()?;
    Ok(exists)
}

#[tauri::command]
pub async fn mark_anilist_pre_sequel_checked(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT OR IGNORE INTO anilist_pre_sequel (external_id) VALUES (?1)",
        [&external_id],
    )
    .str_err()?;
    Ok(())
}
