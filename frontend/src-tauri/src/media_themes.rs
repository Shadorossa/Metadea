// Anime openings/endings from animethemes.moe (the "Temas" tab on an
// anime's media page) — same cache-after-first-fetch pattern as
// media_episodes.rs.
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaTheme {
    pub external_id: String,
    // animethemes.moe's own unique name per theme ("OP1", "OP1v2",
    // "OP1-YorinukiGintamaSan", ...) — the real key, since (theme_type,
    // sequence) alone can collide (see media_theme's own CREATE TABLE
    // comment).
    pub slug:        String,
    pub theme_type:  String, // "OP" or "ED"
    pub sequence:    i64,
    pub song_title:  Option<String>,
    pub artists:     Option<String>,
    pub episodes:    Option<String>,
    pub video_url:   Option<String>,
    pub preview_url: Option<String>,
    #[serde(default)]
    pub versions:    Option<String>,
}

#[tauri::command]
pub async fn get_media_themes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Vec<MediaTheme>, String> {
    let conn = state.conn.lock().str_err()?;
    load_media_themes(&conn, &external_id)
}

pub(crate) fn load_media_themes(
    conn: &rusqlite::Connection,
    external_id: &str,
) -> Result<Vec<MediaTheme>, String> {
    // OP always before ED — plain ORDER BY theme_type ASC would sort them
    // alphabetically ('ED' < 'OP'), undoing the fetch-time ordering
    // (animethemes.ts's own sort) the moment this is read back from cache.
    let mut stmt = conn.prepare(
        "SELECT external_id, slug, theme_type, sequence, song_title, artists, episodes, video_url, preview_url, versions
         FROM media_theme
         WHERE external_id = ?1
         ORDER BY CASE theme_type WHEN 'OP' THEN 0 ELSE 1 END, sequence ASC, slug ASC"
    ).str_err()?;
    let rows = stmt.query_map([external_id], |r| {
        Ok(MediaTheme {
            external_id: r.get(0)?,
            slug:        r.get(1)?,
            theme_type:  r.get(2)?,
            sequence:    r.get(3)?,
            song_title:  r.get(4)?,
            artists:     r.get(5)?,
            episodes:    r.get(6)?,
            video_url:   r.get(7)?,
            preview_url: r.get(8)?,
            versions:    r.get(9)?,
        })
    }).str_err()?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// Replaces the whole theme list for external_id in one go — always called
// with a fresh, complete fetch from animethemes.moe, never a partial
// update, so a stale theme from a previous fetch can't linger alongside
// the new ones.
#[tauri::command]
pub async fn save_media_themes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    themes: Vec<MediaTheme>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    // Preserve existing preview_url when saving fresh metadata
    let mut existing_previews = std::collections::HashMap::new();
    {
        let mut prev_stmt = tx.prepare("SELECT slug, preview_url FROM media_theme WHERE external_id = ?1").str_err()?;
        let prev_rows = prev_stmt.query_map([&external_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))).str_err()?;
        for row in prev_rows.flatten() {
            if let Some(p) = row.1 {
                existing_previews.insert(row.0, p);
            }
        }
    }

    tx.execute("DELETE FROM media_theme WHERE external_id = ?1", [&external_id]).str_err()?;
    for theme in &themes {
        let preview = theme.preview_url.clone().or_else(|| existing_previews.get(&theme.slug).cloned());
        tx.execute(
            "INSERT OR REPLACE INTO media_theme (external_id, slug, theme_type, sequence, song_title, artists, episodes, video_url, preview_url, versions)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                external_id, theme.slug, theme.theme_type, theme.sequence,
                theme.song_title, theme.artists, theme.episodes, theme.video_url,
                preview, theme.versions,
            ],
        ).str_err()?;
    }
    tx.commit().str_err()?;
    Ok(())
}

fn theme_preview_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("metadata")
        .join("theme_previews");
    std::fs::create_dir_all(&dir).str_err()?;
    Ok(dir)
}

#[tauri::command]
pub async fn save_theme_preview_frame(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    slug: String,
    data_base64: String,
) -> Result<String, String> {
    let dir = theme_preview_dir(&app_handle)?;
    let safe_id = crate::favorite_images::sanitize_for_filename(&external_id);
    let safe_slug = crate::favorite_images::sanitize_for_filename(&slug);
    let file_path = dir.join(format!("{}_{}.webp", safe_id, safe_slug));
    let file_str = file_path.to_string_lossy().into_owned();

    use base64::Engine;
    let raw = if let Some((_, b64)) = data_base64.split_once(',') { b64 } else { &data_base64 };
    let bytes = base64::engine::general_purpose::STANDARD.decode(raw).str_err()?;
    std::fs::write(&file_path, &bytes).str_err()?;

    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "UPDATE media_theme SET preview_url = ?1 WHERE external_id = ?2 AND slug = ?3",
        rusqlite::params![&file_str, &external_id, &slug],
    ).str_err()?;

    Ok(file_str)
}

fn theme_video_cache_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("metadata")
        .join("theme_video_cache");
    std::fs::create_dir_all(&dir).str_err()?;
    Ok(dir)
}

// ── Theme video cache ────────────────────────────────────────────────────────
//
// One `<external_id>_<slug>.webm` per theme, written by cache_theme_video
// (the media page's preview-frame capture queue and its hover warm-up) and
// read by the OP/ED overlay and the jukebox. v.animethemes.moe answers 503
// after a handful of requests per minute from one IP, so a download is
// streamed to `<name>.webm.part` and only renamed into place once it is
// complete and starts with the EBML signature: a reader never sees a file
// that is still being written, nor an nginx error page saved as video.

const THEME_VIDEO_CACHE_MAX_BYTES: u64 = 800 * 1024 * 1024;
// Every WebM (Matroska) file starts with the EBML header element id.
const WEBM_SIGNATURE: [u8; 4] = [0x1A, 0x45, 0xDF, 0xA3];
// Smallest file accepted as a theme video; an OP/ED is several MB, and the
// CDN's 503 page is ~200 bytes.
const MIN_THEME_VIDEO_BYTES: u64 = 64 * 1024;
const PART_EXTENSION: &str = "part";
// Waiting for the response headers, and then for each body chunk: a stalled
// transfer fails after this long without data, but a big video that keeps
// arriving is never cut off by a total deadline.
const THEME_VIDEO_RESPONSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const THEME_VIDEO_CHUNK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
// Overrides the shared client's 15 s total timeout; only a backstop.
const THEME_VIDEO_TRANSFER_CAP: std::time::Duration = std::time::Duration::from_secs(30 * 60);

static DOWNLOAD_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
// Bumped by cancel_theme_video_downloads: every download (running or queued
// on the semaphore) started under an older generation stops.
static DOWNLOAD_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static DOWNLOAD_CANCELLED: tokio::sync::Notify = tokio::sync::Notify::const_new();

fn theme_video_path(dir: &std::path::Path, external_id: &str, slug: &str) -> std::path::PathBuf {
    let safe_id = crate::favorite_images::sanitize_for_filename(external_id);
    let safe_slug = crate::favorite_images::sanitize_for_filename(slug);
    dir.join(format!("{}_{}.webm", safe_id, safe_slug))
}

// `<name>.webm` → `<name>.webm.part`.
fn theme_video_part_path(final_path: &std::path::Path) -> std::path::PathBuf {
    let mut name = final_path.file_name().unwrap_or_default().to_os_string();
    name.push(".");
    name.push(PART_EXTENSION);
    final_path.with_file_name(name)
}

fn has_webm_signature(path: &std::path::Path) -> bool {
    use std::io::Read;
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if !meta.is_file() || meta.len() < MIN_THEME_VIDEO_BYTES {
        return false;
    }
    let mut head = [0u8; 4];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && head == WEBM_SIGNATURE
}

// The cached video at `path`, if it is a usable one. A file that fails the
// signature check (truncated by a crash of an older build, or an error page
// saved as video) is deleted so the next lookup streams and the next
// download starts clean.
fn usable_cached_video(path: &std::path::Path) -> Option<std::path::PathBuf> {
    if !path.is_file() {
        return None;
    }
    if has_webm_signature(path) {
        Some(path.to_path_buf())
    } else {
        let _ = std::fs::remove_file(path);
        None
    }
}

// Moves a finished `.part` download into place, or deletes it when it is
// not a WebM file. The rename is atomic on one volume, so a reader sees
// either no file or the whole one.
fn commit_theme_video_part(part: &std::path::Path, final_path: &std::path::Path) -> Result<(), String> {
    use crate::error_codes::{with_detail, THEME_VIDEO_DOWNLOAD};
    if !has_webm_signature(part) {
        let _ = std::fs::remove_file(part);
        return Err(with_detail(THEME_VIDEO_DOWNLOAD, "response is not a WebM video"));
    }
    std::fs::rename(part, final_path).map_err(|e| {
        let _ = std::fs::remove_file(part);
        with_detail(THEME_VIDEO_DOWNLOAD, e)
    })
}

fn download_generation() -> u64 {
    DOWNLOAD_GENERATION.load(std::sync::atomic::Ordering::SeqCst)
}

// Resolves `fut`, or fails with THEME_VIDEO_CANCELLED as soon as
// cancel_theme_video_downloads runs (or already ran since `generation`).
async fn unless_cancelled<F: std::future::Future>(generation: u64, fut: F) -> Result<F::Output, String> {
    // Created before the generation check, so a cancel landing in between
    // still wakes it (Notified registers for notify_waiters on creation).
    let cancelled = DOWNLOAD_CANCELLED.notified();
    if download_generation() != generation {
        return Err(crate::error_codes::THEME_VIDEO_CANCELLED.to_string());
    }
    let fut = std::pin::pin!(fut);
    let cancelled = std::pin::pin!(cancelled);
    match futures::future::select(fut, cancelled).await {
        futures::future::Either::Left((out, _)) => Ok(out),
        futures::future::Either::Right(_) => Err(crate::error_codes::THEME_VIDEO_CANCELLED.to_string()),
    }
}

// Streams `url` into `part` chunk by chunk (bounded memory). Retries a
// 429/503 a few times with growing pauses, since that is the CDN's rate
// limit answering, not a missing file.
async fn download_theme_video(url: &str, part: &std::path::Path, generation: u64) -> Result<(), String> {
    use crate::error_codes::{with_detail, THEME_VIDEO_DOWNLOAD};
    use std::io::Write;
    let client = crate::http::http_client();
    let mut attempts: u64 = 0;
    let mut resp = loop {
        attempts += 1;
        let request = client
            .get(url)
            .timeout(THEME_VIDEO_TRANSFER_CAP)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
            .header("Referer", "https://animethemes.moe/")
            .send();
        let resp = unless_cancelled(generation, tokio::time::timeout(THEME_VIDEO_RESPONSE_TIMEOUT, request))
            .await?
            .map_err(|_| with_detail(THEME_VIDEO_DOWNLOAD, "no response"))?
            .map_err(|e| with_detail(THEME_VIDEO_DOWNLOAD, e))?;
        let status = resp.status();
        if status.is_success() {
            break resp;
        }
        if matches!(status.as_u16(), 429 | 503) && attempts < 4 {
            unless_cancelled(generation, tokio::time::sleep(std::time::Duration::from_secs(3 * attempts))).await?;
            continue;
        }
        return Err(with_detail(THEME_VIDEO_DOWNLOAD, format!("HTTP {status}")));
    };

    let mut file = std::fs::File::create(part).map_err(|e| with_detail(THEME_VIDEO_DOWNLOAD, e))?;
    loop {
        let chunk = unless_cancelled(generation, tokio::time::timeout(THEME_VIDEO_CHUNK_TIMEOUT, resp.chunk()))
            .await?
            .map_err(|_| with_detail(THEME_VIDEO_DOWNLOAD, "transfer stalled"))?
            .map_err(|e| with_detail(THEME_VIDEO_DOWNLOAD, e))?;
        match chunk {
            Some(bytes) => file.write_all(&bytes).map_err(|e| with_detail(THEME_VIDEO_DOWNLOAD, e))?,
            None => break,
        }
    }
    file.flush().map_err(|e| with_detail(THEME_VIDEO_DOWNLOAD, e))?;
    Ok(())
}

#[tauri::command]
pub async fn cache_theme_video(
    app_handle: tauri::AppHandle,
    url: String,
    external_id: String,
    slug: String,
) -> Result<String, String> {
    let generation = download_generation();
    let dir = theme_video_cache_dir(&app_handle)?;
    let file_path = theme_video_path(&dir, &external_id, &slug);
    if let Some(path) = usable_cached_video(&file_path) {
        return Ok(path.to_string_lossy().into_owned());
    }

    // One download at a time: the CDN rate-limits per IP, and a queued call
    // cancelled while waiting here never touches the network.
    let _permit = unless_cancelled(generation, DOWNLOAD_SEMAPHORE.acquire()).await?.str_err()?;
    // Another call may have finished this same file while this one waited.
    if usable_cached_video(&file_path).is_none() {
        let part = theme_video_part_path(&file_path);
        let result = match download_theme_video(&url, &part, generation).await {
            Ok(()) => commit_theme_video_part(&part, &file_path),
            Err(e) => Err(e),
        };
        if result.is_err() {
            let _ = std::fs::remove_file(&part);
        }
        result?;
        prune_theme_video_cache(&dir, THEME_VIDEO_CACHE_MAX_BYTES);
    }

    Ok(file_path.to_string_lossy().into_owned())
}

// Stops every theme video download started so far, running or queued. The
// OP/ED overlay calls it on open so a background preview capture doesn't
// spend the CDN's per-IP budget the overlay's own stream needs; later
// cache_theme_video calls are unaffected.
#[tauri::command]
pub async fn cancel_theme_video_downloads() -> Result<(), String> {
    DOWNLOAD_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    DOWNLOAD_CANCELLED.notify_waiters();
    Ok(())
}

// Called with the download permit held, so no `.part` file is in progress:
// any left over (a crash mid-download) is stale and removed first.
fn prune_theme_video_cache(dir: &std::path::Path, max_bytes: u64) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut files: Vec<(std::path::PathBuf, u64, std::time::SystemTime)> = Vec::new();
        let mut total_size = 0u64;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == PART_EXTENSION) {
                let _ = std::fs::remove_file(&path);
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let len = meta.len();
                    total_size += len;
                    let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    files.push((path, len, mtime));
                }
            }
        }
        if total_size > max_bytes {
            files.sort_by_key(|f| f.2);
            for (path, len, _) in files {
                if total_size <= max_bytes * 3 / 4 {
                    break;
                }
                if std::fs::remove_file(&path).is_ok() {
                    total_size = total_size.saturating_sub(len);
                }
            }
        }
    }
}

// The cached video's path, or None when there is no complete, valid one
// (see usable_cached_video): the caller then streams the remote URL.
#[tauri::command]
pub async fn get_cached_theme_video(
    app_handle: tauri::AppHandle,
    external_id: String,
    slug: String,
) -> Result<Option<String>, String> {
    let dir = theme_video_cache_dir(&app_handle)?;
    Ok(usable_cached_video(&theme_video_path(&dir, &external_id, &slug))
        .map(|path| path.to_string_lossy().into_owned()))
}

// The overlay calls this when the cached file fails to play, so the next
// open streams (and a later capture re-downloads) instead of hitting the
// same broken file again.
#[tauri::command]
pub async fn delete_cached_theme_video(
    app_handle: tauri::AppHandle,
    external_id: String,
    slug: String,
) -> Result<(), String> {
    let dir = theme_video_cache_dir(&app_handle)?;
    let file_path = theme_video_path(&dir, &external_id, &slug);
    if file_path.exists() {
        std::fs::remove_file(&file_path).str_err()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_theme_preview_frame(
    app_handle: tauri::AppHandle,
    external_id: String,
    slug: String,
) -> Result<Option<String>, String> {
    let dir = theme_preview_dir(&app_handle)?;
    let safe_id = crate::favorite_images::sanitize_for_filename(&external_id);
    let safe_slug = crate::favorite_images::sanitize_for_filename(&slug);
    let file_path = dir.join(format!("{}_{}.webp", safe_id, safe_slug));

    if file_path.exists() {
        Ok(Some(file_path.to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}


// ── Jukebox favourites (favorite_themes, migrations/jukebox.rs) ─────────────
//
// The starred OP/EDs the jukebox strip plays as its queue, in `position`
// order. Each entry carries the theme row plus what the strip shows around
// it: the work's title and cover (from the visible catalog) and the cached
// preview frame, when one was captured, for the turntable.

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FavoriteTheme {
    pub theme:              MediaTheme,
    pub media_title:        String,
    pub cover_url:          Option<String>,
    pub preview_frame_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct FavoriteThemeKey {
    pub external_id: String,
    pub slug:        String,
}

// First non-blank title — title_main is NOT NULL DEFAULT '' on the catalog
// row, so an empty string counts as missing, not as the title.
fn catalog_display_title(summary: &crate::media_catalog::CatalogSummary) -> String {
    [&summary.title_main, &summary.title_english, &summary.title_romaji, &summary.title_native]
        .into_iter()
        .filter_map(|t| t.as_deref().map(str::trim))
        .find(|t| !t.is_empty())
        .unwrap_or_default()
        .to_string()
}

// Favourites joined with their media_theme row, in queue order. A star
// whose theme row is gone (media_theme is a cache; the work was never
// re-fetched after a schema rebuild) is skipped, not an error — the star
// itself stays put and shows up again once the theme row is back.
pub(crate) fn load_favorite_themes(
    conn: &rusqlite::Connection,
) -> Result<Vec<FavoriteTheme>, String> {
    let mut stmt = conn.prepare(
        "SELECT t.external_id, t.slug, t.theme_type, t.sequence, t.song_title, t.artists, t.episodes, t.video_url, t.preview_url, t.versions
         FROM favorite_themes f
         JOIN media_theme t ON t.external_id = f.external_id AND t.slug = f.slug
         ORDER BY f.position ASC, f.added_at ASC, t.slug ASC",
    ).str_err()?;
    let themes: Vec<MediaTheme> = stmt.query_map([], |r| {
        Ok(MediaTheme {
            external_id: r.get(0)?,
            slug:        r.get(1)?,
            theme_type:  r.get(2)?,
            sequence:    r.get(3)?,
            song_title:  r.get(4)?,
            artists:     r.get(5)?,
            episodes:    r.get(6)?,
            video_url:   r.get(7)?,
            preview_url: r.get(8)?,
            versions:    r.get(9)?,
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();

    let mut ids: Vec<String> = themes.iter().map(|t| t.external_id.clone()).collect();
    ids.sort();
    ids.dedup();
    let summaries = crate::media_catalog::load_catalog_summaries_by_ids(conn, &ids)?;
    let by_id: std::collections::HashMap<&str, &crate::media_catalog::CatalogSummary> =
        summaries.iter().map(|s| (s.external_id.as_str(), s)).collect();

    Ok(themes.into_iter().map(|theme| {
        let summary = by_id.get(theme.external_id.as_str());
        FavoriteTheme {
            media_title: summary.map(|s| catalog_display_title(s)).unwrap_or_default(),
            cover_url:   summary.and_then(|s| s.cover_url.clone()),
            preview_frame_path: None,
            theme,
        }
    }).collect())
}

pub(crate) fn write_theme_favorite(
    conn: &mut rusqlite::Connection,
    external_id: &str,
    slug: &str,
    favorite: bool,
) -> Result<(), String> {
    let tx = conn.transaction().str_err()?;
    if favorite {
        // Appends at the end of the queue; re-starring an existing favourite
        // keeps its position instead of moving it to the back.
        let next_position: i64 = tx
            .query_row("SELECT COALESCE(MAX(position) + 1, 0) FROM favorite_themes", [], |r| r.get(0))
            .str_err()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        tx.execute(
            "INSERT OR IGNORE INTO favorite_themes (external_id, slug, position, added_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![external_id, slug, next_position, now],
        ).str_err()?;
    } else {
        tx.execute(
            "DELETE FROM favorite_themes WHERE external_id = ?1 AND slug = ?2",
            rusqlite::params![external_id, slug],
        ).str_err()?;
    }
    tx.commit().str_err()?;
    Ok(())
}

// Rewrites `position` from the given order. Favourites the list leaves out
// keep their relative order after the listed ones, so a reorder sent from a
// stale queue never silently drops a star.
pub(crate) fn write_favorite_theme_order(
    conn: &mut rusqlite::Connection,
    keys: &[FavoriteThemeKey],
) -> Result<(), String> {
    let tx = conn.transaction().str_err()?;
    let existing: Vec<FavoriteThemeKey> = {
        let mut stmt = tx
            .prepare("SELECT external_id, slug FROM favorite_themes ORDER BY position ASC, added_at ASC, slug ASC")
            .str_err()?;
        let rows = stmt
            .query_map([], |r| Ok(FavoriteThemeKey { external_id: r.get(0)?, slug: r.get(1)? }))
            .str_err()?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };
    let mut ordered: Vec<&FavoriteThemeKey> = Vec::with_capacity(existing.len());
    for key in keys {
        if existing.contains(key) && !ordered.contains(&key) {
            ordered.push(key);
        }
    }
    for key in &existing {
        if !ordered.contains(&key) {
            ordered.push(key);
        }
    }
    for (position, key) in ordered.iter().enumerate() {
        tx.execute(
            "UPDATE favorite_themes SET position = ?1 WHERE external_id = ?2 AND slug = ?3",
            rusqlite::params![position as i64, key.external_id, key.slug],
        ).str_err()?;
    }
    tx.commit().str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn get_favorite_themes(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<FavoriteTheme>, String> {
    let mut favorites = {
        let conn = state.conn.lock().str_err()?;
        load_favorite_themes(&conn)?
    };
    let dir = theme_preview_dir(&app_handle)?;
    for favorite in &mut favorites {
        let safe_id = crate::favorite_images::sanitize_for_filename(&favorite.theme.external_id);
        let safe_slug = crate::favorite_images::sanitize_for_filename(&favorite.theme.slug);
        let frame = dir.join(format!("{}_{}.webp", safe_id, safe_slug));
        if frame.exists() {
            favorite.preview_frame_path = Some(frame.to_string_lossy().into_owned());
        }
    }
    Ok(favorites)
}

#[tauri::command]
pub async fn set_theme_favorite(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    slug: String,
    favorite: bool,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    write_theme_favorite(&mut conn, &external_id, &slug, favorite)
}

#[tauri::command]
pub async fn reorder_favorite_themes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    keys: Vec<FavoriteThemeKey>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    write_favorite_theme_order(&mut conn, &keys)
}

#[cfg(test)]
mod favorite_theme_tests {
    use super::*;

    fn key(external_id: &str, slug: &str) -> FavoriteThemeKey {
        FavoriteThemeKey { external_id: external_id.into(), slug: slug.into() }
    }

    fn seed(conn: &rusqlite::Connection) {
        conn.execute(
            "INSERT INTO media_catalog (id, external_id, type, title_main, cover_url) VALUES ('anime:1', 'anime:1', 'anime', 'Gintama', 'https://img/1.jpg')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO media_catalog (id, external_id, type, title_romaji) VALUES ('anime:2', 'anime:2', 'anime', 'Mushishi')",
            [],
        ).unwrap();
        for (ext, slug, kind, seq, song) in [
            ("anime:1", "OP1", "OP", 1, "Pray"),
            ("anime:1", "ED1", "ED", 1, "Amplified"),
            ("anime:2", "OP1", "OP", 1, "The Sore Feet Song"),
        ] {
            conn.execute(
                "INSERT INTO media_theme (external_id, slug, theme_type, sequence, song_title) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![ext, slug, kind, seq, song],
            ).unwrap();
        }
    }

    fn slugs(rows: &[FavoriteTheme]) -> Vec<String> {
        rows.iter().map(|f| format!("{}/{}", f.theme.external_id, f.theme.slug)).collect()
    }

    #[test]
    fn favorites_roundtrip_in_insertion_order_with_catalog_title_and_cover() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();
        seed(&conn);
        write_theme_favorite(&mut conn, "anime:2", "OP1", true).unwrap();
        write_theme_favorite(&mut conn, "anime:1", "OP1", true).unwrap();
        write_theme_favorite(&mut conn, "anime:1", "ED1", true).unwrap();
        // Re-starring keeps the original slot.
        write_theme_favorite(&mut conn, "anime:2", "OP1", true).unwrap();

        let rows = load_favorite_themes(&conn).unwrap();
        assert_eq!(slugs(&rows), vec!["anime:2/OP1", "anime:1/OP1", "anime:1/ED1"]);
        assert_eq!(rows[0].media_title, "Mushishi");
        assert_eq!(rows[0].cover_url, None);
        assert_eq!(rows[1].media_title, "Gintama");
        assert_eq!(rows[1].cover_url.as_deref(), Some("https://img/1.jpg"));
        assert_eq!(rows[1].theme.song_title.as_deref(), Some("Pray"));
        assert!(rows.iter().all(|r| r.preview_frame_path.is_none()));

        write_theme_favorite(&mut conn, "anime:1", "OP1", false).unwrap();
        let rows = load_favorite_themes(&conn).unwrap();
        assert_eq!(slugs(&rows), vec!["anime:2/OP1", "anime:1/ED1"]);
        // Unstarring something that was never starred is a no-op.
        write_theme_favorite(&mut conn, "anime:9", "OP1", false).unwrap();
        assert_eq!(load_favorite_themes(&conn).unwrap().len(), 2);
    }

    #[test]
    fn star_without_theme_row_is_kept_but_hidden() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();
        seed(&conn);
        write_theme_favorite(&mut conn, "anime:3", "OP1", true).unwrap();
        assert!(load_favorite_themes(&conn).unwrap().is_empty());
        let stored: i64 = conn.query_row("SELECT COUNT(*) FROM favorite_themes", [], |r| r.get(0)).unwrap();
        assert_eq!(stored, 1);
    }

    #[test]
    fn reorder_rewrites_positions_and_keeps_unlisted_stars_after() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();
        seed(&conn);
        write_theme_favorite(&mut conn, "anime:1", "OP1", true).unwrap();
        write_theme_favorite(&mut conn, "anime:1", "ED1", true).unwrap();
        write_theme_favorite(&mut conn, "anime:2", "OP1", true).unwrap();

        write_favorite_theme_order(&mut conn, &[key("anime:2", "OP1"), key("anime:1", "ED1"), key("anime:1", "OP1")]).unwrap();
        assert_eq!(slugs(&load_favorite_themes(&conn).unwrap()), vec!["anime:2/OP1", "anime:1/ED1", "anime:1/OP1"]);

        // Partial / stale list: unknown keys ignored, unlisted stars trail.
        write_favorite_theme_order(&mut conn, &[key("anime:1", "OP1"), key("nope", "OP9"), key("anime:1", "OP1")]).unwrap();
        assert_eq!(slugs(&load_favorite_themes(&conn).unwrap()), vec!["anime:1/OP1", "anime:2/OP1", "anime:1/ED1"]);
        let positions: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT position FROM favorite_themes ORDER BY position").unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
        };
        assert_eq!(positions, vec![0, 1, 2]);
    }
}

#[cfg(test)]
mod theme_video_cache_tests {
    use super::*;
    use std::path::{Path, PathBuf};

    // A fresh directory per test under the OS temp dir, removed on drop.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("metadea-theme-cache-{}-{}", name, std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn webm_bytes(len: usize) -> Vec<u8> {
        let mut bytes = WEBM_SIGNATURE.to_vec();
        bytes.resize(len, 0x42);
        bytes
    }

    const NGINX_503: &[u8] = b"<html>\r\n<head><title>503 Service Temporarily Unavailable</title></head>\r\n</html>\r\n";

    fn full_size() -> usize {
        MIN_THEME_VIDEO_BYTES as usize * 2
    }

    fn cached(dir: &Path) -> PathBuf {
        theme_video_path(dir, "anime:185874", "OP1")
    }

    #[test]
    fn part_path_sits_next_to_the_final_file() {
        let final_path = cached(Path::new("cache"));
        assert_eq!(final_path.file_name().unwrap(), "anime_185874_OP1.webm");
        assert_eq!(theme_video_part_path(&final_path).file_name().unwrap(), "anime_185874_OP1.webm.part");
    }

    #[test]
    fn committing_a_valid_part_renames_it_into_place() {
        let tmp = TempDir::new("commit-ok");
        let final_path = cached(&tmp.0);
        let part = theme_video_part_path(&final_path);
        std::fs::write(&part, webm_bytes(full_size())).unwrap();
        // Readers see nothing while only the .part exists.
        assert_eq!(usable_cached_video(&final_path), None);

        commit_theme_video_part(&part, &final_path).unwrap();
        assert!(!part.exists());
        assert_eq!(usable_cached_video(&final_path), Some(final_path.clone()));
        assert_eq!(std::fs::metadata(&final_path).unwrap().len(), full_size() as u64);
    }

    #[test]
    fn committing_a_non_webm_or_truncated_part_is_rejected_and_deleted() {
        let tmp = TempDir::new("commit-bad");
        let final_path = cached(&tmp.0);
        let part = theme_video_part_path(&final_path);

        let mut error_page = NGINX_503.to_vec();
        error_page.resize(full_size(), b' ');
        for body in [error_page, webm_bytes(1024)] {
            std::fs::write(&part, &body).unwrap();
            let err = commit_theme_video_part(&part, &final_path).unwrap_err();
            assert!(err.starts_with(crate::error_codes::THEME_VIDEO_DOWNLOAD), "{err}");
            assert!(!part.exists());
            assert!(!final_path.exists());
        }
    }

    #[test]
    fn lookup_ignores_part_files_and_purges_invalid_cached_files() {
        let tmp = TempDir::new("lookup");
        let final_path = cached(&tmp.0);

        std::fs::write(theme_video_part_path(&final_path), webm_bytes(full_size())).unwrap();
        assert_eq!(usable_cached_video(&final_path), None);

        // A file left by an older, non-atomic build: truncated, or the 503 page.
        for body in [webm_bytes(4096), NGINX_503.to_vec()] {
            std::fs::write(&final_path, &body).unwrap();
            assert_eq!(usable_cached_video(&final_path), None);
            assert!(!final_path.exists(), "invalid cached file is deleted");
        }

        std::fs::write(&final_path, webm_bytes(full_size())).unwrap();
        assert_eq!(usable_cached_video(&final_path), Some(final_path.clone()));
    }

    #[test]
    fn prune_drops_stale_part_files() {
        let tmp = TempDir::new("prune");
        let final_path = cached(&tmp.0);
        let part = theme_video_part_path(&final_path);
        std::fs::write(&final_path, webm_bytes(full_size())).unwrap();
        std::fs::write(&part, webm_bytes(full_size())).unwrap();
        prune_theme_video_cache(&tmp.0, THEME_VIDEO_CACHE_MAX_BYTES);
        assert!(!part.exists());
        assert!(final_path.exists());
    }

    #[test]
    fn cancel_stops_pending_waits_and_leaves_later_downloads_alone() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        rt.block_on(async {
            let generation = download_generation();
            let waiting = unless_cancelled(generation, tokio::time::sleep(std::time::Duration::from_secs(60)));
            let cancel = async {
                tokio::task::yield_now().await;
                cancel_theme_video_downloads().await.unwrap();
            };
            let (result, ()) = futures::join!(waiting, cancel);
            assert_eq!(result.unwrap_err(), crate::error_codes::THEME_VIDEO_CANCELLED);

            // A call started after the cancel runs normally.
            let fresh = unless_cancelled(download_generation(), async { 7 }).await;
            assert_eq!(fresh.unwrap(), 7);
        });
    }
}
