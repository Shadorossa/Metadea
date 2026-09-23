// Installed EA app titles (InstallData manifests plus the classic folders).

use std::path::PathBuf;
use super::common::{extract_xml_attr, synthetic_app_id, LocalGame};

pub(super) fn scan_ea_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    if let Ok(prog_data) = std::env::var("PROGRAMDATA") {
        let install_data = PathBuf::from(&prog_data)
            .join("EA Desktop")
            .join("InstallData");
        if install_data.exists() {
            if let Ok(entries) = std::fs::read_dir(&install_data) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    let manifest = path.join("__Installer").join("installerdata.xml");
                    if manifest.exists() {
                        if let Ok(content) = std::fs::read_to_string(&manifest) {
                            if let Some(name) = extract_xml_attr(&content, "displayName")
                                .or_else(|| extract_xml_attr(&content, "title"))
                            {
                                let install_path = path.to_string_lossy().to_string();
                                games.push(LocalGame::installed(
                                    name,
                                    "ea",
                                    Some(synthetic_app_id("ea", &install_path)),
                                    Some(install_path),
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    for drive in &["C", "D", "E"] {
        for base in &[
            format!("{}:\\Program Files\\EA Games", drive),
            format!("{}:\\EA Games", drive),
        ] {
            let base_dir = PathBuf::from(base);
            if !base_dir.exists() {
                continue;
            }
            if let Ok(entries) = std::fs::read_dir(&base_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    let has_exe = std::fs::read_dir(&path)
                        .ok()
                        .map(|mut d| {
                            d.any(|e| {
                                e.ok().is_some_and(|f| {
                                    f.path().extension().is_some_and(|ext| ext == "exe")
                                })
                            })
                        })
                        .unwrap_or(false);
                    if has_exe {
                        if let Some(name) =
                            path.file_name().map(|n| n.to_string_lossy().to_string())
                        {
                            let install_path = path.to_string_lossy().to_string();
                            games.push(LocalGame::installed(
                                name,
                                "ea",
                                Some(synthetic_app_id("ea", &install_path)),
                                Some(install_path),
                            ));
                        }
                    }
                }
            }
        }
    }

    games.dedup_by(|a, b| a.name == b.name);
    games
}
