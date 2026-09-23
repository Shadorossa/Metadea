// "Continue watching" frame: when the built-in player closes, one video-only
// frame of where playback stopped is written to
// `$APPDATA/metadata/continue_frames/<external_id>_<episode>.jpg`
// (overwritten every time) and recorded in `continue_watching_frame`, so
// Home's Continue card can show the exact spot. The asset scope already
// covers `$APPDATA/metadata/**`.

use std::path::{Path, PathBuf};

/// Where a work/episode's frame lives: one file per (work, episode), so a
/// later stop on the same episode simply replaces it.
pub fn continue_frame_file_name(external_id: &str, episode_number: f64) -> String {
    let id: String = external_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let episode = if episode_number.fract() == 0.0 {
        format!("{}", episode_number as i64)
    } else {
        format!("{episode_number}").replace('.', "_")
    };
    format!("{id}_{episode}.jpg")
}

pub fn continue_frame_path(app_data_dir: &Path, external_id: &str, episode_number: f64) -> PathBuf {
    app_data_dir
        .join("metadata")
        .join("continue_frames")
        .join(continue_frame_file_name(external_id, episode_number))
}

/// A frame is only worth keeping for a real mid-episode stop: some time in,
/// and not already at the credits of a finished file.
pub fn worth_capturing(position_secs: f64, duration_secs: f64) -> bool {
    position_secs > 5.0 && (duration_secs <= 0.0 || position_secs < duration_secs - 1.0)
}

/// Records the stop for Home's Continue card (see migration 77).
pub fn record_frame(
    conn: &rusqlite::Connection,
    external_id: &str,
    episode_number: f64,
    frame_path: Option<&str>,
    position_secs: f64,
    duration_secs: f64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO continue_watching_frame (external_id, episode_number, frame_path, position_seconds, duration_seconds, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
         ON CONFLICT(external_id, episode_number) DO UPDATE SET
            frame_path = ?3, position_seconds = ?4, duration_seconds = ?5, updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![external_id, episode_number, frame_path, position_secs, duration_secs],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_is_filesystem_safe_and_per_episode() {
        assert_eq!(continue_frame_file_name("anime:21", 13.0), "anime_21_13.jpg");
        assert_eq!(continue_frame_file_name("series:1399:s2", 4.0), "series_1399_s2_4.jpg");
        assert_eq!(continue_frame_file_name("anime:1", 12.5), "anime_1_12_5.jpg");
        assert_eq!(continue_frame_file_name("a/b\\c", 1.0), "a_b_c_1.jpg");
    }

    #[test]
    fn path_lives_under_metadata_continue_frames() {
        let path = continue_frame_path(Path::new("/data"), "anime:21", 13.0);
        assert!(path.ends_with(Path::new("metadata").join("continue_frames").join("anime_21_13.jpg")));
    }

    #[test]
    fn only_mid_episode_stops_are_captured() {
        assert!(!worth_capturing(2.0, 1400.0));
        assert!(worth_capturing(600.0, 1400.0));
        assert!(!worth_capturing(1400.0, 1400.0));
        assert!(worth_capturing(600.0, 0.0));
    }

    #[test]
    fn record_frame_upserts_one_row_per_episode() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        record_frame(&conn, "anime:21", 13.0, Some("/a.jpg"), 100.0, 1400.0).unwrap();
        record_frame(&conn, "anime:21", 13.0, Some("/b.jpg"), 200.0, 1400.0).unwrap();
        let (count, path, pos): (i64, String, f64) = conn
            .query_row(
                "SELECT COUNT(*), MAX(frame_path), MAX(position_seconds) FROM continue_watching_frame",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((count, path.as_str(), pos), (1, "/b.jpg", 200.0));
    }
}
