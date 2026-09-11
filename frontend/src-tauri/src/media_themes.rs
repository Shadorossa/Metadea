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
        "SELECT external_id, slug, theme_type, sequence, song_title, artists, episodes, video_url
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
    tx.execute("DELETE FROM media_theme WHERE external_id = ?1", [&external_id]).str_err()?;
    for theme in &themes {
        tx.execute(
            "INSERT OR REPLACE INTO media_theme (external_id, slug, theme_type, sequence, song_title, artists, episodes, video_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                external_id, theme.slug, theme.theme_type, theme.sequence,
                theme.song_title, theme.artists, theme.episodes, theme.video_url,
            ],
        ).str_err()?;
    }
    tx.commit().str_err()?;
    Ok(())
}
