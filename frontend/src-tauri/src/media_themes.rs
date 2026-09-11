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
}

#[tauri::command]
pub async fn get_media_themes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Vec<MediaTheme>, String> {
    let conn = state.conn.lock().str_err()?;
    // OP always before ED — plain ORDER BY theme_type ASC would sort them
    // alphabetically ('ED' < 'OP'), undoing the fetch-time ordering
    // (animethemes.ts's own sort) the moment this is read back from cache.
    let mut stmt = conn.prepare(
        "SELECT external_id, slug, theme_type, sequence, song_title, artists, episodes, video_url, preview_url
         FROM media_theme
         WHERE external_id = ?1
         ORDER BY CASE theme_type WHEN 'OP' THEN 0 ELSE 1 END, sequence ASC, slug ASC"
    ).str_err()?;
    let rows = stmt.query_map([&external_id], |r| {
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
            "INSERT OR REPLACE INTO media_theme (external_id, slug, theme_type, sequence, song_title, artists, episodes, video_url, preview_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                external_id, theme.slug, theme.theme_type, theme.sequence,
                theme.song_title, theme.artists, theme.episodes, theme.video_url,
                preview,
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

static DOWNLOAD_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

#[tauri::command]
pub async fn cache_theme_video(
    app_handle: tauri::AppHandle,
    url: String,
    external_id: String,
    slug: String,
) -> Result<String, String> {
    let dir = theme_video_cache_dir(&app_handle)?;
    let safe_id = crate::favorite_images::sanitize_for_filename(&external_id);
    let safe_slug = crate::favorite_images::sanitize_for_filename(&slug);
    let file_path = dir.join(format!("{}_{}.webm", safe_id, safe_slug));

    if !file_path.exists() {
        let _permit = DOWNLOAD_SEMAPHORE.acquire().await.map_err(|e| e.to_string())?;

        // Re-check existence in case another task completed it while waiting for the semaphore
        if !file_path.exists() {
            let client = crate::igdb::get_http_client();
            let mut attempts = 0;
            let bytes = loop {
                attempts += 1;
                let resp = client
                    .get(&url)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                    .header("Referer", "https://animethemes.moe/")
                    .header("Range", "bytes=0-")
                    .send()
                    .await
                    .str_err()?;

                let status = resp.status();
                if status.is_success() {
                    break resp.bytes().await.str_err()?;
                }

                if (status.as_u16() == 503 || status.as_u16() == 429) && attempts < 4 {
                    tokio::time::sleep(tokio::time::Duration::from_millis(2000 * attempts as u64)).await;
                    continue;
                }

                return Err(format!("Failed to fetch theme video: HTTP {}", status));
            };

            std::fs::write(&file_path, &bytes).str_err()?;
            prune_theme_video_cache(&dir, 800 * 1024 * 1024);
            tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
        }
    }

    Ok(file_path.to_string_lossy().into_owned())
}

fn prune_theme_video_cache(dir: &std::path::Path, max_bytes: u64) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        let mut files: Vec<(std::path::PathBuf, u64, std::time::SystemTime)> = Vec::new();
        let mut total_size = 0u64;
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let len = meta.len();
                    total_size += len;
                    let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    files.push((entry.path(), len, mtime));
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

#[tauri::command]
pub async fn get_cached_theme_video(
    app_handle: tauri::AppHandle,
    external_id: String,
    slug: String,
) -> Result<Option<String>, String> {
    let dir = theme_video_cache_dir(&app_handle)?;
    let safe_id = crate::favorite_images::sanitize_for_filename(&external_id);
    let safe_slug = crate::favorite_images::sanitize_for_filename(&slug);
    let file_path = dir.join(format!("{}_{}.webm", safe_id, safe_slug));
    if file_path.exists() {
        Ok(Some(file_path.to_string_lossy().into_owned()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn delete_cached_theme_video(
    app_handle: tauri::AppHandle,
    external_id: String,
    slug: String,
) -> Result<(), String> {
    let dir = theme_video_cache_dir(&app_handle)?;
    let safe_id = crate::favorite_images::sanitize_for_filename(&external_id);
    let safe_slug = crate::favorite_images::sanitize_for_filename(&slug);
    let file_path = dir.join(format!("{}_{}.webm", safe_id, safe_slug));
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

