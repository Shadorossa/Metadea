// Installed EA app titles (InstallData manifests plus the classic folders).

use std::path::PathBuf;
use super::common::{extract_xml_attr, synthetic_app_id, LocalGame};

fn ea_install_data_dir() -> Option<PathBuf> {
    std::env::var("PROGRAMDATA").ok().map(|prog_data| PathBuf::from(&prog_data).join("EA Desktop").join("InstallData"))
}

fn ea_classic_dirs() -> Vec<PathBuf> {
    ["C", "D", "E"]
        .iter()
        .flat_map(|drive| {
            [
                PathBuf::from(format!("{}:\\Program Files\\EA Games", drive)),
                PathBuf::from(format!("{}:\\EA Games", drive)),
            ]
        })
        .collect()
}

// Cheap change signature for scan_ea_games (see scan_cache.rs): the
// InstallData manifests root and the classic per-game folders.
pub(super) fn ea_scan_signature() -> Option<String> {
    let mut parts = Vec::new();
    if let Some(dir) = ea_install_data_dir() {
        parts.push(super::scan_cache::dir_tree_signature(&dir));
    }
    parts.extend(ea_classic_dirs().iter().map(|dir| super::scan_cache::dir_tree_signature(dir)));
    Some(super::scan_cache::join_signatures(parts))
}

pub(super) fn scan_ea_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    if let Some(install_data) = ea_install_data_dir() {
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

    for base_dir in ea_classic_dirs() {
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

    super::common::dedupe_by_name(&mut games);
    games
}
