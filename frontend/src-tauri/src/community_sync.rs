// Downloading and merging the repo's shared community catalog — split out of
// media_catalog.rs.
use tauri::Manager;
use crate::db::ToStringErr;
use crate::media_catalog::COMMUNITY_DB_URL;

// The downloaded community.db is a rebuilt-in-place, unversioned file — a
// stale download from just before some column existed would otherwise fail
// a query referencing it with "no such column". Shared by every optional-
// column guard in sync_community_catalog instead of each repeating its own
// `pragma_table_info` query.
// media_catalog columns a community sync copies (blocked_at is handled on
// its own). scripts/build-database.js has to write every one of them into
// the community database, or a merged PR's value is silently dropped — see
// the test below.
const COMMUNITY_CATALOG_COLUMNS: &[&str] = &[
    "id", "external_id", "banners_csv", "country_code", "cover_url",
    "favorites_count", "format", "genres_csv", "genres_tag_csv",
    "parent_id", "platforms_csv",
    "ratings_count", "release_day", "release_end_day", "release_end_month", "release_end_year",
    "release_month", "release_year", "score_global",
    "shop_links_csv", "source", "source_url", "status", "synopsis",
    "time_length", "title_english", "title_main", "title_native", "title_romaji", "total_count", "total_count_2",
    "type", "issue_source_id", "episode_source_id",
];

fn attached_db_has_column(conn: &rusqlite::Connection, db: &str, table: &str, column: &str) -> bool {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM pragma_table_info('{table}', '{db}') WHERE name = '{column}'"),
        [],
        |r| r.get::<_, i64>(0),
    )
    .map(|c| c > 0)
    .unwrap_or(false)
}

// Downloads the repo's shared community catalog (built from merged
// collaborative-catalog PRs) and merges its rows into the local media_catalog.
// Uses INSERT OR IGNORE via ATTACH DATABASE so it only fills in ids the user
// doesn't already have locally — never overwrites a user's own library data,
// local edits, or anything fetched live from an API. Exception: saga data
// (PREQUEL/SEQUEL/ALTERNATIVE, sagas/saga_relations) is always fully rebuilt
// from the catalog instead — see the reconciliation block below for why.
//
// Incremental: the catalog is one prebuilt file, so "only what changed"
// means skipping the download (HTTP validators from the last merge, see
// community_sync_cursor) or, when the server ignores them, the merge (same
// SHA-256 as last time). Returns how many local rows actually changed — 0
// for an unchanged catalog, so the UI stays silent on a routine launch.
#[tauri::command]
pub async fn sync_community_catalog(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<i64, String> {
    let cursor = load_cursor(&*state.conn.lock().str_err()?);
    let mut request = crate::http::http_client().get(COMMUNITY_DB_URL);
    if let Some(cursor) = &cursor {
        if let Some(etag) = &cursor.etag {
            request = request.header(reqwest::header::IF_NONE_MATCH, etag);
        }
        if let Some(last_modified) = &cursor.last_modified {
            request = request.header(reqwest::header::IF_MODIFIED_SINCE, last_modified);
        }
    }
    let resp = request.send().await.str_err()?;

    if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(0);
    }
    if !resp.status().is_success() {
        return Err(format!("Failed to download community catalog: HTTP {}", resp.status()));
    }
    let header = |name: reqwest::header::HeaderName| {
        resp.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
    };
    let etag = header(reqwest::header::ETAG);
    let last_modified = header(reqwest::header::LAST_MODIFIED);
    let bytes = resp.bytes().await.str_err()?;

    let cache_dir = app_handle.path().app_cache_dir().str_err()?;
    let imported = {
        let mut conn = state.conn.lock().str_err()?;
        sync_downloaded_catalog(&mut conn, &cache_dir, &bytes, etag, last_modified)
    };

    if matches!(imported, Ok(changes) if changes > 0) {
        if let Ok(data_dir) = app_handle.path().app_data_dir() {
            if let Ok(conn) = state.conn.lock() {
                if let Err(error) = crate::image_storage::migrate_inline_images(&data_dir, &conn) {
                    log::warn!("Could not move newly synced inline images to file storage: {error}");
                }
            }
        }
    }

    imported
}

// What the last merged download looked like — see community_sync_cursor.
#[derive(Debug, Clone, PartialEq)]
struct SyncCursor {
    etag: Option<String>,
    last_modified: Option<String>,
    content_sha256: String,
}

fn load_cursor(conn: &rusqlite::Connection) -> Option<SyncCursor> {
    conn.query_row(
        "SELECT etag, last_modified, content_sha256 FROM community_sync_cursor WHERE id = 1",
        [],
        |r| Ok(SyncCursor { etag: r.get(0)?, last_modified: r.get(1)?, content_sha256: r.get(2)? }),
    )
    .ok()
}

fn save_cursor(conn: &rusqlite::Connection, cursor: &SyncCursor) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO community_sync_cursor (id, etag, last_modified, content_sha256, synced_at)
         VALUES (1, ?1, ?2, ?3, CURRENT_TIMESTAMP)",
        rusqlite::params![cursor.etag, cursor.last_modified, cursor.content_sha256],
    )?;
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

// Everything after the download: skips a file identical to the last merged
// one, otherwise merges it and records it as the new cursor.
fn sync_downloaded_catalog(
    conn: &mut rusqlite::Connection,
    cache_dir: &std::path::Path,
    bytes: &[u8],
    etag: Option<String>,
    last_modified: Option<String>,
) -> Result<i64, String> {
    let next = SyncCursor { etag, last_modified, content_sha256: sha256_hex(bytes) };
    if load_cursor(conn).is_some_and(|c| c.content_sha256 == next.content_sha256) {
        // Same file, but keep the validators fresh so the next launch can
        // get a 304 instead of the whole download again.
        save_cursor(conn, &next).str_err()?;
        return Ok(0);
    }

    std::fs::create_dir_all(cache_dir).str_err()?;
    let temp_path = cache_dir.join("community_catalog_tmp.db");
    std::fs::write(&temp_path, bytes).str_err()?;
    let merged = merge_community_catalog(conn, &temp_path.to_string_lossy(), &next);
    let _ = std::fs::remove_file(&temp_path);
    merged
}

fn merge_community_catalog(
    conn: &mut rusqlite::Connection,
    community_path: &str,
    cursor: &SyncCursor,
) -> Result<i64, String> {
    conn.execute("ATTACH DATABASE ?1 AS community", rusqlite::params![community_path])
        .str_err()?;
    // Counts every row inserted/updated across the whole merge below —
    // lets the UI tell "the community added something" from "nothing
    // changed" even when every title was already in the local catalog.
    let mut changes: i64 = 0;
    let merge_result = (|| -> Result<(), String> {
        // The merge below deletes and rebuilds the saga graph, story arcs
        // and the synced-id set. Without a transaction, a failure part way
        // through leaves those rows deleted and not restored, and nothing
        // else holds a copy of the user's data. ATTACH/DETACH stay outside
        // it: SQLite does not allow them inside a transaction.
        let tx = conn.transaction().str_err()?;
        // Explicit column list, not `SELECT *`: a DB upgraded via an old
        // migration can have a given column as its *last* physical
        // column, while a fresh DB has it inline — position-based
        // `SELECT *` would shift every later column into the wrong field.
        // blocked_at is community-wide by design (a curator block should
        // reach every install), guarded by attached_db_has_column in case
        // this community.db predates the column.
        // last_sync_error/last_synced_at/sync_failed_count/authors_csv
        // deliberately excluded even if the attached community.db still
        // has them — sync bookkeeping has no business coming from a
        // community submission (see sync_state's own table for that now),
        // and authors_csv no longer exists at all (media_author/
        // media_by_author are the only source of author data now).
        let possible_cols = COMMUNITY_CATALOG_COLUMNS;

        let mut select_cols = Vec::new();
        for &col in possible_cols {
            if attached_db_has_column(&tx, "community", "media_catalog", col) {
                select_cols.push(col);
            }
        }

        let has_blocked_col = attached_db_has_column(&tx, "community", "media_catalog", "blocked_at");

        let mut insert_cols_str = select_cols.join(", ");
        let mut select_cols_str = select_cols.join(", ");

        if has_blocked_col {
            insert_cols_str.push_str(", blocked_at");
            select_cols_str.push_str(", blocked_at");
        }

        insert_cols_str.push_str(", created_at, updated_at");
        select_cols_str.push_str(", created_at, updated_at");

        changes += tx.execute(
            &format!(
                "INSERT OR IGNORE INTO media_catalog ({insert_cols_str})
                 SELECT {select_cols_str}
                 FROM community.media_catalog"
            ),
            [],
        ).str_err()? as i64;

        // Existing rows also adopt a not-yet-reflected community block —
        // but only fills a NULL, so a local unblock is never overwritten.
        if has_blocked_col {
            changes += tx.execute(
                "UPDATE media_catalog
                 SET blocked_at = (SELECT c.blocked_at FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id)
                 WHERE blocked_at IS NULL
                   AND EXISTS (SELECT 1 FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id AND c.blocked_at IS NOT NULL)",
                [],
            ).str_err()? as i64;
        }

        // banners/genres/companies are only ever set through the
        // collaborative catalog, so an already-cached row (most of them,
        // since the live API sync gets there first) would otherwise never
        // pick up a merged PR's update — fill each only where still
        // empty, never clobbering a local edit or fresher live value.
        for col in ["banners_csv", "genres_csv", "genres_tag_csv"] {
            if attached_db_has_column(&tx, "community", "media_catalog", col) {
                changes += tx.execute(
                    &format!(
                        "UPDATE media_catalog
                         SET {col} = (SELECT c.{col} FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id)
                         WHERE ({col} IS NULL OR {col} = '')
                           AND blocked_at IS NULL
                           AND EXISTS (SELECT 1 FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id AND c.{col} IS NOT NULL AND c.{col} != '')"
                    ),
                    [],
                ).str_err()? as i64;
            }
        }

        // Characters a PR carried over from the entry's already-cached
        // appearances (see PrEditorModal's bundle export) — merge both
        // the character rows and their media links the same "fill gaps
        // only" way.
        changes += tx.execute(
            "INSERT OR IGNORE INTO characters (id, external_id, name, name_native, aliases_csv, biography, image_url, reaction, created_at, updated_at)
             SELECT id, external_id, name, name_native, aliases_csv, biography, image_url, reaction, created_at, updated_at FROM community.characters",
            [],
        ).str_err()? as i64;
        changes += tx.execute(
            "INSERT OR IGNORE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, added_at)
             SELECT c.character_external_id, c.media_external_id, c.relation_type, c.character_name, c.added_at
             FROM community.character_appearances c
             WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
            [],
        ).str_err()? as i64;

        if attached_db_has_column(&tx, "community", "character_merges", "source_character_external_id") {
            changes += tx.execute(
                "INSERT OR IGNORE INTO character_merges (source_character_external_id, canonical_character_external_id, added_at)
                 SELECT m.source_character_external_id, m.canonical_character_external_id, m.added_at
                 FROM community.character_merges m",
                [],
            ).str_err()? as i64;
        }

        // Curator-selected provider mappings are shared catalog data,
        // unlike local episode caches. The community value is canonical
        // (including an explicit clear), so apply corrections to rows
        // that already existed locally instead of INSERT OR IGNORE alone.
        for col in ["issue_source_id", "episode_source_id"] {
            if attached_db_has_column(&tx, "community", "media_catalog", col) {
                changes += tx.execute(
                    &format!(
                        "UPDATE media_catalog
                         SET {col} = (SELECT c.{col} FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id)
                         WHERE EXISTS (SELECT 1 FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id)
                           AND {col} IS NOT (SELECT c.{col} FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id)"
                    ),
                    [],
                ).str_err()? as i64;
            }
        }

        // Actors (voice/live-action) — same fill-gaps merge as characters above.
        let has_actor_tables: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM community.sqlite_master WHERE type = 'table' AND name = 'actors'",
                [],
                |r| r.get(0),
            )
            .map(|c: i64| c > 0)
            .unwrap_or(false);
        if has_actor_tables {
            changes += tx.execute(
                "INSERT OR IGNORE INTO actors (id, external_id, name, name_native, image_url, created_at, updated_at)
                 SELECT id, external_id, name, name_native, image_url, created_at, updated_at FROM community.actors",
                [],
            ).str_err()? as i64;
            changes += tx.execute(
                "INSERT OR IGNORE INTO character_actors (actor_external_id, character_external_id, role, language, added_at)
                 SELECT actor_external_id, character_external_id, role, language, added_at FROM community.character_actors",
                [],
            ).str_err()? as i64;
        }

        // Relations, same fill-gaps merge (composite PK means this never
        // overwrites one the user's own API sync produced). Respects the
        // deleted_relations tombstone, same as a live resync would.
        changes += tx.execute(
            "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             SELECT c.media_external_id, c.related_media_external_id, c.relation_type, c.type_label
             FROM community.media_relations c
             WHERE c.media_external_id != c.related_media_external_id
               AND NOT EXISTS (
                 SELECT 1 FROM deleted_relations dr
                 WHERE dr.media_external_id = c.media_external_id AND dr.related_media_external_id = c.related_media_external_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM blocked_media_catalog mc
                 WHERE mc.external_id IN (c.media_external_id, c.related_media_external_id)
               )",
            [],
        ).str_err()? as i64;

        // Authors carried over the same "fill gaps only" way.
        changes += tx.execute(
            "INSERT OR IGNORE INTO media_author (external_id, name, author_image_url, author_url, created_at, updated_at)
             SELECT external_id, name, author_image_url, author_url, created_at, updated_at FROM community.media_author",
            [],
        ).str_err()? as i64;
        changes += tx.execute(
            "INSERT OR IGNORE INTO media_by_author (media_external_id, author_external_id, role)
             SELECT media_external_id, author_external_id, role FROM community.media_by_author c
             WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
            [],
        ).str_err()? as i64;

        // Custom saga display name, same fill-gaps merge — guarded since
        // an older community catalog build might not have these tables yet.
        let has_saga_tables: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM community.sqlite_master WHERE type = 'table' AND name = 'sagas'",
                [],
                |r| r.get(0),
            )
            .map(|c: i64| c > 0)
            .unwrap_or(false);

        // Saga membership is rewritten in several passes below, ending with
        // merge_fragmented_sagas re-anchoring every chain locally — so the
        // per-statement row counts say nothing about whether anything
        // changed. Counted instead as the net difference between this
        // snapshot and the final state.
        tx.execute_batch(
            "DROP TABLE IF EXISTS temp.saga_membership_before;
             CREATE TEMP TABLE saga_membership_before AS
             SELECT sr.media_external_id, sr.saga_id, s.name
             FROM saga_relations sr LEFT JOIN sagas s ON s.id = sr.saga_id;",
        ).str_err()?;

        if has_saga_tables {
            tx.execute(
                "INSERT OR IGNORE INTO sagas (id, name)
                 SELECT id, name FROM community.sagas",
                [],
            ).str_err()?;
            tx.execute(
                "INSERT OR IGNORE INTO saga_relations (media_external_id, saga_id)
                 SELECT c.media_external_id, c.saga_id FROM community.saga_relations c
                 WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                [],
            ).str_err()?;
        }

        // ── Saga reconciliation (authoritative from catalog) ─────────
        // Fill-gaps alone would let an old local saga bug survive even
        // after the community catalog fixed it — nobody hand-edits these
        // rows (PrEditorModal always rewrites the whole chain), so wipe
        // and rebuild from the community catalog for types it has an
        // opinion on (SAGA_GROUPABLE_TYPES in library-grouping.ts).
        // Rows already identical to the catalog's are left alone instead of
        // deleted and reinserted, so `changes` stays 0 for a catalog that
        // has nothing new for this install.
        tx.execute_batch(
            "DROP TABLE IF EXISTS temp.community_saga_edges;
             CREATE TEMP TABLE community_saga_edges AS
             SELECT c.media_external_id, c.related_media_external_id, c.relation_type, c.type_label
             FROM community.media_relations c
             JOIN community.media_catalog cm ON cm.external_id = c.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel')
             JOIN community.media_catalog cr ON cr.external_id = c.related_media_external_id AND cr.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel')
             WHERE c.relation_type IN ('PREQUEL', 'SEQUEL', 'ALTERNATIVE')
               AND c.media_external_id != c.related_media_external_id
               AND NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id IN (c.media_external_id, c.related_media_external_id));",
        ).str_err()?;
        changes += tx.execute(
            "DELETE FROM media_relations
             WHERE relation_type IN ('PREQUEL', 'SEQUEL', 'ALTERNATIVE')
               AND EXISTS (SELECT 1 FROM community.media_catalog cm WHERE cm.external_id = media_relations.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel'))
               AND EXISTS (SELECT 1 FROM community.media_catalog cr WHERE cr.external_id = media_relations.related_media_external_id AND cr.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel'))
               AND NOT EXISTS (
                 SELECT 1 FROM temp.community_saga_edges e
                 WHERE e.media_external_id = media_relations.media_external_id
                   AND e.related_media_external_id = media_relations.related_media_external_id
                   AND e.relation_type = media_relations.relation_type
                   AND e.type_label = media_relations.type_label
               )",
            [],
        ).str_err()? as i64;
        changes += tx.execute(
            "INSERT OR REPLACE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             SELECT e.media_external_id, e.related_media_external_id, e.relation_type, e.type_label
             FROM temp.community_saga_edges e
             WHERE NOT EXISTS (
               SELECT 1 FROM media_relations r
               WHERE r.media_external_id = e.media_external_id
                 AND r.related_media_external_id = e.related_media_external_id
                 AND r.relation_type = e.relation_type
                 AND r.type_label = e.type_label
             )",
            [],
        ).str_err()? as i64;
        tx.execute("DROP TABLE temp.community_saga_edges", []).str_err()?;

        if has_saga_tables {
            // sagas rows first — saga_relations.saga_id has an enforced FK into it.
            tx.execute(
                "INSERT OR REPLACE INTO sagas (id, name)
                 SELECT DISTINCT cs.id, cs.name
                 FROM community.sagas cs
                 WHERE EXISTS (
                   SELECT 1 FROM community.saga_relations csr
                   JOIN community.media_catalog cm ON cm.external_id = csr.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel')
                   WHERE csr.saga_id = cs.id
                 )",
                [],
            ).str_err()?;
            tx.execute(
                "DELETE FROM saga_relations
                 WHERE EXISTS (SELECT 1 FROM community.media_catalog cm WHERE cm.external_id = saga_relations.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel'))",
                [],
            ).str_err()?;
            tx.execute(
                "INSERT OR REPLACE INTO saga_relations (media_external_id, saga_id)
                 SELECT c.media_external_id, c.saga_id FROM community.saga_relations c
                 JOIN community.media_catalog cm ON cm.external_id = c.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel')
                 WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                [],
            ).str_err()?;
        }

        // The community database.db's own sagas/saga_relations can be
        // fragmented (see merge_fragmented_sagas' doc comment) — rebuild
        // from the now-reconciled media_relations graph instead of
        // trusting what was just copied in above verbatim.
        let _ = crate::db::merge_fragmented_sagas(&tx);

        changes += tx.query_row(
            "WITH after AS (
               SELECT sr.media_external_id, sr.saga_id, s.name
               FROM saga_relations sr LEFT JOIN sagas s ON s.id = sr.saga_id
             )
             SELECT (SELECT COUNT(*) FROM (SELECT * FROM temp.saga_membership_before EXCEPT SELECT * FROM after))
                  + (SELECT COUNT(*) FROM (SELECT * FROM after EXCEPT SELECT * FROM temp.saga_membership_before))",
            [],
            |r| r.get::<_, i64>(0),
        ).str_err()?;
        tx.execute("DROP TABLE temp.saga_membership_before", []).str_err()?;

        // Story arcs
        let has_story_arc_tables: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM community.sqlite_master WHERE type = 'table' AND name = 'story_arcs'",
                [],
                |r| r.get(0),
            )
            .map(|c: i64| c > 0)
            .unwrap_or(false);

        if has_story_arc_tables {
            changes += tx.execute(
                "INSERT INTO story_arcs (id, name, image_base64, sort_order, created_at, updated_at)
                 SELECT ca.id, ca.name, ca.image_base64,
                        (COALESCE((SELECT MAX(sort_order) FROM story_arcs), 0) + ROW_NUMBER() OVER (ORDER BY ca.sort_order, ca.name)),
                        ca.created_at, ca.updated_at
                 FROM community.story_arcs ca
                 WHERE NOT EXISTS (SELECT 1 FROM story_arcs sa WHERE sa.id = ca.id)",
                [],
            ).str_err()? as i64;

            // The catalog ships arc images inline, but after a merge
            // migrate_inline_images replaces the local copy with a file
            // reference — so the same image is recognised by the reference
            // it would get, not by comparing the two cells.
            // (id, community name, community image, local name, local image)
            type ArcRow = (String, String, Option<String>, String, Option<String>);
            let arcs: Vec<ArcRow> = {
                let mut stmt = tx.prepare(
                    "SELECT sa.id, ca.name, ca.image_base64, sa.name, sa.image_base64
                     FROM story_arcs sa JOIN community.story_arcs ca ON ca.id = sa.id",
                ).str_err()?;
                let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).str_err()?;
                rows.collect::<Result<Vec<_>, _>>().str_err()?
            };
            for (id, name, image, local_name, local_image) in arcs {
                let new_image = match image {
                    Some(image) if local_image.as_deref() != Some(image.as_str()) => {
                        let reference = crate::image_storage::reference_for_value(
                            crate::image_storage::STORY_ARC_NAMESPACE, &id, &image,
                        )
                        .unwrap_or_else(|_| image.clone());
                        (local_image.as_deref() != Some(reference.as_str())).then_some(image)
                    }
                    _ => None,
                };
                if name == local_name && new_image.is_none() {
                    continue;
                }
                changes += tx.execute(
                    "UPDATE story_arcs
                     SET name = ?2, image_base64 = COALESCE(?3, image_base64), updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?1",
                    rusqlite::params![id, name, new_image],
                ).str_err()? as i64;
            }

            tx.execute_batch(
                "DROP TABLE IF EXISTS temp.community_arc_items;
                 CREATE TEMP TABLE community_arc_items AS
                 SELECT ci.id, ci.arc_id, ci.media_external_id, ci.ep_start, ci.ep_end, ci.position
                 FROM community.story_arc_items ci
                 WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = ci.media_external_id);",
            ).str_err()?;
            changes += tx.execute(
                "DELETE FROM story_arc_items
                 WHERE EXISTS (SELECT 1 FROM community.story_arcs ca WHERE ca.id = story_arc_items.arc_id)
                   AND NOT EXISTS (
                     SELECT 1 FROM temp.community_arc_items ci
                     WHERE ci.id = story_arc_items.id AND ci.arc_id = story_arc_items.arc_id
                       AND ci.media_external_id = story_arc_items.media_external_id
                       AND ci.ep_start IS story_arc_items.ep_start AND ci.ep_end IS story_arc_items.ep_end
                       AND ci.position IS story_arc_items.position
                   )",
                [],
            ).str_err()? as i64;

            changes += tx.execute(
                "INSERT OR REPLACE INTO story_arc_items (id, arc_id, media_external_id, ep_start, ep_end, position)
                 SELECT ci.id, ci.arc_id, ci.media_external_id, ci.ep_start, ci.ep_end, ci.position
                 FROM temp.community_arc_items ci
                 WHERE NOT EXISTS (
                   SELECT 1 FROM story_arc_items sai
                   WHERE sai.id = ci.id AND sai.arc_id = ci.arc_id
                     AND sai.media_external_id = ci.media_external_id
                     AND sai.ep_start IS ci.ep_start AND sai.ep_end IS ci.ep_end
                     AND sai.position IS ci.position
                 )",
                [],
            ).str_err()? as i64;
            tx.execute("DROP TABLE temp.community_arc_items", []).str_err()?;

            tx.execute(
                "DELETE FROM story_arcs
                 WHERE EXISTS (SELECT 1 FROM community.story_arcs ca WHERE ca.id = story_arcs.id)
                   AND NOT EXISTS (SELECT 1 FROM story_arc_items sai WHERE sai.arc_id = story_arcs.id)",
                [],
            ).str_err()?;
        }

        // ── Community-side deletions ────────────────────────────────
        // In last sync's snapshot (community_synced_ids) but missing from
        // this download now = removed upstream. Only deleted locally if
        // the user isn't tracking it in their own library.
        let removed_ids: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT s.external_id FROM community_synced_ids s
                 WHERE NOT EXISTS (SELECT 1 FROM community.media_catalog c WHERE c.external_id = s.external_id)
                   AND NOT EXISTS (SELECT 1 FROM user_library l WHERE l.external_id = s.external_id)"
            ).str_err()?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).str_err()?;
            rows.collect::<Result<Vec<_>, _>>().str_err()?
        };

        // One DELETE per table per chunk instead of one per table *per
        // id* — same end result, a fraction of the round trips against
        // the connection.
        for chunk in removed_ids.chunks(crate::db::SQL_IN_CHUNK) {
            let placeholders = crate::db::sql_placeholders(chunk.len());
            for (table, column) in [
                ("media_catalog", "external_id"),
                ("media_relations", "media_external_id"),
                ("media_relations", "related_media_external_id"),
                ("character_appearances", "media_external_id"),
                ("media_staff_relation", "media_external_id"),
                ("media_by_author", "media_external_id"),
                ("saga_relations", "media_external_id"),
                ("story_arc_items", "media_external_id"),
            ] {
                let ids_params = rusqlite::params_from_iter(chunk.iter());
                tx.execute(&format!("DELETE FROM {table} WHERE {column} IN ({placeholders})"), ids_params).str_err()?;
            }
        }
        changes += removed_ids.len() as i64;

        // Refresh the snapshot to the current community set so the next
        // sync's diff is against what's actually live now.
        tx.execute("DELETE FROM community_synced_ids", []).str_err()?;
        tx.execute(
            "INSERT INTO community_synced_ids (external_id) SELECT external_id FROM community.media_catalog",
            [],
        ).str_err()?;

        save_cursor(&tx, cursor).str_err()?;
        tx.commit().str_err()?;
        Ok(())
    })();
    conn.execute("DETACH DATABASE community", []).str_err()?;
    merge_result?;

    Ok(changes)
}

// Admin catalog editor's GitHub > Personajes tab — a read-only peek at the
// community catalog's own characters table, not the merge sync_community_catalog
// does into the local one. Characters do have their own file now
// (catalog/Characters/<id>.json, plus whatever's still embedded in a media
// bundle's own file), but there's no per-character-file browse/edit view in
// the admin panel yet — the built database.db (same download as
// sync_community_catalog) is the only place to read "every character GitHub
// actually has" from in one request instead of one per file.
#[tauri::command]
pub async fn get_community_characters(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<crate::characters::CharacterEntry>, String> {
    let client = crate::http::http_client();
    let resp = client.get(COMMUNITY_DB_URL).send().await.str_err()?;
    if !resp.status().is_success() {
        return Err(format!("Failed to download community catalog: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.str_err()?;

    let cache_dir = app_handle.path().app_cache_dir().str_err()?;
    std::fs::create_dir_all(&cache_dir).str_err()?;
    let temp_path = cache_dir.join("community_characters_tmp.db");
    std::fs::write(&temp_path, &bytes).str_err()?;
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let result = (|| -> Result<Vec<crate::characters::CharacterEntry>, String> {
        let conn = state.conn.lock().str_err()?;
        conn.execute("ATTACH DATABASE ?1 AS ghcharacters", rusqlite::params![temp_path_str]).str_err()?;

        let read = (|| -> Result<Vec<crate::characters::CharacterEntry>, String> {
            let mut stmt = conn.prepare(
                "SELECT id, external_id, name, name_native, aliases_csv, biography, image_url, NULL, created_at, updated_at
                 FROM ghcharacters.characters"
            ).str_err()?;
            let rows = stmt.query_map([], |row| {
                Ok(crate::characters::CharacterEntry {
                    id: row.get(0)?,
                    external_id: row.get(1)?,
                    name: row.get(2)?,
                    name_native: row.get(3)?,
                    aliases_csv: row.get(4)?,
                    biography: row.get(5)?,
                    image_url: row.get(6)?,
                    reaction: row.get(7)?,
                    // The community-shared database (scripts/build-database.js
                    // output) has no gender/age/blood_type/dob_* columns —
                    // this is purely a name/cover cache for character search,
                    // never rendered as a full character page.
                    gender: None,
                    age: None,
                    blood_type: None,
                    dob_year: None,
                    dob_month: None,
                    dob_day: None,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            }).str_err()?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        })();

        conn.execute("DETACH DATABASE ghcharacters", []).str_err()?;
        read
    })();

    let _ = std::fs::remove_file(&temp_path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::MetadeaDb;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("metadea-community-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // A community database.db with one of everything the merge reconciles
    // (catalog rows, a saga edge, a saga, a story arc), returned as the
    // bytes a download would hand sync_downloaded_catalog.
    fn community_catalog_bytes(dir: &std::path::Path, extra_title: Option<&str>) -> Vec<u8> {
        let path = dir.join(format!("community-{}.db", extra_title.unwrap_or("base")));
        {
            let db = MetadeaDb::open(&path).unwrap();
            let conn = db.conn.lock().unwrap();
            conn.execute_batch(
                "INSERT INTO media_catalog (external_id, type, title_main) VALUES
                   ('anime:1', 'anime', 'First'), ('anime:2', 'anime', 'Second');
                 INSERT INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                   VALUES ('anime:1', 'anime:2', 'SEQUEL', 'Sequel');
                 INSERT INTO sagas (id, name) VALUES ('saga-1', 'Saga');
                 INSERT INTO saga_relations (media_external_id, saga_id) VALUES ('anime:1', 'saga-1'), ('anime:2', 'saga-1');
                 INSERT INTO story_arcs (id, name) VALUES ('arc-1', 'Arc');
                 INSERT INTO story_arc_items (id, arc_id, media_external_id, ep_start, ep_end, position)
                   VALUES ('item-1', 'arc-1', 'anime:1', 1, 12, 0);",
            ).unwrap();
            conn.execute(
                "UPDATE story_arcs SET image_base64 = ?1 WHERE id = 'arc-1'",
                [format!("data:image/png;base64,{}", crate::utils::base64_encode(b"arc-image"))],
            ).unwrap();
            if let Some(title) = extra_title {
                conn.execute(
                    "INSERT INTO media_catalog (external_id, type, title_main) VALUES ('anime:3', 'anime', ?1)",
                    [title],
                ).unwrap();
            }
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
        }
        std::fs::read(&path).unwrap()
    }

    #[test]
    fn a_second_sync_of_an_unchanged_catalog_merges_nothing() {
        let dir = temp_dir("unchanged");
        let bytes = community_catalog_bytes(&dir, None);
        let db = MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();

        let first = sync_downloaded_catalog(&mut conn, &dir, &bytes, Some("\"v1\"".into()), None).unwrap();
        assert!(first > 0, "first launch merges the catalog");
        let cursor = load_cursor(&conn).expect("cursor saved after merge");
        assert_eq!(cursor.etag.as_deref(), Some("\"v1\""));
        assert_eq!(cursor.content_sha256, sha256_hex(&bytes));

        // A local edit the catalog would overwrite if it were merged again.
        conn.execute("UPDATE story_arcs SET name = 'Local' WHERE id = 'arc-1'", []).unwrap();

        let second = sync_downloaded_catalog(&mut conn, &dir, &bytes, Some("\"v1\"".into()), None).unwrap();
        assert_eq!(second, 0, "same download reports no changes");
        let name: String = conn.query_row("SELECT name FROM story_arcs WHERE id = 'arc-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "Local", "same download is not merged again");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn merging_the_same_catalog_twice_counts_no_changes() {
        let dir = temp_dir("idempotent");
        let bytes = community_catalog_bytes(&dir, None);
        let path = dir.join("community-base.db");
        let db = MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();
        let cursor = SyncCursor { etag: None, last_modified: None, content_sha256: sha256_hex(&bytes) };

        assert!(merge_community_catalog(&mut conn, &path.to_string_lossy(), &cursor).unwrap() > 0);
        // What the command does after a merge with changes: the arc's
        // inline image becomes a file reference.
        let data_dir = dir.join("data");
        assert_eq!(crate::image_storage::migrate_inline_images(&data_dir, &conn).unwrap(), 1);
        assert_eq!(merge_community_catalog(&mut conn, &path.to_string_lossy(), &cursor).unwrap(), 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_changed_catalog_is_merged_and_counts_only_the_new_rows() {
        let dir = temp_dir("changed");
        let db = MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();

        let base = community_catalog_bytes(&dir, None);
        sync_downloaded_catalog(&mut conn, &dir, &base, None, None).unwrap();

        let updated = community_catalog_bytes(&dir, Some("Third"));
        let changes = sync_downloaded_catalog(&mut conn, &dir, &updated, None, None).unwrap();
        assert_eq!(changes, 1, "only anime:3 is new");
        assert_eq!(load_cursor(&conn).unwrap().content_sha256, sha256_hex(&updated));

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod catalog_column_tests {
    // build-database.js once left out blocked_at, country_code, title_english,
    // source_url and release_end_*, so those never reached any install.
    #[test]
    fn build_script_writes_every_column_the_sync_reads() {
        let script = include_str!("../../../scripts/build-database.js");
        let start = script.find("const CATALOG_COLUMNS = [").expect("CATALOG_COLUMNS");
        let list = &script[start..start + script[start..].find("];").unwrap()];
        for col in super::COMMUNITY_CATALOG_COLUMNS.iter().chain(["blocked_at"].iter()) {
            assert!(list.contains(&format!("'{col}'")), "build-database.js CATALOG_COLUMNS lacks {col}");
        }
    }
}
