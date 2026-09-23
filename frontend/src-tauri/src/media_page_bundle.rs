//! Aggregated reads for the media page's mount.
//!
//! `get_media_page_bundle` returns, in one IPC round trip and under one
//! connection lock, every local row the page used to fetch through ~10
//! separate commands the moment it mounted (catalog row, relations, authors,
//! characters, staff, companies, sync state, library entry, cached episodes
//! and themes). Each part is produced by the same `load_*` helper its
//! standalone command uses, so the rows are identical — only the transport
//! differs. Characters come back "light" (portrait file paths, not base64):
//! the page only ever displays them from this read, it never writes them
//! back.
//!
//! `get_anime_chain` replaces the frontend's PREQUEL/SEQUEL walk
//! (buildAnimeChain in lib/media/episodes/anime-tmdb-match.ts), which issued
//! one relations read plus one catalog read per hop, with two recursive CTEs
//! (one per direction) that follow exactly the same rule: from each entry,
//! take the first PREQUEL (resp. SEQUEL) row in curated order whose target
//! is a visible, non-SUMMARY anime that hasn't been visited yet, up to 25
//! hops in each direction.
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::Manager;
use crate::db::ToStringErr;

#[derive(Debug, Serialize)]
pub struct MediaPageBundle {
    pub catalog: Option<crate::media_catalog::MediaCatalogEntry>,
    pub relations: Vec<crate::media_relations::DbMediaRelation>,
    pub authors: Vec<crate::media_authors::DbMediaAuthor>,
    pub characters: Vec<crate::characters::MediaCharacter>,
    pub staff: Vec<crate::staff::MediaStaffMember>,
    pub companies: Vec<crate::companies::DbMediaCompany>,
    pub sync_state: Option<crate::sync_state::SyncStateEntry>,
    pub library_entry: Option<crate::user_library::LibraryEntry>,
    pub episodes: Vec<crate::media_episodes::MediaEpisode>,
    pub themes: Vec<crate::media_themes::MediaTheme>,
}

// Every part keyed by the id as requested — same as the standalone
// commands, which the page also called with its own raw id (only the
// catalog lookup itself has the vnovel:/game: sibling fallback).
pub(crate) fn load_media_page_bundle(
    conn: &rusqlite::Connection,
    external_id: &str,
) -> Result<MediaPageBundle, String> {
    Ok(MediaPageBundle {
        catalog: crate::media_catalog::load_catalog_entry(conn, external_id)?,
        relations: crate::media_relations::load_media_relations(conn, external_id, false)?,
        authors: crate::media_authors::load_media_authors(conn, external_id)?,
        characters: crate::characters::load_media_characters(conn, external_id)?,
        staff: crate::staff::load_media_staff(conn, external_id)?,
        companies: crate::companies::load_media_companies(conn, external_id)?,
        sync_state: crate::sync_state::load_sync_state(conn, external_id)?,
        library_entry: crate::user_library::load_library_entry(conn, external_id)?,
        episodes: crate::media_episodes::load_media_episodes(conn, external_id)?,
        themes: crate::media_themes::load_media_themes(conn, external_id)?,
    })
}

#[tauri::command]
pub async fn get_media_page_bundle(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<MediaPageBundle, String> {
    let mut bundle = {
        let conn = state.conn.lock().str_err()?;
        load_media_page_bundle(&conn, &external_id)?
    };
    // Portrait paths (see image_storage::resolve_reference_path), resolved
    // after the lock is released — the frontend wraps them with wrapAssetUrl.
    let data_dir = app_handle.path().app_data_dir().str_err()?;
    for character in &mut bundle.characters {
        character.image_url = crate::image_storage::resolve_image_path_value(&data_dir, character.image_url.take())?;
    }
    Ok(bundle)
}

// ─── Anime PREQUEL/SEQUEL chain ──────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct AnimeChainEntry {
    pub external_id: String,
    pub title_main: Option<String>,
    pub title_english: Option<String>,
    pub title_romaji: Option<String>,
    pub title_native: Option<String>,
    pub total_count: Option<i32>,
    pub format: Option<String>,
    pub release_year: Option<i32>,
    pub status: Option<String>,
}

// Same per-direction cap as the frontend walk it replaces (MAX_CHAIN_LENGTH).
const MAX_HOPS_PER_DIRECTION: i64 = 25;

const CHAIN_ENTRY_COLUMNS: &str =
    "mc.external_id, mc.title_main, mc.title_english, mc.title_romaji, mc.title_native,
     mc.total_count, mc.format, mc.release_year, mc.status";

fn row_to_chain_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<AnimeChainEntry> {
    Ok(AnimeChainEntry {
        external_id: row.get(0)?,
        title_main: row.get(1)?,
        title_english: row.get(2)?,
        title_romaji: row.get(3)?,
        title_native: row.get(4)?,
        total_count: row.get(5)?,
        format: row.get(6)?,
        release_year: row.get(7)?,
        status: row.get(8)?,
    })
}

// One direction of the walk, nearest hop first. `visited_path` is the
// '|'-delimited id list the walk must never re-enter (the start id, plus
// — for the forward pass — everything the backward pass already took).
// The next hop from an entry is its first relation row of `relation_type`
// in curated (rowid) order whose target is a visible, non-SUMMARY catalog
// row, exactly the row get_media_relations would have listed first; the
// walk then stops unless that target is an anime (a manga SOURCE, say) and
// unvisited.
fn walk_direction(
    conn: &rusqlite::Connection,
    start_id: &str,
    relation_type: &str,
    visited_path: &str,
) -> Result<Vec<AnimeChainEntry>, String> {
    let sql = format!(
        "WITH RECURSIVE walk(id, depth, path) AS (
             SELECT ?1, 0, ?3
             UNION ALL
             SELECT mr.related_media_external_id, w.depth + 1,
                    w.path || mr.related_media_external_id || '|'
             FROM walk w
             JOIN media_relations mr ON mr.media_external_id = w.id
             JOIN visible_media_catalog mc ON mc.external_id = mr.related_media_external_id
             WHERE w.depth < ?4
               AND mr.rowid = (
                   SELECT MIN(first.rowid)
                   FROM media_relations first
                   JOIN visible_media_catalog fc ON fc.external_id = first.related_media_external_id
                   WHERE first.media_external_id = w.id
                     AND first.relation_type = ?2
                     AND UPPER(COALESCE(fc.format, '')) <> 'SUMMARY'
               )
               AND mc.type = 'anime'
               AND instr(w.path, '|' || mr.related_media_external_id || '|') = 0
         )
         SELECT {CHAIN_ENTRY_COLUMNS}
         FROM walk w
         JOIN visible_media_catalog mc ON mc.external_id = w.id
         WHERE w.depth > 0
         ORDER BY w.depth"
    );
    let mut stmt = conn.prepare(&sql).str_err()?;
    let rows = stmt
        .query_map(
            rusqlite::params![start_id, relation_type, visited_path, MAX_HOPS_PER_DIRECTION],
            row_to_chain_entry,
        )
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

// Prequels (earliest first), the entry itself, then sequels. Empty unless
// the start id is a visible anime row.
pub(crate) fn load_anime_chain(
    conn: &rusqlite::Connection,
    external_id: &str,
) -> Result<Vec<AnimeChainEntry>, String> {
    let sql = format!("SELECT {CHAIN_ENTRY_COLUMNS} FROM visible_media_catalog mc WHERE mc.external_id = ?1 AND mc.type = 'anime'");
    let Some(own) = conn
        .query_row(&sql, [external_id], row_to_chain_entry)
        .optional()
        .str_err()?
    else {
        return Ok(Vec::new());
    };

    let own_path = format!("|{external_id}|");
    let mut backward = walk_direction(conn, external_id, "PREQUEL", &own_path)?;
    backward.reverse();

    let mut forward_path = own_path;
    for entry in &backward {
        forward_path.push_str(&entry.external_id);
        forward_path.push('|');
    }
    let forward = walk_direction(conn, external_id, "SEQUEL", &forward_path)?;

    let mut chain = backward;
    chain.push(own);
    chain.extend(forward);
    Ok(chain)
}

#[tauri::command]
pub async fn get_anime_chain(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Vec<AnimeChainEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    load_anime_chain(&conn, &external_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn catalog(conn: &rusqlite::Connection, external_id: &str, kind: &str, format: &str) {
        conn.execute(
            "INSERT INTO media_catalog (id, external_id, type, format, title_main, title_english, title_romaji, title_native, total_count, release_year, status)
             VALUES (?1, ?1, ?2, ?3, 'Main ' || ?1, 'English ' || ?1, 'Romaji ' || ?1, 'Native ' || ?1, 12, 2010, 'FINISHED')",
            rusqlite::params![external_id, kind, format],
        ).unwrap();
    }

    fn relation(conn: &rusqlite::Connection, owner: &str, related: &str, kind: &str) {
        conn.execute(
            "INSERT INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             VALUES (?1, ?2, ?3, ?3)",
            rusqlite::params![owner, related, kind],
        ).unwrap();
    }

    // The old frontend walk (buildAnimeChain in anime-tmdb-match.ts), step
    // for step, over the same standalone reads it used: get_media_relations
    // + get_catalog_entry per hop. Kept as the reference the CTE must match.
    fn reference_walk(conn: &rusqlite::Connection, raw_id: &str) -> Vec<String> {
        let Some(own) = crate::media_catalog::load_catalog_entry(conn, raw_id).unwrap() else { return vec![] };
        if own.r#type != "anime" { return vec![]; }
        let mut visited: HashSet<String> = HashSet::from([raw_id.to_string()]);
        let mut walk = |kind: &str| {
            let mut out = Vec::new();
            let mut cursor = raw_id.to_string();
            for _ in 0..MAX_HOPS_PER_DIRECTION {
                let relations = crate::media_relations::load_media_relations(conn, &cursor, false).unwrap();
                let Some(next) = relations.iter().find(|r| r.relation_type == kind) else { break };
                let next_id = next.related_media_external_id.clone();
                if visited.contains(&next_id) { break; }
                let entry = crate::media_catalog::load_catalog_entry(conn, &next_id).unwrap();
                if entry.as_ref().is_some_and(|e| e.r#type != "anime") { break; }
                if entry.is_none() && !next_id.starts_with("anime:") { break; }
                out.push(next_id.clone());
                visited.insert(next_id.clone());
                cursor = next_id;
            }
            out
        };
        let mut backward = walk("PREQUEL");
        backward.reverse();
        let forward = walk("SEQUEL");
        let mut chain = backward;
        chain.push(raw_id.to_string());
        chain.extend(forward);
        chain
    }

    // Five seasons with reciprocal edges, a branch off season 3 (a second
    // SEQUEL row, curated after the real one), a cycle closing season 5
    // back onto season 1, a manga source, a blocked and a SUMMARY sequel.
    fn seed_chain(conn: &rusqlite::Connection) {
        for season in 1..=5 {
            catalog(conn, &format!("anime:{season}"), "anime", "TV");
        }
        for season in 1..5 {
            relation(conn, &format!("anime:{season}"), &format!("anime:{}", season + 1), "SEQUEL");
            relation(conn, &format!("anime:{}", season + 1), &format!("anime:{season}"), "PREQUEL");
        }
        // Branch: anime:3 -> anime:30 (second SEQUEL row), anime:30 -> manga:9.
        catalog(conn, "anime:30", "anime", "OVA");
        catalog(conn, "manga:9", "manga", "MANGA");
        relation(conn, "anime:3", "anime:30", "SEQUEL");
        relation(conn, "anime:30", "anime:3", "PREQUEL");
        relation(conn, "anime:30", "manga:9", "SEQUEL");
        // Cycle: anime:5 -> anime:1.
        relation(conn, "anime:5", "anime:1", "SEQUEL");
        relation(conn, "anime:1", "anime:5", "PREQUEL");
        // Noise the walk must skip or stop at.
        catalog(conn, "manga:1", "manga", "MANGA");
        relation(conn, "anime:1", "manga:1", "SOURCE");
        catalog(conn, "anime:99", "anime", "TV");
        conn.execute("UPDATE media_catalog SET blocked_at = '2024-01-01' WHERE external_id = 'anime:99'", []).unwrap();
        relation(conn, "anime:5", "anime:99", "SEQUEL");
        catalog(conn, "anime:98", "anime", "SUMMARY");
        relation(conn, "anime:4", "anime:98", "SEQUEL");
    }

    #[test]
    fn cte_chain_matches_the_reference_walk_from_every_start() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed_chain(&conn);
        for start in ["anime:1", "anime:2", "anime:3", "anime:4", "anime:5", "anime:30", "anime:99", "manga:1", "anime:404"] {
            let cte: Vec<String> = load_anime_chain(&conn, start).unwrap().into_iter().map(|e| e.external_id).collect();
            assert_eq!(cte, reference_walk(&conn, start), "start {start}");
        }
        // Spot checks of what the reference itself produces on this fixture:
        // the cycle means the backward walk from any season wraps around
        // until it meets the start again, so the start always lands last.
        let ids = |start: &str| -> Vec<String> { reference_walk(&conn, start) };
        assert_eq!(ids("anime:3"), ["anime:4", "anime:5", "anime:1", "anime:2", "anime:3"]);
        assert_eq!(ids("anime:30"), ["anime:4", "anime:5", "anime:1", "anime:2", "anime:3", "anime:30"]);
        assert_eq!(ids("anime:1"), ["anime:2", "anime:3", "anime:4", "anime:5", "anime:1"]);
        assert!(ids("manga:1").is_empty());
        assert!(ids("anime:99").is_empty());
    }

    #[test]
    fn chain_entries_carry_the_catalog_columns_the_matcher_reads() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed_chain(&conn);
        let chain = load_anime_chain(&conn, "anime:2").unwrap();
        let first_season = chain.iter().find(|e| e.external_id == "anime:1").unwrap();
        assert_eq!(*first_season, AnimeChainEntry {
            external_id: "anime:1".into(),
            title_main: Some("Main anime:1".into()),
            title_english: Some("English anime:1".into()),
            title_romaji: Some("Romaji anime:1".into()),
            title_native: Some("Native anime:1".into()),
            total_count: Some(12),
            format: Some("TV".into()),
            release_year: Some(2010),
            status: Some("FINISHED".into()),
        });
    }

    #[test]
    fn chain_walk_is_bounded_per_direction() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        for i in 0..80 {
            catalog(&conn, &format!("anime:{i}"), "anime", "TV");
        }
        for i in 0..79 {
            relation(&conn, &format!("anime:{i}"), &format!("anime:{}", i + 1), "SEQUEL");
            relation(&conn, &format!("anime:{}", i + 1), &format!("anime:{i}"), "PREQUEL");
        }
        let chain = load_anime_chain(&conn, "anime:40").unwrap();
        assert_eq!(chain.len(), 1 + 2 * MAX_HOPS_PER_DIRECTION as usize);
        assert_eq!(chain.first().unwrap().external_id, "anime:15");
        assert_eq!(chain.last().unwrap().external_id, "anime:65");
        let ids: Vec<String> = chain.into_iter().map(|e| e.external_id).collect();
        assert_eq!(ids, reference_walk(&conn, "anime:40"));
    }

    #[test]
    fn bundle_reads_every_part_from_the_same_helpers_as_the_standalone_commands() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed_chain(&conn);
        conn.execute("INSERT INTO user_library (external_id, type, user_id, status, rating, progress) VALUES ('anime:1', 'anime', 'local', 'completed', 8, 12)", []).unwrap();
        conn.execute("INSERT INTO sync_state (external_id, last_synced_at, sync_failed_count) VALUES ('anime:1', '2024-01-01T00:00:00Z', 0)", []).unwrap();
        conn.execute("INSERT INTO media_author (external_id, name) VALUES ('author:1', 'Author')", []).unwrap();
        conn.execute("INSERT INTO media_by_author (media_external_id, author_external_id, role) VALUES ('anime:1', 'author:1', 'Story')", []).unwrap();
        conn.execute("INSERT INTO characters (id, external_id, name, image_url) VALUES ('c1', 'character:1', 'Hero', 'https://x/hero.png')", []).unwrap();
        conn.execute("INSERT INTO character_appearances (character_external_id, media_external_id, relation_type, position) VALUES ('character:1', 'anime:1', 'MAIN', 0)", []).unwrap();
        conn.execute("INSERT INTO media_staff (id, external_id, name) VALUES ('s1', 'staff:1', 'Director')", []).unwrap();
        conn.execute("INSERT INTO media_staff_relation (staff_external_id, media_external_id, role) VALUES ('staff:1', 'anime:1', 'Director')", []).unwrap();
        conn.execute("INSERT INTO companies (external_id, name) VALUES ('company:1', 'Studio')", []).unwrap();
        conn.execute("INSERT INTO media_by_company (company_external_id, media_external_id, role) VALUES ('company:1', 'anime:1', 'publisher')", []).unwrap();
        conn.execute("INSERT INTO media_episode (external_id, season_number, episode_number, name) VALUES ('anime:1', 0, 2, 'Two'), ('anime:1', 0, 1, 'One')", []).unwrap();
        conn.execute("INSERT INTO media_theme (external_id, slug, theme_type, sequence) VALUES ('anime:1', 'ED1', 'ED', 1), ('anime:1', 'OP1', 'OP', 1)", []).unwrap();

        let bundle = load_media_page_bundle(&conn, "anime:1").unwrap();
        let value = serde_json::to_value(&bundle).unwrap();
        let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec![
            "authors", "catalog", "characters", "companies", "episodes", "library_entry",
            "relations", "staff", "sync_state", "themes",
        ]);

        assert_eq!(bundle.catalog.as_ref().map(|c| c.external_id.as_str()), Some("anime:1"));
        assert_eq!(
            serde_json::to_value(&bundle.relations).unwrap(),
            serde_json::to_value(crate::media_relations::load_media_relations(&conn, "anime:1", false).unwrap()).unwrap(),
        );
        assert_eq!(bundle.authors.len(), 1);
        assert_eq!(bundle.characters[0].image_url.as_deref(), Some("https://x/hero.png"));
        assert_eq!(bundle.staff[0].external_id, "staff:1");
        assert_eq!(bundle.companies[0].role, "publisher");
        assert_eq!(bundle.sync_state.as_ref().and_then(|s| s.last_synced_at.as_deref()), Some("2024-01-01T00:00:00Z"));
        assert_eq!(bundle.library_entry.as_ref().and_then(|e| e.status.as_deref()), Some("completed"));
        let episode_names: Vec<Option<String>> = bundle.episodes.iter().map(|e| e.name.clone()).collect();
        assert_eq!(episode_names, vec![Some("One".into()), Some("Two".into())]);
        let theme_slugs: Vec<&str> = bundle.themes.iter().map(|t| t.slug.as_str()).collect();
        assert_eq!(theme_slugs, vec!["OP1", "ED1"]);

        // A blocked row: catalog None, same as get_catalog_entry.
        assert!(load_media_page_bundle(&conn, "anime:99").unwrap().catalog.is_none());
    }
}
