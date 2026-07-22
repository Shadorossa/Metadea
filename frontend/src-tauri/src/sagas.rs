// Saga chain: editor cache (SagaEntry/get_cached_saga/save_cached_saga),
// admin panel list (SagaListEntry/build_saga_list/get_all_sagas/
// get_community_sagas/delete_saga), and small shared lookups.
use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use crate::db::ToStringErr;
use crate::media_catalog::{existing_catalog_ids, infer_source_from_id, COMMUNITY_DB_URL};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SagaEntry {
    #[serde(rename = "externalId")]
    pub external_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub format: Option<String>,
    #[serde(rename = "mediaType")]
    pub media_type: String,
    pub year: Option<i32>,
    pub month: Option<i32>,
    pub day: Option<i32>,
}

#[tauri::command]
pub async fn get_cached_saga(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<Vec<SagaEntry>>, String> {
    let conn = state.conn.lock().str_err()?;

    // 1. Check if the external_id is mapped to a saga
    let saga_id: Option<String> = conn
        .query_row(
            "SELECT saga_id FROM saga_relations WHERE media_external_id = ?1",
            [&external_id],
            |row| row.get(0),
        )
        .optional()
        .str_err()?;

    let saga_id = match saga_id {
        Some(sid) => sid,
        None => return Ok(None),
    };

    // 2. Fetch all entries related to this saga_id
    let mut stmt = conn
        .prepare(
            "SELECT mc.external_id, mc.title_main, mc.cover_url, mc.format, mc.type, mc.release_year, mc.release_month, mc.release_day
             FROM saga_relations sr
             JOIN visible_media_catalog mc ON mc.external_id = sr.media_external_id
             WHERE sr.saga_id = ?1",
        )
        .str_err()?;

    let entries: Vec<SagaEntry> = stmt
        .query_map([&saga_id], |row| {
            let external_id: String = row.get::<_, Option<String>>(0)?.unwrap_or_default();
            let title: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let cover: Option<String> = row.get(2)?;
            let format: Option<String> = row.get(3)?;
            let media_type: String = row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "anime".to_string());
            let year: Option<i32> = row.get(5)?;
            let month: Option<i32> = row.get(6)?;
            let day: Option<i32> = row.get(7)?;

            Ok(SagaEntry {
                external_id,
                title,
                cover,
                format,
                media_type,
                year,
                month,
                day,
            })
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    if entries.is_empty() {
        Ok(None)
    } else {
        // Sort entries by date locally to ensure correct timeline
        let mut sorted = entries;
        sorted.sort_by(|a, b| {
            let ay = a.year.unwrap_or(9999);
            let by = b.year.unwrap_or(9999);
            if ay != by {
                return ay.cmp(&by);
            }
            let am = a.month.unwrap_or(12);
            let bm = b.month.unwrap_or(12);
            if am != bm {
                return am.cmp(&bm);
            }
            let ad = a.day.unwrap_or(31);
            let bd = b.day.unwrap_or(31);
            ad.cmp(&bd)
        });
        Ok(Some(sorted))
    }
}

// order_index per id in `chain_ids` (front-to-back): keeps existing values,
// extends either end by whole steps from the nearest anchor, and gives a
// newly-inserted-between id the fractional midpoint of its neighbors — so a
// drag-reorder never forces renumbering the rest of the saga. Anchors out of
// order relative to the new chain position (a real reorder) do trigger a
// full renumber from 100.
fn assign_saga_order_indices(chain_ids: &[String], existing: &std::collections::HashMap<String, f64>) -> std::collections::HashMap<String, f64> {
    let mut result = std::collections::HashMap::new();

    let renumber = |result: &mut std::collections::HashMap<String, f64>| {
        for (i, id) in chain_ids.iter().enumerate() {
            result.insert(id.clone(), 100.0 + i as f64);
        }
    };

    let anchors: Vec<(usize, f64)> = chain_ids.iter().enumerate()
        .filter_map(|(i, id)| existing.get(id).map(|&v| (i, v)))
        .collect();

    if anchors.is_empty() {
        renumber(&mut result);
        return result;
    }

    let monotonic = anchors.windows(2).all(|w| w[0].1 < w[1].1);
    if !monotonic {
        renumber(&mut result);
        return result;
    }

    for &(i, v) in &anchors {
        result.insert(chain_ids[i].clone(), v);
    }

    let (first_i, first_v) = anchors[0];
    for k in 0..first_i {
        let i = first_i - 1 - k;
        result.insert(chain_ids[i].clone(), first_v - (k as f64 + 1.0));
    }

    let (last_i, last_v) = anchors[anchors.len() - 1];
    for i in (last_i + 1)..chain_ids.len() {
        result.insert(chain_ids[i].clone(), last_v + (i - last_i) as f64);
    }

    for w in anchors.windows(2) {
        let (ia, va) = w[0];
        let (ib, vb) = w[1];
        let gap = ib - ia;
        if gap > 1 {
            let step = (vb - va) / gap as f64;
            for k in 1..gap {
                result.insert(chain_ids[ia + k].clone(), va + step * k as f64);
            }
        }
    }

    result
}

#[tauri::command]
pub async fn save_cached_saga(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    entries: Vec<SagaEntry>,
    saga_name: String,
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }

    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    // Anchor the saga_id on the lexicographically-smallest external_id rather
    // than entries[0] — the caller's array order isn't guaranteed (the TS side
    // sorts chronologically before calling, but nothing enforces that here),
    // and anchoring on array position meant saving the same saga twice with a
    // differently-ordered list would mint a second saga_id, orphaning the
    // previous saga_relations rows.
    let anchor = entries
        .iter()
        .min_by(|a, b| a.external_id.cmp(&b.external_id))
        .expect("entries is non-empty, checked above");
    let saga_id = anchor.external_id.clone();
    let final_saga_name = if saga_name.is_empty() { anchor.title.clone() } else { saga_name };

    // The anchor above can be a *different* id than a previous save's — e.g.
    // adding an earlier-released member later, whose external_id now sorts
    // first. Every saga_id these entries currently sit under other than the
    // new one is now stale for them; without this, the old sagas row (and
    // whatever saga_relations still point at it) never gets cleaned up and
    // lingers forever as an apparent duplicate of the same saga.
    let all_ids: Vec<String> = entries.iter().map(|e| e.external_id.clone()).collect();
    let id_placeholders = all_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let old_saga_ids: Vec<String> = {
        let sql = format!(
            "SELECT DISTINCT saga_id FROM saga_relations WHERE media_external_id IN ({id_placeholders}) AND saga_id != ?"
        );
        let mut stmt = tx.prepare(&sql).str_err()?;
        let params = rusqlite::params_from_iter(all_ids.iter().chain(std::iter::once(&saga_id)));
        let rows = stmt.query_map(params, |r| r.get::<_, String>(0)).str_err()?;
        rows.filter_map(|r| r.ok()).collect()
    };

    // 1. Insert saga
    tx.execute(
        "INSERT OR REPLACE INTO sagas (id, name) VALUES (?1, ?2)",
        rusqlite::params![&saga_id, &final_saga_name],
    )
    .str_err()?;

    // 2. Insert entries into media_catalog (minimal metadata for caching) and relations
    let all_ids: Vec<String> = entries.iter().map(|e| e.external_id.clone()).collect();
    let existing_ids = existing_catalog_ids(&tx, &all_ids)?;

    // Existing order_index across any saga_id (an anchor shift shouldn't
    // reset it), read before the delete below wipes the rows.
    let existing_order: std::collections::HashMap<String, f64> = {
        let sql = format!(
            "SELECT media_external_id, order_index FROM saga_relations
             WHERE media_external_id IN ({id_placeholders}) AND order_index IS NOT NULL"
        );
        let mut stmt = tx.prepare(&sql).str_err()?;
        let params = rusqlite::params_from_iter(all_ids.iter());
        let rows = stmt.query_map(params, |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))).str_err()?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let order_map = assign_saga_order_indices(&all_ids, &existing_order);

    // Remove stale members — previously this only INSERT OR REPLACED, so an
    // entry deliberately removed from the saga by the user would linger in
    // saga_relations indefinitely and keep appearing in getCachedSaga.
    // Delete the full old set first so the final set exactly matches what
    // was passed in.
    tx.execute(
        "DELETE FROM saga_relations WHERE saga_id = ?1",
        rusqlite::params![&saga_id],
    )
    .str_err()?;

    for entry in &entries {
        let now = Utc::now().to_rfc3339();

        if !existing_ids.contains(&entry.external_id) {
            tx.execute(
                "INSERT OR IGNORE INTO media_catalog (
                    id, external_id, type, source, format, title_main, cover_url, release_year, release_month, release_day, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                rusqlite::params![
                    crate::db::generate_id(),
                    &entry.external_id,
                    &entry.media_type,
                    infer_source_from_id(&entry.external_id),
                    &entry.format,
                    &entry.title,
                    &entry.cover,
                    &entry.year,
                    &entry.month,
                    &entry.day,
                    &now,
                    &now,
                ],
            )
            .str_err()?;
        }

        // Insert relation
        tx.execute(
            "INSERT OR REPLACE INTO saga_relations (media_external_id, saga_id, order_index) VALUES (?1, ?2, ?3)",
            rusqlite::params![&entry.external_id, &saga_id, order_map.get(&entry.external_id)],
        )
        .str_err()?;
    }

    // Drop this batch's members from every stale old saga_id found above —
    // if that empties one out entirely, its sagas row is now pointless and
    // gets removed too, instead of surviving as a stale duplicate.
    for old_id in &old_saga_ids {
        let sql = format!(
            "DELETE FROM saga_relations WHERE saga_id = ? AND media_external_id IN ({id_placeholders})"
        );
        let params = rusqlite::params_from_iter(std::iter::once(old_id).chain(all_ids.iter()));
        tx.execute(&sql, params).str_err()?;

        let remaining: i64 = tx
            .query_row("SELECT COUNT(*) FROM saga_relations WHERE saga_id = ?1", [old_id], |r| r.get(0))
            .str_err()?;
        if remaining == 0 {
            tx.execute("DELETE FROM sagas WHERE id = ?1", [old_id]).str_err()?;
        }
    }

    tx.commit().str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn get_transitive_relation_ids(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "WITH RECURSIVE saga_graph(id) AS (
            SELECT ?1
            UNION
            SELECT mr.related_media_external_id
            FROM media_relations mr
            JOIN saga_graph sg ON sg.id = mr.media_external_id
            JOIN visible_media_catalog mc ON mc.external_id = mr.related_media_external_id
            WHERE mr.relation_type IN ('PREQUEL', 'SEQUEL')
        )
        SELECT id FROM saga_graph"
    ).str_err()?;

    let rows = stmt.query_map([&media_external_id], |row| row.get::<_, String>(0)).str_err()?;
    let ids: Vec<String> = rows.filter_map(|r| r.ok()).collect();
    Ok(ids)
}

#[tauri::command]
pub async fn get_saga_name(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_id: String,
) -> Result<Option<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let name: Option<String> = conn
        .query_row(
            "SELECT s.name FROM saga_relations sr JOIN sagas s ON s.id = sr.saga_id WHERE sr.media_external_id = ?1",
            [&media_external_id],
            |row| row.get(0),
        )
        .optional()
        .str_err()?;
    Ok(name)
}

// Bulk variant of get_saga_name — the library grid's saga grouping needs the
// assigned name (if any) for every owned work in one round trip instead of
// one get_saga_name call per item.
#[tauri::command]
pub async fn get_saga_names(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    media_external_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let mut map = std::collections::HashMap::new();
    if media_external_ids.is_empty() {
        return Ok(map);
    }

    let conn = state.conn.lock().str_err()?;
    let placeholders = media_external_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT sr.media_external_id, s.name FROM saga_relations sr JOIN sagas s ON s.id = sr.saga_id
         WHERE sr.media_external_id IN ({}) AND s.name != ''",
        placeholders
    );
    let mut stmt = conn.prepare(&sql).str_err()?;
    let params = rusqlite::params_from_iter(media_external_ids.iter());
    let rows = stmt.query_map(params, |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).str_err()?;

    for row in rows.filter_map(|r| r.ok()) {
        map.insert(row.0, row.1);
    }
    Ok(map)
}

#[derive(Debug, Serialize, Clone)]
pub struct SagaMemberEntry {
    pub external_id: String,
    pub title: String,
    pub cover: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SagaListEntry {
    pub id: String,
    pub name: String,
    pub anchor_title: Option<String>,
    pub anchor_cover: Option<String>,
    // Embedded rather than fetched separately per row — the admin panel's
    // Sagas tab is an expandable text list (member works shown inline on
    // expand, no editor modal), and for github's case this whole list
    // already came from one community.db download, so there's nothing to
    // save by deferring the member query to a second round trip.
    pub members: Vec<SagaMemberEntry>,
}

// Shared by get_all_sagas ("") and get_community_sagas ("ghsagas."): computed
// live from the reciprocal PREQUEL/SEQUEL graph, never trusting
// sagas/saga_relations directly (can be fragmented — see merge_fragmented_sagas
// in db.rs). ALTERNATIVE is excluded — it links alternate versions/adaptations,
// not numbered continuations, and would merge unrelated entries into one saga.
fn build_saga_list(conn: &rusqlite::Connection, table_prefix: &str) -> rusqlite::Result<Vec<SagaListEntry>> {
    let mut parent: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    {
        let sql = format!(
            "SELECT media_external_id, related_media_external_id FROM {table_prefix}media_relations
             WHERE relation_type IN ('PREQUEL', 'SEQUEL')"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for (a, b) in rows.filter_map(|r| r.ok()) {
            crate::db::union_find_merge(&mut parent, &a, &b);
        }
    }
    if parent.is_empty() {
        return Ok(Vec::new());
    }

    let mut components: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for id in parent.keys().cloned().collect::<Vec<_>>() {
        let root = crate::db::union_find_root(&mut parent, &id);
        components.entry(root).or_default().push(id);
    }
    components.retain(|_, members| members.len() >= 2);
    if components.is_empty() {
        return Ok(Vec::new());
    }

    // Two batched queries covering every kept component's members at once,
    // instead of one query per component or per member.
    let all_member_ids: Vec<String> = components.values().flatten().cloned().collect();
    let placeholders = all_member_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");

    // (title, cover, release_year, release_month, release_day) — the date
    // fields drive member ordering below (chronological, not lexicographic
    // by external_id, which happened to look right for some sagas but put
    // others in a scrambled order unrelated to release sequence).
    type MemberInfo = (Option<String>, Option<String>, Option<i64>, Option<i64>, Option<i64>);
    let mut info: std::collections::HashMap<String, MemberInfo> = std::collections::HashMap::new();
    {
        // Excludes locally-blocked entries here (not from `components` itself)
        // so a blocked member just quietly drops out of the list below, the
        // same way visible_media_catalog used to filter get_all_sagas.
        let sql = format!(
            "SELECT mc.external_id, mc.title_main, mc.cover_url, mc.release_year, mc.release_month, mc.release_day
             FROM {table_prefix}media_catalog mc
             WHERE mc.external_id IN ({placeholders})
               AND NOT EXISTS (SELECT 1 FROM blocked_media_catalog b WHERE b.external_id = mc.external_id)"
        );
        let mut stmt = conn.prepare(&sql)?;
        let params = rusqlite::params_from_iter(all_member_ids.iter());
        let rows = stmt.query_map(params, |r| {
            Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })?;
        for (id, title, cover, year, month, day) in rows.filter_map(|r| r.ok()) {
            info.insert(id, (title, cover, year, month, day));
        }
    }

    let mut names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    {
        // sagas is a newer table than media_relations in some older community
        // snapshots — a missing-table prepare error just leaves `names` empty
        // rather than failing the whole list.
        let sql = format!("SELECT id, name FROM {table_prefix}sagas WHERE id IN ({placeholders}) AND name != ''");
        if let Ok(mut stmt) = conn.prepare(&sql) {
            let params = rusqlite::params_from_iter(all_member_ids.iter());
            if let Ok(rows) = stmt.query_map(params, |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
                for (id, name) in rows.filter_map(|r| r.ok()) {
                    names.insert(id, name);
                }
            }
        }
    }

    // Manual order_index wins over the date sort below, but only when EVERY
    // visible member has one — a mix (e.g. a graph-only reconciled member)
    // falls back entirely to the date sort rather than interleaving both.
    let mut order_hints: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    {
        let sql = format!(
            "SELECT media_external_id, order_index FROM {table_prefix}saga_relations
             WHERE media_external_id IN ({placeholders}) AND order_index IS NOT NULL"
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            let params = rusqlite::params_from_iter(all_member_ids.iter());
            if let Ok(rows) = stmt.query_map(params, |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))) {
                for (id, order) in rows.filter_map(|r| r.ok()) {
                    order_hints.insert(id, order);
                }
            }
        }
    }

    let mut result = Vec::new();
    for members in components.values() {
        let mut visible: Vec<&String> = members.iter().filter(|id| info.contains_key(*id)).collect();
        if visible.len() < 2 { continue; }

        // Anchor id keeps the established "lexicographically smallest
        // external_id" convention (matches save_cached_saga/merge_fragmented_sagas),
        // but display order prefers the manually-curated order_index when
        // every member has one, falling back to chronological release date
        // (id as tiebreak for missing/equal dates — undated entries sort last).
        let canonical = visible.iter().min().map(|s| (*s).clone()).unwrap();
        if visible.iter().all(|id| order_hints.contains_key(*id)) {
            visible.sort_by(|a, b| order_hints[*a].partial_cmp(&order_hints[*b]).unwrap().then_with(|| a.cmp(b)));
        } else {
            visible.sort_by(|a, b| {
                let da = &info[*a];
                let db = &info[*b];
                let key_a = (da.2.unwrap_or(i64::MAX), da.3.unwrap_or(13), da.4.unwrap_or(32));
                let key_b = (db.2.unwrap_or(i64::MAX), db.3.unwrap_or(13), db.4.unwrap_or(32));
                key_a.cmp(&key_b).then_with(|| a.cmp(b))
            });
        }

        let name = names.get(&canonical).cloned()
            .or_else(|| visible.iter().find_map(|id| names.get(*id).cloned()))
            .unwrap_or_default();

        let mut entry = SagaListEntry { id: canonical.clone(), name, anchor_title: None, anchor_cover: None, members: Vec::new() };
        for member_id in &visible {
            let (title, cover, ..) = info.get(*member_id).cloned().unwrap_or((None, None, None, None, None));
            if **member_id == canonical {
                entry.anchor_title = title.clone();
                entry.anchor_cover = cover.clone();
            }
            entry.members.push(SagaMemberEntry {
                external_id: (*member_id).clone(),
                title: title.unwrap_or_else(|| (*member_id).clone()),
                cover,
            });
        }
        result.push(entry);
    }

    result.sort_by(|a, b| {
        let key = |e: &SagaListEntry| if !e.name.is_empty() { e.name.clone() } else { e.anchor_title.clone().unwrap_or_else(|| e.id.clone()) };
        key(a).cmp(&key(b))
    });
    Ok(result)
}

// Admin catalog editor's Sagas tab (local catalog).
#[tauri::command]
pub async fn get_all_sagas(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<SagaListEntry>, String> {
    let conn = state.conn.lock().str_err()?;
    build_saga_list(&conn, "").str_err()
}

// GitHub > Sagas — read-only peek at the community database.db, same
// download-and-attach pattern as get_community_characters, so only sagas
// actually published to the shared catalog show up here (not whatever the
// local install happens to have).
#[tauri::command]
pub async fn get_community_sagas(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<SagaListEntry>, String> {
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
    let temp_path = cache_dir.join("community_sagas_tmp.db");
    std::fs::write(&temp_path, &bytes).str_err()?;
    let temp_path_str = temp_path.to_string_lossy().to_string();

    let result = (|| -> Result<Vec<SagaListEntry>, String> {
        let conn = state.conn.lock().str_err()?;
        conn.execute("ATTACH DATABASE ?1 AS ghsagas", rusqlite::params![temp_path_str]).str_err()?;
        let read = build_saga_list(&conn, "ghsagas.").str_err();
        conn.execute("DETACH DATABASE ghsagas", []).str_err()?;
        read
    })();

    let _ = std::fs::remove_file(&temp_path);
    result
}

// Only unlinks the saga itself (cascades to saga_relations) — never touches
// the member media_catalog rows, which is why this isn't just
// delete_catalog_entry on the anchor id.
#[tauri::command]
pub async fn delete_saga(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    saga_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM sagas WHERE id = ?1", [&saga_id]).str_err()?;
    Ok(())
}
