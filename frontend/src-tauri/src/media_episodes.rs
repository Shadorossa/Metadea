use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaEpisode {
    pub external_id:    String,
    pub season_number:  i64,
    pub episode_number: f64,
    pub name:           Option<String>,
    pub cover_url:      Option<String>,
    pub source_key:     Option<String>,
    pub mapping_key:    Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaEpisodeGroup {
    pub external_id:   String,
    pub episode_count: i64,
    pub sample_name:   Option<String>,
    pub sample_cover:  Option<String>,
}

#[tauri::command]
pub async fn get_all_media_episodes_grouped(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<MediaEpisodeGroup>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT external_id, COUNT(1), MAX(name), MAX(cover_url)
         FROM media_episode
         GROUP BY external_id
         ORDER BY external_id ASC"
    ).str_err()?;
    let rows = stmt.query_map([], |r| {
        Ok(MediaEpisodeGroup {
            external_id:   r.get(0)?,
            episode_count: r.get(1)?,
            sample_name:   r.get(2)?,
            sample_cover:  r.get(3)?,
        })
    }).str_err()?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub async fn get_media_episodes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Vec<MediaEpisode>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT external_id, season_number, episode_number, name, cover_url, source_key, mapping_key
         FROM media_episode
         WHERE external_id = ?1
         ORDER BY CASE WHEN episode_number > 0 THEN 0 ELSE 1 END,
                  CASE WHEN episode_number > 0 THEN episode_number ELSE -episode_number END ASC"
    ).str_err()?;
    let rows = stmt.query_map([&external_id], |r| {
        Ok(MediaEpisode {
            external_id:    r.get(0)?,
            season_number:  r.get(1)?,
            episode_number: r.get(2)?,
            name:           r.get(3)?,
            cover_url:      r.get(4)?,
            source_key:     r.get(5)?,
            mapping_key:    r.get(6)?,
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
            // source_key has a partial unique index. IGNORE deliberately
            // refuses to assign one provider episode to a second work.
            "INSERT OR IGNORE INTO media_episode (external_id, season_number, episode_number, name, cover_url, source_key, mapping_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![external_id, ep.season_number, ep.episode_number, ep.name, ep.cover_url, ep.source_key, ep.mapping_key],
        ).str_err()?;
    }
    tx.commit().str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn delete_all_media_episodes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM media_episode WHERE external_id = ?1", [&external_id])
        .map(|_| ())
        .str_err()
}

#[tauri::command]
pub async fn delete_media_episode(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    season_number: i64,
    episode_number: f64,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "DELETE FROM media_episode WHERE external_id = ?1 AND season_number = ?2 AND episode_number = ?3",
        rusqlite::params![external_id, season_number, episode_number],
    )
    .map(|_| ())
    .str_err()
}
