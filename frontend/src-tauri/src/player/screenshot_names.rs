// F12 capture naming for the built-in player. folders/screenshots.rs keeps
// its own `sanitize_capture_folder_name` (`pub(super)`, used for emulator
// captures and listing); the output must match byte for byte because both
// resolve the same `$PICTURES/Metadea/<work>/` folder and
// MediaScreenshotsSection lists everything in it together.

use std::path::{Path, PathBuf};

pub fn sanitize_capture_folder_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let sanitized = sanitized.trim().trim_matches('.');
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        "Obra".to_string()
    } else {
        sanitized.to_string()
    }
}

pub fn screenshot_timecode(position_millis: u64) -> String {
    let hours = position_millis / 3_600_000;
    let minutes = (position_millis % 3_600_000) / 60_000;
    let seconds = (position_millis % 60_000) / 1_000;
    let milliseconds = position_millis % 1_000;
    format!("{hours:02}h{minutes:02}m{seconds:02}s{milliseconds:03}")
}

pub fn screenshot_file_name(work_name: &str, episode_label: &str, position_millis: u64) -> String {
    let title: String = sanitize_capture_folder_name(work_name).chars().take(100).collect();
    format!("{title} - {episode_label} - {}.png", screenshot_timecode(position_millis))
}

/// The label the capture carries for queue entry `index`, with the same
/// fallbacks used when the label list is short.
pub fn episode_label_for_index(episode_labels: &[String], index: usize) -> String {
    episode_labels
        .get(index)
        .cloned()
        .or_else(|| (episode_labels.len() == 1).then(|| episode_labels[0].clone()))
        .unwrap_or_else(|| "Episodio".to_string())
}

pub fn available_screenshot_path(directory: &Path, filename: &str) -> PathBuf {
    let preferred = directory.join(filename);
    if !preferred.exists() {
        return preferred;
    }
    let stem = preferred.file_stem().unwrap_or_default().to_string_lossy().into_owned();
    for suffix in 2u32.. {
        let candidate = directory.join(format!("{stem}-{suffix}.png"));
        if !candidate.exists() {
            return candidate;
        }
    }
    preferred
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_uses_work_episode_and_timecode() {
        assert_eq!(
            screenshot_file_name("Teen Titans", "S01E25", 3_723_456),
            "Teen Titans - S01E25 - 01h02m03s456.png"
        );
    }

    #[test]
    fn folder_name_sanitizing_mirrors_the_folders_helper() {
        assert_eq!(sanitize_capture_folder_name(r#"a<b>c:d"e/f\g|h?i*j"#), "a_b_c_d_e_f_g_h_i_j");
        assert_eq!(sanitize_capture_folder_name("  .Name.  "), "Name");
        assert_eq!(sanitize_capture_folder_name(""), "Obra");
        assert_eq!(sanitize_capture_folder_name(".."), "Obra");
    }

    #[test]
    fn label_falls_back_to_single_label_then_generic() {
        let labels = vec!["S01E01".to_string(), "S01E02".to_string()];
        assert_eq!(episode_label_for_index(&labels, 1), "S01E02");
        assert_eq!(episode_label_for_index(&labels, 5), "Episodio");
        assert_eq!(episode_label_for_index(&["Movie".to_string()], 3), "Movie");
        assert_eq!(episode_label_for_index(&[], 0), "Episodio");
    }

    #[test]
    fn timecode_rolls_over_hours() {
        assert_eq!(screenshot_timecode(0), "00h00m00s000");
        assert_eq!(screenshot_timecode(36_000_000 + 59_999), "10h00m59s999");
    }

    #[test]
    fn available_path_keeps_the_preferred_name_when_free() {
        let dir = std::env::temp_dir().join("metadea-player-screenshot-names-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let first = available_screenshot_path(&dir, "a.png");
        assert_eq!(first, dir.join("a.png"));
        std::fs::write(&first, b"x").unwrap();
        assert_eq!(available_screenshot_path(&dir, "a.png"), dir.join("a-2.png"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
