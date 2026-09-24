//! Plugins: third-party packages (a `manifest.json` plus one JS file) that
//! run in their own Web Worker in the frontend (`frontend/src/lib/plugins`).
//! Rust owns everything a worker must not touch directly: installing and
//! validating packages, the enabled flag and the permissions the user
//! granted, settings (secrets through DPAPI), the key/value storage, and the
//! network (`plugin_http_fetch`, the only way out, checked against the
//! granted host allowlist). The public API is documented in docs/PLUGINS.md.
//!
//! Layout on disk: `<app data>/plugins/<id>/<version>/` holds the extracted
//! package; `<app data>/plugins/.staging/<token>/` a package waiting for the
//! user's consent (install/update prompt), removed after an hour.
pub mod host_rules;
pub mod http;
pub mod manifest;
pub mod package;
pub mod settings;
pub mod store;

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::Manager;

use crate::db::{MetadeaDb, ToStringErr};
use crate::error_codes::{self, with_detail};
use host_rules::HostPattern;
use manifest::{PluginManifest, MANIFEST_FILE};

pub const PLUGINS_DIR_NAME: &str = "plugins";
const STAGING_DIR_NAME: &str = ".staging";
const STAGING_TTL: Duration = Duration::from_secs(60 * 60);
const MAX_ENTRY_BYTES: u64 = 5 * 1024 * 1024;
const MAX_ICON_BYTES: u64 = 256 * 1024;
const DOWNLOAD_EXTENSIONS: &[&str] = &["cbz", "zip", "epub", "pdf"];
const DOWNLOAD_CACHE_TTL: Duration = Duration::from_secs(3 * 24 * 60 * 60);

fn io_err(e: impl std::fmt::Display) -> String {
    with_detail(error_codes::PLUGIN_IO, e)
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

fn plugins_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(io_err)?.join(PLUGINS_DIR_NAME);
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    Ok(dir)
}

fn plugin_version_dir(root: &Path, id: &str, version: &str) -> Result<PathBuf, String> {
    // Both were validated by the manifest parser, but the row could have
    // been written by anything: never build a path from unchecked text.
    if !manifest::is_valid_plugin_id(id) || !manifest::is_valid_version(version) {
        return Err(with_detail(error_codes::PLUGIN_NOT_FOUND, id));
    }
    Ok(root.join(id).join(version))
}

/// Reads a manifest from a package folder; its id and version must match
/// the folder it lives in when `expected` is given.
fn read_manifest_in(dir: &Path, expected: Option<(&str, &str)>) -> Result<PluginManifest, String> {
    let path = dir.join(MANIFEST_FILE);
    if !path.is_file() {
        return Err(with_detail(error_codes::PLUGIN_PACKAGE_INVALID, format!("{MANIFEST_FILE} is missing")));
    }
    if std::fs::metadata(&path).map_err(io_err)?.len() > 256 * 1024 {
        return Err(with_detail(error_codes::PLUGIN_MANIFEST_INVALID, "manifest.json is larger than 256 KB"));
    }
    let json = std::fs::read_to_string(&path).map_err(io_err)?;
    let manifest = manifest::parse_manifest(&json)?;
    if let Some((id, version)) = expected {
        if manifest.id != id || manifest.version != version {
            return Err(with_detail(
                error_codes::PLUGIN_MANIFEST_INVALID,
                format!("manifest says {}@{}, folder is {id}@{version}", manifest.id, manifest.version),
            ));
        }
    }
    Ok(manifest)
}

/// A file named by the manifest, which must resolve (symlinks included)
/// inside the package folder.
fn package_file(dir: &Path, relative: &str) -> Result<PathBuf, String> {
    let safe = crate::utils::safe_archive_path(Path::new(relative))
        .ok_or_else(|| with_detail(error_codes::PLUGIN_PACKAGE_INVALID, format!("unsafe path {relative}")))?;
    let root = dir.canonicalize().map_err(io_err)?;
    let real = dir.join(safe).canonicalize().map_err(|e| with_detail(error_codes::PLUGIN_PACKAGE_INVALID, format!("{relative}: {e}")))?;
    if !real.starts_with(&root) || !real.is_file() {
        return Err(with_detail(error_codes::PLUGIN_PACKAGE_INVALID, format!("{relative} is outside the package")));
    }
    Ok(real)
}

fn icon_data_url(dir: &Path, manifest: &PluginManifest) -> Option<String> {
    let icon = manifest.icon.as_deref()?;
    let path = package_file(dir, icon).ok()?;
    if std::fs::metadata(&path).ok()?.len() > MAX_ICON_BYTES {
        return None;
    }
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        _ => return None,
    };
    let bytes = std::fs::read(&path).ok()?;
    Some(format!("data:{mime};base64,{}", crate::utils::base64_encode(&bytes)))
}

// ── Listing ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub installed_at: i64,
    pub updated_at: i64,
    /// None when the package on disk cannot be read (see `error`).
    pub manifest: Option<PluginManifest>,
    pub icon_data_url: Option<String>,
    pub granted_permissions: Vec<String>,
    /// Permissions the manifest on disk declares that were never granted
    /// (a package edited by hand): the plugin does not start until the user
    /// accepts them (`plugin_grant_permissions`).
    pub pending_permissions: Vec<String>,
    pub folder: String,
    /// `E_PLUGIN_*` code (with detail) when the package cannot be loaded.
    pub error: Option<String>,
}

fn describe(root: &Path, row: store::PluginRow) -> PluginInfo {
    let folder = plugin_version_dir(root, &row.id, &row.version);
    let loaded = folder.clone().and_then(|dir| read_manifest_in(&dir, Some((&row.id, &row.version))).map(|m| (dir, m)));
    let (manifest, icon, pending, error) = match loaded {
        Ok((dir, manifest)) => {
            let icon = icon_data_url(&dir, &manifest);
            let pending = manifest::permission_escalation(&row.granted, &manifest::permission_tokens(&manifest.permissions));
            (Some(manifest), icon, pending, None)
        }
        Err(error) => (None, None, Vec::new(), Some(error)),
    };
    PluginInfo {
        folder: folder.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        id: row.id,
        version: row.version,
        enabled: row.enabled,
        installed_at: row.installed_at,
        updated_at: row.updated_at,
        manifest,
        icon_data_url: icon,
        granted_permissions: row.granted.into_iter().collect(),
        pending_permissions: pending,
        error,
    }
}

#[tauri::command]
pub fn plugin_list(app_handle: tauri::AppHandle, state: tauri::State<'_, MetadeaDb>) -> Result<Vec<PluginInfo>, String> {
    let root = plugins_root(&app_handle)?;
    let rows = {
        let conn = state.conn.lock().str_err()?;
        store::list(&conn)?
    };
    Ok(rows.into_iter().map(|row| describe(&root, row)).collect())
}

// ── Install (stage → consent → commit) ────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousInstall {
    pub version: String,
    pub granted_permissions: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallPreview {
    /// Pass to `plugin_install_confirm` / `plugin_install_cancel`.
    pub token: String,
    pub manifest: PluginManifest,
    pub icon_data_url: Option<String>,
    pub previous: Option<PreviousInstall>,
    /// Every permission token the package asks for.
    pub requested_permissions: Vec<String>,
    /// Tokens not covered by the previous grant (all of them on a new
    /// install).
    pub new_permissions: Vec<String>,
    /// A fresh install always asks; an update only when it escalates.
    pub needs_consent: bool,
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(io_err)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn is_valid_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn staging_root(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(STAGING_DIR_NAME);
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    Ok(dir)
}

/// Drops staged packages nobody confirmed within the TTL.
fn sweep_staging(staging: &Path) {
    let Ok(entries) = std::fs::read_dir(staging) else { return };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age > STAGING_TTL);
        if old {
            std::fs::remove_dir_all(entry.path()).ok();
        }
    }
}

fn build_preview(token: String, dir: &Path, manifest: PluginManifest, previous: Option<store::PluginRow>) -> PluginInstallPreview {
    let requested = manifest::permission_tokens(&manifest.permissions);
    let granted = previous.as_ref().map(|row| row.granted.clone()).unwrap_or_default();
    let new_permissions = manifest::permission_escalation(&granted, &requested);
    let needs_consent = previous.is_none() || !new_permissions.is_empty();
    PluginInstallPreview {
        token,
        icon_data_url: icon_data_url(dir, &manifest),
        previous: previous.map(|row| PreviousInstall { version: row.version, granted_permissions: row.granted.into_iter().collect() }),
        requested_permissions: requested.into_iter().collect(),
        new_permissions,
        needs_consent,
        manifest,
    }
}

/// Stages a package with `fill` (extract or copy into an empty folder),
/// validates it and returns the preview for the consent prompt.
fn stage(
    app: &tauri::AppHandle,
    db: &MetadeaDb,
    fill: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<PluginInstallPreview, String> {
    let root = plugins_root(app)?;
    let staging = staging_root(&root)?;
    sweep_staging(&staging);
    let token = random_token()?;
    let dir = staging.join(&token);
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    let staged = fill(&dir).and_then(|_| {
        let manifest = read_manifest_in(&dir, None)?;
        package_file(&dir, &manifest.main)?;
        Ok(manifest)
    });
    let manifest = match staged {
        Ok(manifest) => manifest,
        Err(error) => {
            std::fs::remove_dir_all(&dir).ok();
            return Err(error);
        }
    };
    let previous = {
        let conn = db.conn.lock().str_err()?;
        store::get(&conn, &manifest.id)?
    };
    Ok(build_preview(token, &dir, manifest, previous))
}

fn pick_package(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("Metadea plugin", &["zip"])
        .blocking_pick_file()
        .map(|file| PathBuf::from(file.to_string()))
}

/// `path` is a `.zip` or a package folder; without one, a file picker opens
/// (None when the user cancels it).
#[tauri::command]
pub async fn plugin_install_from_file(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, MetadeaDb>,
    path: Option<String>,
) -> Result<Option<PluginInstallPreview>, String> {
    let source = match path {
        Some(path) => PathBuf::from(path),
        None => match pick_package(&app_handle) {
            Some(path) => path,
            None => return Ok(None),
        },
    };
    let preview = if source.is_dir() {
        stage(&app_handle, &state, |dest| package::copy_folder(&source, dest))?
    } else {
        let size = std::fs::metadata(&source).map_err(io_err)?.len();
        if size > package::MAX_ARCHIVE_BYTES {
            return Err(with_detail(error_codes::PLUGIN_PACKAGE_TOO_LARGE, format!("{} MB max", package::MAX_ARCHIVE_BYTES / 1024 / 1024)));
        }
        let file = std::fs::File::open(&source).map_err(io_err)?;
        stage(&app_handle, &state, |dest| package::extract_zip(file, dest))?
    };
    Ok(Some(preview))
}

/// Downloads a package over https (any host: the user typed the URL).
#[tauri::command]
pub async fn plugin_install_from_url(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, MetadeaDb>,
    url: String,
) -> Result<PluginInstallPreview, String> {
    let parsed = reqwest::Url::parse(url.trim()).map_err(|e| with_detail(error_codes::PLUGIN_URL_INVALID, e))?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(with_detail(error_codes::PLUGIN_URL_INVALID, "only https URLs are accepted"));
    }
    let host = parsed.host_str().unwrap_or_default().to_string();
    let port = parsed.port().map(|p| format!(":{p}")).unwrap_or_default();
    let pattern = HostPattern::parse(&format!("{host}{port}")).map_err(|e| with_detail(error_codes::PLUGIN_URL_INVALID, e))?;
    let request = http::PluginHttpRequest {
        url: parsed.to_string(),
        method: None,
        headers: Default::default(),
        body: None,
        body_base64: None,
        response_type: http::ResponseType::Base64,
        timeout_ms: Some(http::MAX_TIMEOUT_MS),
    };
    // Redirects may only stay on the host the user typed (release pages
    // that bounce to a CDN are not followed; link the file itself).
    let response = http::fetch(request, vec![pattern])
        .await
        .map_err(|e| with_detail(error_codes::PLUGIN_DOWNLOAD, e))?;
    if !(200..300).contains(&response.status) {
        return Err(with_detail(error_codes::PLUGIN_DOWNLOAD, format!("HTTP {}", response.status)));
    }
    let bytes = crate::utils::base64_decode(&response.body).map_err(|e| with_detail(error_codes::PLUGIN_DOWNLOAD, e))?;
    if bytes.len() as u64 > package::MAX_ARCHIVE_BYTES {
        return Err(with_detail(error_codes::PLUGIN_PACKAGE_TOO_LARGE, format!("{} MB max", package::MAX_ARCHIVE_BYTES / 1024 / 1024)));
    }
    stage(&app_handle, &state, |dest| package::extract_zip(std::io::Cursor::new(bytes), dest))
}

fn staged_dir(root: &Path, token: &str) -> Result<PathBuf, String> {
    if !is_valid_token(token) {
        return Err(with_detail(error_codes::PLUGIN_INSTALL_EXPIRED, "bad token"));
    }
    let dir = root.join(STAGING_DIR_NAME).join(token);
    if !dir.is_dir() {
        return Err(error_codes::PLUGIN_INSTALL_EXPIRED.to_string());
    }
    Ok(dir)
}

/// Moves a staged package into place and records the grant: the user just
/// accepted every permission it requests.
#[tauri::command]
pub fn plugin_install_confirm(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, MetadeaDb>,
    token: String,
) -> Result<PluginInfo, String> {
    let root = plugins_root(&app_handle)?;
    let staged = staged_dir(&root, &token)?;
    let manifest = read_manifest_in(&staged, None)?;
    let target = plugin_version_dir(&root, &manifest.id, &manifest.version)?;
    let previous = {
        let conn = state.conn.lock().str_err()?;
        store::get(&conn, &manifest.id)?
    };
    if target.exists() {
        std::fs::remove_dir_all(&target).map_err(io_err)?;
    }
    std::fs::create_dir_all(target.parent().unwrap_or(root.as_path())).map_err(io_err)?;
    std::fs::rename(&staged, &target).map_err(io_err)?;
    let granted = manifest::permission_tokens(&manifest.permissions);
    let row = {
        let conn = state.conn.lock().str_err()?;
        store::upsert_install(&conn, &manifest.id, &manifest.version, &granted, now_secs())?;
        store::require(&conn, &manifest.id)?
    };
    if let Some(previous) = previous.filter(|p| p.version != manifest.version) {
        if let Ok(old) = plugin_version_dir(&root, &previous.id, &previous.version) {
            std::fs::remove_dir_all(old).ok();
        }
    }
    Ok(describe(&root, row))
}

#[tauri::command]
pub fn plugin_install_cancel(app_handle: tauri::AppHandle, token: String) -> Result<(), String> {
    let root = plugins_root(&app_handle)?;
    if let Ok(dir) = staged_dir(&root, &token) {
        std::fs::remove_dir_all(dir).map_err(io_err)?;
    }
    Ok(())
}

/// Grants what the on-disk manifest declares (after the consent prompt for
/// `pendingPermissions`).
#[tauri::command]
pub fn plugin_grant_permissions(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, MetadeaDb>,
    id: String,
) -> Result<(), String> {
    let root = plugins_root(&app_handle)?;
    let conn = state.conn.lock().str_err()?;
    let row = store::require(&conn, &id)?;
    let manifest = read_manifest_in(&plugin_version_dir(&root, &row.id, &row.version)?, Some((&row.id, &row.version)))?;
    store::set_granted(&conn, &id, &manifest::permission_tokens(&manifest.permissions))
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/// The row and manifest of a plugin that may run: enabled, loadable and
/// with every declared permission granted.
fn runnable(app: &tauri::AppHandle, db: &MetadeaDb, id: &str) -> Result<(PathBuf, store::PluginRow, PluginManifest), String> {
    let root = plugins_root(app)?;
    let row = {
        let conn = db.conn.lock().str_err()?;
        store::require(&conn, id)?
    };
    if !row.enabled {
        return Err(with_detail(error_codes::PLUGIN_DISABLED, id));
    }
    let dir = plugin_version_dir(&root, &row.id, &row.version)?;
    let manifest = read_manifest_in(&dir, Some((&row.id, &row.version)))?;
    let pending = manifest::permission_escalation(&row.granted, &manifest::permission_tokens(&manifest.permissions));
    if !pending.is_empty() {
        return Err(with_detail(error_codes::PLUGIN_CONSENT_REQUIRED, pending.join(", ")));
    }
    Ok((dir, row, manifest))
}

#[tauri::command]
pub fn plugin_set_enabled(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, MetadeaDb>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    {
        let conn = state.conn.lock().str_err()?;
        store::set_enabled(&conn, &id, enabled)?;
    }
    if enabled {
        // Refuse (and roll back) enabling a plugin that could not run.
        if let Err(error) = runnable(&app_handle, &state, &id) {
            let conn = state.conn.lock().str_err()?;
            store::set_enabled(&conn, &id, false)?;
            return Err(error);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_uninstall(app_handle: tauri::AppHandle, state: tauri::State<'_, MetadeaDb>, id: String) -> Result<(), String> {
    if !manifest::is_valid_plugin_id(&id) {
        return Err(with_detail(error_codes::PLUGIN_NOT_FOUND, id));
    }
    let root = plugins_root(&app_handle)?;
    {
        let conn = state.conn.lock().str_err()?;
        store::require(&conn, &id)?;
        store::delete(&conn, &id)?;
    }
    let dir = root.join(&id);
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(io_err)?;
    }
    if let Ok(cache) = app_handle.path().app_cache_dir() {
        std::fs::remove_dir_all(cache.join("plugin-downloads").join(&id)).ok();
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub source: String,
    pub manifest: PluginManifest,
    pub settings: Map<String, Value>,
}

/// JS source for the plugin's worker, with its manifest and effective
/// settings. Refused for a disabled plugin or one with pending permissions.
#[tauri::command]
pub fn plugin_read_entry(app_handle: tauri::AppHandle, state: tauri::State<'_, MetadeaDb>, id: String) -> Result<PluginEntry, String> {
    let (dir, row, manifest) = runnable(&app_handle, &state, &id)?;
    let main = package_file(&dir, &manifest.main)?;
    if std::fs::metadata(&main).map_err(io_err)?.len() > MAX_ENTRY_BYTES {
        return Err(with_detail(error_codes::PLUGIN_PACKAGE_TOO_LARGE, "entry script larger than 5 MB"));
    }
    let source = std::fs::read_to_string(&main).map_err(|e| with_detail(error_codes::PLUGIN_PACKAGE_INVALID, e))?;
    let settings = settings::effective_values(&manifest.settings, &row.settings, crate::utils::decrypt_secret);
    Ok(PluginEntry { source, manifest, settings })
}

#[tauri::command]
pub fn plugin_open_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let root = plugins_root(&app_handle)?;
    crate::folders::open_directory_in_file_manager(&root).map_err(|e| with_detail(error_codes::PLUGIN_OPEN_FOLDER, e))
}

// ── Settings ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingsView {
    /// Effective values; secrets only when asked for (the worker).
    pub values: Map<String, Value>,
    /// Secret keys that hold a value.
    pub secrets_set: Vec<String>,
}

fn installed_manifest(app: &tauri::AppHandle, row: &store::PluginRow) -> Result<PluginManifest, String> {
    let root = plugins_root(app)?;
    read_manifest_in(&plugin_version_dir(&root, &row.id, &row.version)?, Some((&row.id, &row.version)))
}

#[tauri::command]
pub fn plugin_get_settings(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, MetadeaDb>,
    id: String,
    include_secrets: Option<bool>,
) -> Result<PluginSettingsView, String> {
    let row = {
        let conn = state.conn.lock().str_err()?;
        store::require(&conn, &id)?
    };
    let manifest = installed_manifest(&app_handle, &row)?;
    let mut values = settings::effective_values(&manifest.settings, &row.settings, crate::utils::decrypt_secret);
    if !include_secrets.unwrap_or(false) {
        for field in manifest.settings.iter().filter(|f| f.kind == manifest::SettingType::Secret) {
            values.remove(&field.key);
        }
    }
    Ok(PluginSettingsView { values, secrets_set: settings::stored_secret_keys(&manifest.settings, &row.settings) })
}

#[tauri::command]
pub fn plugin_set_settings(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, MetadeaDb>,
    id: String,
    values: Map<String, Value>,
) -> Result<(), String> {
    let row = {
        let conn = state.conn.lock().str_err()?;
        store::require(&conn, &id)?
    };
    let manifest = installed_manifest(&app_handle, &row)?;
    let validated = settings::validate_input(&manifest.settings, &values)
        .map_err(|e| with_detail(error_codes::PLUGIN_SETTINGS_INVALID, e))?;
    let stored = settings::merge_for_storage(&manifest.settings, &values, validated, &row.settings, crate::utils::encrypt_secret)
        .map_err(|e| with_detail(error_codes::PLUGIN_SETTINGS_INVALID, e))?;
    let conn = state.conn.lock().str_err()?;
    store::set_settings(&conn, &id, &stored)
}

// ── Network ───────────────────────────────────────────────────────────────────

/// Granted host patterns that the current manifest still declares, plus the
/// host of every granted `settingsHosts` URL the user filled in.
fn allowlist(row: &store::PluginRow, manifest: &PluginManifest) -> Vec<HostPattern> {
    let mut out = Vec::new();
    for host in &manifest.permissions.hosts {
        if row.granted.contains(&format!("host:{}", host.to_ascii_lowercase())) {
            if let Ok(pattern) = HostPattern::parse(host) {
                out.push(pattern);
            }
        }
    }
    let values = settings::effective_values(&manifest.settings, &row.settings, |_| Err(String::new()));
    for key in &manifest.permissions.settings_hosts {
        if !row.granted.contains(&format!("settingsHost:{key}")) {
            continue;
        }
        let url = values.get(key).and_then(Value::as_str).and_then(|u| reqwest::Url::parse(u).ok());
        if let Some(pattern) = url.as_ref().and_then(HostPattern::exact_for_url) {
            out.push(pattern);
        }
    }
    out
}

#[tauri::command]
pub async fn plugin_http_fetch(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, MetadeaDb>,
    id: String,
    request: http::PluginHttpRequest,
) -> Result<http::PluginHttpResponse, String> {
    let (_, row, manifest) = runnable(&app_handle, &state, &id)?;
    http::fetch(request, allowlist(&row, &manifest)).await
}

/// Downloads a chapter archive (cbz/zip/epub/pdf) into the app cache for
/// the reader and returns its path. Same checks as `plugin_http_fetch`.
#[tauri::command]
pub async fn plugin_http_download(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, MetadeaDb>,
    id: String,
    request: http::PluginHttpRequest,
    extension: String,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let (_, row, manifest) = runnable(&app_handle, &state, &id)?;
    let extension = extension.to_ascii_lowercase();
    if !DOWNLOAD_EXTENSIONS.contains(&extension.as_str()) {
        return Err(with_detail(error_codes::PLUGIN_HTTP_REQUEST_INVALID, format!("extension {extension}")));
    }
    let dir = app_handle.path().app_cache_dir().map_err(io_err)?.join("plugin-downloads").join(&row.id);
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let stale = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|m| SystemTime::now().duration_since(m).ok())
                .is_some_and(|age| age > DOWNLOAD_CACHE_TTL);
            if stale {
                std::fs::remove_file(entry.path()).ok();
            }
        }
    }
    let digest = Sha256::digest(format!("{} {}", request.method.as_deref().unwrap_or("GET"), request.url).as_bytes());
    let name: String = digest.iter().take(16).map(|b| format!("{b:02x}")).collect();
    let dest = dir.join(format!("{name}.{extension}"));
    if !dest.is_file() {
        http::download(request, allowlist(&row, &manifest), &dest).await?;
    }
    Ok(dest.to_string_lossy().to_string())
}

// ── metadea.storage ───────────────────────────────────────────────────────────

fn require_installed(db: &MetadeaDb, id: &str) -> Result<(), String> {
    let conn = db.conn.lock().str_err()?;
    store::require(&conn, id).map(|_| ())
}

#[tauri::command]
pub fn plugin_storage_get(state: tauri::State<'_, MetadeaDb>, id: String, key: String) -> Result<Option<String>, String> {
    require_installed(&state, &id)?;
    let conn = state.conn.lock().str_err()?;
    store::storage_get(&conn, &id, &key)
}

#[tauri::command]
pub fn plugin_storage_set(
    state: tauri::State<'_, MetadeaDb>,
    id: String,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    require_installed(&state, &id)?;
    let conn = state.conn.lock().str_err()?;
    store::storage_set(&conn, &id, &key, value.as_deref(), now_secs())
}

// ── Work links ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn plugin_get_work_link(state: tauri::State<'_, MetadeaDb>, external_id: String) -> Result<Option<store::WorkLink>, String> {
    let conn = state.conn.lock().str_err()?;
    store::work_link_get(&conn, &external_id)
}

#[tauri::command]
pub fn plugin_set_work_link(
    state: tauri::State<'_, MetadeaDb>,
    external_id: String,
    link: Option<store::WorkLink>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    if let Some(link) = &link {
        store::require(&conn, &link.plugin_id)?;
        if link.item_id.len() > 1024 || link.item_title.len() > 1024 || link.source_id.len() > 64 {
            return Err(with_detail(error_codes::PLUGIN_SETTINGS_INVALID, "work link too long"));
        }
    }
    store::work_link_set(&conn, &external_id, link.as_ref(), now_secs())
}

/// Removes staging leftovers from a previous run (called once at startup).
pub fn clean_staging(app: &tauri::AppHandle) {
    if let Ok(root) = plugins_root(app) {
        std::fs::remove_dir_all(root.join(STAGING_DIR_NAME)).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use package::tests::{temp_dir, zip_of};

    const HELLO_MANIFEST: &str = include_str!("../../../../plugins/examples/hello-source/manifest.json");

    fn manifest_with(hosts: &[&str], capabilities: &[&str], version: &str) -> String {
        let mut value: Value = serde_json::from_str(HELLO_MANIFEST).unwrap();
        value["version"] = Value::String(version.into());
        value["permissions"]["hosts"] = serde_json::json!(hosts);
        value["permissions"]["capabilities"] = serde_json::json!(capabilities);
        value.to_string()
    }

    #[test]
    fn update_that_asks_for_more_needs_consent_again() {
        let db = MetadeaDb::open_in_memory().unwrap();
        let v1 = manifest::parse_manifest(&manifest_with(&["api.example.com"], &[], "1.0.0")).unwrap();
        let dir = temp_dir("preview");

        let fresh = build_preview("t".into(), &dir, v1.clone(), None);
        assert!(fresh.needs_consent, "a fresh install always asks");
        assert_eq!(fresh.new_permissions, vec!["host:api.example.com".to_string()]);

        {
            let conn = db.conn.lock().unwrap();
            store::upsert_install(&conn, &v1.id, &v1.version, &manifest::permission_tokens(&v1.permissions), 1).unwrap();
        }
        let row = || store::require(&db.conn.lock().unwrap(), &v1.id).unwrap();

        let same = manifest::parse_manifest(&manifest_with(&["api.example.com"], &[], "1.0.1")).unwrap();
        let preview = build_preview("t".into(), &dir, same, Some(row()));
        assert!(!preview.needs_consent, "same permissions: silent update");

        let fewer = manifest::parse_manifest(&manifest_with(&[], &[], "1.0.2")).unwrap();
        assert!(!build_preview("t".into(), &dir, fewer, Some(row())).needs_consent);

        let more = manifest::parse_manifest(&manifest_with(&["api.example.com", "cdn.example.com"], &["notifications"], "1.1.0")).unwrap();
        let preview = build_preview("t".into(), &dir, more.clone(), Some(row()));
        assert!(preview.needs_consent);
        assert_eq!(preview.new_permissions, vec!["cap:notifications".to_string(), "host:cdn.example.com".to_string()]);
        assert_eq!(preview.previous.unwrap().version, "1.0.0");

        // A package edited on disk to ask for more is not runnable until granted.
        let pending = manifest::permission_escalation(&row().granted, &manifest::permission_tokens(&more.permissions));
        assert_eq!(pending.len(), 2);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn allowlist_uses_only_granted_and_declared_hosts() {
        let mut value: Value = serde_json::from_str(HELLO_MANIFEST).unwrap();
        value["permissions"]["hosts"] = serde_json::json!(["api.example.com", "cdn.example.com"]);
        value["settings"] = serde_json::json!([{ "key": "server", "type": "url", "label": "Server" }]);
        value["permissions"]["settingsHosts"] = serde_json::json!(["server"]);
        let manifest = manifest::parse_manifest(&value.to_string()).unwrap();
        let mut settings = Map::new();
        settings.insert("server".into(), Value::String("http://192.168.1.20:4567".into()));
        let row = store::PluginRow {
            id: manifest.id.clone(),
            version: manifest.version.clone(),
            enabled: true,
            installed_at: 0,
            updated_at: 0,
            granted: ["host:api.example.com".to_string(), "settingsHost:server".to_string()].into_iter().collect(),
            settings,
        };
        let list = allowlist(&row, &manifest);
        let ok = |url: &str| host_rules::check_url(&reqwest::Url::parse(url).unwrap(), &list).is_ok();
        assert!(ok("https://api.example.com/x"));
        assert!(!ok("https://cdn.example.com/x"), "declared but not granted");
        assert!(ok("http://192.168.1.20:4567/api/graphql"), "the user's own server");
        assert!(!ok("http://192.168.1.21:4567/"));
    }

    #[test]
    fn staged_zip_with_a_bad_manifest_is_rejected() {
        let dir = temp_dir("stage");
        package::extract_zip(std::io::Cursor::new(zip_of(&[("manifest.json", b"{\"id\":\"x\"}"), ("main.js", b"")])), &dir).unwrap();
        let error = read_manifest_in(&dir, None).unwrap_err();
        assert!(error.starts_with(error_codes::PLUGIN_MANIFEST_INVALID), "{error}");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn tokens_are_strict_hex() {
        assert!(is_valid_token(&random_token().unwrap()));
        assert!(!is_valid_token("../../etc"));
        assert!(!is_valid_token(&"A".repeat(32)));
    }
}
