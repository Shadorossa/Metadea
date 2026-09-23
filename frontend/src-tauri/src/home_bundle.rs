//! Aggregated read for Home's mount.
//!
//! `get_home_bundle` returns, in one IPC round trip and under one connection
//! lock, everything lib/profile/library-data-cache.ts used to assemble
//! through a chain of sequential commands: the library rows and their
//! catalog summaries (two parallel commands), then the scoped relations
//! closure (lib/profile/relations-scope.ts — one get_media_relations_for_ids
//! per expansion hop, measured at 9 hops on a real library), then the
//! catalog summaries for every id those relations introduced, then the saga
//! names the "unify seasons" grouping reads. Twelve sequential round trips
//! on that library, now one.
//!
//! Each part is produced by the same `load_*` helper its standalone command
//! uses, and the closure walk follows relations-scope.ts's algorithm step
//! for step (same seed order, same frontier rule, same merge order, same hop
//! cap) so the rows — and their order — are identical to the chain they
//! replace. The relation kinds that form chains, the kinds to exclude and the
//! hop cap are passed in by the frontend, which keeps their single source of
//! truth in TypeScript.
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use crate::db::ToStringErr;

#[derive(Debug, Serialize)]
pub struct HomeBundle {
    pub library: Vec<crate::user_library::LibraryEntry>,
    /// The library-scoped summaries first (get_catalog_entries_for_library
    /// order), then the rows the relations closure introduced
    /// (get_catalog_entries_by_ids order) — the same concatenation
    /// library-data-cache.ts builds.
    pub catalog: Vec<crate::media_catalog::CatalogSummary>,
    pub relations: Vec<crate::media_relations::DbMediaRelation>,
    pub saga_names: HashMap<String, String>,
}

fn push_unique(seen: &mut HashSet<String>, out: &mut Vec<String>, id: Option<&str>) {
    let Some(id) = id else { return };
    if id.is_empty() || seen.contains(id) {
        return;
    }
    seen.insert(id.to_string());
    out.push(id.to_string());
}

fn relation_key(relation: &crate::media_relations::DbMediaRelation) -> (String, String, String) {
    (
        relation.media_external_id.clone().unwrap_or_default(),
        relation.related_media_external_id.clone(),
        relation.relation_type.clone(),
    )
}

// relations-scope.ts's loadScopedMediaRelations: every relation (minus
// `exclude_types`) touching `seed_ids`, expanded outwards along
// `chain_types` edges for at most `max_hops` extra rounds. Rows are kept in
// first-seen order and deduplicated by (owner, related, type), exactly as
// mergeRelations does.
pub(crate) fn load_scoped_relations_closure(
    conn: &rusqlite::Connection,
    seed_ids: &[String],
    chain_types: &[String],
    exclude_types: &[String],
    max_hops: usize,
) -> Result<Vec<crate::media_relations::DbMediaRelation>, String> {
    let chain: HashSet<&str> = chain_types.iter().map(String::as_str).collect();
    let mut known: HashSet<String> = seed_ids.iter().cloned().collect();
    let mut targets: Vec<String> = seed_ids.to_vec();
    let mut relations = Vec::new();
    let mut keys: HashSet<(String, String, String)> = HashSet::new();

    let mut hop = 0;
    while hop <= max_hops && !targets.is_empty() {
        let fetched = crate::media_relations::load_media_relations_for_ids(conn, &targets, Some(exclude_types))?;
        // collectRelationFrontier: ids on either end of a chain-forming row
        // that aren't known yet, owner side first, input order.
        let mut frontier_seen = HashSet::new();
        let mut frontier = Vec::new();
        for relation in &fetched {
            if !chain.contains(relation.relation_type.as_str()) {
                continue;
            }
            for id in [relation.media_external_id.as_deref(), Some(relation.related_media_external_id.as_str())] {
                let Some(id) = id else { continue };
                if id.is_empty() || known.contains(id) {
                    continue;
                }
                push_unique(&mut frontier_seen, &mut frontier, Some(id));
            }
        }
        for relation in fetched {
            if keys.insert(relation_key(&relation)) {
                relations.push(relation);
            }
        }
        for id in &frontier {
            known.insert(id.clone());
        }
        targets = frontier;
        hop += 1;
    }
    Ok(relations)
}

pub(crate) fn load_home_bundle(
    conn: &rusqlite::Connection,
    chain_types: &[String],
    exclude_types: &[String],
    max_hops: usize,
) -> Result<HomeBundle, String> {
    let library = crate::user_library::load_all_library_entries(conn)?;
    let mut catalog = crate::media_catalog::load_catalog_summaries_for_library(conn, None)?;

    // collectSeedIds: library rows first, then the scoped catalog rows.
    let mut seen = HashSet::new();
    let mut seeds = Vec::new();
    for id in library.iter().map(|row| row.external_id.as_str()).chain(catalog.iter().map(|row| row.external_id.as_str())) {
        push_unique(&mut seen, &mut seeds, Some(id));
    }

    let relations = if seeds.is_empty() {
        Vec::new()
    } else {
        load_scoped_relations_closure(conn, &seeds, chain_types, exclude_types, max_hops)?
    };

    // collectMissingCatalogIds: either end of every relation row that has
    // no catalog row yet, owner side first, relation order.
    let mut known_catalog: HashSet<String> = catalog.iter().map(|row| row.external_id.clone()).collect();
    let mut missing = Vec::new();
    for relation in &relations {
        push_unique(&mut known_catalog, &mut missing, relation.media_external_id.as_deref());
        push_unique(&mut known_catalog, &mut missing, Some(relation.related_media_external_id.as_str()));
    }
    if !missing.is_empty() {
        catalog.extend(crate::media_catalog::load_catalog_summaries_by_ids(conn, &missing)?);
    }

    let library_ids: Vec<String> = library.iter().map(|row| row.external_id.clone()).collect();
    let saga_names = if library_ids.is_empty() {
        HashMap::new()
    } else {
        crate::sagas::load_saga_names(conn, &library_ids)?
    };

    Ok(HomeBundle { library, catalog, relations, saga_names })
}

#[tauri::command]
pub async fn get_home_bundle(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    chain_types: Vec<String>,
    exclude_types: Vec<String>,
    max_hops: usize,
) -> Result<HomeBundle, String> {
    let conn = state.conn.lock().str_err()?;
    load_home_bundle(&conn, &chain_types, &exclude_types, max_hops.min(64))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(conn: &rusqlite::Connection) {
        // Library owns season 1 and 3 of a five-season anime; season 2, 4
        // and 5 are only reachable through SEQUEL hops. A movie is related
        // to season 1 by a non-chain kind (still fetched, not expanded), and
        // a recommendation is excluded entirely.
        for (ext, kind) in [
            ("anime:1", "anime"), ("anime:2", "anime"), ("anime:3", "anime"), ("anime:4", "anime"), ("anime:5", "anime"),
            ("movie:1", "movie"), ("anime:9", "anime"), ("anime:99", "anime"),
        ] {
            conn.execute(
                "INSERT INTO media_catalog (id, external_id, type, title_main) VALUES (?1, ?1, ?2, ?1)",
                rusqlite::params![ext, kind],
            ).unwrap();
        }
        conn.execute("INSERT INTO user_library (external_id, type, user_id, status) VALUES ('anime:1', 'anime', 'local', 'watching')", []).unwrap();
        conn.execute("INSERT INTO user_library (external_id, type, user_id, status) VALUES ('anime:3', 'anime', 'local', 'planning')", []).unwrap();
        for (a, b, kind) in [
            ("anime:1", "anime:2", "SEQUEL"),
            ("anime:2", "anime:3", "SEQUEL"),
            ("anime:3", "anime:4", "SEQUEL"),
            ("anime:4", "anime:5", "SEQUEL"),
            ("anime:1", "movie:1", "SIDE_STORY"),
            ("movie:1", "anime:9", "SEQUEL"),
            ("anime:1", "anime:99", "RECOMMENDATION"),
        ] {
            conn.execute(
                "INSERT INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 VALUES (?1, ?2, ?3, ?3)",
                rusqlite::params![a, b, kind],
            ).unwrap();
        }
        conn.execute("INSERT INTO sagas (id, name) VALUES ('saga-1', 'Five Seasons')", []).unwrap();
        conn.execute("INSERT INTO saga_relations (saga_id, media_external_id) VALUES ('saga-1', 'anime:1')", []).unwrap();
    }

    fn chain() -> Vec<String> { vec!["SEQUEL".into(), "PREQUEL".into()] }
    fn excluded() -> Vec<String> { vec!["RECOMMENDATION".into()] }

    // Library-scoped rows first (their own statement's order), then the
    // rows the closure introduced — those come back in the by-ids
    // statement's own order (as get_catalog_entries_by_ids always did), so
    // only the split and the set are asserted.
    fn ids(rows: &[crate::media_catalog::CatalogSummary], library_scoped: usize) -> Vec<&str> {
        let mut out: Vec<&str> = rows.iter().take(library_scoped).map(|r| r.external_id.as_str()).collect();
        let mut extra: Vec<&str> = rows.iter().skip(library_scoped).map(|r| r.external_id.as_str()).collect();
        extra.sort_unstable();
        out.extend(extra);
        out
    }

    #[test]
    fn bundle_walks_the_chain_closure_and_adds_the_rows_it_reached() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        let bundle = load_home_bundle(&conn, &chain(), &excluded(), 8).unwrap();

        assert_eq!(bundle.library.len(), 2);
        assert_eq!(ids(&bundle.catalog, 2), vec!["anime:1", "anime:3", "anime:2", "anime:4", "anime:5", "movie:1"]);
        let pairs: Vec<(String, String)> = bundle.relations.iter()
            .map(|r| (r.media_external_id.clone().unwrap_or_default(), r.related_media_external_id.clone()))
            .collect();
        // Hop 0 (seeds anime:1, anime:3): 1→2, 1→movie, 2→3 (related side), 3→4.
        // Hop 1 (frontier anime:2, anime:4): 4→5. SIDE_STORY doesn't expand,
        // so movie:1's own SEQUEL to anime:9 is never reached; the
        // recommendation is excluded.
        assert_eq!(pairs, vec![
            ("anime:1".into(), "anime:2".into()),
            ("anime:2".into(), "anime:3".into()),
            ("anime:3".into(), "anime:4".into()),
            ("anime:1".into(), "movie:1".into()),
            ("anime:4".into(), "anime:5".into()),
        ]);
        assert_eq!(bundle.saga_names.get("anime:1").map(String::as_str), Some("Five Seasons"));
        assert!(!bundle.saga_names.contains_key("anime:3"));
    }

    #[test]
    fn hop_cap_stops_the_expansion() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        let bundle = load_home_bundle(&conn, &chain(), &excluded(), 0).unwrap();
        assert_eq!(bundle.relations.len(), 4);
        assert_eq!(ids(&bundle.catalog, 2), vec!["anime:1", "anime:3", "anime:2", "anime:4", "movie:1"]);
    }

    #[test]
    fn empty_library_yields_empty_parts() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let bundle = load_home_bundle(&conn, &chain(), &excluded(), 8).unwrap();
        assert!(bundle.library.is_empty() && bundle.catalog.is_empty() && bundle.relations.is_empty() && bundle.saga_names.is_empty());
    }
}
