// User-configured plain folders: one game per subfolder (videojuegos route)
// and one visual novel per subfolder with its executable picked out.

use std::path::PathBuf;
use super::common::{synthetic_app_id, LocalGame};

// Cheap change signature for scan_local_folder/scan_vn_folder (see
// scan_cache.rs): the folder's own listing plus each game folder's mtime.
pub(super) fn local_folder_signature(folder: &str) -> Option<String> {
    Some(super::scan_cache::join_signatures([folder.to_string(), super::scan_cache::dir_tree_signature(std::path::Path::new(folder))]))
}

pub(super) fn scan_local_folder(folder: &str) -> Vec<LocalGame> {
    let path = std::path::Path::new(folder);
    if !path.is_dir() {
        return vec![];
    }
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| {
                    let install_path = e.path().to_string_lossy().to_string();
                    LocalGame::installed(
                        e.file_name().to_string_lossy().to_string(),
                        "local",
                        Some(synthetic_app_id("local", &install_path)),
                        Some(install_path),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn scan_vn_folder(folder: &str) -> Vec<LocalGame> {
    let path = std::path::Path::new(folder);
    if !path.is_dir() {
        return vec![];
    }
    let mut games = Vec::new();
    let Ok(entries) = std::fs::read_dir(path) else {
        return games;
    };

    for entry in entries.flatten() {
        let sub_path = entry.path();
        if !sub_path.is_dir() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let Ok(sub_entries) = std::fs::read_dir(&sub_path) else {
            continue;
        };

        let mut exe_candidates: Vec<PathBuf> = Vec::new();
        for file_entry in sub_entries.flatten() {
            let file_path = file_entry.path();
            if file_path.is_file() {
                if let Some(ext) = file_path.extension().and_then(|s| s.to_str()) {
                    if ext.eq_ignore_ascii_case("exe") {
                        let stem = file_path
                            .file_stem()
                            .map(|s| s.to_string_lossy().to_lowercase())
                            .unwrap_or_default();
                        if !stem.starts_with("unins")
                            && stem != "uninstall"
                            && !stem.contains("crashhandler")
                            && !stem.contains("crashpad")
                        {
                            exe_candidates.push(file_path);
                        }
                    }
                }
            }
        }

        if exe_candidates.is_empty() {
            continue;
        }

        let chosen_exe = exe_candidates
            .iter()
            .find(|p| {
                p.file_stem()
                    .map(|s| s.to_string_lossy().eq_ignore_ascii_case(&folder_name))
                    .unwrap_or(false)
            })
            .or_else(|| {
                exe_candidates.iter().find(|p| {
                    p.file_stem()
                        .map(|s| {
                            let st = s.to_string_lossy().to_lowercase();
                            st == "game" || st.ends_with("game")
                        })
                        .unwrap_or(false)
                })
            })
            .unwrap_or(&exe_candidates[0]);

        let install_path = chosen_exe.to_string_lossy().to_string();
        let mut game = LocalGame::installed(
            folder_name,
            "local",
            Some(synthetic_app_id("local", &install_path)),
            Some(install_path),
        );
        game.rom_platform = Some("vnovel".to_string());
        games.push(game);
    }

    games
}
