// Installed Xbox app / Game Pass titles.

use std::path::PathBuf;
use super::common::{extract_xml_attr, synthetic_app_id, LocalGame};

pub(super) fn scan_xbox_games() -> Vec<LocalGame> {
    let mut games = Vec::new();
    let mut candidates: Vec<PathBuf> = Vec::new();

    for drive in &["C", "D", "E", "F"] {
        candidates.push(PathBuf::from(format!("{}:\\XboxGames", drive)));
        candidates.push(PathBuf::from(format!("{}:\\Xbox Games", drive)));
        candidates.push(PathBuf::from(format!("{}:\\Games\\Xbox Game Pass", drive)));
        candidates.push(PathBuf::from(format!("{}:\\Games\\XboxGames", drive)));

        let root_file = PathBuf::from(format!("{}:\\GamingRootMetadata.json", drive));
        if root_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&root_file) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(paths) = json["ContentDirectories"].as_array() {
                        for p in paths {
                            if let Some(s) = p.as_str() {
                                candidates.push(PathBuf::from(s));
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let keys = [
            "SOFTWARE\\Microsoft\\GamingServices",
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR",
        ];
        for key_path in &keys {
            if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(key_path) {
                if let Ok(path) = key.get_value::<String, _>("PackageRoot") {
                    candidates.push(PathBuf::from(path));
                }
            }
        }
    }

    candidates.dedup();

    for base_dir in &candidates {
        if !base_dir.exists() {
            continue;
        }
        let entries = match std::fs::read_dir(base_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let content_config = path.join("Content").join("MicrosoftGame.config");
            let config = if content_config.exists() {
                content_config
            } else {
                path.join("MicrosoftGame.config")
            };

            let content_msix = path.join("Content").join("AppxManifest.xml");
            let msix = if content_msix.exists() {
                content_msix
            } else {
                path.join("AppxManifest.xml")
            };

            let name: Option<String> = if config.exists() {
                if let Ok(c) = std::fs::read_to_string(&config) {
                    extract_xml_attr(&c, "DefaultDisplayName")
                        .or_else(|| extract_xml_attr(&c, "Name"))
                        .or_else(|| extract_xml_attr(&c, "TitleId"))
                } else {
                    None
                }
            } else if msix.exists() {
                if let Ok(c) = std::fs::read_to_string(&msix) {
                    extract_xml_attr(&c, "DisplayName")
                } else {
                    None
                }
            } else {
                path.file_name().map(|n| {
                    let s = n.to_string_lossy().to_string();
                    if let Some(idx) = s.rfind('.') {
                        let after = &s[idx + 1..];
                        if !after.is_empty()
                            && after
                                .chars()
                                .next()
                                .map(|c| c.is_uppercase())
                                .unwrap_or(false)
                        {
                            return after.to_string();
                        }
                    }
                    s
                })
            };

            if let Some(name) = name {
                if name.starts_with("ms-resource:") || name.is_empty() {
                    continue;
                }
                let install_path = path.to_string_lossy().to_string();
                games.push(LocalGame::installed(
                    name,
                    "xbox",
                    Some(synthetic_app_id("xbox", &install_path)),
                    Some(install_path),
                ));
            }
        }
    }

    games.dedup_by(|a, b| a.name == b.name);
    games
}
