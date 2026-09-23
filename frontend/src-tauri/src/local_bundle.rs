//! Aggregated reads for the Local page's mount.
//!
//! `get_local_library_bundle` returns, in one IPC round trip and under one
//! connection lock, what components/local/hooks/useLocalMediaEntries.ts used
//! to assemble from three commands (library rows, the WHOLE catalog in its
//! full-row shape, then the relations for the library's ids once the rows
//! had landed). The catalog now ships in the CatalogSummary projection —
//! the grid, the status matching and the visual-novel classification only
//! read those columns — plus the full rows for the library's own game/
//! visual-novel entries, the one place the grid still needs a wide column
//! (shop_links_csv, see usePendingLaunchers). A detail panel that needs a
//! full row for anything else fetches it by id through
//! `get_catalog_entries_full_by_ids`.
//!
//! Each part is produced by the same `load_*` helper its standalone command
//! uses, so the rows are identical — only the transport differs.
use serde::Serialize;
use crate::db::ToStringErr;

#[derive(Debug, Serialize)]
pub struct LocalLibraryBundle {
    pub entries: Vec<crate::user_library::LibraryEntry>,
    /// Every visible catalog row, summary projection (SELECT_SUMMARY order).
    pub catalog: Vec<crate::media_catalog::CatalogSummary>,
    /// Full rows for the library entries typed game/vnovel.
    pub game_rows: Vec<crate::media_catalog::MediaCatalogEntry>,
    /// get_media_relations_for_ids over the library's own ids, no exclusions.
    pub relations: Vec<crate::media_relations::DbMediaRelation>,
}

// A series' per-season synthetic library rows ("series:1:season:2") have no
// catalog row and are filtered out of every "whole library" read on the
// frontend (getAllLibraryEntries) — the relations scope here follows the
// same rule so the bundle's rows match the chain it replaces exactly.
pub(crate) fn is_series_season_synthetic_id(external_id: &str) -> bool {
    let Some((_, suffix)) = external_id.rsplit_once(":season:") else { return false };
    !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit())
}

pub(crate) fn load_all_catalog_summaries(
    conn: &rusqlite::Connection,
) -> Result<Vec<crate::media_catalog::CatalogSummary>, String> {
    let mut stmt = conn.prepare(crate::media_catalog::SELECT_SUMMARY).str_err()?;
    let rows = stmt
        .query_map([], crate::media_catalog::row_to_summary)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// Full visible rows for an explicit id list, chunked like
// load_catalog_summaries_by_ids. Ids that aren't in the visible catalog are
// simply absent.
pub(crate) fn load_catalog_entries_full_by_ids(
    conn: &rusqlite::Connection,
    external_ids: &[String],
) -> Result<Vec<crate::media_catalog::MediaCatalogEntry>, String> {
    let mut out = Vec::with_capacity(external_ids.len());
    for chunk in external_ids.chunks(crate::db::SQL_IN_CHUNK) {
        let sql = format!(
            "{} WHERE external_id IN ({})",
            crate::media_catalog::SELECT_VISIBLE,
            crate::db::sql_placeholders(chunk.len())
        );
        let mut stmt = conn.prepare(&sql).str_err()?;
        let params = rusqlite::params_from_iter(chunk.iter());
        out.extend(stmt.query_map(params, crate::media_catalog::row_to_entry).str_err()?.filter_map(|r| r.ok()));
    }
    Ok(out)
}

pub(crate) fn load_local_library_bundle(conn: &rusqlite::Connection) -> Result<LocalLibraryBundle, String> {
    let entries = crate::user_library::load_all_library_entries(conn)?;
    let catalog = load_all_catalog_summaries(conn)?;
    let real_ids: Vec<String> = entries
        .iter()
        .filter(|e| !is_series_season_synthetic_id(&e.external_id))
        .map(|e| e.external_id.clone())
        .collect();
    let game_ids: Vec<String> = entries
        .iter()
        .filter(|e| (e.entry_type == "game" || e.entry_type == "vnovel") && !is_series_season_synthetic_id(&e.external_id))
        .map(|e| e.external_id.clone())
        .collect();
    let game_rows = if game_ids.is_empty() { Vec::new() } else { load_catalog_entries_full_by_ids(conn, &game_ids)? };
    let relations = if real_ids.is_empty() {
        Vec::new()
    } else {
        crate::media_relations::load_media_relations_for_ids(conn, &real_ids, None)?
    };
    Ok(LocalLibraryBundle { entries, catalog, game_rows, relations })
}

#[tauri::command]
pub async fn get_local_library_bundle(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<LocalLibraryBundle, String> {
    let conn = state.conn.lock().str_err()?;
    load_local_library_bundle(&conn)
}

#[tauri::command]
pub async fn get_catalog_entries_full_by_ids(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_ids: Vec<String>,
) -> Result<Vec<crate::media_catalog::MediaCatalogEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    load_catalog_entries_full_by_ids(&conn, &external_ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(conn: &rusqlite::Connection) {
        for (ext, kind, blocked) in [
            ("anime:1", "anime", false), ("game:2", "game", false), ("vnovel:3", "vnovel", false),
            ("anime:4", "anime", true), ("game:5", "game", false),
        ] {
            conn.execute(
                "INSERT INTO media_catalog (id, external_id, type, title_main, blocked_at, synopsis, shop_links_csv)
                 VALUES (?1, ?1, ?2, ?1, ?3, 'long synopsis', 'steam|https://store.steampowered.com/app/1')",
                rusqlite::params![ext, kind, if blocked { Some("2024-01-01") } else { None }],
            ).unwrap();
        }
        for (ext, kind) in [("anime:1", "anime"), ("game:2", "game"), ("vnovel:3", "vnovel"), ("series:9:season:2", "series")] {
            conn.execute(
                "INSERT INTO user_library (external_id, type, user_id, status) VALUES (?1, ?2, 'local', 'planning')",
                rusqlite::params![ext, kind],
            ).unwrap();
        }
        conn.execute(
            "INSERT INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             VALUES ('anime:1', 'game:5', 'SEQUEL', 'SEQUEL')",
            [],
        ).unwrap();
    }

    #[test]
    fn synthetic_season_ids_are_recognised() {
        assert!(is_series_season_synthetic_id("series:1:season:2"));
        assert!(!is_series_season_synthetic_id("series:1"));
        assert!(!is_series_season_synthetic_id("series:1:season:"));
        assert!(!is_series_season_synthetic_id("series:1:season:x"));
    }

    #[test]
    fn bundle_ships_summaries_game_rows_and_library_relations() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        let bundle = load_local_library_bundle(&conn).unwrap();
        assert_eq!(bundle.entries.len(), 4);
        let mut catalog: Vec<&str> = bundle.catalog.iter().map(|r| r.external_id.as_str()).collect();
        catalog.sort();
        assert_eq!(catalog, vec!["anime:1", "game:2", "game:5", "vnovel:3"], "blocked rows stay hidden");
        let mut game_rows: Vec<&str> = bundle.game_rows.iter().map(|r| r.external_id.as_str()).collect();
        game_rows.sort();
        assert_eq!(game_rows, vec!["game:2", "vnovel:3"]);
        assert_eq!(bundle.game_rows[0].shop_links_csv.as_deref(), Some("steam|https://store.steampowered.com/app/1"));
        assert_eq!(bundle.relations.len(), 1);
        assert_eq!(bundle.relations[0].related_media_external_id, "game:5");
    }

    #[test]
    fn full_rows_by_ids_skip_unknown_and_blocked() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        let rows = load_catalog_entries_full_by_ids(&conn, &["anime:1".into(), "anime:4".into(), "missing:1".into()]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].synopsis.as_deref(), Some("long synopsis"));
        assert!(load_catalog_entries_full_by_ids(&conn, &[]).unwrap().is_empty());
    }
}
