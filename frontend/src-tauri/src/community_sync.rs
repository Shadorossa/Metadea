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
        // Counts every row actually inserted/updated across the whole merge
        // below (new catalog entries, relations, characters, authors, sagas,
        // and the gap-filled banners/genres/etc.) — not just brand new
        // media_catalog rows — so the UI can tell "the community added
        // something for you" from "nothing changed" even when every title
        // involved was already in your local catalog.
        let mut changes: i64 = 0;
        let merge_result = (|| -> Result<(), String> {
            // Column list is explicit (not `SELECT *`) on purpose: DBs upgraded
            // via the `ALTER TABLE ... ADD COLUMN authors_csv` migration in
            // db.rs have authors_csv as their *last* physical column, while a
            // fresh DB (this downloaded community one included) has it inline
            // per METADEA_SCHEMA's CREATE TABLE text — position-based `SELECT *`
            // would silently shift every column after the mismatch into the
            // wrong field.
            // blocked_at is a curator flag ("hide this remaster/edition
            // everywhere") that IS meant to propagate community-wide, so a
            // blocked entry someone proposed reaches every other user's
            // catalog the same way any other collaborative-catalog field
            // does. Guarded by attached_db_has_column in case this
            // community.db predates the column.
            let possible_cols = [
                "id", "external_id", "authors_csv", "banners_csv", "country_code", "cover_url",
                "developer_badge", "favorites_count", "format", "genres_csv", "genres_tag_csv",
                "last_sync_error", "last_synced_at", "parent_id", "platforms_csv", "publishers_csv",
                "ratings_count", "release_day", "release_end_day", "release_end_month", "release_end_year",
                "release_month", "release_year", "score_global",
                "shop_links_csv", "source", "source_url", "status", "sync_failed_count", "synopsis",
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

            // For entries that already existed locally (the INSERT OR IGNORE
            // above only benefits brand-new rows), adopt a community block
            // that isn't reflected here yet — same "fill gaps only" shape as
            // the columns below, so a local unblock decision (blocked_at
            // already NULL after the user re-enabled it) is never
            // overwritten, but a fresh community-wide block still reaches
            // every other user's install once it merges.
            if has_blocked_col {
                changes += conn.execute(
                    "UPDATE media_catalog
                     SET blocked_at = (SELECT c.blocked_at FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id)
                     WHERE blocked_at IS NULL
                       AND EXISTS (SELECT 1 FROM community.media_catalog c WHERE c.external_id = media_catalog.external_id AND c.blocked_at IS NOT NULL)",
                    [],
                ).str_err()? as i64;
            }

            // The INSERT OR IGNORE above only benefits entries the user's
            // local catalog doesn't have at all — for anything already
            // cached (the common case, since the live API sync populates
            // most rows before anyone ever opens the collaborative editor on
            // them), it's silently skipped. That's fine for fields the live
            // API sync keeps fresh (title, dates, score, status...), but
            // banners/genres/companies/authors are *only* ever set through
            // the collaborative catalog — an existing row can otherwise never
            // receive a merged PR's update to those fields. Fill them in only
            // where the local value is still empty, so a manual edit already
            // present locally (or a fresher live-synced value) is never
            // clobbered.
            // Same "fill gaps only" shape for every gap-fillable column —
            // built as one parameterized statement instead of five
            // hand-copied UPDATEs that used to drift if only one got edited.
            for col in ["banners_csv", "genres_csv", "genres_tag_csv", "publishers_csv", "authors_csv"] {
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

            // Relations (bundled-in episodes/updates, saga-derived prequel/
            // sequel, and any other relation a PR carried over) — same
            // fill-gaps merge, keyed by the table's own composite PK so this
            // never overwrites a relation the user's own API sync produced.
            // Excludes any pair the user has deliberately deleted locally:
            // the community catalog can carry an older relation (e.g. from a
            // different, earlier PR touching the same pair) that's since
            // been removed here — the exact same "can't tell a deletion
            // from never-synced" problem a live API resync has, so it gets
            // the same per-pair tombstone guard (see deleted_relations).
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

            // Custom saga display name (editable in PrEditorModal, exported in
            // every PR bundle — see saga_name there) — same fill-gaps merge
            // as everything else above. Guarded by a table-existence check
            // because these tables were only added to build-database.js's
            // output alongside this merge; a community catalog built by an
            // older workflow run won't have them yet.
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
            // Everything above only fills gaps — a pair the local DB
            // already has a row for is never touched, so a past bug that
            // duplicated/garbled a saga chain locally survives forever even
            // after the community catalog itself gets fixed. Nobody hand-
            // edits these row by row (PrEditorModal's saga UI always
            // rewrites the whole chain on save), so there's nothing local
            // worth protecting the way a hand-typed synopsis is — wipe and
            // rebuild entirely from whatever the community catalog says,
            // for entries it actually has an opinion on. Scoped to the same
            // types the frontend's own saga grouping considers chainable
            // (SAGA_GROUPABLE_TYPES in library-grouping.ts) — started as
            // games-only, widened after the same corruption turned up in a
            // vnovel saga (Umineko no Naku Koro ni).
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
            // The downloaded database.db is a full, current snapshot of the
            // community catalog — anything in community_synced_ids (this
            // client's snapshot from the *previous* sync) but missing from
            // community.media_catalog now was removed upstream (e.g. via a
            // merged collaborative-editor PR that deleted a saga entry).
            // Only actually deleted locally when the user doesn't have it in
            // their own library — a community removal must never touch
            // something the user is tracking. On a first-ever sync,
            // community_synced_ids is still empty, so nothing here matches
            // and nothing gets deleted — only the snapshot refresh below runs.
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
// does into the local one. Characters have no per-file GitHub representation
// (unlike media_catalog rows, one database/*.json each) — they only exist
// embedded inside each media bundle's own file — so the built database.db
// (same download as sync_community_catalog) is the only place to read "every
// character GitHub actually has" from in one request instead of one per file.
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
