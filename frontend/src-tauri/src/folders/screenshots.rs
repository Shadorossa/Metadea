// Per-work capture folder (`$PICTURES/Metadea/<work>/`): the folder-name
// sanitizing shared with emulator captures, and listing what was saved there.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
    fn sanitises_folder_names() {
        for (input, expected) in [
            // Ordinary names are untouched.
            ("Teen Titans", "Teen Titans"),
            ("Año Nuevo 2024", "Año Nuevo 2024"),
            // Reserved and control characters become underscores.
            (r#"a<b>c:d"e/f\g|h?i*j"#, "a_b_c_d_e_f_g_h_i_j"),
            ("a\tb\nc", "a_b_c"),
            ("***", "___"),
            // Whitespace, then dots, are trimmed; inner whitespace stays.
            ("  .Name.  ", "Name"),
            ("...Name...", "Name"),
            (". Name .", " Name "),
            // Nothing usable left: the default name.
            ("", "Obra"),
            ("   ", "Obra"),
            (".", "Obra"),
            ("..", "Obra"),
            ("...", "Obra"),
        ] {
            assert_eq!(sanitize_capture_folder_name(input), expected, "{input:?}");
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalScreenshot {
    pub path: String,
    pub thumbnail_path: String,
}

/// `$PICTURES/Metadea/<work>/`: where every capture of a work lives — the
/// built-in player's F12 frames and the emulator captures moved there by
/// emulator_captures — and the one folder get_local_screenshots lists.
pub(super) fn metadea_capture_dir(app_handle: &tauri::AppHandle, work_name: &str) -> Result<PathBuf, String> {
    use tauri::Manager;

    Ok(app_handle
        .path()
        .picture_dir()
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::PICTURES_DIR_LOCATE, e))?
        .join("Metadea")
        .join(sanitize_capture_folder_name(work_name)))
}

#[tauri::command]
pub async fn get_local_screenshots(
    app_handle: tauri::AppHandle,
    work_name: String,
) -> Result<Vec<LocalScreenshot>, String> {
    let screenshots_dir = metadea_capture_dir(&app_handle, &work_name)?;
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
