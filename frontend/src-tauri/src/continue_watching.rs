// Home's "Continue watching" card: the raw candidates for "the last thing
// watched" in one round trip — the latest resume-position updates (VLC and
// the built-in player both write them), the latest watched-episode history
// entries, the built-in player's stop frames (player/continue_frame.rs) and
// the cached per-episode name/still for every candidate episode. Picking
// the winner is frontend logic (lib/home/continue-watching.ts, tested).
use crate::db::ToStringErr;
use rusqlite::OptionalExtension;
use serde::Serialize;

const CANDIDATES: i64 = 5;

#[derive(Serialize)]
pub struct ResumeCandidate {
    pub external_id: String,
    pub episode_number: f64,
    pub position_seconds: f64,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct HistoryCandidate {
    pub external_id: String,
    pub episode_number: f64,
    pub watched_at: String,
}

#[derive(Serialize)]
pub struct FrameCandidate {
    pub external_id: String,
    pub episode_number: f64,
    pub frame_path: Option<String>,
    pub position_seconds: f64,
    pub duration_seconds: f64,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct EpisodeMeta {
    pub external_id: String,
    pub episode_number: f64,
    pub season_number: i64,
    pub name: Option<String>,
    pub cover_url: Option<String>,
}

#[derive(Serialize)]
pub struct ContinueWatchingSources {
    pub resume: Vec<ResumeCandidate>,
    pub history: Vec<HistoryCandidate>,
    pub frames: Vec<FrameCandidate>,
    pub episodes: Vec<EpisodeMeta>,
}

pub fn read_sources(conn: &rusqlite::Connection) -> rusqlite::Result<ContinueWatchingSources> {
    let resume = conn
        .prepare(
            "SELECT external_id, episode_number, position_seconds, updated_at
             FROM episode_resume_position ORDER BY updated_at DESC LIMIT ?1",
        )?
        .query_map([CANDIDATES], |r| {
            Ok(ResumeCandidate { external_id: r.get(0)?, episode_number: r.get(1)?, position_seconds: r.get(2)?, updated_at: r.get(3)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let history = conn
        .prepare("SELECT external_id, episode_number, watched_at FROM episode_history ORDER BY watched_at DESC LIMIT ?1")?
        .query_map([CANDIDATES], |r| {
            Ok(HistoryCandidate { external_id: r.get(0)?, episode_number: r.get(1)?, watched_at: r.get(2)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let frames = conn
        .prepare(
            "SELECT external_id, episode_number, frame_path, position_seconds, duration_seconds, updated_at
             FROM continue_watching_frame ORDER BY updated_at DESC LIMIT ?1",
        )?
        .query_map([CANDIDATES], |r| {
            Ok(FrameCandidate {
                external_id: r.get(0)?,
                episode_number: r.get(1)?,
                frame_path: r.get(2)?,
                position_seconds: r.get(3)?,
                duration_seconds: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // A finished episode's card points at the next one, so history rows
    // also ask for episode + 1.
    let mut wanted: Vec<(String, f64)> = Vec::new();
    let mut want = |id: &str, episode: f64| {
        if !wanted.iter().any(|(i, e)| i == id && *e == episode) {
            wanted.push((id.to_string(), episode));
        }
    };
    for row in &resume { want(&row.external_id, row.episode_number); }
    for row in &frames { want(&row.external_id, row.episode_number); }
    for row in &history {
        want(&row.external_id, row.episode_number);
        want(&row.external_id, row.episode_number + 1.0);
    }
    let mut stmt = conn.prepare(
        "SELECT season_number, name, cover_url FROM media_episode
         WHERE external_id = ?1 AND episode_number = ?2 ORDER BY season_number LIMIT 1",
    )?;
    let mut episodes = Vec::new();
    for (external_id, episode_number) in wanted {
        let meta = stmt
            .query_row(rusqlite::params![external_id, episode_number], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?))
            })
            .optional()?;
        if let Some((season_number, name, cover_url)) = meta {
            episodes.push(EpisodeMeta { external_id, episode_number, season_number, name, cover_url });
        }
    }
    Ok(ContinueWatchingSources { resume, history, frames, episodes })
}

#[tauri::command]
pub async fn get_continue_watching_sources(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<ContinueWatchingSources, String> {
    let conn = state.conn.lock().str_err()?;
    read_sources(&conn).str_err()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_source_and_the_next_episode_meta() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        conn.execute_batch(
            "INSERT INTO episode_resume_position (external_id, episode_number, position_seconds, updated_at)
                VALUES ('anime:1', 3, 120, '2026-09-20 10:00:00');
             INSERT INTO episode_history (external_id, episode_number, watched_at)
                VALUES ('anime:2', 7, '2026-09-21 10:00:00');
             INSERT INTO continue_watching_frame (external_id, episode_number, frame_path, position_seconds, duration_seconds, updated_at)
                VALUES ('anime:1', 3, '/f.jpg', 130, 1400, '2026-09-20 10:00:01');
             INSERT INTO media_episode (external_id, season_number, episode_number, name, cover_url)
                VALUES ('anime:2', 1, 8, 'Next one', 'https://still/8.jpg');",
        )
        .unwrap();
        let sources = read_sources(&conn).unwrap();
        assert_eq!(sources.resume.len(), 1);
        assert_eq!(sources.history[0].episode_number, 7.0);
        assert_eq!(sources.frames[0].frame_path.as_deref(), Some("/f.jpg"));
        assert_eq!(sources.episodes.len(), 1);
        assert_eq!(sources.episodes[0].episode_number, 8.0);
        assert_eq!(sources.episodes[0].name.as_deref(), Some("Next one"));
    }
}
