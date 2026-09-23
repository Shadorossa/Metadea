// "Obtener metadatos" as one command instead of one igdb_get_cover_by_steam_id
// per game. The per-game path costs up to six IGDB requests (external_games
// by Steam id, the game row, the fuzzy search, artworks, screenshots) plus a
// Steam store lookup; here every stage is batched across the whole list:
//
//   - games already on disk (cover AND banner) are reported without a request;
//   - games IGDB found nothing for recently are skipped for NOT_FOUND_TTL
//     (metadata/igdb_not_found.json — "already tried, not found"), so an
//     unmatched ROM doesn't cost a fresh search on every scan;
//   - Steam ids resolve ten per `external_games` request, known ids ten per
//     `games` request, and the fuzzy name search runs as an IGDB multiquery
//     (ten searches per request);
//   - banner candidates (artworks/screenshots) are read ten games per request;
//   - image downloads run four at a time, and index.json is written once.
//
// The per-game *decisions* are the same functions resolve_igdb_game uses
// (Steam id first, then exact normalized name, then similarity, with the
// same Steam-release-year tie break), so a game resolves to the same IGDB
// row it would have one at a time. Progress reaches the modal through the
// METADATA_PROGRESS_EVENT window event; the Cancel button flips a flag the
// batch checks between stages and downloads.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::db::ToStringErr;
use crate::error_codes::{self, with_detail};
use crate::igdb_matching::{igdb_platform_clause, normalize_name, steam_release_year, try_normalized_match, try_similarity_match};
use super::auth::get_twitch_token;
use super::cache::{build_index_entry, download_game_files, index_entry_from_disk, index_entry_is_complete, merge_index_updates, read_index};
use super::client::{igdb_query, IGDB_API_ARTWORKS, IGDB_API_EXTERNAL_GAMES, IGDB_API_GAMES, IGDB_API_MULTIQUERY, IGDB_API_SCREENSHOTS, IGDB_GAME_FIELDS};
use super::images::{extract_image_candidates, pick_landscape_image};
use super::mapping::{extract_cover_and_game, is_non_game};

pub const METADATA_PROGRESS_EVENT: &str = "local-metadata-progress";
pub(crate) const NOT_FOUND_TTL_SECS: u64 = 7 * 24 * 60 * 60;
// IGDB accepts up to ten queries per multiquery request; the same size keeps
// the `where id = (...)` batches small enough for `limit`.
pub(crate) const BATCH_CHUNK: usize = 10;
const DOWNLOAD_CONCURRENCY: usize = 4;
// Per-game caps that keep the banner choice identical to the one-game path
// (fetch_landscape_image_id: 10 artworks, 5 screenshots, artworks first).
const ARTWORKS_PER_GAME: usize = 10;
const SCREENSHOTS_PER_GAME: usize = 5;

// How long the batch waits for the database lock before failing with
// E_METADATA_DB_BUSY instead of sitting on its first game.
const DB_WAIT: Duration = Duration::from_secs(20);
// Cover + banner for one game: two requests under the shared client's 15 s
// timeout plus the webp re-encode; this caps the whole thing per game.
const GAME_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);

static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);
// Id of the newest run; an older run that sees a different id stops.
static ACTIVE_RUN: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Deserialize)]
pub struct BatchGameRequest {
    pub app_id: String,
    pub game_name: String,
    pub launcher: String,
    #[serde(default)]
    pub rom_platform: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchGameResult {
    pub app_id: String,
    /// "cached" | "done" | "not_found" | "skipped" (fresh not-found memo) |
    /// "error" | "cancelled"
    pub status: String,
    pub cover_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MetadataBatchProgress {
    pub total: usize,
    pub current: usize,
    pub current_name: String,
}

// ── Not-found memo ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct NotFoundEntry {
    pub name: String,
    pub tried_at: u64,
}

// Still worth skipping: same name as when it was tried (a rename is a new
// question) and inside the TTL.
pub(crate) fn not_found_is_fresh(entry: &NotFoundEntry, game_name: &str, now: u64) -> bool {
    entry.name == game_name && now.saturating_sub(entry.tried_at) < NOT_FOUND_TTL_SECS
}

fn not_found_path(meta_root: &std::path::Path) -> std::path::PathBuf {
    meta_root.join("igdb_not_found.json")
}

fn read_not_found(meta_root: &std::path::Path) -> HashMap<String, NotFoundEntry> {
    std::fs::read_to_string(not_found_path(meta_root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_not_found(meta_root: &std::path::Path, memo: &HashMap<String, NotFoundEntry>) {
    let _ = std::fs::create_dir_all(meta_root);
    let _ = std::fs::write(not_found_path(meta_root), serde_json::to_string_pretty(memo).unwrap_or_default());
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ── Pure helpers (tested) ─────────────────────────────────────────────────────

pub(crate) fn chunks_of<T: Clone>(items: &[T], size: usize) -> Vec<Vec<T>> {
    items.chunks(size.max(1)).map(|c| c.to_vec()).collect()
}

// The APIcalypse id set for `where id = (…)`.
pub(crate) fn id_set(ids: &[u64]) -> String {
    ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",")
}

// resolve_igdb_game's own search-string cleaning: "NieR:Automata™" →
// "NieR Automata", "STEINS;GATE" → "STEINS GATE".
pub(crate) fn search_query_for(game_name: &str) -> String {
    game_name
        .chars()
        .map(|c| match c {
            '\u{2122}' | '\u{00AE}' | '\u{00A9}' => ' ',
            ':' | ';' | '_' | '\'' | '\u{2019}' | '"' => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

// One multiquery body: `query games "g<i>" { <the same fuzzy query
// resolve_igdb_game issues> };` per (name, platform clause) pair.
pub(crate) fn build_search_multiquery(searches: &[(String, String)]) -> String {
    searches
        .iter()
        .enumerate()
        .map(|(i, (query, platform_clause))| {
            format!(
                "query games \"g{i}\" {{ fields {IGDB_GAME_FIELDS}; search \"{query}\"; where cover != null{platform_clause}; limit 10; }};"
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// Splits a multiquery response (`[{name, result}]`) back into per-query
// result arrays, by the "g<i>" name — missing names come back empty.
pub(crate) fn split_multiquery_results(response: &serde_json::Value, count: usize) -> Vec<Vec<serde_json::Value>> {
    let mut out = vec![Vec::new(); count];
    if let Some(arr) = response.as_array() {
        for item in arr {
            let Some(name) = item["name"].as_str() else { continue };
            let Some(index) = name.strip_prefix('g').and_then(|n| n.parse::<usize>().ok()) else { continue };
            if index < count {
                out[index] = item["result"].as_array().cloned().unwrap_or_default();
            }
        }
    }
    out
}

// Groups a batched artworks/screenshots response by its `game` field,
// keeping at most `per_game` candidates per game in response order.
pub(crate) fn group_image_candidates(response: &serde_json::Value, per_game: usize) -> HashMap<u64, Vec<(String, f64, f64)>> {
    let mut grouped: HashMap<u64, Vec<(String, f64, f64)>> = HashMap::new();
    if let Some(arr) = response.as_array() {
        for entry in arr {
            let Some(game) = entry["game"].as_u64() else { continue };
            let bucket = grouped.entry(game).or_default();
            if bucket.len() >= per_game {
                continue;
            }
            bucket.extend(extract_image_candidates(&serde_json::Value::Array(vec![entry.clone()])));
        }
    }
    grouped
}

// ── Phase decisions (tested) ──────────────────────────────────────────────────

// A run stops when Cancel was pressed or a newer run has started (the modal
// was closed and the fetch started again while this one was still between
// stages). Without the run check, the new run's reset of the cancel flag
// revived the run it replaced and both kept writing the same files.
pub(crate) fn run_should_stop(cancel_requested: bool, active_run: u64, this_run: u64) -> bool {
    cancel_requested || active_run != this_run
}

// Whether the not-found memo skips a game this run. "Retry skipped games"
// in the modal asks again regardless of the memo.
pub(crate) fn memo_skips(entry: Option<&NotFoundEntry>, game_name: &str, now: u64, retry_not_found: bool) -> bool {
    !retry_not_found && entry.is_some_and(|entry| not_found_is_fresh(entry, game_name, now))
}

// Outcome for a game no stage matched. Only a genuine no-match is memoised:
// when an IGDB lookup for it failed (network, HTTP error, rate limit) the
// miss says nothing about the game, and memoising it would hide the game
// from every fetch for NOT_FOUND_TTL.
pub(crate) fn unmatched_status(lookup_failed: bool) -> &'static str {
    if lookup_failed { "error" } else { "not_found" }
}

// Both keys, non-blank, or E_IGDB_KEYS_MISSING (the modal points to
// Settings › Environment for that code).
pub(crate) fn igdb_credentials(client_id: Option<String>, client_secret: Option<String>) -> Result<(String, String), String> {
    let present = |v: Option<String>| v.filter(|s| !s.trim().is_empty());
    match (present(client_id), present(client_secret)) {
        (Some(id), Some(secret)) => Ok((id, secret)),
        _ => Err(error_codes::IGDB_KEYS_MISSING.to_string()),
    }
}

// get_twitch_token's error text → an E_* code: an unreachable Twitch is a
// network problem, anything else (HTTP 400/401/403, unparseable reply) means
// the stored client id/secret were refused.
pub(crate) fn twitch_error(err: &str) -> String {
    let code = if err.starts_with("Twitch request failed") { error_codes::IGDB_NETWORK } else { error_codes::IGDB_AUTH };
    with_detail(code, err)
}

// ── The command ───────────────────────────────────────────────────────────────

struct Progress {
    app: tauri::AppHandle,
    total: usize,
    done: usize,
}

impl Progress {
    fn finished(&mut self, name: &str) {
        self.done += 1;
        let _ = self.app.emit(METADATA_PROGRESS_EVENT, MetadataBatchProgress { total: self.total, current: self.done, current_name: name.to_string() });
    }
    fn working_on(&self, name: &str) {
        let _ = self.app.emit(METADATA_PROGRESS_EVENT, MetadataBatchProgress { total: self.total, current: self.done, current_name: name.to_string() });
    }
}

fn has_cover_and_banner(game_dir: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(game_dir) else { return false };
    let (mut has_cover, mut has_banner) = (false, false);
    for e in entries.flatten() {
        let n = e.file_name().to_string_lossy().to_string();
        if n.ends_with("_cover.webp") {
            has_cover = true;
        }
        if n.ends_with("_banner.webp") {
            has_banner = true;
        }
    }
    has_cover && has_banner
}

fn result(app_id: &str, status: &str, cover_path: Option<String>, error: Option<String>) -> BatchGameResult {
    BatchGameResult { app_id: app_id.to_string(), status: status.to_string(), cover_path, error }
}

// A resolved game: the cover image id plus the raw IGDB row.
struct Resolved {
    index: usize,
    cover_image_id: String,
    igdb_game: serde_json::Value,
}

// Runs `f` against the database on the blocking pool and gives up after
// DB_WAIT. MetadeaDb.conn is a std Mutex: a lock taken inline here would
// park a runtime worker, and a long holder elsewhere (a big rescan, a
// community sync) would leave the modal sitting on its first game with no
// sign of why. Past the wait the batch fails with E_METADATA_DB_BUSY.
async fn with_db<T, F>(app: &tauri::AppHandle, phase: &'static str, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&crate::db::MetadeaDb) -> Result<T, String> + Send + 'static,
{
    let app = app.clone();
    let task = tokio::task::spawn_blocking(move || f(&app.state::<crate::db::MetadeaDb>()));
    match tokio::time::timeout(DB_WAIT, task).await {
        Ok(Ok(result)) => result,
        Ok(Err(join_err)) => Err(join_err.to_string()),
        Err(_) => {
            log::warn!("[metadata] {phase}: database still locked after {}s", DB_WAIT.as_secs());
            Err(with_detail(error_codes::METADATA_DB_BUSY, phase))
        }
    }
}

#[tauri::command]
pub async fn igdb_cancel_metadata_batch() -> Result<(), String> {
    log::info!("[metadata] cancel requested");
    CANCEL_REQUESTED.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn igdb_fetch_metadata_batch(
    app_handle: tauri::AppHandle,
    games: Vec<BatchGameRequest>,
    // "Retry skipped games": ignore the not-found memo for this run.
    retry_not_found: Option<bool>,
) -> Result<Vec<BatchGameResult>, String> {
    let run = ACTIVE_RUN.fetch_add(1, Ordering::SeqCst) + 1;
    CANCEL_REQUESTED.store(false, Ordering::SeqCst);
    let cancelled = move || run_should_stop(CANCEL_REQUESTED.load(Ordering::Relaxed), ACTIVE_RUN.load(Ordering::SeqCst), run);
    let retry_not_found = retry_not_found.unwrap_or(false);
    let meta_root = app_handle.path().app_data_dir().str_err()?.join("metadata");
    let total = games.len();
    log::info!("[metadata] run {run}: start, {total} game(s), retry_not_found={retry_not_found}");
    let mut results: Vec<Option<BatchGameResult>> = vec![None; total];
    let mut progress = Progress { app: app_handle.clone(), total, done: 0 };
    // Index entries written at the end, merged into the index as it is then.
    let mut index_updates: Vec<(String, serde_json::Value)> = Vec::new();

    // 1. Already complete on disk — no request at all. A game whose files
    // are there but whose index entry is missing or stale is re-indexed
    // from disk, or the grid would never show it and it would stay
    // "pending" forever.
    let index_now = read_index(&meta_root);
    for (i, g) in games.iter().enumerate() {
        let game_dir = meta_root.join(&g.app_id);
        if has_cover_and_banner(&game_dir) {
            if !index_entry_is_complete(index_now.get(&g.app_id)) {
                if let Some(entry) = index_entry_from_disk(&game_dir, &g.game_name) {
                    index_updates.push((g.app_id.clone(), entry));
                }
            }
            results[i] = Some(result(&g.app_id, "cached", Some(game_dir.to_string_lossy().to_string()), None));
            progress.finished(&g.game_name);
        }
    }
    let cached = results.iter().flatten().count();
    log::info!("[metadata] run {run}: phase cached: {cached} on disk, {} re-indexed", index_updates.len());

    // 2. Recently tried and not found — skip until the memo expires.
    let now = unix_now();
    let mut not_found = read_not_found(&meta_root);
    for (i, g) in games.iter().enumerate() {
        if results[i].is_some() {
            continue;
        }
        if memo_skips(not_found.get(&g.app_id), &g.game_name, now, retry_not_found) {
            results[i] = Some(result(&g.app_id, "skipped", None, None));
            progress.finished(&g.game_name);
        }
    }

    let pending: Vec<usize> = (0..total).filter(|i| results[*i].is_none()).collect();
    log::info!("[metadata] run {run}: phase memo: {} skipped, {} to look up", total - cached - pending.len(), pending.len());
    if pending.is_empty() {
        merge_index_updates(&meta_root, index_updates);
        return Ok(results.into_iter().flatten().collect());
    }
    if let Some(first) = pending.first() {
        progress.working_on(&games[*first].game_name);
    }

    let cfg = with_db(&app_handle, "env", crate::igdb_env::env_from_db).await;
    // Whatever the outcome, keep the re-indexed entries.
    let credentials = cfg.and_then(|cfg| igdb_credentials(cfg.igdb_client_id, cfg.igdb_client_secret));
    let (client_id, client_secret) = match credentials {
        Ok(keys) => keys,
        Err(err) => {
            log::warn!("[metadata] run {run}: stopped before IGDB: {err}");
            merge_index_updates(&meta_root, index_updates);
            return Err(err);
        }
    };
    let token = match get_twitch_token(&client_id, &client_secret).await {
        Ok(token) => token,
        Err(err) => {
            let err = twitch_error(&err);
            log::warn!("[metadata] run {run}: Twitch token failed: {err}");
            merge_index_updates(&meta_root, index_updates);
            return Err(err);
        }
    };
    log::info!("[metadata] run {run}: phase auth: Twitch token ready");
    let client = crate::http::http_client();

    // 3. A manual pick (IgdbPickerModal) always wins — see save_game_link.
    let links = match with_db(&app_handle, "links", |db| {
        let conn = db.conn.lock().str_err()?;
        Ok(crate::game_links::lookup_game_links(&conn))
    })
    .await
    {
        Ok(links) => links,
        Err(err) => {
            merge_index_updates(&meta_root, index_updates);
            return Err(err);
        }
    };
    let mut known_id: HashMap<usize, u64> = HashMap::new();
    let mut manual: Vec<usize> = Vec::new();
    for &i in &pending {
        let g = &games[i];
        let manual_id = links
            .get(&(g.launcher.clone(), g.app_id.clone()))
            .and_then(|eid| eid.rsplit(':').next())
            .and_then(|id| id.parse::<u64>().ok());
        if let Some(id) = manual_id {
            known_id.insert(i, id);
            manual.push(i);
        }
    }
    log::info!("[metadata] run {run}: phase links: {} manual pick(s)", manual.len());

    // Games an IGDB lookup failed for (not a miss): never memoised.
    let mut lookup_failed: std::collections::HashSet<usize> = std::collections::HashSet::new();

    // 4. Steam ids, ten per external_games request.
    let steam_unknown: Vec<usize> = pending.iter().copied().filter(|i| !known_id.contains_key(i) && games[*i].launcher == "steam").collect();
    for chunk in chunks_of(&steam_unknown, BATCH_CHUNK) {
        if cancelled() {
            break;
        }
        progress.working_on(&games[chunk[0]].game_name);
        let uids = chunk.iter().map(|i| format!("\"{}\"", games[*i].app_id)).collect::<Vec<_>>().join(",");
        let body = format!("fields game,uid; where uid = ({uids}) & category = 1; limit {};", chunk.len());
        let rows = match igdb_query(client, &client_id, &token, IGDB_API_EXTERNAL_GAMES, &body).await {
            Ok(rows) => rows,
            Err(err) => {
                log::warn!("[metadata] run {run}: Steam id lookup failed: {err}");
                lookup_failed.extend(chunk.iter().copied());
                continue;
            }
        };
        let by_uid: HashMap<String, u64> = rows
            .as_array()
            .map(|arr| arr.iter().filter_map(|r| Some((r["uid"].as_str()?.to_string(), r["game"].as_u64()?))).collect())
            .unwrap_or_default();
        for i in chunk {
            if let Some(id) = by_uid.get(&games[i].app_id) {
                known_id.insert(i, *id);
            }
        }
    }
    log::info!("[metadata] run {run}: phase steam ids: {} of {} resolved", steam_unknown.iter().filter(|i| known_id.contains_key(i)).count(), steam_unknown.len());

    // 5. Every known id, ten per games request.
    let mut resolved: Vec<Resolved> = Vec::new();
    let mut rows_by_id: HashMap<u64, serde_json::Value> = HashMap::new();
    let mut ids: Vec<u64> = known_id.values().copied().collect();
    ids.sort_unstable();
    ids.dedup();
    for chunk in chunks_of(&ids, BATCH_CHUNK) {
        if cancelled() {
            break;
        }
        let body = format!("fields {IGDB_GAME_FIELDS}; where id = ({}) & cover != null; limit {};", id_set(&chunk), chunk.len());
        match igdb_query(client, &client_id, &token, IGDB_API_GAMES, &body).await {
            Ok(rows) => {
                for row in rows.as_array().cloned().unwrap_or_default() {
                    if let Some(id) = row["id"].as_u64() {
                        rows_by_id.insert(id, row);
                    }
                }
            }
            Err(err) => {
                log::warn!("[metadata] run {run}: game rows by id failed: {err}");
                lookup_failed.extend(known_id.iter().filter(|(_, id)| chunk.contains(id)).map(|(i, _)| *i));
            }
        }
    }
    let mut needs_fuzzy: Vec<usize> = Vec::new();
    for &i in &pending {
        let Some(id) = known_id.get(&i) else { needs_fuzzy.push(i); continue };
        let is_manual = manual.contains(&i);
        match rows_by_id.get(id) {
            // fetch_igdb_game_by_id: a manual id either resolves or errors,
            // it never falls back to guessing.
            Some(row) if is_manual => {
                let (cover, _, igdb_game) = extract_cover_and_game(row);
                match cover {
                    Some(cover_image_id) => resolved.push(Resolved { index: i, cover_image_id, igdb_game }),
                    None => results[i] = Some(result(&games[i].app_id, "error", None, Some("Game has no cover".into()))),
                }
            }
            None if is_manual => results[i] = Some(result(&games[i].app_id, "error", None, Some("Game not found in IGDB".into()))),
            // try_steam_id_match: a non-game row (or none) means the Steam
            // id stage missed, and the name search runs instead.
            Some(row) if !is_non_game(row) => {
                let (cover, _, igdb_game) = extract_cover_and_game(row);
                match cover {
                    Some(cover_image_id) => resolved.push(Resolved { index: i, cover_image_id, igdb_game }),
                    None => needs_fuzzy.push(i),
                }
            }
            _ => needs_fuzzy.push(i),
        }
    }
    log::info!("[metadata] run {run}: phase by id: {} resolved, {} need a name search", resolved.len(), needs_fuzzy.len());

    // 6. Fuzzy name search, ten games per multiquery request. Steam's own
    // release year (its store API, one request per Steam game that gets
    // this far) breaks ties exactly as resolve_igdb_game does. One request
    // per game can take minutes on a big library, so each one reports the
    // game it is on — this stage used to sit on the first name silently.
    let mut steam_years: HashMap<usize, Option<i32>> = HashMap::new();
    for &i in &needs_fuzzy {
        if cancelled() {
            break;
        }
        if games[i].launcher == "steam" {
            progress.working_on(&games[i].game_name);
            steam_years.insert(i, steam_release_year(client, &games[i].app_id).await);
        }
    }
    log::info!("[metadata] run {run}: phase steam years: {} looked up", steam_years.len());
    let mut unmatched: Vec<usize> = Vec::new();
    for chunk in chunks_of(&needs_fuzzy, BATCH_CHUNK) {
        if cancelled() {
            break;
        }
        progress.working_on(&games[chunk[0]].game_name);
        let searches: Vec<(String, String)> = chunk
            .iter()
            .map(|i| (search_query_for(&games[*i].game_name), igdb_platform_clause(games[*i].rom_platform.as_deref())))
            .collect();
        let body = build_search_multiquery(&searches);
        let per_game = match igdb_query(client, &client_id, &token, IGDB_API_MULTIQUERY, &body).await {
            Ok(response) => split_multiquery_results(&response, chunk.len()),
            Err(err) => {
                log::warn!("[metadata] run {run}: name search failed: {err}");
                for i in chunk {
                    results[i] = Some(result(&games[i].app_id, "error", None, Some(err.clone())));
                    progress.finished(&games[i].game_name);
                }
                continue;
            }
        };
        for (i, candidates) in chunk.into_iter().zip(per_game) {
            let name_norm = normalize_name(&games[i].game_name);
            let year = steam_years.get(&i).copied().flatten();
            let hit = try_normalized_match(&candidates, &name_norm, year)
                .or_else(|| try_similarity_match(&candidates, &name_norm, year));
            match hit {
                Some((cover_image_id, _, igdb_game)) => resolved.push(Resolved { index: i, cover_image_id, igdb_game }),
                None => unmatched.push(i),
            }
        }
    }
    log::info!("[metadata] run {run}: phase name search: {} resolved in total, {} unmatched", resolved.len(), unmatched.len());

    // A ROM's automatic match is recorded (never over a manual pick) so the
    // card keeps its catalog identity on rescans — same as the per-game path.
    let auto_links: Vec<(String, String, String)> = resolved
        .iter()
        .filter(|r| games[r.index].rom_platform.is_some() && !manual.contains(&r.index))
        .filter_map(|r| {
            let g = &games[r.index];
            Some((g.launcher.clone(), g.app_id.clone(), format!("game:{}", r.igdb_game["id"].as_u64()?)))
        })
        .collect();
    if !auto_links.is_empty() {
        let saved = with_db(&app_handle, "auto links", move |db| {
            let conn = db.conn.lock().str_err()?;
            for (launcher, app_id, external_id) in &auto_links {
                let _ = crate::game_links::save_auto_game_link(&conn, launcher, app_id, external_id);
            }
            Ok(())
        })
        .await;
        // Not fatal: the covers still download; the link is written next run.
        if let Err(err) = saved {
            log::warn!("[metadata] run {run}: auto links not saved: {err}");
        }
    }

    // 7. Banners, ten games per artworks/screenshots request.
    let mut banner_by_game: HashMap<u64, Option<String>> = HashMap::new();
    let mut game_ids: Vec<u64> = resolved.iter().filter_map(|r| r.igdb_game["id"].as_u64()).collect();
    game_ids.sort_unstable();
    game_ids.dedup();
    for chunk in chunks_of(&game_ids, BATCH_CHUNK) {
        if cancelled() {
            break;
        }
        let set = id_set(&chunk);
        let arts_body = format!("fields game,image_id,width,height,alpha_channel; where game = ({set}) & alpha_channel = false; limit 500;");
        let ss_body = format!("fields game,image_id,width,height; where game = ({set}); limit 500;");
        let (arts_res, ss_res) = futures::join!(
            igdb_query(client, &client_id, &token, IGDB_API_ARTWORKS, &arts_body),
            igdb_query(client, &client_id, &token, IGDB_API_SCREENSHOTS, &ss_body),
        );
        let arts = arts_res.map(|v| group_image_candidates(&v, ARTWORKS_PER_GAME)).unwrap_or_default();
        let shots = ss_res.map(|v| group_image_candidates(&v, SCREENSHOTS_PER_GAME)).unwrap_or_default();
        for id in chunk {
            let mut candidates: Vec<(String, f64, f64)> = arts.get(&id).cloned().unwrap_or_default();
            candidates.extend(shots.get(&id).cloned().unwrap_or_default());
            banner_by_game.insert(id, if candidates.is_empty() { None } else { pick_landscape_image(&candidates) });
        }
    }
    log::info!("[metadata] run {run}: phase banners: {} game(s) with a banner", banner_by_game.values().filter(|b| b.is_some()).count());

    // 8. Downloads, a few at a time, each bounded by GAME_DOWNLOAD_TIMEOUT;
    // index entries collected in memory.
    let (mut downloaded, mut failed) = (0usize, 0usize);
    let mut downloads = futures::stream::iter(resolved.into_iter().filter(|_| !cancelled()).map(|r| {
        let g = games[r.index].clone();
        let game_dir = meta_root.join(&g.app_id);
        let banner = r.igdb_game["id"].as_u64().and_then(|id| banner_by_game.get(&id).cloned().flatten());
        async move {
            let download = download_game_files(client, &game_dir, &r.igdb_game, &r.cover_image_id, banner.as_deref(), &g.app_id);
            let outcome = match tokio::time::timeout(GAME_DOWNLOAD_TIMEOUT, download).await {
                Ok(outcome) => outcome,
                Err(_) => Err(format!("Download timed out after {}s", GAME_DOWNLOAD_TIMEOUT.as_secs())),
            };
            (r, g, game_dir, outcome)
        }
    }))
    .buffer_unordered(DOWNLOAD_CONCURRENCY);
    while let Some((r, g, game_dir, outcome)) = downloads.next().await {
        match outcome {
            Ok(()) => {
                let cover_path = game_dir.join(format!("{}_cover.webp", r.cover_image_id));
                index_updates.push((g.app_id.clone(), build_index_entry(&game_dir, &g.game_name, &cover_path, &r.igdb_game)));
                not_found.remove(&g.app_id);
                results[r.index] = Some(result(&g.app_id, "done", Some(cover_path.to_string_lossy().to_string()), None));
                downloaded += 1;
            }
            Err(err) => {
                log::warn!("[metadata] run {run}: download failed for {}: {err}", g.app_id);
                results[r.index] = Some(result(&g.app_id, "error", None, Some(err)));
                failed += 1;
            }
        }
        progress.finished(&g.game_name);
    }
    drop(downloads);
    merge_index_updates(&meta_root, index_updates);
    log::info!("[metadata] run {run}: phase downloads: {downloaded} done, {failed} failed");

    // 9. Nothing matched: remember, so the next scan doesn't ask again —
    // unless a lookup for the game failed, which proves nothing.
    for i in unmatched {
        if results[i].is_some() {
            continue;
        }
        let status = unmatched_status(lookup_failed.contains(&i));
        if status == "not_found" {
            not_found.insert(games[i].app_id.clone(), NotFoundEntry { name: games[i].game_name.clone(), tried_at: now });
        } else {
            not_found.remove(&games[i].app_id);
        }
        let detail = if status == "not_found" { format!("No match found for {:?}", games[i].game_name) } else { "IGDB lookup failed".to_string() };
        results[i] = Some(result(&games[i].app_id, status, None, Some(detail)));
        progress.finished(&games[i].game_name);
    }
    write_not_found(&meta_root, &not_found);

    // Whatever a cancel (or a failed stage) left untouched.
    let results: Vec<BatchGameResult> = results
        .into_iter()
        .enumerate()
        .map(|(i, r)| r.unwrap_or_else(|| result(&games[i].app_id, "cancelled", None, None)))
        .collect();
    log::info!(
        "[metadata] run {run}: finished{} ({} cancelled)",
        if cancelled() { " after cancel" } else { "" },
        results.iter().filter(|r| r.status == "cancelled").count()
    );
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_memo_expires_after_the_ttl_and_on_rename() {
        let entry = NotFoundEntry { name: "Some Game".into(), tried_at: 1_000_000 };
        assert!(not_found_is_fresh(&entry, "Some Game", 1_000_000 + NOT_FOUND_TTL_SECS - 1));
        assert!(!not_found_is_fresh(&entry, "Some Game", 1_000_000 + NOT_FOUND_TTL_SECS));
        assert!(!not_found_is_fresh(&entry, "Some Game (Renamed)", 1_000_001));
        // A clock that went backwards never turns a memo stale into an error.
        assert!(not_found_is_fresh(&entry, "Some Game", 999_000));
    }

    #[test]
    fn the_memo_only_skips_fresh_entries_and_never_on_a_retry() {
        let entry = NotFoundEntry { name: "Some Game".into(), tried_at: 1_000_000 };
        assert!(memo_skips(Some(&entry), "Some Game", 1_000_100, false));
        assert!(!memo_skips(Some(&entry), "Some Game", 1_000_100, true), "Retry skipped games asks again");
        assert!(!memo_skips(Some(&entry), "Some Game", 1_000_000 + NOT_FOUND_TTL_SECS, false));
        assert!(!memo_skips(None, "Some Game", 1_000_100, false));
    }

    #[test]
    fn only_a_genuine_no_match_is_memoised() {
        assert_eq!(unmatched_status(false), "not_found");
        // A failed Steam-id or by-id lookup (network, 429, auth) proves nothing.
        assert_eq!(unmatched_status(true), "error");
    }

    #[test]
    fn missing_or_blank_keys_are_one_code() {
        let some = |s: &str| Some(s.to_string());
        assert_eq!(igdb_credentials(some("id"), some("secret")), Ok(("id".into(), "secret".into())));
        for (id, secret) in [(None, some("s")), (some("id"), None), (some("  "), some("s")), (some("id"), some("")), (None, None)] {
            assert_eq!(igdb_credentials(id, secret), Err(crate::error_codes::IGDB_KEYS_MISSING.to_string()));
        }
    }

    #[test]
    fn twitch_failures_map_to_network_or_auth() {
        assert!(twitch_error("Twitch request failed: error sending request").starts_with("E_IGDB_NETWORK: "));
        assert!(twitch_error("Twitch auth failed (HTTP 400 Bad Request): invalid client secret").starts_with("E_IGDB_AUTH: "));
        assert!(twitch_error("Twitch parse failed: EOF").starts_with("E_IGDB_AUTH: "));
    }

    #[test]
    fn a_run_stops_on_cancel_or_when_a_newer_run_starts() {
        assert!(!run_should_stop(false, 3, 3));
        assert!(run_should_stop(true, 3, 3));
        // The previous run, after run 4 reset the cancel flag, still stops.
        assert!(run_should_stop(false, 4, 3));
    }

    #[test]
    fn requests_are_grouped_ten_at_a_time() {
        let ids: Vec<u64> = (1..=23).collect();
        let chunks = chunks_of(&ids, BATCH_CHUNK);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].len(), 10);
        assert_eq!(chunks[2], vec![21, 22, 23]);
        assert_eq!(id_set(&chunks[2]), "21,22,23");
        assert!(chunks_of::<u64>(&[], BATCH_CHUNK).is_empty());
    }

    #[test]
    fn multiquery_body_and_response_round_trip() {
        let body = build_search_multiquery(&[
            (search_query_for("NieR:Automata™"), String::new()),
            (search_query_for("STEINS;GATE"), igdb_platform_clause(Some("switch"))),
        ]);
        assert!(body.starts_with("query games \"g0\" { fields "));
        assert!(body.contains("search \"NieR Automata\"; where cover != null; limit 10; };"));
        assert!(body.contains("query games \"g1\" {"));
        assert!(body.contains("search \"STEINS GATE\"; where cover != null & platforms = (130); limit 10; };"));

        let response = serde_json::json!([
            { "name": "g1", "result": [{ "id": 2, "name": "Steins;Gate" }] },
            { "name": "unrelated", "result": [{ "id": 9 }] },
        ]);
        let split = split_multiquery_results(&response, 2);
        assert!(split[0].is_empty(), "a query with no entry comes back empty");
        assert_eq!(split[1][0]["id"].as_u64(), Some(2));
    }

    #[test]
    fn image_candidates_group_by_game_with_a_per_game_cap() {
        let response = serde_json::json!([
            { "game": 1, "image_id": "a", "width": 1920, "height": 1080 },
            { "game": 1, "image_id": "b", "width": 1920, "height": 1080, "alpha_channel": true },
            { "game": 1, "image_id": "c", "width": 800, "height": 600 },
            { "game": 2, "image_id": "d", "width": 1280, "height": 720 },
            { "image_id": "no-game" },
        ]);
        let grouped = group_image_candidates(&response, 2);
        // alpha_channel entries are dropped (as in the per-game path) and
        // the cap bounds the candidates actually kept per game.
        assert_eq!(grouped[&1].iter().map(|c| c.0.as_str()).collect::<Vec<_>>(), vec!["a", "c"]);
        assert_eq!(group_image_candidates(&response, 1)[&1].len(), 1);
        assert_eq!(grouped[&2].len(), 1);
        assert_eq!(pick_landscape_image(&grouped[&2]).as_deref(), Some("d"));
    }
}
