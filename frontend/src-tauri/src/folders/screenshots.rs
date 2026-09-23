// VLC F12 captures: watching the capture folder, naming each file after the
// work/episode/timecode, and listing what was saved.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use super::toast_window::{show_screenshot_toast, ScreenshotToastPayload};
use super::vlc::read_vlc_screenshot_position;

struct PendingVlcScreenshot {
    path: PathBuf,
    size: u64,
    stable_checks: u8,
    episode_label: String,
    position_millis: u64,
}

fn basename_lower(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_lowercase()
}

fn extract_episode_label(filename: &str) -> Option<String> {
    let bytes = filename.as_bytes();
    for start in 0..bytes.len() {
        if !matches!(bytes[start].to_ascii_uppercase(), b'S') {
            continue;
        }
        let season_start = start + 1;
        let mut episode_marker = season_start;
        while episode_marker < bytes.len() && bytes[episode_marker].is_ascii_digit() {
            episode_marker += 1;
        }
        if episode_marker == season_start
            || episode_marker >= bytes.len()
            || !bytes[episode_marker].eq_ignore_ascii_case(&b'E')
        {
            continue;
        }
        let episode_start = episode_marker + 1;
        let mut end = episode_start;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        if end == episode_start {
            continue;
        }
        let season = filename[season_start..episode_marker].parse::<u32>().ok()?;
        let episode = filename[episode_start..end].parse::<u32>().ok()?;
        return Some(format!("S{season:02}E{episode:02}"));
    }
    None
}

fn resolve_screenshot_episode_label(
    current_filename: &str,
    file_paths: &[String],
    episode_labels: &[String],
) -> String {
    let current_basename = basename_lower(current_filename);
    if let Some((_, label)) = file_paths.iter().zip(episode_labels).find(|(path, _)| {
        basename_lower(path) == current_basename
    }) {
        return label.clone();
    }
    extract_episode_label(current_filename)
        .or_else(|| (episode_labels.len() == 1).then(|| episode_labels[0].clone()))
        .unwrap_or_else(|| "Episodio".to_string())
}

fn screenshot_timecode(position_millis: u64) -> String {
    let hours = position_millis / 3_600_000;
    let minutes = (position_millis % 3_600_000) / 60_000;
    let seconds = (position_millis % 60_000) / 1_000;
    let milliseconds = position_millis % 1_000;
    format!("{hours:02}h{minutes:02}m{seconds:02}s{milliseconds:03}")
}

fn screenshot_file_name(work_name: &str, episode_label: &str, position_millis: u64) -> String {
    let title: String = sanitize_capture_folder_name(work_name).chars().take(100).collect();
    format!("{title} - {episode_label} - {}.png", screenshot_timecode(position_millis))
}

#[cfg(test)]
mod screenshot_file_name_tests {
    use super::screenshot_file_name;

    #[test]
    fn includes_milliseconds_after_the_episode_timecode() {
        assert_eq!(
            screenshot_file_name("Teen Titans", "S01E25", 3_723_456),
            "Teen Titans - S01E25 - 01h02m03s456.png"
        );
    }
}

#[cfg(test)]
mod extract_episode_label_tests {
    use super::extract_episode_label;

    #[test]
    fn finds_standard_season_episode_marker() {
        assert_eq!(extract_episode_label("Show.S01E05.1080p.mkv"), Some("S01E05".to_string()));
    }

    #[test]
    fn is_case_insensitive_and_zero_pads_to_two_digits() {
        assert_eq!(extract_episode_label("show s2e3.mkv"), Some("S02E03".to_string()));
    }

    #[test]
    fn keeps_more_than_two_digits() {
        assert_eq!(extract_episode_label("S1E123"), Some("S01E123".to_string()));
        assert_eq!(extract_episode_label("S100E1"), Some("S100E01".to_string()));
    }

    #[test]
    fn returns_first_match_when_several_are_present() {
        assert_eq!(extract_episode_label("S01E02 S03E04"), Some("S01E02".to_string()));
    }

    #[test]
    fn returns_none_without_a_full_marker() {
        assert_eq!(extract_episode_label("Show.S01.mkv"), None);
        assert_eq!(extract_episode_label("Show.SE01.mkv"), None);
        assert_eq!(extract_episode_label("Show.S01E.mkv"), None);
        assert_eq!(extract_episode_label("Season 1 Episode 2"), None);
        assert_eq!(extract_episode_label("Show 1x02.mkv"), None);
        assert_eq!(extract_episode_label(""), None);
    }

    #[test]
    fn does_not_require_a_word_boundary_before_the_s() {
        assert_eq!(extract_episode_label("Bus1e2.mkv"), Some("S01E02".to_string()));
    }

    #[test]
    fn non_ascii_prefix_does_not_break_slicing() {
        assert_eq!(extract_episode_label("Épisode S01E02.mkv"), Some("S01E02".to_string()));
    }

    #[test]
    fn overflowing_season_number_aborts_instead_of_trying_later_markers() {
        assert_eq!(extract_episode_label("S99999999999E01 S01E02"), None);
    }
}

#[cfg(test)]
mod resolve_screenshot_episode_label_tests {
    use super::resolve_screenshot_episode_label;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn uses_label_of_matching_basename_ignoring_case_and_directory() {
        let paths = strings(&[r"C:\Series\Ep One.mkv", "/mnt/series/Ep Two.mkv"]);
        let labels = strings(&["S01E01", "S01E02"]);
        assert_eq!(
            resolve_screenshot_episode_label("/other/dir/EP TWO.MKV", &paths, &labels),
            "S01E02"
        );
    }

    #[test]
    fn basename_match_wins_over_pattern_in_filename() {
        let paths = strings(&["Show.S09E09.mkv"]);
        let labels = strings(&["Custom"]);
        assert_eq!(
            resolve_screenshot_episode_label("Show.S09E09.mkv", &paths, &labels),
            "Custom"
        );
    }

    #[test]
    fn falls_back_to_pattern_extracted_from_filename() {
        let paths = strings(&["a.mkv"]);
        let labels = strings(&["S01E01"]);
        assert_eq!(
            resolve_screenshot_episode_label("Show.S02E07.mkv", &paths, &labels),
            "S02E07"
        );
    }

    #[test]
    fn falls_back_to_the_only_label_when_exactly_one_exists() {
        let paths = strings(&["a.mkv"]);
        let labels = strings(&["Movie"]);
        assert_eq!(resolve_screenshot_episode_label("b.mkv", &paths, &labels), "Movie");
    }

    #[test]
    fn falls_back_to_generic_label_otherwise() {
        let paths = strings(&["a.mkv", "b.mkv"]);
        let labels = strings(&["L1", "L2"]);
        assert_eq!(resolve_screenshot_episode_label("c.mkv", &paths, &labels), "Episodio");
        assert_eq!(resolve_screenshot_episode_label("c.mkv", &[], &[]), "Episodio");
    }

    #[test]
    fn paths_without_a_paired_label_are_ignored() {
        let paths = strings(&["a.mkv", "b.mkv", "c.mkv"]);
        let labels = strings(&["L1", "L2"]);
        assert_eq!(resolve_screenshot_episode_label("c.mkv", &paths, &labels), "Episodio");
    }
}

fn available_screenshot_path(directory: &std::path::Path, filename: &str) -> PathBuf {
    let preferred = directory.join(filename);
    if !preferred.exists() {
        return preferred;
    }

    let stem = preferred.file_stem().unwrap_or_default().to_string_lossy();
    for suffix in 2u32.. {
        let candidate = directory.join(format!("{stem}-{suffix}.png"));
        if !candidate.exists() {
            return candidate;
        }
    }
    preferred
}

pub(super) async fn watch_and_rename_vlc_screenshots(
    mut child: std::process::Child,
    app_handle: tauri::AppHandle,
    capture_dir: PathBuf,
    work_name: String,
    file_paths: Vec<String>,
    episode_labels: Vec<String>,
) {
    use std::time::{Duration, Instant};

    let mut seen = std::collections::HashSet::new();
    if let Ok(entries) = std::fs::read_dir(&capture_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) == Some("png")
                && path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("Metadea-"))
            {
                seen.insert(path);
            }
        }
    }

    let client = crate::http::http_client();
    let mut pending: Vec<PendingVlcScreenshot> = Vec::new();
    let mut child_exited_at: Option<Instant> = None;

    loop {
        tokio::time::sleep(Duration::from_millis(150)).await;

        let mut discovered = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&capture_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let is_capture = path.is_file()
                    && path.extension().and_then(|extension| extension.to_str()) == Some("png")
                    && path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("Metadea-"));
                if is_capture && !seen.contains(&path) {
                    seen.insert(path.clone());
                    discovered.push(path);
                }
            }
        }

        if !discovered.is_empty() {
            let current = read_vlc_screenshot_position(client).await;
            for path in discovered {
                let (episode_label, position_millis) = current.as_ref().map_or_else(
                    || ("Episodio".to_string(), 0),
                    |(filename, position)| (
                        resolve_screenshot_episode_label(filename, &file_paths, &episode_labels),
                        *position,
                    ),
                );
                let size = std::fs::metadata(&path).map(|metadata| metadata.len()).unwrap_or_default();
                pending.push(PendingVlcScreenshot {
                    path,
                    size,
                    stable_checks: 0,
                    episode_label,
                    position_millis,
                });
            }
        }

        let mut index = 0;
        while index < pending.len() {
            let capture = &mut pending[index];
            let current_size = std::fs::metadata(&capture.path)
                .map(|metadata| metadata.len())
                .unwrap_or_default();
            if current_size > 0 && current_size == capture.size {
                capture.stable_checks = capture.stable_checks.saturating_add(1);
            } else {
                capture.size = current_size;
                capture.stable_checks = 0;
            }

            if capture.stable_checks < 2 {
                index += 1;
                continue;
            }

            let filename = screenshot_file_name(&work_name, &capture.episode_label, capture.position_millis);
            let destination = available_screenshot_path(&capture_dir, &filename);
            if std::fs::rename(&capture.path, destination).is_ok() {
                show_screenshot_toast(&app_handle, ScreenshotToastPayload {
                    work_name: work_name.clone(),
                    episode_label: capture.episode_label.clone(),
                    timecode: screenshot_timecode(capture.position_millis),
                });
                pending.remove(index);
            } else {
                index += 1;
            }
        }

        if child_exited_at.is_none() {
            match child.try_wait() {
                Ok(Some(_)) | Err(_) => child_exited_at = Some(Instant::now()),
                Ok(None) => {}
            }
        }
        if child_exited_at.is_some_and(|exited| exited.elapsed() >= Duration::from_secs(5)) {
            break;
        }
    }
}

pub(super) fn sanitize_capture_folder_name(name: &str) -> String {
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

#[cfg(test)]
mod sanitize_capture_folder_name_tests {
    use super::sanitize_capture_folder_name;

    #[test]
    fn keeps_ordinary_names_untouched() {
        assert_eq!(sanitize_capture_folder_name("Teen Titans"), "Teen Titans");
        assert_eq!(sanitize_capture_folder_name("Año Nuevo 2024"), "Año Nuevo 2024");
    }

    #[test]
    fn replaces_reserved_characters_and_control_chars_with_underscore() {
        assert_eq!(
            sanitize_capture_folder_name(r#"a<b>c:d"e/f\g|h?i*j"#),
            "a_b_c_d_e_f_g_h_i_j"
        );
        assert_eq!(sanitize_capture_folder_name("a\tb\nc"), "a_b_c");
    }

    #[test]
    fn trims_surrounding_whitespace_then_dots() {
        assert_eq!(sanitize_capture_folder_name("  .Name.  "), "Name");
        assert_eq!(sanitize_capture_folder_name("...Name..."), "Name");
    }

    #[test]
    fn inner_whitespace_left_after_dot_trimming_is_kept() {
        assert_eq!(sanitize_capture_folder_name(". Name ."), " Name ");
    }

    #[test]
    fn falls_back_to_default_when_nothing_usable_remains() {
        assert_eq!(sanitize_capture_folder_name(""), "Obra");
        assert_eq!(sanitize_capture_folder_name("   "), "Obra");
        assert_eq!(sanitize_capture_folder_name("."), "Obra");
        assert_eq!(sanitize_capture_folder_name(".."), "Obra");
        assert_eq!(sanitize_capture_folder_name("..."), "Obra");
    }

    #[test]
    fn a_name_made_only_of_reserved_characters_becomes_underscores() {
        assert_eq!(sanitize_capture_folder_name("***"), "___");
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalScreenshot {
    pub path: String,
    pub thumbnail_path: String,
}

#[tauri::command]
pub async fn get_local_screenshots(
    app_handle: tauri::AppHandle,
    work_name: String,
) -> Result<Vec<LocalScreenshot>, String> {
    use tauri::Manager;

    let screenshots_dir = app_handle
        .path()
        .picture_dir()
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::PICTURES_DIR_LOCATE, e))?
        .join("Metadea")
        .join(sanitize_capture_folder_name(&work_name));
    let entries = match std::fs::read_dir(screenshots_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };

    let mut screenshots: Vec<(std::time::SystemTime, LocalScreenshot)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let extension = path.extension()?.to_str()?.to_ascii_lowercase();
            if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().unwrap_or(std::time::UNIX_EPOCH);
            let path = path.to_string_lossy().into_owned();
            Some((modified, LocalScreenshot { path: path.clone(), thumbnail_path: path }))
        })
        .collect();
    screenshots.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    Ok(screenshots.into_iter().map(|(_, screenshot)| screenshot).collect())
}

// ── Emulator screenshots ──────────────────────────────────────────────────
// The emulator's own capture folder (emulator_configs.screenshots_dir, or
// the layout emulators::default_screenshots_dirs detects), narrowed to one
// game when the emulator names captures after it.

const MAX_EMULATOR_SCREENSHOTS: usize = 200;

#[derive(Debug, Serialize, Deserialize)]
pub struct EmulatorScreenshots {
    pub screenshots: Vec<LocalScreenshot>,
    // false when nothing in the folder could be tied to this game, so the
    // list is the emulator's most recent captures for the platform instead.
    pub filtered: bool,
}

fn is_image_file(path: &std::path::Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| matches!(extension.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp"))
}

// Lowercase alphanumerics only, so "Zelda - Twilight Princess" matches
// "zelda_twilight_princess_20240101.png" whatever separators either uses.
fn normalized_key(text: &str) -> String {
    text.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

// Keys a capture's file name must start with to count as this game's:
// the ROM's own file stem, the display title and the header id/title.
// Shorter than 3 characters would match nearly everything, so those are
// dropped.
pub(crate) fn game_match_keys(rom_path: &str, title: Option<&str>, header_id: Option<&str>, header_title: Option<&str>) -> Vec<String> {
    let rom_stem = std::path::Path::new(rom_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.split(['(', '[']).next().unwrap_or(stem));
    let mut keys: Vec<String> = [rom_stem, title, header_id, header_title]
        .into_iter()
        .flatten()
        .map(normalized_key)
        .filter(|key| key.chars().count() >= 3)
        .collect();
    keys.sort();
    keys.dedup();
    keys
}

pub(crate) fn screenshot_matches_game(file_name: &str, keys: &[String]) -> bool {
    let stem = file_name.rsplit_once('.').map_or(file_name, |(stem, _)| stem);
    let normalized = normalized_key(stem);
    !normalized.is_empty() && keys.iter().any(|key| normalized.starts_with(key.as_str()))
}

fn images_in_dir(dir: &std::path::Path) -> Vec<(std::time::SystemTime, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !is_image_file(&path) {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().unwrap_or(std::time::UNIX_EPOCH);
            Some((modified, path))
        })
        .collect()
}

// Newest first, at most MAX_EMULATOR_SCREENSHOTS. Dolphin keeps one
// subfolder per GameID: when it exists that folder is the whole answer.
// Otherwise the flat folder is narrowed by file name, and when nothing in
// it names this game the emulator's recent captures are returned unfiltered
// so the user still sees something (flagged, so the UI can say so).
pub(crate) fn list_emulator_screenshots(dir: &std::path::Path, keys: &[String], header_id: Option<&str>) -> (Vec<PathBuf>, bool) {
    let (mut images, filtered) = match header_id.map(|id| dir.join(id)).filter(|sub| sub.is_dir()) {
        Some(game_dir) => (images_in_dir(&game_dir), true),
        None => {
            let all = images_in_dir(dir);
            let own: Vec<_> = all
                .iter()
                .filter(|(_, path)| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| screenshot_matches_game(name, keys)))
                .cloned()
                .collect();
            if own.is_empty() { (all, false) } else { (own, true) }
        }
    };
    images.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    images.truncate(MAX_EMULATOR_SCREENSHOTS);
    (images.into_iter().map(|(_, path)| path).collect(), filtered)
}

#[tauri::command]
pub async fn get_emulator_screenshots(
    app_handle: tauri::AppHandle,
    platform_id: String,
    rom_path: String,
    header_id: Option<String>,
    title: Option<String>,
) -> Result<EmulatorScreenshots, String> {
    use tauri::Manager;

    let config = {
        let db = app_handle.state::<crate::db::MetadeaDb>();
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::emulators::emulator_config_for_platform(&conn, &platform_id)?
    };
    let Some(config) = config else {
        return Ok(EmulatorScreenshots { screenshots: Vec::new(), filtered: true });
    };
    let user_dirs = crate::emulators::UserDirs {
        documents: app_handle.path().document_dir().ok(),
        data: app_handle.path().data_dir().ok(),
    };
    let Some(dir) = crate::emulators::resolve_screenshots_dir(&config, &user_dirs) else {
        return Ok(EmulatorScreenshots { screenshots: Vec::new(), filtered: true });
    };

    // The header id/title come from the ROM itself when the caller has none
    // (Dolphin's per-game folder is named after the disc's game id).
    let header = if header_id.is_none() {
        crate::platform_scanning::rom_header::read_rom_header(std::path::Path::new(&rom_path))
    } else {
        None
    };
    let header_id = header_id.or_else(|| header.as_ref().map(|h| h.game_id.clone()));
    let header_title = header.as_ref().and_then(|h| h.title.clone());
    let keys = game_match_keys(&rom_path, title.as_deref(), header_id.as_deref(), header_title.as_deref());

    let (paths, filtered) = list_emulator_screenshots(&dir, &keys, header_id.as_deref());
    // Same runtime widening steam_get_screenshots does: the folder is
    // wherever the emulator lives, so it cannot be in the static scope.
    let scope = app_handle.asset_protocol_scope();
    let _ = scope.allow_directory(&dir, false);
    if let Some(id) = header_id.as_deref() {
        let _ = scope.allow_directory(dir.join(id), false);
    }
    let screenshots = paths
        .into_iter()
        .map(|path| {
            let path = path.to_string_lossy().into_owned();
            LocalScreenshot { path: path.clone(), thumbnail_path: path }
        })
        .collect();
    Ok(EmulatorScreenshots { screenshots, filtered })
}

#[cfg(test)]
mod emulator_screenshot_tests {
    use super::*;

    #[test]
    fn match_keys_come_from_rom_stem_title_and_header_without_short_ones() {
        let keys = game_match_keys(r"C:\roms\Zelda - Twilight Princess (USA).rvz", Some("The Legend of Zelda"), Some("GZ2E01"), Some("ZELDA"));
        assert_eq!(keys, vec!["gz2e01", "thelegendofzelda", "zelda", "zeldatwilightprincess"]);
        assert!(game_match_keys("/roms/ab.nds", Some("ab"), None, None).is_empty());
    }

    #[test]
    fn file_names_match_by_normalized_prefix() {
        let keys = game_match_keys("/roms/Zelda - Twilight Princess.rvz", None, None, None);
        assert!(screenshot_matches_game("zelda_twilight_princess_2024-01-01.png", &keys));
        assert!(screenshot_matches_game("Zelda - Twilight Princess-1.PNG", &keys));
        assert!(!screenshot_matches_game("Metroid Prime-1.png", &keys));
        assert!(!screenshot_matches_game(".png", &keys));
    }

    fn touch(path: &std::path::Path, modified_secs_ago: u64) {
        std::fs::write(path, b"x").unwrap();
        let time = std::time::SystemTime::now() - std::time::Duration::from_secs(modified_secs_ago);
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_modified(time).unwrap();
    }

    #[test]
    fn listing_is_filtered_newest_first_and_bounded() {
        let dir = std::env::temp_dir().join(format!("metadea-emu-list-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..(MAX_EMULATOR_SCREENSHOTS + 5) {
            touch(&dir.join(format!("Game A_{i:04}.png")), (i as u64) * 10 + 1000);
        }
        touch(&dir.join("Game B_0001.png"), 1);
        touch(&dir.join("Game A_notes.txt"), 1);

        let keys = game_match_keys("/roms/Game A.iso", None, None, None);
        let (own, filtered) = list_emulator_screenshots(&dir, &keys, None);
        assert!(filtered);
        assert_eq!(own.len(), MAX_EMULATOR_SCREENSHOTS);
        assert!(own[0].ends_with("Game A_0000.png"), "{:?}", own[0]);
        assert!(own.iter().all(|p| p.to_string_lossy().contains("Game A_")));

        // Nothing named after this game: the recent captures, flagged.
        let keys = game_match_keys("/roms/Game C.iso", None, None, None);
        let (recent, filtered) = list_emulator_screenshots(&dir, &keys, None);
        assert!(!filtered);
        assert!(recent[0].ends_with("Game B_0001.png"));

        // Dolphin-style per-game folder wins over name matching.
        std::fs::create_dir_all(dir.join("GZ2E01")).unwrap();
        touch(&dir.join("GZ2E01").join("shot.png"), 5);
        let (game_dir, filtered) = list_emulator_screenshots(&dir, &keys, Some("GZ2E01"));
        assert!(filtered);
        assert_eq!(game_dir.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
