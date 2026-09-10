use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;
use crate::db::ToStringErr;

// Caps how many cover downloads run at once — get_cached_cover's own
// file-exists check is instant, but a grid full of uncached covers (first
// visit to a category, or after clearing the cache) used to fire one
// unbounded reqwest download per card the moment they all mounted. A modest
// limit keeps that burst from thrashing the connection pool / CPU (webp
// re-encode) without meaningfully slowing down the common case (a handful
// of misses at a time).
fn cover_download_semaphore() -> &'static tokio::sync::Semaphore {
    static SEM: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    SEM.get_or_init(|| tokio::sync::Semaphore::new(6))
}

// Rebuilt-in-place GitHub Release asset (scripts/build-database.js), not a
// branch-tracked file — a branch commit would bloat git history with a
// near-full binary copy on every merge.
pub(crate) const COMMUNITY_DB_URL: &str = "https://github.com/Shadorossa/Metadea/releases/download/catalog-latest/database.db";

// Game and visual novel share one numeric IGDB id space, filed under
// whichever prefix is_vn resolves to (see detect_vn in igdb.rs) — every
// lookup below that only has the numeric id has to check both prefixes
// since only one will ever actually resolve. Was independently spelled out
// at each call site before being pulled out here as the one shared version.
pub(crate) fn game_vnovel_siblings(num_id: &str) -> (String, String) {
    (format!("vnovel:{num_id}"), format!("game:{num_id}"))
}

// One IN-query instead of N+1 SELECT EXISTS per row.
pub(crate) fn existing_catalog_ids(
    tx: &rusqlite::Transaction,
    ids: &[String],
) -> Result<HashSet<String>, String> {
    if ids.is_empty() {
        return Ok(HashSet::new());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT external_id FROM media_catalog WHERE external_id IN ({})",
        placeholders
    );
    let mut stmt = tx.prepare(&sql).str_err()?;
    let params = rusqlite::params_from_iter(ids.iter());
    let found = stmt
        .query_map(params, |row| row.get::<_, String>(0))
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(found)
}

// The other side's edge (SEQUEL<->PREQUEL, etc.) — get_transitive_relation_ids'
// recursive CTE only walks forward via media_external_id, so a one-sided
// write silently breaks traversal partway through a saga. Callers use
// INSERT OR REPLACE with this (see save_media_relations), not IGNORE: a
// curator flipping an existing pair's direction in the editor must also
// flip the other side's already-existing row, not have it silently frozen
// at whatever it was first written as.
pub(crate) fn reciprocal_relation(relation_type: &str) -> Option<(&'static str, &'static str)> {
    match relation_type {
        "SEQUEL"     => Some(("PREQUEL", "Prequel")),
        "PREQUEL"    => Some(("SEQUEL", "Sequel")),
        "SOURCE"     => Some(("ADAPTATION", "Adaptation")),
        "ADAPTATION" => Some(("SOURCE", "Source Material")),
        "EPISODE"    => Some(("PART_OF", "Part of")),
        "UPDATE"     => Some(("PART_OF", "Part of")),
        // REL_SOURCE/REL_ADAPTATION/REL_ALTERNATIVE are the generic-editor's
        // own prefixed spellings of SOURCE/ADAPTATION/ALTERNATIVE (see
        // sagaTypes.ts's EDITABLE_RELATION_OPTIONS comment — the prefix
        // exists purely so a plain edit here doesn't get swept into the
        // saga-chain walker, which only recognizes the unprefixed literals).
        // REL_ADAPTATION reciprocates to REL_SOURCE, not the literal SOURCE,
        // so the OTHER side doesn't risk that same collision if it's ever
        // added to a saga chain later. Whatever this media is derived FROM
        // as a different work (an adaptation, a summary, a fork) is
        // genuinely its source, i.e. the original work.
        "REL_SOURCE"     => Some(("REL_ADAPTATION", "Adaptation")),
        "REL_ADAPTATION" => Some(("REL_SOURCE", "Source Material")),
        "SUMMARY"        => Some(("REL_SOURCE", "Source Material")),
        "FORK"           => Some(("REL_SOURCE", "Source Material")),
        // SIDE_STORY/PARENT is AniList's own real pair (the main story a
        // side story/movie/OVA is attached to) — distinct from SOURCE, which
        // is about a DIFFERENT work this one adapts/summarizes/forks, not a
        // side story still within the same continuity.
        "SIDE_STORY" => Some(("PARENT", "Parent Story")),
        "PARENT"     => Some(("SIDE_STORY", "Side story")),
        // Symmetric — AniList itself has no separate inverse label for
        // either of these, both sides just read the same way.
        "SPIN_OFF"       => Some(("SPIN_OFF", "Spin-off")),
        "REL_ALTERNATIVE" => Some(("REL_ALTERNATIVE", "Alternative Version")),
        // Update/Season are episodic content released INTO the base work
        // over time (a big free update, a season pass' season), not a
        // separate purchasable product the way a remaster/DLC/expansion is
        // — same "lives inside the base work" relationship Bundled In/
        // Contains already models for comics/anime (EPISODE/PART_OF above),
        // so these reuse that exact pair instead of BASE_EDITION.
        "REL_UPDATE" => Some(("PART_OF", "Part of")),
        "SEASON"     => Some(("PART_OF", "Part of")),
        // Every remaining game-edition flavor (see FULL_EDITION_FORMATS in
        // media-relations.ts) reciprocates the same way regardless of which
        // one it is: from the edition's own side, the other work is always
        // its BASE_EDITION. The reverse (BASE_EDITION itself) has no fixed
        // entry here — it can't say which of these the other side actually
        // is from the relation_type string alone — see
        // format_to_edition_relation below, which save_media_relations
        // calls instead specifically for BASE_EDITION, using the edition's
        // own already-known catalog format.
        "REMASTER"      => Some(("BASE_EDITION", "Base Edition")),
        "REMAKE"        => Some(("BASE_EDITION", "Base Edition")),
        "EXPANDED_GAME" => Some(("BASE_EDITION", "Base Edition")),
        "DLC"           => Some(("BASE_EDITION", "Base Edition")),
        "EXPANSION"     => Some(("BASE_EDITION", "Base Edition")),
        "STANDALONE"    => Some(("BASE_EDITION", "Base Edition")),
        _ => None,
    }
}

// A BASE_EDITION relation's reciprocal isn't fixed the way the others in
// reciprocal_relation() are — the base game's own row needs to say WHICH
// kind of edition the other side is (remaster/remake/DLC/...), and that's
// exactly what the edition's own media_catalog.format column already holds
// (IGDB sets it directly — see GAME_TYPE_FORMAT in igdb-mapper.ts). E.g.
// Silent Hill 2 (2024) has format=REMAKE, so marking the 2001 original as
// its BASE_EDITION writes REMAKE back onto the original's own relation to
// the 2024 entry, instead of leaving that side undecided.
pub(crate) fn format_to_edition_relation(format: &str) -> Option<(&'static str, &'static str)> {
    match format {
        "REMASTER"      => Some(("REMASTER", "Remaster")),
        "REMAKE"        => Some(("REMAKE", "Remake")),
        "EXPANDED_GAME" => Some(("EXPANDED_GAME", "Expanded Edition")),
        "DLC"           => Some(("DLC", "DLC")),
        "EXPANSION"     => Some(("EXPANSION", "Content Expansion")),
        "STANDALONE"    => Some(("STANDALONE", "Standalone Expansion")),
        _ => None,
    }
}

// external_id's own prefix as its type (e.g. "anime:123" -> "anime");
// colon-less ids fall back to "anime".
pub(crate) fn infer_type_from_id(external_id: &str) -> String {
    external_id
        .split_once(':')
        .map(|(prefix, _)| prefix)
        .unwrap_or("anime")
        .to_string()
}

// A stub row's source, inferred from its type prefix — mirrors the source
// string each live mapper writes (anilist/tmdb/igdb/openlibrary/comicvine).
pub(crate) fn infer_source_from_id(external_id: &str) -> Option<&'static str> {
    // Comic-Vine issue sub-entries keep their parent's type prefix (e.g.
    // "manga:issue-123") so catalog classification matches the parent, but
    // the data itself always comes from ComicVine regardless of that prefix.
    if let Some((_, rest)) = external_id.split_once(':') {
        if rest.starts_with("issue-") {
            return Some("comicvine");
        }
    }
    match infer_type_from_id(external_id).as_str() {
        "anime" | "manga" | "lnovel" => Some("anilist"),
        "movie" | "series" => Some("tmdb"),
        "game" | "vnovel" => Some("igdb"),
        "book" => Some("openlibrary"),
        "comic" => Some("comicvine"),
        _ => None,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[derive(Default)]
pub struct MediaCatalogEntry {
    pub id: String,
    pub external_id: String,
    pub banners_csv: Option<String>,
    pub blocked_at: Option<String>,
    pub country_code: Option<String>,
    pub cover_url: Option<String>,
    pub favorites_count: Option<i32>,
    pub format: Option<String>,
    pub genres_csv: Option<String>,
    pub genres_tag_csv: Option<String>,
    pub parent_id: Option<String>,
    pub platforms_csv: Option<String>,
    pub ratings_count: Option<i32>,
    pub release_day: Option<i32>,
    pub release_end_day: Option<i32>,
    pub release_end_month: Option<i32>,
    pub release_end_year: Option<i32>,
    pub release_month: Option<i32>,
    pub release_year: Option<i32>,
    pub score_global: Option<f64>,
    pub shop_links_csv: Option<String>,
    pub source: Option<String>,
    pub source_url: Option<String>,
    pub status: Option<String>,
    pub synopsis: Option<String>,
    pub time_length: Option<i32>,
    pub title_english: Option<String>,
    pub title_main: Option<String>,
    pub title_native: Option<String>,
    pub title_romaji: Option<String>,
    pub total_count: Option<i32>,
    pub total_count_2: Option<i32>,
    pub r#type: String,
    pub created_at: String,
    pub updated_at: String,
}

const SELECT_ALL: &str = "
    SELECT id, external_id, banners_csv, blocked_at, country_code, cover_url,
           favorites_count, format, genres_csv, genres_tag_csv,
           parent_id, platforms_csv,
           ratings_count, release_day, release_end_day, release_end_month, release_end_year,
           release_month, release_year, score_global,
           shop_links_csv, source, source_url, status, synopsis,
           time_length, title_english, title_main, title_native, title_romaji, total_count, total_count_2,
           type, created_at, updated_at
    FROM media_catalog";

// Same as SELECT_ALL but excludes blocked rows (visible_media_catalog view,
// db.rs) — used by every read path except a direct id lookup.
const SELECT_VISIBLE: &str = "
    SELECT id, external_id, banners_csv, blocked_at, country_code, cover_url,
           favorites_count, format, genres_csv, genres_tag_csv,
           parent_id, platforms_csv,
           ratings_count, release_day, release_end_day, release_end_month, release_end_year,
           release_month, release_year, score_global,
           shop_links_csv, source, source_url, status, synopsis,
           time_length, title_english, title_main, title_native, title_romaji, total_count, total_count_2,
           type, created_at, updated_at
    FROM visible_media_catalog";

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaCatalogEntry> {
    Ok(MediaCatalogEntry {
        id:                  row.get::<_, Option<String>>(0)?.unwrap_or_default(),
        external_id:         row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        banners_csv:         row.get(2)?,
        blocked_at:          row.get(3)?,
        country_code:        row.get(4)?,
        cover_url:           row.get(5)?,
        favorites_count:     row.get(6)?,
        format:              row.get(7)?,
        genres_csv:          row.get(8)?,
        genres_tag_csv:      row.get(9)?,
        parent_id:           row.get(10)?,
        platforms_csv:       row.get(11)?,
        ratings_count:       row.get(12)?,
        release_day:         row.get(13)?,
        release_end_day:     row.get(14)?,
        release_end_month:   row.get(15)?,
        release_end_year:    row.get(16)?,
        release_month:       row.get(17)?,
        release_year:        row.get(18)?,
        score_global:        row.get(19)?,
        shop_links_csv:      row.get(20)?,
        source:              row.get(21)?,
        source_url:          row.get(22)?,
        status:              row.get(23)?,
        synopsis:            row.get(24)?,
        time_length:         row.get(25)?,
        title_english:       row.get(26)?,
        title_main:          row.get(27)?,
        title_native:        row.get(28)?,
        title_romaji:        row.get(29)?,
        total_count:         row.get(30)?,
        total_count_2:       row.get(31)?,
        r#type:              row.get::<_, Option<String>>(32)?.unwrap_or_default(),
        created_at:          row.get::<_, Option<String>>(33)?.unwrap_or_default(),
        updated_at:          row.get::<_, Option<String>>(34)?.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn save_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    mut entry: MediaCatalogEntry,
) -> Result<MediaCatalogEntry, String> {
    let conn = state.conn.lock().str_err()?;

    let numeric_suffix = entry.external_id.split_once(':').map(|(_, id)| id);

    let existing: Option<(String, String, String)> = if let Some(num_id) = numeric_suffix {
        let (vnovel_id, game_id) = game_vnovel_siblings(num_id);
        conn.query_row(
            "SELECT id, external_id, created_at FROM media_catalog WHERE external_id = ?1 OR external_id = ?2 OR external_id = ?3",
            [&entry.external_id, &vnovel_id, &game_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .str_err()?
    } else {
        conn.query_row(
            "SELECT id, external_id, created_at FROM media_catalog WHERE external_id = ?1",
            [&entry.external_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .str_err()?
    };

    if let Some((eid, orig_ext_id, eat)) = existing {
        if entry.id.is_empty() { entry.id = eid; }
        entry.external_id = orig_ext_id;
        entry.created_at = eat;
    }

    if entry.id.is_empty() { entry.id = crate::db::generate_id(); }
    if entry.created_at.is_empty() { entry.created_at = Utc::now().to_rfc3339(); }
    entry.updated_at = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO media_catalog (
            id, external_id, banners_csv, blocked_at, country_code, cover_url,
            favorites_count, format, genres_csv, genres_tag_csv,
            parent_id, platforms_csv,
            ratings_count, release_day, release_end_day, release_end_month, release_end_year,
            release_month, release_year, score_global,
            shop_links_csv, source, source_url, status, synopsis,
            time_length, title_english, title_main, title_native, title_romaji, total_count, total_count_2,
            type, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rusqlite::params![
            &entry.id,
            &entry.external_id,
            &entry.banners_csv,
            &entry.blocked_at,
            &entry.country_code,
            &entry.cover_url,
            &entry.favorites_count,
            &entry.format,
            &entry.genres_csv,
            &entry.genres_tag_csv,
            &entry.parent_id,
            &entry.platforms_csv,
            &entry.ratings_count,
            &entry.release_day,
            &entry.release_end_day,
            &entry.release_end_month,
            &entry.release_end_year,
            &entry.release_month,
            &entry.release_year,
            &entry.score_global,
            &entry.shop_links_csv,
            &entry.source,
            &entry.source_url,
            &entry.status,
            &entry.synopsis,
            &entry.time_length,
            &entry.title_english,
            &entry.title_main,
            &entry.title_native,
            &entry.title_romaji,
            &entry.total_count,
            &entry.total_count_2,
            &entry.r#type,
            &entry.created_at,
            &entry.updated_at,
        ],
    ).str_err()?;

    Ok(entry)
}

// Narrow update for genres/tags discovered by a background fetch (Comic
// Vine's aggregated concepts) — touches only these two columns.
#[tauri::command]
pub async fn update_catalog_genres(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    genres_csv: Option<String>,
    genres_tag_csv: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "UPDATE media_catalog
         SET genres_csv = ?2,
             genres_tag_csv = ?3
         WHERE external_id = ?1",
        rusqlite::params![external_id, genres_csv, genres_tag_csv],
    ).str_err()?;
    Ok(())
}

// Narrow update for a book's page count — only discoverable from a
// background OpenLibrary editions fetch (see fetch_book_editions,
// mediaService.ts), never the initial work-level fetch, since OpenLibrary
// has no page count field on a Work at all, only on its editions.
#[tauri::command]
pub async fn update_catalog_total_count(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    total_count: i32,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "UPDATE media_catalog SET total_count = ?2 WHERE external_id = ?1",
        rusqlite::params![external_id, total_count],
    ).str_err()?;
    Ok(())
}

// Lets the frontend strip blocked entries out of a live API fetch's raw
// relations, which have no idea a title was blocked locally.
//
// No cross-type (vnovel:/game:) expansion here on purpose, unlike
// get_catalog_entry's own OR'd lookup below: get_reclassified_external_ids
// already excludes a game/vnovel live-search hit whenever its sibling
// type's row exists in media_catalog at all, blocked or not (a block
// doesn't delete the row, just flags it) — so a blocked entry's sibling
// was always already covered by that check once it's applied alongside
// this one (see filterReclassified, always run right after filterBlocked
// in lib/search/index.ts). Expanding here too would just be the same
// exclusion computed twice.
#[tauri::command]
pub async fn get_blocked_external_ids(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare("SELECT external_id FROM blocked_media_catalog").str_err()?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0)).str_err()?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// Which of these game/vnovel search results have already been reclassified
// to the other type locally — a work IGDB still returns as vnovel:<id>
// (say) whose numeric id already has its own row filed under game:<id> here
// shouldn't need an explicit block to disappear from the vnovel tab: the
// local catalog reclassifying it IS the signal, same cross-type id lookup
// get_catalog_entry already relies on. Only meaningful for game/vnovel —
// every other type has its own disjoint id space, no sibling to check.
#[tauri::command]
pub async fn get_reclassified_external_ids(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut reclassified = Vec::new();
    for id in &external_ids {
        let Some((prefix, num_id)) = id.split_once(':') else { continue };
        let sibling_prefix = match prefix {
            "vnovel" => "game",
            "game" => "vnovel",
            _ => continue,
        };
        let sibling_id = format!("{sibling_prefix}:{num_id}");
        let exists: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM media_catalog WHERE external_id = ?1 LIMIT 1",
                [&sibling_id],
                |row| row.get(0),
            )
            .optional()
            .str_err()?;
        if exists.is_some() {
            reclassified.push(id.clone());
        }
    }
    Ok(reclassified)
}

#[tauri::command]
pub async fn get_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<MediaCatalogEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    if let Some((_, num_id)) = external_id.split_once(':') {
        let (vnovel_id, game_id) = game_vnovel_siblings(num_id);
        conn.query_row(
            &format!("{} WHERE external_id = ?1 OR external_id = ?2 OR external_id = ?3", SELECT_ALL),
            [&external_id, &vnovel_id, &game_id],
            row_to_entry,
        )
        .optional()
        .str_err()
    } else {
        conn.query_row(
            &format!("{} WHERE external_id = ?1", SELECT_ALL),
            [&external_id],
            row_to_entry,
        )
        .optional()
        .str_err()
    }
}

#[tauri::command]
pub async fn delete_catalog_entry(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    // Exact match only — unlike get_catalog_entry's OR'd vnovel:/game: lookup
    // (a deliberate "find whichever type this got filed under" read), a
    // delete has to remove precisely the row asked for. The same OR match
    // here would silently delete a work's *other*, still-correct type row
    // too whenever both happened to exist locally at once (e.g. mid-cleanup
    // after a vnovel->game reclassification).
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM media_catalog WHERE external_id = ?1", [&external_id])
        .map(|_| ())
        .str_err()
}

#[derive(Debug, Serialize)]
pub struct CatalogHealthEntry {
    pub external_id: String,
    pub title_main: String,
    pub r#type: String,
}

#[derive(Debug, Serialize)]
pub struct CatalogHealthReport {
    pub orphans: Vec<CatalogHealthEntry>,
    pub duplicates: Vec<CatalogHealthEntry>,
}

fn row_to_health_entry(row: &rusqlite::Row) -> rusqlite::Result<CatalogHealthEntry> {
    Ok(CatalogHealthEntry {
        external_id: row.get(0)?,
        title_main: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        r#type: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
    })
}

// Settings > Entorno's "Detectar duplicados y huérfanos" — read-only.
// Orphan: nothing else in the DB references this row. Duplicate: two+ rows
// share the same (normalized title, type), e.g. cataloged twice under
// different external_ids. Flagged for manual review only, never auto-merged.
#[tauri::command]
pub async fn find_catalog_health_issues(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<CatalogHealthReport, String> {
    let conn = state.conn.lock().str_err()?;

    let mut orphan_stmt = conn.prepare(
        "SELECT mc.external_id, mc.title_main, mc.type
         FROM media_catalog mc
         WHERE NOT EXISTS (SELECT 1 FROM user_library ul WHERE ul.external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM user_list_items uli WHERE uli.external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM tier_list_items tli WHERE tli.external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM media_relations mr WHERE mr.media_external_id = mc.external_id OR mr.related_media_external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM character_appearances ca WHERE ca.media_external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM saga_relations sr WHERE sr.media_external_id = mc.external_id)
           AND NOT EXISTS (SELECT 1 FROM media_catalog child WHERE child.parent_id = mc.external_id)
         ORDER BY mc.updated_at DESC",
    ).str_err()?;
    let orphans = orphan_stmt
        .query_map([], row_to_health_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    let mut dup_stmt = conn.prepare(
        "SELECT external_id, title_main, type FROM media_catalog
         WHERE title_main IS NOT NULL AND trim(title_main) != ''
           AND (lower(trim(title_main)), type) IN (
             SELECT lower(trim(title_main)), type FROM media_catalog
             WHERE title_main IS NOT NULL AND trim(title_main) != ''
             GROUP BY lower(trim(title_main)), type
             HAVING COUNT(*) > 1
           )
         ORDER BY lower(trim(title_main))",
    ).str_err()?;
    let duplicates = dup_stmt
        .query_map([], row_to_health_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    Ok(CatalogHealthReport { orphans, duplicates })
}

#[tauri::command]
pub async fn get_all_catalog_entries(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<MediaCatalogEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(SELECT_ALL).str_err()?;
    let entries = stmt
        .query_map([], row_to_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn search_catalog(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    query: String,
) -> Result<Vec<MediaCatalogEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = conn.prepare(
        &format!("{} WHERE lower(title_main) LIKE ?1 OR lower(title_romaji) LIKE ?1 OR lower(title_native) LIKE ?1", SELECT_VISIBLE),
    ).str_err()?;
    let entries = stmt
        .query_map([&pattern], row_to_entry)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

// Local disk cache for catalog cover_url images (anime/manga/lnovel/movie/
// series/book/vnovel) — these were the one category of cover this app never
// cached: Videojuegos already downloads+converts IGDB covers to disk (see
// igdb.rs's download_as_webp/game_dir), served via asset:// instead of
// re-fetching the remote CDN on every load. Reuses that same webp-download
// helper and favorite_images.rs's filename sanitizer rather than
// reimplementing either. First call per external_id pays the real network
// cost once; every later call (including future app sessions) is a plain
// file-exists check.
#[tauri::command]
pub async fn get_cached_cover(
    app_handle: tauri::AppHandle,
    external_id: String,
    url: String,
) -> Result<String, String> {
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("metadata")
        .join("covers");
    std::fs::create_dir_all(&dir).str_err()?;
    let path = dir.join(format!("{}.webp", crate::favorite_images::sanitize_for_filename(&external_id)));
    if !path.exists() {
        let _permit = cover_download_semaphore().acquire().await.str_err()?;
        crate::igdb::download_as_webp(crate::igdb::get_http_client(), &url, &path).await;
        if !path.exists() {
            return Err("Failed to download/convert cover".into());
        }
    }
    Ok(path.to_string_lossy().to_string())
}

// Bulk cache-hit check for a whole grid's worth of covers in one IPC call,
// instead of one get_cached_cover call per card racing at mount — mirrors
// Steam/GOG's own read_metadata_index bulk read (igdb.rs). Existence-only:
// a miss here still falls through to the individual get_cached_cover call
// (which actually downloads), this just lets the frontend skip that round
// trip entirely for whatever's already on disk.
#[tauri::command]
pub async fn get_cached_covers_batch(
    app_handle: tauri::AppHandle,
    external_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("metadata")
        .join("covers");
    let mut hits = std::collections::HashMap::new();
    for external_id in external_ids {
        let path = dir.join(format!("{}.webp", crate::favorite_images::sanitize_for_filename(&external_id)));
        if path.exists() {
            hits.insert(external_id, path.to_string_lossy().to_string());
        }
    }
    Ok(hits)
}
