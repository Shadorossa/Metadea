// MyAnimeList list sync, parallel to the AniList one (src/anilist.rs):
//   oauth.rs  PKCE login through the `metadea://auth/mal` deep link, token
//             storage and refresh
//   api.rs    throttled/retrying API v2 client, list-status payloads, list
//             paging and fixtures
// This file holds the `mal_*` commands and the small pieces of shared
// state: the login that is waiting for its code, and a lock so two syncs
// never refresh the same token at once.
//
// MAL ids are kept on `media_catalog.mal_id` (resolved through AniList by
// lib/player/mal-id.ts and by the import in lib/mal/import.ts); nothing
// here talks to AniList.
pub mod api;
pub mod oauth;

use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{MetadeaDb, ToStringErr};
use crate::error_codes;
use api::ListKind;

/// Emitted to the main window when a login started with `mal_begin_login`
/// finishes (through the deep link or `mal_complete_login`).
pub const AUTH_RESULT_EVENT: &str = "mal://auth-result";
const MAIN_WINDOW: &str = "main";

static PENDING_LOGIN: Mutex<Option<oauth::PendingLogin>> = Mutex::new(None);

fn refresh_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn client_id(db: &MetadeaDb) -> Result<String, String> {
    crate::igdb_env::env_from_db(db)?
        .mal_client_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .ok_or_else(|| error_codes::MAL_NOT_CONFIGURED.to_string())
}

/// A usable access token: the stored one, refreshed first when it is
/// within a day of expiring. A refresh MAL rejects means the session is
/// gone for good, so the tokens are dropped and the user sees "connect".
async fn access_token(app: &AppHandle) -> Result<String, String> {
    let db = app.state::<MetadeaDb>();
    let tokens = oauth::load_tokens(&db)?.ok_or_else(|| error_codes::MAL_NOT_CONNECTED.to_string())?;
    if !oauth::needs_refresh(&tokens, oauth::now_unix()) {
        return Ok(tokens.access_token);
    }
    let _guard = refresh_lock().lock().await;
    // Another sync may have refreshed while this one waited for the lock.
    let tokens = oauth::load_tokens(&db)?.ok_or_else(|| error_codes::MAL_NOT_CONNECTED.to_string())?;
    if !oauth::needs_refresh(&tokens, oauth::now_unix()) {
        return Ok(tokens.access_token);
    }
    let client_id = client_id(&db)?;
    match oauth::refresh_tokens(&client_id, &tokens.refresh_token).await {
        Ok(fresh) => {
            oauth::save_tokens(&db, &fresh)?;
            Ok(fresh.access_token)
        }
        Err(error) if error.starts_with(error_codes::MAL_AUTH) => {
            log::warn!("mal: refresh rejected, dropping the session: {error}");
            oauth::delete_tokens(&db)?;
            Err(error)
        }
        Err(error) => Err(error),
    }
}

// ─── Status / login ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MalStatus {
    pub client_id_configured: bool,
    pub connected: bool,
    pub redirect_uri: &'static str,
}

#[tauri::command]
pub async fn mal_status(app: AppHandle) -> Result<MalStatus, String> {
    let db = app.state::<MetadeaDb>();
    Ok(MalStatus {
        client_id_configured: client_id(&db).is_ok(),
        connected: oauth::load_tokens(&db)?.is_some(),
        redirect_uri: oauth::REDIRECT_URI,
    })
}

/// Starts a login: remembers a fresh verifier/state pair and returns the
/// authorization page URL for the frontend to open in the system browser.
#[tauri::command]
pub async fn mal_begin_login(app: AppHandle) -> Result<String, String> {
    let client_id = client_id(&app.state::<MetadeaDb>())?;
    let login = oauth::new_pending_login()?;
    let url = oauth::authorize_url(&client_id, &login)?;
    *PENDING_LOGIN.lock().str_err()? = Some(login);
    Ok(url)
}

async fn complete_login(app: &AppHandle, code: &str, state: &str) -> Result<(), String> {
    let pending = PENDING_LOGIN.lock().str_err()?.take();
    let login = match pending {
        Some(login) if login.state == state => login,
        // Put a mismatching login back: the code that arrived is not ours,
        // but the real one may still be on its way.
        Some(login) => {
            *PENDING_LOGIN.lock().str_err()? = Some(login);
            return Err(error_codes::MAL_STATE_MISMATCH.to_string());
        }
        None => return Err(error_codes::MAL_STATE_MISMATCH.to_string()),
    };
    let db = app.state::<MetadeaDb>();
    let client_id = client_id(&db)?;
    let tokens = oauth::exchange_code(&client_id, code, &login.verifier).await?;
    oauth::save_tokens(&db, &tokens)
}

#[derive(Debug, Clone, Serialize)]
struct AuthResult {
    ok: bool,
    error: Option<String>,
}

fn emit_auth_result(app: &AppHandle, result: &Result<(), String>) {
    let payload = AuthResult { ok: result.is_ok(), error: result.as_ref().err().cloned() };
    let _ = app.emit_to(MAIN_WINDOW, AUTH_RESULT_EVENT, &payload);
}

/// Manual completion — the fallback when the browser did not come back
/// through the deep link and the user pasted the redirect URL instead.
#[tauri::command]
pub async fn mal_complete_login(app: AppHandle, code: String, state: String) -> Result<(), String> {
    let result = complete_login(&app, &code, &state).await;
    emit_auth_result(&app, &result);
    result
}

/// Called by src/deep_link.rs when `metadea://auth/mal?code=…&state=…`
/// arrives: exchanges the code off the deep-link thread and tells the
/// webview how it went.
pub fn complete_login_in_background(app: AppHandle, code: String, state: String) {
    tauri::async_runtime::spawn(async move {
        let result = complete_login(&app, &code, &state).await;
        if let Err(error) = &result {
            log::warn!("mal: login could not be completed: {error}");
        }
        emit_auth_result(&app, &result);
    });
}

#[tauri::command]
pub async fn mal_get_profile(app: AppHandle) -> Result<api::Profile, String> {
    let token = access_token(&app).await?;
    api::fetch_profile(&token).await
}

#[tauri::command]
pub async fn mal_logout(app: AppHandle) -> Result<(), String> {
    *PENDING_LOGIN.lock().str_err()? = None;
    oauth::delete_tokens(&app.state::<MetadeaDb>())
}

// ─── List writes ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mal_update_anime(app: AppHandle, mal_id: i64, update: api::AnimeListUpdate) -> Result<(), String> {
    let form = api::anime_form(&update)?;
    let token = access_token(&app).await?;
    api::update_list_status(&token, ListKind::Anime, mal_id, &form).await
}

#[tauri::command]
pub async fn mal_update_manga(app: AppHandle, mal_id: i64, update: api::MangaListUpdate) -> Result<(), String> {
    let form = api::manga_form(&update)?;
    let token = access_token(&app).await?;
    api::update_list_status(&token, ListKind::Manga, mal_id, &form).await
}

#[tauri::command]
pub async fn mal_delete_entry(app: AppHandle, kind: String, mal_id: i64) -> Result<(), String> {
    let kind = ListKind::parse(&kind)?;
    let token = access_token(&app).await?;
    api::delete_list_status(&token, kind, mal_id).await
}

// ─── Import ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mal_fetch_list(app: AppHandle, kind: String) -> Result<Vec<api::ListItem>, String> {
    let kind = ListKind::parse(&kind)?;
    let token = access_token(&app).await?;
    api::fetch_whole_list(&token, kind).await
}

/// A catalog row already known to carry a MAL id. `type` is the catalog
/// type (anime / manga / lnovel) — MAL's anime and manga id spaces overlap,
/// so a lookup is always scoped to one list kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogLink {
    pub mal_id: i64,
    pub external_id: String,
    #[serde(rename = "type")]
    pub media_type: String,
}

fn catalog_types_for(kind: ListKind) -> &'static [&'static str] {
    match kind {
        ListKind::Anime => &["anime"],
        ListKind::Manga => &["manga", "lnovel"],
    }
}

pub(crate) fn catalog_links_by_mal_ids(conn: &rusqlite::Connection, kind: ListKind, mal_ids: &[i64]) -> Result<Vec<CatalogLink>, String> {
    let types = catalog_types_for(kind);
    let mut links = Vec::new();
    for chunk in mal_ids.chunks(crate::db::SQL_IN_CHUNK) {
        let sql = format!(
            "SELECT mal_id, external_id, type FROM visible_media_catalog
             WHERE mal_id IN ({}) AND type IN ({})",
            crate::db::sql_placeholders(chunk.len()),
            crate::db::sql_placeholders(types.len()),
        );
        let mut stmt = conn.prepare(&sql).str_err()?;
        let params: Vec<Box<dyn rusqlite::ToSql>> = chunk
            .iter()
            .map(|id| Box::new(*id) as Box<dyn rusqlite::ToSql>)
            .chain(types.iter().map(|t| Box::new(t.to_string()) as Box<dyn rusqlite::ToSql>))
            .collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |row| {
                Ok(CatalogLink { mal_id: row.get(0)?, external_id: row.get(1)?, media_type: row.get(2)? })
            })
            .str_err()?;
        links.extend(rows.filter_map(|r| r.ok()));
    }
    Ok(links)
}

#[tauri::command]
pub async fn mal_catalog_links_by_mal_ids(app: AppHandle, kind: String, mal_ids: Vec<i64>) -> Result<Vec<CatalogLink>, String> {
    let kind = ListKind::parse(&kind)?;
    if mal_ids.is_empty() {
        return Ok(Vec::new());
    }
    let db = app.state::<MetadeaDb>();
    let conn = db.conn.lock().str_err()?;
    catalog_links_by_mal_ids(&conn, kind, &mal_ids)
}

pub(crate) fn remember_catalog_links(conn: &mut rusqlite::Connection, links: &[CatalogLink]) -> Result<usize, String> {
    let tx = conn.transaction().str_err()?;
    let mut updated = 0;
    for link in links {
        updated += tx
            .execute(
                "UPDATE media_catalog SET mal_id = ?2 WHERE external_id = ?1 AND (mal_id IS NULL OR mal_id != ?2)",
                rusqlite::params![link.external_id, link.mal_id],
            )
            .str_err()?;
    }
    tx.commit().str_err()?;
    Ok(updated)
}

/// Batched `set_catalog_mal_id` for the import: one transaction instead of
/// one IPC round-trip per matched row.
#[tauri::command]
pub async fn mal_remember_catalog_links(app: AppHandle, links: Vec<CatalogLink>) -> Result<usize, String> {
    if links.is_empty() {
        return Ok(0);
    }
    let db = app.state::<MetadeaDb>();
    let mut conn = db.conn.lock().str_err()?;
    remember_catalog_links(&mut conn, &links)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_catalog(conn: &rusqlite::Connection, external_id: &str, media_type: &str, mal_id: Option<i64>) {
        conn.execute(
            "INSERT INTO media_catalog (id, external_id, type, title_main, mal_id) VALUES (?1, ?1, ?2, ?1, ?3)",
            rusqlite::params![external_id, media_type, mal_id],
        )
        .unwrap();
    }

    #[test]
    fn catalog_links_are_scoped_to_the_list_kind() {
        let db = MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();
        seed_catalog(&conn, "anime:21", "anime", Some(21));
        seed_catalog(&conn, "manga:13", "manga", Some(21)); // same MAL id, other id space
        seed_catalog(&conn, "lnovel:9", "lnovel", Some(7));
        seed_catalog(&conn, "anime:99", "anime", None);

        let anime = catalog_links_by_mal_ids(&conn, ListKind::Anime, &[21, 7, 123]).unwrap();
        assert_eq!(anime, vec![CatalogLink { mal_id: 21, external_id: "anime:21".into(), media_type: "anime".into() }]);

        let mut manga = catalog_links_by_mal_ids(&conn, ListKind::Manga, &[21, 7]).unwrap();
        manga.sort_by_key(|l| l.mal_id);
        assert_eq!(manga.iter().map(|l| l.external_id.as_str()).collect::<Vec<_>>(), vec!["lnovel:9", "manga:13"]);

        let updated = remember_catalog_links(
            &mut conn,
            &[
                CatalogLink { mal_id: 99, external_id: "anime:99".into(), media_type: "anime".into() },
                CatalogLink { mal_id: 21, external_id: "anime:21".into(), media_type: "anime".into() },
                CatalogLink { mal_id: 1, external_id: "anime:missing".into(), media_type: "anime".into() },
            ],
        )
        .unwrap();
        assert_eq!(updated, 1, "only the row that lacked the id changes");
        let stored: i64 = conn.query_row("SELECT mal_id FROM media_catalog WHERE external_id = 'anime:99'", [], |r| r.get(0)).unwrap();
        assert_eq!(stored, 99);
    }

    #[test]
    fn catalog_link_serialises_with_a_type_field() {
        let json = serde_json::to_value(CatalogLink { mal_id: 1, external_id: "anime:1".into(), media_type: "anime".into() }).unwrap();
        assert_eq!(json, serde_json::json!({ "mal_id": 1, "external_id": "anime:1", "type": "anime" }));
    }
}
