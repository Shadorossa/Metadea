// Installed Epic Games Launcher titles (ProgramData manifests).

use std::path::PathBuf;
use super::common::LocalGame;

fn epic_manifests_dir() -> Option<PathBuf> {
    std::env::var("PROGRAMDATA").ok().map(|prog_data| {
        PathBuf::from(&prog_data)
            .join("Epic")
            .join("EpicGamesLauncher")
            .join("Data")
            .join("Manifests")
    })
}

// Cheap change signature for scan_epic_games (see scan_cache.rs): every
// *.item manifest's name/mtime/size.
pub(super) fn epic_scan_signature() -> Option<String> {
    let Some(dir) = epic_manifests_dir() else { return Some("absent".into()) };
    Some(super::scan_cache::dir_children_signature(&dir, |name, _| name.ends_with(".item")))
}

pub(super) fn scan_epic_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    if let Some(manifests_dir) = epic_manifests_dir() {
        if manifests_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&manifests_dir) {
                for entry in entries.flatten() {
                    if entry.path().extension().is_some_and(|e| e == "item") {
                        if let Ok(content) = std::fs::read_to_string(entry.path()) {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                let name = json["DisplayName"].as_str().unwrap_or("").to_string();
                                let install_path =
                                    json["InstallLocation"].as_str().map(|s| s.to_string());
                                let app_id = json["CatalogItemId"].as_str().map(|s| s.to_string());
                                let is_game = json["bIsApplication"].as_bool().unwrap_or(true);
                                if !name.is_empty() && is_game {
                                    games.push(LocalGame::installed(
                                    name,
                                    "epic",
                                    app_id,
                                    install_path,
                                ));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    games
}
