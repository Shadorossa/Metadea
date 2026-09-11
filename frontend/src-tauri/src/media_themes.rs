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

    if !file_path.exists() {
        use base64::Engine;
        let raw = if let Some((_, b64)) = data_base64.split_once(',') { b64 } else { &data_base64 };
        let bytes = base64::engine::general_purpose::STANDARD.decode(raw).str_err()?;
        let decoded = image::load_from_memory(&bytes).str_err()?;
        let target_img = if decoded.width() > 320 {
            let target_height = ((320.0 / decoded.width() as f32) * decoded.height() as f32).round() as u32;
            decoded.resize_exact(320, target_height, image::imageops::FilterType::Triangle)
        } else {
            decoded
        };
        let mut webp_bytes: Vec<u8> = Vec::new();
        target_img.write_to(&mut std::io::Cursor::new(&mut webp_bytes), image::ImageFormat::WebP).str_err()?;
        std::fs::write(&file_path, &webp_bytes).str_err()?;
    }

    // Persist preview_url path to SQLite media_theme row
    let conn = state.conn.lock().str_err()?;
    let _ = conn.execute(
        "UPDATE media_theme SET preview_url = ?1 WHERE external_id = ?2 AND slug = ?3",
        rusqlite::params![&file_str, &external_id, &slug],
    );

    Ok(file_str)
}

#[tauri::command]
pub async fn fetch_theme_video_blob(url: String) -> Result<String, String> {
    let client = crate::igdb::get_http_client();
    let resp = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .send()
        .await
        .str_err()?;

    if !resp.status().is_success() {
        return Err(format!("Failed to fetch theme video: HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.str_err()?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:video/webm;base64,{}", b64))
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

