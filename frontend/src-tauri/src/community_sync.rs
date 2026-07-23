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
#[tauri::command]
pub async fn sync_community_catalog(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<i64, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .str_err()?;
    let resp = client
        .get(COMMUNITY_DB_URL)
        .send()
        .await
        .str_err()?;

    if !resp.status().is_success() {
        return Err(format!("Failed to download community catalog: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.str_err()?;

    let cache_dir = app_handle.path().app_cache_dir().str_err()?;
    std::fs::create_dir_all(&cache_dir).str_err()?;
    let temp_path = cache_dir.join("community_catalog_tmp.db");
    std::fs::write(&temp_path, &bytes).str_err()?;
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let imported = (|| -> Result<i64, String> {
        let conn = state.conn.lock().str_err()?;

        conn.execute("ATTACH DATABASE ?1 AS community", rusqlite::params![temp_path_str])
            .str_err()?;
        // Counts every row inserted/updated across the whole merge below —
        // lets the UI tell "the community added something" from "nothing
        // changed" even when every title was already in the local catalog.
        let mut changes: i64 = 0;
        let merge_result = (|| -> Result<(), String> {
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
            let possible_cols = [
                "id", "external_id", "banners_csv", "country_code", "cover_url",
                "favorites_count", "format", "genres_csv", "genres_tag_csv",
                "parent_id", "platforms_csv",
                "ratings_count", "release_day", "release_end_day", "release_end_month", "release_end_year",
                "release_month", "release_year", "score_global",
                "shop_links_csv", "source", "source_url", "status", "synopsis",
                "time_length", "title_english", "title_main", "title_native", "title_romaji", "total_count", "total_count_2",
                "type"
            ];

            let mut select_cols = Vec::new();
            for col in possible_cols {
                if attached_db_has_column(&conn, "community", "media_catalog", col) {
                    select_cols.push(col);
                }
            }

            let has_blocked_col = attached_db_has_column(&conn, "community", "media_catalog", "blocked_at");

            let mut insert_cols_str = select_cols.join(", ");
            let mut select_cols_str = select_cols.join(", ");

            if has_blocked_col {
                insert_cols_str.push_str(", blocked_at");
                select_cols_str.push_str(", blocked_at");
            }

            insert_cols_str.push_str(", created_at, updated_at");
            select_cols_str.push_str(", created_at, updated_at");

            changes += conn.execute(
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
                changes += conn.execute(
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
                if attached_db_has_column(&conn, "community", "media_catalog", col) {
                    changes += conn.execute(
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
            changes += conn.execute(
                "INSERT OR IGNORE INTO characters (id, external_id, name, name_native, aliases_csv, biography, image_url, reaction, created_at, updated_at)
                 SELECT id, external_id, name, name_native, aliases_csv, biography, image_url, reaction, created_at, updated_at FROM community.characters",
                [],
            ).str_err()? as i64;
            changes += conn.execute(
                "INSERT OR IGNORE INTO character_appearances (character_external_id, media_external_id, relation_type, character_name, added_at)
                 SELECT c.character_external_id, c.media_external_id, c.relation_type, c.character_name, c.added_at
                 FROM community.character_appearances c
                 WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                [],
            ).str_err()? as i64;

            // Actors (voice/live-action) — same fill-gaps merge as characters above.
            let has_actor_tables: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM community.sqlite_master WHERE type = 'table' AND name = 'actors'",
                    [],
                    |r| r.get(0),
                )
                .map(|c: i64| c > 0)
                .unwrap_or(false);
            if has_actor_tables {
                changes += conn.execute(
                    "INSERT OR IGNORE INTO actors (id, external_id, name, name_native, image_url, created_at, updated_at)
                     SELECT id, external_id, name, name_native, image_url, created_at, updated_at FROM community.actors",
                    [],
                ).str_err()? as i64;
                changes += conn.execute(
                    "INSERT OR IGNORE INTO character_actors (actor_external_id, character_external_id, role, language, added_at)
                     SELECT actor_external_id, character_external_id, role, language, added_at FROM community.character_actors",
                    [],
                ).str_err()? as i64;
            }

            // Relations, same fill-gaps merge (composite PK means this never
            // overwrites one the user's own API sync produced). Respects the
            // deleted_relations tombstone, same as a live resync would.
            changes += conn.execute(
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
            changes += conn.execute(
                "INSERT OR IGNORE INTO media_author (external_id, name, author_image_url, author_url, created_at, updated_at)
                 SELECT external_id, name, author_image_url, author_url, created_at, updated_at FROM community.media_author",
                [],
            ).str_err()? as i64;
            changes += conn.execute(
                "INSERT OR IGNORE INTO media_by_author (media_external_id, author_external_id, role)
                 SELECT media_external_id, author_external_id, role FROM community.media_by_author c
                 WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                [],
            ).str_err()? as i64;

            // Custom saga display name, same fill-gaps merge — guarded since
            // an older community catalog build might not have these tables yet.
            let has_saga_tables: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM community.sqlite_master WHERE type = 'table' AND name = 'sagas'",
                    [],
                    |r| r.get(0),
                )
                .map(|c: i64| c > 0)
                .unwrap_or(false);

            if has_saga_tables {
                changes += conn.execute(
                    "INSERT OR IGNORE INTO sagas (id, name)
                     SELECT id, name FROM community.sagas",
                    [],
                ).str_err()? as i64;
                changes += conn.execute(
                    "INSERT OR IGNORE INTO saga_relations (media_external_id, saga_id)
                     SELECT c.media_external_id, c.saga_id FROM community.saga_relations c
                     WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                    [],
                ).str_err()? as i64;
            }

            // ── Saga reconciliation (authoritative from catalog) ─────────
            // Fill-gaps alone would let an old local saga bug survive even
            // after the community catalog fixed it — nobody hand-edits these
            // rows (PrEditorModal always rewrites the whole chain), so wipe
            // and rebuild from the community catalog for types it has an
            // opinion on (SAGA_GROUPABLE_TYPES in library-grouping.ts).
            changes += conn.execute(
                "DELETE FROM media_relations
                 WHERE relation_type IN ('PREQUEL', 'SEQUEL', 'ALTERNATIVE')
                   AND EXISTS (SELECT 1 FROM community.media_catalog cm WHERE cm.external_id = media_relations.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel'))
                   AND EXISTS (SELECT 1 FROM community.media_catalog cr WHERE cr.external_id = media_relations.related_media_external_id AND cr.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel'))",
                [],
            ).str_err()? as i64;
            changes += conn.execute(
                "INSERT OR REPLACE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
                 SELECT c.media_external_id, c.related_media_external_id, c.relation_type, c.type_label
                 FROM community.media_relations c
                 JOIN community.media_catalog cm ON cm.external_id = c.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel')
                 JOIN community.media_catalog cr ON cr.external_id = c.related_media_external_id AND cr.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel')
                 WHERE c.relation_type IN ('PREQUEL', 'SEQUEL', 'ALTERNATIVE')
                   AND c.media_external_id != c.related_media_external_id
                   AND NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id IN (c.media_external_id, c.related_media_external_id))",
                [],
            ).str_err()? as i64;

            if has_saga_tables {
                // sagas rows first — saga_relations.saga_id has an enforced FK into it.
                changes += conn.execute(
                    "INSERT OR REPLACE INTO sagas (id, name)
                     SELECT DISTINCT cs.id, cs.name
                     FROM community.sagas cs
                     WHERE EXISTS (
                       SELECT 1 FROM community.saga_relations csr
                       JOIN community.media_catalog cm ON cm.external_id = csr.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel')
                       WHERE csr.saga_id = cs.id
                     )",
                    [],
                ).str_err()? as i64;
                changes += conn.execute(
                    "DELETE FROM saga_relations
                     WHERE EXISTS (SELECT 1 FROM community.media_catalog cm WHERE cm.external_id = saga_relations.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel'))",
                    [],
                ).str_err()? as i64;
                changes += conn.execute(
                    "INSERT OR REPLACE INTO saga_relations (media_external_id, saga_id)
                     SELECT c.media_external_id, c.saga_id FROM community.saga_relations c
                     JOIN community.media_catalog cm ON cm.external_id = c.media_external_id AND cm.type IN ('anime', 'manga', 'lnovel', 'game', 'vnovel')
                     WHERE NOT EXISTS (SELECT 1 FROM blocked_media_catalog mc WHERE mc.external_id = c.media_external_id)",
                    [],
                ).str_err()? as i64;
            }

            // The community database.db's own sagas/saga_relations can be
            // fragmented (see merge_fragmented_sagas' doc comment) — rebuild
            // from the now-reconciled media_relations graph instead of
            // trusting what was just copied in above verbatim.
            let _ = crate::db::merge_fragmented_sagas(&conn);

            // ── Community-side deletions ────────────────────────────────
            // In last sync's snapshot (community_synced_ids) but missing from
            // this download now = removed upstream. Only deleted locally if
            // the user isn't tracking it in their own library.
            let removed_ids: Vec<String> = {
                let mut stmt = conn.prepare(
                    "SELECT s.external_id FROM community_synced_ids s
                     WHERE NOT EXISTS (SELECT 1 FROM community.media_catalog c WHERE c.external_id = s.external_id)
                       AND NOT EXISTS (SELECT 1 FROM user_library l WHERE l.external_id = s.external_id)"
                ).str_err()?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0)).str_err()?;
                rows.collect::<Result<Vec<_>, _>>().str_err()?
            };

            if !removed_ids.is_empty() {
                // One DELETE per table for the whole batch instead of one
                // per table *per id* — same end result, a fraction of the
                // round trips against the connection.
                let placeholders = removed_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                let ids_params = rusqlite::params_from_iter(removed_ids.iter());
                conn.execute(&format!("DELETE FROM media_catalog WHERE external_id IN ({placeholders})"), ids_params).str_err()?;

                let ids_params = rusqlite::params_from_iter(removed_ids.iter().chain(removed_ids.iter()));
                conn.execute(
                    &format!("DELETE FROM media_relations WHERE media_external_id IN ({placeholders}) OR related_media_external_id IN ({placeholders})"),
                    ids_params,
                ).str_err()?;

                for (table, column) in [
                    ("character_appearances", "media_external_id"),
                    ("media_staff_relation", "media_external_id"),
                    ("media_by_author", "media_external_id"),
                    ("saga_relations", "media_external_id"),
                ] {
                    let ids_params = rusqlite::params_from_iter(removed_ids.iter());
                    conn.execute(&format!("DELETE FROM {table} WHERE {column} IN ({placeholders})"), ids_params).str_err()?;
                }
            }
            changes += removed_ids.len() as i64;

            // Refresh the snapshot to the current community set so the next
            // sync's diff is against what's actually live now.
            conn.execute("DELETE FROM community_synced_ids", []).str_err()?;
            conn.execute(
                "INSERT INTO community_synced_ids (external_id) SELECT external_id FROM community.media_catalog",
                [],
            ).str_err()?;

            Ok(())
        })();
        conn.execute("DETACH DATABASE community", []).str_err()?;
        merge_result?;

        Ok(changes)
    })();

    let _ = std::fs::remove_file(&temp_path);

    imported
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
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .str_err()?;
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
