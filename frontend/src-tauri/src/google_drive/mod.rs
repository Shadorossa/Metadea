//! Google Drive backups: link an account (OAuth, see `oauth.rs`), upload the
//! same `.7z` a local export produces into the app-private `appDataFolder`,
//! keep the last N, list and restore them, and an optional daily/weekly
//! schedule that only uploads when the data changed.
//!
//! The link and the schedule live in `google-drive.json` in the data folder,
//! tokens DPAPI-encrypted. That file is machine-local: it is excluded from
//! backups and survives a restore (see `backup::layout`).

pub mod api;
pub mod oauth;
pub mod schedule;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

use crate::backup::progress::{EventProgress, OperationGuard, ProgressSink};
use crate::backup::{self, WorkDir};
use crate::error_codes::{self, with_detail};
use api::DriveAccount;
use oauth::{ClientCredentials, LoopbackPage, StoredTokens};
use schedule::{RemoteBackup, Schedule};

pub const STATE_FILE_NAME: &str = "google-drive.json";
/// Emitted after a scheduled run changes the state, so an open Backup tab refreshes.
const STATE_EVENT: &str = "backup://drive-state";

static LINK_CANCEL: AtomicBool = AtomicBool::new(false);
static LINK_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Serialises read-modify-write of the state file.
static STATE_LOCK: Mutex<()> = Mutex::new(());

fn default_keep_last() -> u32 {
    schedule::DEFAULT_KEEP_LAST
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DriveState {
    /// `utils::encrypt_secret` of the `StoredTokens` JSON.
    #[serde(default)]
    tokens: Option<String>,
    #[serde(default)]
    account: Option<DriveAccount>,
    #[serde(default)]
    schedule: Schedule,
    #[serde(default = "default_keep_last")]
    keep_last: u32,
    #[serde(default)]
    last_upload_at: Option<String>,
    #[serde(default)]
    last_upload_fingerprint: Option<String>,
    #[serde(default)]
    last_upload_size: Option<u64>,
    /// A scheduled run that found nothing new to upload.
    #[serde(default)]
    last_check_at: Option<String>,
    #[serde(default)]
    last_error: Option<String>,
}

impl Default for DriveState {
    fn default() -> Self {
        Self {
            tokens: None,
            account: None,
            schedule: Schedule::Off,
            keep_last: schedule::DEFAULT_KEEP_LAST,
            last_upload_at: None,
            last_upload_fingerprint: None,
            last_upload_size: None,
            last_check_at: None,
            last_error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveStatus {
    /// A client id is available (build-time or Environment override).
    configured: bool,
    linked: bool,
    account: Option<DriveAccount>,
    schedule: Schedule,
    keep_last: u32,
    last_upload_at: Option<String>,
    last_upload_size: Option<u64>,
    last_check_at: Option<String>,
    last_error: Option<String>,
}

fn state_path(data_dir: &Path) -> PathBuf {
    data_dir.join(STATE_FILE_NAME)
}

fn load_state(data_dir: &Path) -> DriveState {
    backup::read_json_or_default(&state_path(data_dir))
}

fn update_state(data_dir: &Path, change: impl FnOnce(&mut DriveState)) -> Result<DriveState, String> {
    let _lock = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut state = load_state(data_dir);
    change(&mut state);
    backup::write_json_atomic(&state_path(data_dir), &state)?;
    Ok(state)
}

/// The Environment › Google override wins over the build-time client.
fn client_credentials(app: &tauri::AppHandle) -> Option<ClientCredentials> {
    let from_db = app.try_state::<crate::db::MetadeaDb>().and_then(|db| crate::igdb_env::env_from_db(&db).ok());
    let (id, secret) = from_db.map(|cfg| (cfg.google_client_id, cfg.google_client_secret)).unwrap_or((None, None));
    let client_id = id.filter(|s| !s.trim().is_empty()).or_else(|| option_env!("METADEA_GOOGLE_CLIENT_ID").map(str::to_string))?;
    let client_secret = secret
        .filter(|s| !s.trim().is_empty())
        .or_else(|| option_env!("METADEA_GOOGLE_CLIENT_SECRET").map(str::to_string))
        .unwrap_or_default();
    Some(ClientCredentials { client_id: client_id.trim().to_string(), client_secret: client_secret.trim().to_string() })
}

fn status_of(app: &tauri::AppHandle, state: &DriveState) -> DriveStatus {
    DriveStatus {
        configured: client_credentials(app).is_some(),
        linked: state.tokens.is_some(),
        account: state.account.clone(),
        schedule: state.schedule,
        keep_last: state.keep_last,
        last_upload_at: state.last_upload_at.clone(),
        last_upload_size: state.last_upload_size,
        last_check_at: state.last_check_at.clone(),
        last_error: state.last_error.clone(),
    }
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// A valid access token, refreshed (and persisted) when close to expiry.
async fn access_token(app: &tauri::AppHandle, data_dir: &Path) -> Result<String, String> {
    let state = load_state(data_dir);
    let stored = state.tokens.ok_or(error_codes::GDRIVE_NOT_LINKED)?;
    let json = crate::utils::decrypt_secret(&stored).map_err(|_| error_codes::GDRIVE_NOT_LINKED.to_string())?;
    let tokens: StoredTokens = serde_json::from_str(&json).map_err(|_| error_codes::GDRIVE_NOT_LINKED.to_string())?;
    let now = chrono::Utc::now().timestamp();
    if !oauth::needs_refresh(&tokens, now) {
        return Ok(tokens.access_token);
    }
    let client = client_credentials(app).ok_or(error_codes::GDRIVE_NOT_CONFIGURED)?;
    let refreshed = oauth::refresh_tokens(&client, &tokens.refresh_token).await?;
    let encrypted = crate::utils::encrypt_secret(&serde_json::to_string(&refreshed).map_err(|e| e.to_string())?)?;
    update_state(data_dir, |s| s.tokens = Some(encrypted))?;
    Ok(refreshed.access_token)
}

/// For the emulator saves sync (src/saves/drive.rs): a valid token and the
/// linked account's email (the sync state is reset when it changes).
pub(crate) async fn token_for_saves(app: &tauri::AppHandle) -> Result<(String, Option<String>), String> {
    let data_dir = backup::app_data_dir(app)?;
    let token = access_token(app, &data_dir).await?;
    let email = load_state(&data_dir).account.map(|account| account.email).filter(|email| !email.is_empty());
    Ok((token, email))
}

/// Linked and a client id available: what a saves sync needs to run.
pub(crate) fn is_linked(app: &tauri::AppHandle) -> bool {
    backup::app_data_dir(app).is_ok_and(|dir| load_state(&dir).tokens.is_some()) && client_credentials(app).is_some()
}

// ─── Linking ──────────────────────────────────────────────────────────────────

struct LinkGuard;

impl LinkGuard {
    fn acquire() -> Result<Self, String> {
        if LINK_ACTIVE.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return Err(error_codes::BACKUP_BUSY.into());
        }
        LINK_CANCEL.store(false, Ordering::SeqCst);
        Ok(Self)
    }
}

impl Drop for LinkGuard {
    fn drop(&mut self) {
        LINK_ACTIVE.store(false, Ordering::SeqCst);
        LINK_CANCEL.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn google_drive_status(app_handle: tauri::AppHandle) -> Result<DriveStatus, String> {
    let data_dir = backup::app_data_dir(&app_handle)?;
    Ok(status_of(&app_handle, &load_state(&data_dir)))
}

/// Opens the system browser on Google's consent page and waits (up to five
/// minutes) for the loopback redirect. `page` is the localized text the
/// browser tab shows afterwards.
#[tauri::command]
pub async fn google_drive_link(
    app_handle: tauri::AppHandle,
    page: LoopbackPage,
    login_hint: Option<String>,
) -> Result<DriveStatus, String> {
    let _guard = LinkGuard::acquire()?;
    let client = client_credentials(&app_handle).ok_or(error_codes::GDRIVE_NOT_CONFIGURED)?;
    let data_dir = backup::app_data_dir(&app_handle)?;
    let pkce = oauth::new_pkce()?;
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| with_detail(error_codes::GDRIVE_AUTH, e))?;
    let port = listener.local_addr().map_err(|e| with_detail(error_codes::GDRIVE_AUTH, e))?.port();
    let redirect_uri = oauth::loopback_redirect_uri(port);
    let url = oauth::authorize_url(&client.client_id, &redirect_uri, &pkce, login_hint.as_deref())?;

    use tauri_plugin_opener::OpenerExt;
    app_handle.opener().open_url(url, None::<&str>).map_err(|e| with_detail(error_codes::GDRIVE_AUTH, e))?;

    let state = pkce.state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        oauth::wait_for_code(&listener, &state, &page, oauth::LOGIN_TIMEOUT, &LINK_CANCEL)
    })
    .await
    .map_err(|e| e.to_string())??;

    let tokens = oauth::exchange_code(&client, &code, &pkce.verifier, &redirect_uri).await?;
    let account = api::about(&tokens.access_token).await.ok();
    let encrypted = crate::utils::encrypt_secret(&serde_json::to_string(&tokens).map_err(|e| e.to_string())?)?;
    let state = update_state(&data_dir, |s| {
        s.tokens = Some(encrypted);
        s.account = account;
        s.last_error = None;
    })?;
    Ok(status_of(&app_handle, &state))
}

#[tauri::command]
pub fn google_drive_cancel_link() -> bool {
    let active = LINK_ACTIVE.load(Ordering::SeqCst);
    if active {
        LINK_CANCEL.store(true, Ordering::SeqCst);
    }
    active
}

/// Forgets the account locally (always) and revokes the grant (best effort).
/// Backups already on Drive stay there.
#[tauri::command]
pub async fn google_drive_unlink(app_handle: tauri::AppHandle) -> Result<DriveStatus, String> {
    let data_dir = backup::app_data_dir(&app_handle)?;
    let previous = load_state(&data_dir);
    let state = update_state(&data_dir, |s| {
        s.tokens = None;
        s.account = None;
        s.last_upload_fingerprint = None;
        s.last_error = None;
    })?;
    let token = previous
        .tokens
        .and_then(|t| crate::utils::decrypt_secret(&t).ok())
        .and_then(|json| serde_json::from_str::<StoredTokens>(&json).ok());
    if let Some(tokens) = token {
        oauth::revoke(&tokens.refresh_token).await;
    }
    Ok(status_of(&app_handle, &state))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveOptions {
    schedule: Schedule,
    keep_last: u32,
}

#[tauri::command]
pub async fn google_drive_set_options(app_handle: tauri::AppHandle, options: DriveOptions) -> Result<DriveStatus, String> {
    let data_dir = backup::app_data_dir(&app_handle)?;
    let state = update_state(&data_dir, |s| {
        s.schedule = options.schedule;
        s.keep_last = schedule::clamp_keep_last(options.keep_last);
    })?;
    Ok(status_of(&app_handle, &state))
}

#[tauri::command]
pub async fn google_drive_list(app_handle: tauri::AppHandle) -> Result<Vec<RemoteBackup>, String> {
    let data_dir = backup::app_data_dir(&app_handle)?;
    let token = access_token(&app_handle, &data_dir).await?;
    api::list_backups(&token).await
}

// ─── Upload ───────────────────────────────────────────────────────────────────

enum Trigger {
    Manual,
    Scheduled,
}

/// Builds the archive, uploads it, prunes old ones and records the result.
/// `Ok(None)`: a scheduled run found nothing changed since the last upload.
async fn run_upload(app: &tauri::AppHandle, trigger: Trigger, progress: &EventProgress) -> Result<Option<RemoteBackup>, String> {
    let data_dir = backup::app_data_dir(app)?;
    let token = access_token(app, &data_dir).await?;
    let state = load_state(&data_dir);
    let skip_if = match trigger {
        Trigger::Scheduled => state.last_upload_fingerprint.clone(),
        Trigger::Manual => None,
    };

    let work = WorkDir::new(&data_dir, "metadea-drive-upload")?;
    let archive_path = work.0.join("backup.7z");
    let version = backup::app_version(app);
    let built = {
        let (data_dir, archive_path, version) = (data_dir.clone(), archive_path.clone(), version.clone());
        let app = app.clone();
        // Game saves ride along in the archive ("Include game saves").
        let saves_root = crate::saves::backup_root(&app);
        tauri::async_runtime::spawn_blocking(move || {
            let progress = EventProgress::new(&app, "drive_upload");
            backup::build_archive(&data_dir, &version, &archive_path, skip_if.as_deref(), saves_root.as_deref(), &progress)
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let Some(built) = built else {
        update_state(&data_dir, |s| {
            s.last_check_at = Some(now_rfc3339());
            s.last_error = None;
        })?;
        return Ok(None);
    };

    let fingerprint = built.manifest.fingerprint();
    let name = schedule::remote_backup_name(chrono::Utc::now());
    let meta = api::UploadMeta { name: &name, fingerprint: &fingerprint, schema_version: built.manifest.schema_version, app_version: &version };
    let remote = api::upload(&token, &archive_path, meta, progress).await?;

    // Retention: a failure here must not turn a good upload into an error.
    if let Ok(list) = api::list_backups(&token).await {
        for id in schedule::backups_to_prune(&list, state.keep_last) {
            if id != remote.id {
                let _ = api::delete(&token, &id).await;
            }
        }
    }
    update_state(&data_dir, |s| {
        s.last_upload_at = Some(now_rfc3339());
        s.last_upload_fingerprint = Some(fingerprint);
        s.last_upload_size = Some(built.size);
        s.last_check_at = None;
        s.last_error = None;
    })?;
    progress.report("done", 100.0);
    Ok(Some(remote))
}

#[tauri::command]
pub async fn google_drive_upload_now(app_handle: tauri::AppHandle) -> Result<RemoteBackup, String> {
    let _guard = OperationGuard::acquire()?;
    let progress = EventProgress::new(&app_handle, "drive_upload");
    let result = run_upload(&app_handle, Trigger::Manual, &progress).await;
    if let Err(error) = &result {
        record_error(&app_handle, error);
    }
    result?.ok_or_else(|| error_codes::GDRIVE_API.to_string())
}

fn record_error(app: &tauri::AppHandle, error: &str) {
    if error == error_codes::BACKUP_CANCELLED {
        return;
    }
    if let Ok(data_dir) = backup::app_data_dir(app) {
        let _ = update_state(&data_dir, |s| s.last_error = Some(error.to_string()));
    }
}

/// Downloads a Drive backup and stages it exactly like a local restore.
#[tauri::command]
pub async fn google_drive_restore(app_handle: tauri::AppHandle, file_id: String, size: u64) -> Result<backup::RestorePrepared, String> {
    let guard = OperationGuard::acquire()?;
    let data_dir = backup::app_data_dir(&app_handle)?;
    let token = access_token(&app_handle, &data_dir).await?;
    let work = WorkDir::new(&data_dir, "metadea-drive-download")?;
    let archive_path = work.0.join("backup.7z");
    let progress = EventProgress::new(&app_handle, "drive_download");
    api::download(&token, &file_id, size, &archive_path, &progress).await?;
    let version = backup::app_version(&app_handle);
    let app = app_handle.clone();
    let saves_target = crate::saves::restore_target(&app_handle);
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        let _work = work;
        let progress = EventProgress::new(&app, "restore");
        let target = saves_target.as_ref().map(|(root, keep)| (root.as_path(), *keep));
        backup::prepare_restore_from(&data_dir, &version, &archive_path, target, &progress)
    })
    .await
    .map_err(|e| e.to_string())??;
    // Backup first, then the saves synced to Drive since it was taken
    // (only where newer) before the app restarts.
    crate::saves::pull_after_drive_restore(&app_handle).await;
    drop(guard);
    Ok(prepared)
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

/// One scheduled check: skipped unless linked, on, due and idle.
async fn scheduled_tick(app: &tauri::AppHandle) {
    let Ok(data_dir) = backup::app_data_dir(app) else { return };
    let state = load_state(&data_dir);
    if state.tokens.is_none() || client_credentials(app).is_none() {
        return;
    }
    let last_run = schedule::latest(state.last_upload_at.as_deref(), state.last_check_at.as_deref());
    if !schedule::is_due(state.schedule, last_run, chrono::Utc::now()) {
        return;
    }
    let Ok(_guard) = OperationGuard::acquire() else { return };
    let progress = EventProgress::new(app, "drive_upload");
    if let Err(error) = run_upload(app, Trigger::Scheduled, &progress).await {
        log::warn!("Scheduled Google Drive backup failed: {error}");
        record_error(app, &error);
    }
    let _ = app.emit(STATE_EVENT, ());
}

/// Checks at startup (after a short delay) and every few hours while running.
pub fn start_scheduler(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(schedule::FIRST_CHECK_AFTER).await;
        loop {
            scheduled_tick(&app).await;
            tokio::time::sleep(schedule::CHECK_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_defaults_and_round_trips() {
        let state: DriveState = serde_json::from_str("{}").unwrap();
        assert_eq!(state.keep_last, schedule::DEFAULT_KEEP_LAST);
        assert_eq!(state.schedule, Schedule::Off);
        let dir = crate::backup::layout::tempdir("drive-state");
        let saved = update_state(&dir, |s| {
            s.schedule = Schedule::Weekly;
            s.keep_last = 3;
        })
        .unwrap();
        let loaded = load_state(&dir);
        assert_eq!(loaded.schedule, saved.schedule);
        assert_eq!(loaded.keep_last, 3);
        let _ = std::fs::remove_dir_all(dir);
    }
}
