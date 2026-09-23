//! User-made UI themes ("skins"), Playnite-style: a folder under
//! `<app_data_dir>/ui_themes/<id>/` with a `theme.json` manifest plus CSS and
//! asset files. Two tiers share one format: a *variables* theme only carries
//! `variables` (design-token overrides the frontend turns into a `:root{}`
//! block) and a *full CSS* theme lists `css` files that may target any
//! selector. See `docs/THEMING.md` for the authoring contract.
//!
//! Not to be confused with `media_themes.rs`, which is anime OP/ED songs.
//!
//! Everything a theme ships is untrusted input rendered inside the webview,
//! so `read_ui_theme_css` sanitises the CSS before it leaves Rust:
//! `@import` is removed, `url()`/`src()` may only reference files inside the
//! theme folder (rewritten to asset-protocol URLs), and the legacy script
//! vectors (`expression(`, `-moz-binding`, `behavior:`, `javascript:`) are
//! neutralised. Total CSS is capped at [`MAX_CSS_BYTES`].
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db::ToStringErr;
use crate::error_codes::{self, with_detail};

pub const THEMES_DIR_NAME: &str = "ui_themes";
const MANIFEST_FILE: &str = "theme.json";
/// Upper bound on the concatenated raw CSS of one theme.
pub const MAX_CSS_BYTES: usize = 2 * 1024 * 1024;
const MAX_ID_LEN: usize = 64;
const MAX_VARIABLE_VALUE_LEN: usize = 512;
/// `app_env` row that remembers the active theme id ('' = none).
const ACTIVE_THEME_ENV_KEY: &str = "ui_theme_active";

const STARTER_ID: &str = "example-midnight";
const STARTER_MANIFEST: &str = include_str!("../../public/ui-themes/example-midnight/theme.json");
const STARTER_CSS: &str = include_str!("../../public/ui-themes/example-midnight/theme.css");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UiThemeManifest {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    /// Design-token overrides, keys with or without the leading `--`.
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
    /// CSS files relative to the theme folder, concatenated in order.
    #[serde(default)]
    pub css: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UiThemeTier {
    Variables,
    Full,
}

impl UiThemeManifest {
    pub fn tier(&self) -> UiThemeTier {
        if self.css.is_empty() { UiThemeTier::Variables } else { UiThemeTier::Full }
    }
}

/// One entry of the themes folder. A folder whose manifest cannot be parsed
/// is still listed (with `error`) so the settings UI can point at it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiThemeSummary {
    pub id: String,
    pub folder: String,
    pub manifest: Option<UiThemeManifest>,
    pub tier: Option<UiThemeTier>,
    /// Absolute path of the preview image (the frontend wraps it with
    /// `wrapAssetUrl`), only when the file exists.
    pub preview_path: Option<String>,
    /// `E_*` code (with detail) when the theme cannot be loaded.
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiThemeCss {
    pub id: String,
    pub tier: UiThemeTier,
    pub variables: BTreeMap<String, String>,
    /// Sanitised, concatenated CSS ('' for a variables-only theme).
    pub css: String,
    /// Newest modification time (ms since epoch) across the manifest and
    /// the CSS files — the dev-loop watcher only re-injects when it changes.
    pub mtime: u64,
}

// ── Ids and paths ─────────────────────────────────────────────────────────────

/// `^[a-z0-9-]+$`, at most 64 chars: safe as a folder name, a CSS attribute
/// value and a URL segment on every platform.
pub fn is_valid_theme_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn themes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| with_detail(error_codes::UI_THEME_IO, e))?
        .join(THEMES_DIR_NAME);
    std::fs::create_dir_all(&dir).map_err(|e| with_detail(error_codes::UI_THEME_IO, e))?;
    Ok(dir)
}

/// A manifest-supplied relative path resolved inside `theme_dir`, or None
/// when it is absolute, escapes the folder or is empty.
fn resolve_inside(theme_dir: &Path, relative: &str) -> Option<PathBuf> {
    let safe = crate::utils::safe_archive_path(Path::new(relative))?;
    Some(theme_dir.join(safe))
}

/// Symlinks inside a theme folder could point anywhere on disk; the file
/// must canonicalise under the themes root to be read.
fn file_inside_themes_root(themes_root: &Path, file: &Path) -> Result<PathBuf, String> {
    let root = themes_root
        .canonicalize()
        .map_err(|e| with_detail(error_codes::UI_THEME_IO, e))?;
    let real = file
        .canonicalize()
        .map_err(|e| with_detail(error_codes::UI_THEME_IO, format!("{}: {e}", file.display())))?;
    if real.starts_with(&root) {
        Ok(real)
    } else {
        Err(with_detail(error_codes::UI_THEME_IO, format!("{} is outside the themes folder", file.display())))
    }
}

// ── Manifest ──────────────────────────────────────────────────────────────────

const VARIABLE_FORBIDDEN: &[&str] = &["url(", "expression(", "javascript:", "@import", "\\"];

fn is_valid_variable_name(name: &str) -> bool {
    let body = name.strip_prefix("--").unwrap_or(name);
    !body.is_empty()
        && body.len() <= MAX_ID_LEN
        && body.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn is_valid_variable_value(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_VARIABLE_VALUE_LEN {
        return false;
    }
    if trimmed.contains([';', '{', '}', '<', '>']) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    !VARIABLE_FORBIDDEN.iter().any(|needle| lower.contains(needle))
}

/// Parses and validates a manifest. `folder_id` is the directory name, which
/// the manifest `id` must match so a theme cannot impersonate another.
pub fn parse_manifest(json: &str, folder_id: &str) -> Result<UiThemeManifest, String> {
    let invalid = |detail: String| with_detail(error_codes::UI_THEME_MANIFEST_INVALID, detail);
    let mut manifest: UiThemeManifest = serde_json::from_str(json).map_err(|e| invalid(e.to_string()))?;

    if !is_valid_theme_id(&manifest.id) {
        return Err(with_detail(error_codes::UI_THEME_INVALID_ID, &manifest.id));
    }
    if manifest.id != folder_id {
        return Err(invalid(format!("id \"{}\" does not match folder \"{folder_id}\"", manifest.id)));
    }
    if manifest.name.trim().is_empty() {
        return Err(invalid("name is empty".into()));
    }
    if manifest.author.trim().is_empty() {
        return Err(invalid("author is empty".into()));
    }
    if manifest.version.trim().is_empty() {
        return Err(invalid("version is empty".into()));
    }
    for file in &manifest.css {
        let safe = crate::utils::safe_archive_path(Path::new(file));
        let is_css = Path::new(file).extension().is_some_and(|ext| ext.eq_ignore_ascii_case("css"));
        if safe.is_none() || !is_css {
            return Err(invalid(format!("css entry \"{file}\" must be a relative .css path inside the theme folder")));
        }
    }
    if let Some(preview) = &manifest.preview {
        let ok_ext = Path::new(preview)
            .extension()
            .is_some_and(|ext| ["png", "jpg", "jpeg", "webp", "gif"].iter().any(|e| ext.eq_ignore_ascii_case(e)));
        if crate::utils::safe_archive_path(Path::new(preview)).is_none() || !ok_ext {
            return Err(invalid(format!("preview \"{preview}\" must be a relative image path inside the theme folder")));
        }
    }
    let mut variables = BTreeMap::new();
    for (name, value) in std::mem::take(&mut manifest.variables) {
        if !is_valid_variable_name(&name) {
            return Err(invalid(format!("variable name \"{name}\" is not a valid custom property")));
        }
        if !is_valid_variable_value(&value) {
            return Err(invalid(format!("variable \"{name}\" has an invalid value")));
        }
        let key = if name.starts_with("--") { name } else { format!("--{name}") };
        variables.insert(key, value.trim().to_string());
    }
    manifest.variables = variables;
    Ok(manifest)
}

fn read_manifest(theme_dir: &Path, folder_id: &str) -> Result<UiThemeManifest, String> {
    let path = theme_dir.join(MANIFEST_FILE);
    if !path.is_file() {
        return Err(with_detail(error_codes::UI_THEME_MANIFEST_INVALID, format!("{MANIFEST_FILE} is missing")));
    }
    let json = std::fs::read_to_string(&path).map_err(|e| with_detail(error_codes::UI_THEME_IO, e))?;
    parse_manifest(&json, folder_id)
}

fn summarize(theme_dir: &Path, folder_id: &str) -> UiThemeSummary {
    let folder = theme_dir.to_string_lossy().to_string();
    if !is_valid_theme_id(folder_id) {
        return UiThemeSummary {
            id: folder_id.to_string(),
            folder,
            manifest: None,
            tier: None,
            preview_path: None,
            error: Some(with_detail(error_codes::UI_THEME_INVALID_ID, folder_id)),
        };
    }
    match read_manifest(theme_dir, folder_id) {
        Ok(manifest) => {
            let preview_path = manifest
                .preview
                .as_deref()
                .and_then(|p| resolve_inside(theme_dir, p))
                .filter(|p| p.is_file())
                .map(|p| p.to_string_lossy().to_string());
            UiThemeSummary {
                id: manifest.id.clone(),
                folder,
                tier: Some(manifest.tier()),
                preview_path,
                manifest: Some(manifest),
                error: None,
            }
        }
        Err(error) => UiThemeSummary {
            id: folder_id.to_string(),
            folder,
            manifest: None,
            tier: None,
            preview_path: None,
            error: Some(error),
        },
    }
}

pub fn list_themes_in(themes_root: &Path) -> Result<Vec<UiThemeSummary>, String> {
    let mut out = Vec::new();
    let entries = std::fs::read_dir(themes_root).map_err(|e| with_detail(error_codes::UI_THEME_IO, e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(folder_id) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else { continue };
        if folder_id.starts_with('.') {
            continue;
        }
        out.push(summarize(&path, &folder_id));
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

// ── CSS sanitiser ─────────────────────────────────────────────────────────────

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b'_'
}

/// Case-insensitive `find` on ASCII needles.
fn find_ci(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&i| hay[i..i + needle.len()].eq_ignore_ascii_case(needle))
}

fn replace_ci(input: &str, needle: &str, replacement: &str) -> String {
    let hay = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(at) = find_ci(hay, needle.as_bytes(), cursor) {
        out.push_str(&input[cursor..at]);
        out.push_str(replacement);
        cursor = at + needle.len();
    }
    out.push_str(&input[cursor..]);
    out
}

/// Removes `/* … */` comments so nothing below can be hidden inside one.
fn strip_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// CSS escapes can spell any identifier (`\75rl(` is `url(`). ASCII letters,
/// digits and the few punctuation marks the scanner keys on never need
/// escaping in legitimate CSS, so they are decoded before scanning; every
/// other escape (`\201C`, `\e900` icon glyphs…) is left untouched.
fn decode_ascii_escapes(css: &str) -> String {
    let bytes = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut i = 0;
    while i < css.len() {
        if bytes[i] != b'\\' || i + 1 >= css.len() {
            let ch = css[i..].chars().next().unwrap_or('\\');
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        let mut j = i + 1;
        while j < css.len() && j - (i + 1) < 6 && bytes[j].is_ascii_hexdigit() {
            j += 1;
        }
        let decoded = if j > i + 1 {
            let code = u32::from_str_radix(&css[i + 1..j], 16).ok().and_then(char::from_u32);
            // One optional whitespace terminates a hex escape.
            if j < css.len() && (bytes[j] == b' ' || bytes[j] == b'\t' || bytes[j] == b'\n') {
                j += 1;
            }
            code
        } else {
            let ch = css[i + 1..].chars().next();
            j = i + 1 + ch.map_or(0, char::len_utf8);
            ch
        };
        match decoded {
            Some(ch) if ch.is_ascii_alphanumeric() || matches!(ch, '(' | ':' | '@' | '-' | '/' | '<') => {
                out.push(ch);
                i = j;
            }
            _ => {
                out.push_str(&css[i..j]);
                i = j;
            }
        }
    }
    out
}

/// Drops every `@import …;` statement (case-insensitive).
fn strip_at_imports(css: &str) -> String {
    let hay = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut cursor = 0;
    while let Some(at) = find_ci(hay, b"@import", cursor) {
        out.push_str(&css[cursor..at]);
        cursor = match css[at..].find(';') {
            Some(end) => at + end + 1,
            None => css.len(),
        };
    }
    out.push_str(&css[cursor..]);
    out
}

fn has_scheme(target: &str) -> bool {
    let bytes = target.as_bytes();
    if bytes.is_empty() || !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    bytes
        .iter()
        .position(|&b| b == b':')
        .is_some_and(|colon| bytes[..colon].iter().all(|&b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'.' | b'-')))
}

/// A `url()` argument that names a file inside the theme folder, or None
/// for anything else (remote, absolute, data:, javascript:, fragment…).
pub fn resolve_relative_asset(target: &str, theme_dir: &Path) -> Option<PathBuf> {
    let target = target.trim();
    let target = target.split(['?', '#']).next().unwrap_or("");
    if target.is_empty() || has_scheme(target) || target.starts_with(['/', '\\', '#']) {
        return None;
    }
    resolve_inside(theme_dir, target)
}

/// `encodeURIComponent` — Tauri's `convertFileSrc` encodes the whole path.
pub fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Same URL `convertFileSrc` (lib/tauri/bridge.ts → wrapAssetUrl) produces
/// for a path: `http://asset.localhost/<path>` on Windows and Android,
/// `asset://localhost/<path>` elsewhere.
pub fn asset_url_for(path: &Path) -> String {
    let encoded = encode_uri_component(&path.to_string_lossy());
    if cfg!(any(windows, target_os = "android")) {
        format!("http://asset.localhost/{encoded}")
    } else {
        format!("asset://localhost/{encoded}")
    }
}

/// Rewrites every `url(...)` / `src(...)`: in-folder files become asset URLs
/// (through `resolve`), everything else becomes `none`.
fn rewrite_url_functions(css: &str, resolve: &dyn Fn(&str) -> Option<String>) -> String {
    let hay = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut cursor = 0;
    let mut i = 0;
    while i + 4 <= hay.len() {
        let token = &hay[i..i + 4];
        let is_fn = token.eq_ignore_ascii_case(b"url(") || token.eq_ignore_ascii_case(b"src(");
        if !is_fn || (i > 0 && is_ident_byte(hay[i - 1])) {
            i += 1;
            continue;
        }
        // Find the closing paren, honouring quotes.
        let mut j = i + 4;
        let mut quote: Option<u8> = None;
        let mut close = None;
        while j < hay.len() {
            let b = hay[j];
            match quote {
                Some(q) if b == q => quote = None,
                Some(_) => {}
                None if b == b'"' || b == b'\'' => quote = Some(b),
                None if b == b')' => {
                    close = Some(j);
                    break;
                }
                None => {}
            }
            j += 1;
        }
        let Some(close) = close else {
            // Unterminated: drop the rest of the sheet rather than guess.
            out.push_str(&css[cursor..i]);
            return out;
        };
        let raw = css[i + 4..close].trim();
        let unquoted = raw
            .strip_prefix('"')
            .and_then(|s| s.strip_suffix('"'))
            .or_else(|| raw.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
            .unwrap_or(raw);
        out.push_str(&css[cursor..i]);
        match resolve(unquoted) {
            Some(url) => {
                let name = std::str::from_utf8(&hay[i..i + 3]).unwrap_or("url").to_ascii_lowercase();
                out.push_str(&format!("{name}(\"{}\")", url.replace('"', "%22")));
            }
            None => out.push_str("none"),
        }
        cursor = close + 1;
        i = close + 1;
    }
    out.push_str(&css[cursor..]);
    out
}

/// Every rule in one place; `docs/THEMING.md` → "Sanitisation" mirrors it.
pub fn sanitize_css(css: &str, theme_dir: &Path, to_asset_url: &dyn Fn(&Path) -> String) -> String {
    let stripped = strip_comments(css);
    let decoded = decode_ascii_escapes(&stripped);
    let without_imports = strip_at_imports(&decoded);
    let resolve = |target: &str| resolve_relative_asset(target, theme_dir).map(|p| to_asset_url(&p));
    let rewritten = rewrite_url_functions(&without_imports, &resolve);
    let mut out = rewritten;
    for (needle, replacement) in [
        ("expression(", "blocked("),
        ("-moz-binding", "-blocked-binding"),
        ("behavior:", "-blocked-behavior-:"),
        ("javascript:", "blocked:"),
        ("vbscript:", "blocked:"),
        ("</style", ""),
    ] {
        out = replace_ci(&out, needle, replacement);
    }
    out
}

fn newest_mtime_ms(paths: &[PathBuf]) -> u64 {
    paths
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok()?.modified().ok())
        .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .max()
        .unwrap_or(0)
}

/// Loads, bounds and sanitises one theme's CSS. Pure over `themes_root` so
/// the tests can point it at a temporary folder.
pub fn read_theme_css_in(themes_root: &Path, id: &str) -> Result<UiThemeCss, String> {
    if !is_valid_theme_id(id) {
        return Err(with_detail(error_codes::UI_THEME_INVALID_ID, id));
    }
    let theme_dir = themes_root.join(id);
    if !theme_dir.is_dir() {
        return Err(with_detail(error_codes::UI_THEME_NOT_FOUND, id));
    }
    let manifest = read_manifest(&theme_dir, id)?;

    let mut raw = String::new();
    let mut total = 0usize;
    let mut touched = vec![theme_dir.join(MANIFEST_FILE)];
    for file in &manifest.css {
        // Validated by parse_manifest; resolve_inside cannot fail here.
        let Some(path) = resolve_inside(&theme_dir, file) else { continue };
        let real = file_inside_themes_root(themes_root, &path)?;
        let bytes = std::fs::read(&real).map_err(|e| with_detail(error_codes::UI_THEME_IO, format!("{file}: {e}")))?;
        total += bytes.len();
        if total > MAX_CSS_BYTES {
            return Err(with_detail(error_codes::UI_THEME_CSS_TOO_LARGE, format!("{total} bytes > {MAX_CSS_BYTES}")));
        }
        raw.push_str(&String::from_utf8_lossy(&bytes));
        raw.push('\n');
        touched.push(real);
    }
    let css = if raw.is_empty() { String::new() } else { sanitize_css(&raw, &theme_dir, &asset_url_for) };
    Ok(UiThemeCss {
        id: manifest.id.clone(),
        tier: manifest.tier(),
        variables: manifest.variables,
        css,
        mtime: newest_mtime_ms(&touched),
    })
}

// ── Starter theme ─────────────────────────────────────────────────────────────

/// Copies the bundled example theme into `themes_root` under a free id
/// (`example-midnight`, then `example-midnight-2`, …) and returns that id.
pub fn export_starter_in(themes_root: &Path) -> Result<String, String> {
    let io = |e: std::io::Error| with_detail(error_codes::UI_THEME_IO, e);
    let mut id = STARTER_ID.to_string();
    let mut n = 1;
    while themes_root.join(&id).exists() {
        n += 1;
        id = format!("{STARTER_ID}-{n}");
    }
    let mut manifest = parse_manifest(STARTER_MANIFEST, STARTER_ID)?;
    manifest.id = id.clone();
    if n > 1 {
        manifest.name = format!("{} {n}", manifest.name);
    }
    let dir = themes_root.join(&id);
    std::fs::create_dir_all(&dir).map_err(io)?;
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| with_detail(error_codes::UI_THEME_IO, e))?;
    std::fs::write(dir.join(MANIFEST_FILE), json + "\n").map_err(io)?;
    std::fs::write(dir.join("theme.css"), STARTER_CSS.replace(STARTER_ID, &id)).map_err(io)?;
    Ok(id)
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_ui_themes(app_handle: tauri::AppHandle) -> Result<Vec<UiThemeSummary>, String> {
    let root = themes_dir(&app_handle)?;
    list_themes_in(&root)
}

#[tauri::command]
pub async fn read_ui_theme_css(app_handle: tauri::AppHandle, id: String) -> Result<UiThemeCss, String> {
    let root = themes_dir(&app_handle)?;
    read_theme_css_in(&root, &id)
}

#[tauri::command]
pub async fn get_active_ui_theme(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let db = app_handle.state::<crate::db::MetadeaDb>();
    let conn = db.conn.lock().str_err()?;
    let value: Option<String> = conn
        .query_row("SELECT value FROM app_env WHERE name = ?1", [ACTIVE_THEME_ENV_KEY], |r| r.get(0))
        .ok();
    Ok(value.filter(|v| is_valid_theme_id(v)))
}

#[tauri::command]
pub async fn set_active_ui_theme(app_handle: tauri::AppHandle, id: Option<String>) -> Result<(), String> {
    let value = match id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(id) => {
            if !is_valid_theme_id(id) {
                return Err(with_detail(error_codes::UI_THEME_INVALID_ID, id));
            }
            if !themes_dir(&app_handle)?.join(id).is_dir() {
                return Err(with_detail(error_codes::UI_THEME_NOT_FOUND, id));
            }
            id.to_string()
        }
        None => String::new(),
    };
    let db = app_handle.state::<crate::db::MetadeaDb>();
    let conn = db.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO app_env (name, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![ACTIVE_THEME_ENV_KEY, value, chrono::Utc::now().to_rfc3339()],
    )
    .str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn open_ui_themes_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let root = themes_dir(&app_handle)?;
    crate::folders::open_directory_in_file_manager(&root).map_err(|e| with_detail(error_codes::UI_THEME_OPEN_FOLDER, e))
}

#[tauri::command]
pub async fn export_ui_theme_starter(app_handle: tauri::AppHandle) -> Result<String, String> {
    let root = themes_dir(&app_handle)?;
    export_starter_in(&root)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("metadea-ui-themes-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).expect("temp root");
        dir
    }

    fn write_theme(root: &Path, id: &str, manifest: &str, css: Option<&str>) -> PathBuf {
        let dir = root.join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(MANIFEST_FILE), manifest).unwrap();
        if let Some(css) = css {
            std::fs::write(dir.join("theme.css"), css).unwrap();
        }
        dir
    }

    fn fake_asset_url(path: &Path) -> String {
        format!("asset://{}", path.to_string_lossy().replace('\\', "/"))
    }

    const MINIMAL: &str = r##"{"id":"my-skin","name":"My skin","author":"me","version":"1.0"}"##;

    // ── ids ──

    #[test]
    fn id_rules() {
        assert!(is_valid_theme_id("midnight-2"));
        assert!(is_valid_theme_id("a"));
        assert!(!is_valid_theme_id(""));
        assert!(!is_valid_theme_id("Midnight"));
        assert!(!is_valid_theme_id("my_skin"));
        assert!(!is_valid_theme_id("../etc"));
        assert!(!is_valid_theme_id("a b"));
        assert!(!is_valid_theme_id(&"x".repeat(65)));
    }

    // ── manifest ──

    #[test]
    fn parses_a_minimal_manifest_as_variables_tier() {
        let m = parse_manifest(MINIMAL, "my-skin").unwrap();
        assert_eq!(m.id, "my-skin");
        assert_eq!(m.tier(), UiThemeTier::Variables);
        assert!(m.css.is_empty());
    }

    #[test]
    fn manifest_id_must_match_folder() {
        let err = parse_manifest(MINIMAL, "other").unwrap_err();
        assert!(err.starts_with(error_codes::UI_THEME_MANIFEST_INVALID));
    }

    #[test]
    fn manifest_rejects_bad_id_and_missing_fields() {
        let err = parse_manifest(r##"{"id":"Bad Id","name":"x","author":"a","version":"1"}"##, "Bad Id").unwrap_err();
        assert!(err.starts_with(error_codes::UI_THEME_INVALID_ID));
        let err = parse_manifest(r##"{"id":"x","name":"x"}"##, "x").unwrap_err();
        assert!(err.starts_with(error_codes::UI_THEME_MANIFEST_INVALID));
        let err = parse_manifest("not json", "x").unwrap_err();
        assert!(err.starts_with(error_codes::UI_THEME_MANIFEST_INVALID));
    }

    #[test]
    fn manifest_rejects_css_paths_outside_the_folder() {
        for bad in ["../evil.css", "/abs.css", "C:\\x.css", "notcss.txt"] {
            let json = format!(r##"{{"id":"x","name":"x","author":"a","version":"1","css":["{}"]}}"##, bad.replace('\\', "\\\\"));
            let err = parse_manifest(&json, "x").unwrap_err();
            assert!(err.starts_with(error_codes::UI_THEME_MANIFEST_INVALID), "{bad}: {err}");
        }
        let ok = parse_manifest(r##"{"id":"x","name":"x","author":"a","version":"1","css":["sub/a.css","b.CSS"]}"##, "x").unwrap();
        assert_eq!(ok.tier(), UiThemeTier::Full);
    }

    #[test]
    fn manifest_normalises_and_validates_variables() {
        let json = r##"{"id":"x","name":"x","author":"a","version":"1",
            "variables":{"accent":"#fff","--bg-card":" #111 "}}"##;
        let m = parse_manifest(json, "x").unwrap();
        assert_eq!(m.variables.get("--accent").map(String::as_str), Some("#fff"));
        assert_eq!(m.variables.get("--bg-card").map(String::as_str), Some("#111"));

        for bad in ["url(http://x)", "red; color: blue", "expression(1)", "a}b{", "JAVASCRIPT:x", "\\75rl(x)"] {
            let json = format!(r##"{{"id":"x","name":"x","author":"a","version":"1","variables":{{"accent":"{}"}}}}"##, bad.replace('\\', "\\\\"));
            assert!(parse_manifest(&json, "x").is_err(), "{bad} should be rejected");
        }
        let json = r##"{"id":"x","name":"x","author":"a","version":"1","variables":{"bad name":"#fff"}}"##;
        assert!(parse_manifest(json, "x").is_err());
    }

    // ── sanitiser ──

    #[test]
    fn strips_at_import_in_any_case_and_inside_comments() {
        let dir = Path::new("/themes/x");
        let out = sanitize_css("@IMPORT url(http://evil/a.css); a{color:red} /* @import 'b' */ @import \"c.css\";", dir, &fake_asset_url);
        assert!(!out.to_ascii_lowercase().contains("@import"), "{out}");
        assert!(out.contains("a{color:red}"));
    }

    #[test]
    fn strips_remote_absolute_data_and_javascript_urls() {
        let dir = Path::new("/themes/x");
        let css = "a{background:url(https://evil/x.png)} b{background:url('//evil/x')} c{background:url(\"/etc/passwd\")} \
                   d{background:url(data:image/png;base64,AAAA)} e{background:url(javascript:alert(1))} f{background:url(../other/x.png)}";
        let out = sanitize_css(css, dir, &fake_asset_url);
        assert!(!out.contains("evil"), "{out}");
        assert!(!out.contains("passwd"));
        assert!(!out.contains("data:"));
        assert!(!out.to_ascii_lowercase().contains("javascript"));
        assert!(!out.contains("other/x.png"));
        assert_eq!(out.matches("none").count(), 6, "{out}");
    }

    #[test]
    fn rewrites_relative_urls_to_asset_urls_inside_the_theme_folder() {
        let dir = Path::new("/themes/x");
        let out = sanitize_css("a{background:url( 'img/bg.png?v=2' )} @font-face{src:url(fonts/a.woff2) format(\"woff2\")}", dir, &fake_asset_url);
        assert!(out.contains("url(\"asset:///themes/x/img/bg.png\")"), "{out}");
        assert!(out.contains("url(\"asset:///themes/x/fonts/a.woff2\") format(\"woff2\")"), "{out}");
    }

    #[test]
    fn neutralises_legacy_script_vectors_and_escaped_spellings() {
        let dir = Path::new("/themes/x");
        let css = "a{width:expression(alert(1));-moz-binding:url(x.xml);behavior:url(x.htc)} \
                   b{background:\\75rl(http://evil)} c{x:JavaScript:1} d{content:'</style><script>'}";
        let out = sanitize_css(css, dir, &fake_asset_url);
        let lower = out.to_ascii_lowercase();
        assert!(!lower.contains("expression("), "{out}");
        assert!(!lower.contains("-moz-binding"));
        assert!(!lower.contains("behavior:"));
        assert!(!lower.contains("javascript:"));
        assert!(!lower.contains("evil"));
        assert!(!lower.contains("</style"));
    }

    #[test]
    fn leaves_non_ascii_escapes_and_plain_rules_alone() {
        let dir = Path::new("/themes/x");
        let css = ".icon::before{content:'\\e900'} .q::after{content:\"\\201C\"} .ok{color:var(--accent);transition:all var(--anim-fast)}";
        let out = sanitize_css(css, dir, &fake_asset_url);
        assert!(out.contains("\\e900"));
        assert!(out.contains("\\201C"));
        assert!(out.contains("var(--accent)"));
    }

    #[test]
    fn encode_uri_component_matches_javascript() {
        assert_eq!(encode_uri_component("C:\\Users\\a b\\é.png"), "C%3A%5CUsers%5Ca%20b%5C%C3%A9.png");
        assert_eq!(encode_uri_component("/themes/x/a-b_c.png"), "%2Fthemes%2Fx%2Fa-b_c.png");
    }

    // ── filesystem paths ──

    #[test]
    fn lists_valid_and_broken_themes_side_by_side() {
        let root = temp_root("list");
        write_theme(&root, "my-skin", MINIMAL, None);
        write_theme(&root, "broken", "{ nope", None);
        write_theme(&root, "Bad_Id", MINIMAL, None);
        std::fs::create_dir_all(root.join("no-manifest")).unwrap();
        std::fs::write(root.join("stray.txt"), "x").unwrap();

        let list = list_themes_in(&root).unwrap();
        let ids: Vec<&str> = list.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["Bad_Id", "broken", "my-skin", "no-manifest"]);
        assert!(list[0].error.as_deref().unwrap().starts_with(error_codes::UI_THEME_INVALID_ID));
        assert!(list[1].error.as_deref().unwrap().starts_with(error_codes::UI_THEME_MANIFEST_INVALID));
        assert!(list[2].error.is_none());
        assert_eq!(list[2].tier, Some(UiThemeTier::Variables));
        assert!(list[3].error.as_deref().unwrap().starts_with(error_codes::UI_THEME_MANIFEST_INVALID));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reads_concatenates_and_sanitises_css_with_mtime() {
        let root = temp_root("read");
        let dir = write_theme(
            &root,
            "my-skin",
            r##"{"id":"my-skin","name":"x","author":"a","version":"1","css":["theme.css","extra/more.css"],"variables":{"accent":"#abc"}}"##,
            Some("@import 'x'; a{background:url(bg.png)}"),
        );
        std::fs::create_dir_all(dir.join("extra")).unwrap();
        std::fs::write(dir.join("extra/more.css"), "b{color:red}").unwrap();

        let out = read_theme_css_in(&root, "my-skin").unwrap();
        assert_eq!(out.tier, UiThemeTier::Full);
        assert_eq!(out.variables.get("--accent").map(String::as_str), Some("#abc"));
        assert!(!out.css.contains("@import"));
        assert!(out.css.contains("asset"), "{}", out.css);
        assert!(out.css.contains("bg.png"));
        assert!(out.css.contains("b{color:red}"));
        assert!(out.mtime > 0);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_rejects_unknown_ids_and_traversal() {
        let root = temp_root("traversal");
        write_theme(&root, "my-skin", MINIMAL, None);
        assert!(read_theme_css_in(&root, "missing").unwrap_err().starts_with(error_codes::UI_THEME_NOT_FOUND));
        assert!(read_theme_css_in(&root, "../my-skin").unwrap_err().starts_with(error_codes::UI_THEME_INVALID_ID));
        assert!(read_theme_css_in(&root, "..").unwrap_err().starts_with(error_codes::UI_THEME_INVALID_ID));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_enforces_the_size_bound() {
        let root = temp_root("size");
        let big = "a{}".repeat(MAX_CSS_BYTES / 3 + 1);
        write_theme(
            &root,
            "big",
            r##"{"id":"big","name":"x","author":"a","version":"1","css":["theme.css"]}"##,
            Some(&big),
        );
        let err = read_theme_css_in(&root, "big").unwrap_err();
        assert!(err.starts_with(error_codes::UI_THEME_CSS_TOO_LARGE), "{err}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_reports_a_missing_css_file() {
        let root = temp_root("missing-css");
        write_theme(&root, "x", r##"{"id":"x","name":"x","author":"a","version":"1","css":["nope.css"]}"##, None);
        let err = read_theme_css_in(&root, "x").unwrap_err();
        assert!(err.starts_with(error_codes::UI_THEME_IO), "{err}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn starter_export_picks_a_free_id_and_round_trips() {
        let root = temp_root("starter");
        let first = export_starter_in(&root).unwrap();
        assert_eq!(first, STARTER_ID);
        let second = export_starter_in(&root).unwrap();
        assert_eq!(second, format!("{STARTER_ID}-2"));

        let list = list_themes_in(&root).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|s| s.error.is_none()));
        let css = read_theme_css_in(&root, &second).unwrap();
        assert!(css.css.contains(&format!("data-ui-theme=\"{second}\"")));
        assert!(!css.variables.is_empty());
        std::fs::remove_dir_all(&root).ok();
    }
}
