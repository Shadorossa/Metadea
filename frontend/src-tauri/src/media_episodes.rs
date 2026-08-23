use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaEpisode {
    pub external_id:    String,
    pub season_number:  i64,
    pub episode_number: f64,
    pub name:           Option<String>,
    pub cover_url:      Option<String>,
}

#[tauri::command]
pub async fn get_media_episodes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Vec<MediaEpisode>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT external_id, season_number, episode_number, name, cover_url
         FROM media_episode
         WHERE external_id = ?1
         ORDER BY season_number ASC, episode_number ASC"
    ).str_err()?;
    let rows = stmt.query_map([&external_id], |r| {
        Ok(MediaEpisode {
            external_id:    r.get(0)?,
            season_number:  r.get(1)?,
            episode_number: r.get(2)?,
            name:           r.get(3)?,
            cover_url:      r.get(4)?,
        })
    }).str_err()?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// Replaces the whole episode list for external_id in one go — always called
// with a fresh, complete fetch from the provider (TMDB/AniList), never a
// partial update, so stale rows from a previous (e.g. shorter) fetch can't
// linger alongside the new ones.
#[tauri::command]
pub async fn save_media_episodes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    episodes: Vec<MediaEpisode>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    tx.execute("DELETE FROM media_episode WHERE external_id = ?1", [&external_id]).str_err()?;
    for ep in &episodes {
        tx.execute(
            "INSERT OR REPLACE INTO media_episode (external_id, season_number, episode_number, name, cover_url)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![external_id, ep.season_number, ep.episode_number, ep.name, ep.cover_url],
        ).str_err()?;
    }
    tx.commit().str_err()?;
    Ok(())
}
