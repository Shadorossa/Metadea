// Installed Steam games: root lookup plus libraryfolders.vdf/appmanifest
// parsing. (The Steam Web API lives in crate::steam.)

use std::path::PathBuf;
use super::common::LocalGame;

#[cfg(windows)]
fn steam_root_from_registry() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
        if let Ok(path) = key.get_value::<String, _>("SteamPath") {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }
    if let Ok(key) =
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
    {
        if let Ok(path) = key.get_value::<String, _>("InstallPath") {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn steam_root_from_registry() -> Option<PathBuf> {
    None
}

/// Returns the Steam root directory (registry first, then common paths).
pub fn steam_root() -> Option<PathBuf> {
    let from_reg = steam_root_from_registry();
    if from_reg.is_some() {
        return from_reg;
    }
    let candidates: Vec<PathBuf> = ["C", "D", "E", "F"]
        .iter()
        .flat_map(|drive| {
            vec![
                PathBuf::from(format!("{}:\\Program Files (x86)\\Steam", drive)),
                PathBuf::from(format!("{}:\\Program Files\\Steam", drive)),
                PathBuf::from(format!("{}:\\Steam", drive)),
                PathBuf::from(format!("{}:\\Games\\Steam", drive)),
            ]
        })
        .collect();
    candidates
        .into_iter()
        .find(|p| p.join("steamapps").exists())
}

pub(super) fn scan_steam_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    let steam_root = match steam_root() {
        Some(r) => r,
        None => return games,
    };

    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
    let mut library_paths: Vec<PathBuf> = vec![steam_root.join("steamapps")];

    if let Ok(content) = std::fs::read_to_string(&vdf_path) {
        for line in content.lines() {
            let line = line.trim();
            if line.contains("\"path\"") {
                let parts: Vec<&str> = line.splitn(5, '"').collect();
                if parts.len() >= 4 {
                    let raw = parts[3];
                    let path_str = if raw.contains("\\\\") {
                        raw.replace("\\\\", "\\")
                    } else {
                        raw.to_string()
                    };
                    let lib_path = PathBuf::from(&path_str).join("steamapps");
                    if lib_path.exists() && !library_paths.contains(&lib_path) {
                        library_paths.push(lib_path);
                    }
                }
            }
        }
    }

    for lib_path in &library_paths {
        if let Ok(entries) = std::fs::read_dir(lib_path) {
            for entry in entries.flatten() {
                let fname = entry.file_name();
                let fname = fname.to_string_lossy();
                if fname.starts_with("appmanifest_") && fname.ends_with(".acf") {
                    if let Ok(content) = std::fs::read_to_string(entry.path()) {
                        let mut name = String::new();
                        let mut app_id = String::new();
                        let mut install_dir = String::new();
                        for line in content.lines() {
                            let line = line.trim();
                            let parts: Vec<&str> = line.splitn(5, '"').collect();
                            if parts.len() >= 4 {
                                match parts[1] {
                                    "name" => name = parts[3].to_string(),
                                    "appid" => app_id = parts[3].to_string(),
                                    "installdir" => install_dir = parts[3].to_string(),
                                    _ => {}
                                }
                            }
                        }
                        if !name.is_empty() && !app_id.is_empty() {
                            let is_blocked_id = matches!(
                                app_id.as_str(),
                                "228980" | // Steamworks Common Redistributables
                                "993090" | // Lossless Scaling
                                "388080" | // Borderless Gaming
                                "250820" | // SteamVR
                                "1113010" | // SteamVR Extensions
                                "1054830" // SteamVR Beta
                            );
                            let lower_name = name.to_lowercase();
                            let is_blocked_name = lower_name.contains("redistributable")
                                || lower_name.contains("dedicated server")
                                || lower_name.contains("steamworks")
                                || lower_name.contains("steamvr");

                            if !is_blocked_id && !is_blocked_name {
                                let install_path = lib_path
                                    .join("common")
                                    .join(&install_dir)
                                    .to_string_lossy()
                                    .to_string();
                                games.push(LocalGame::installed(
                                    name,
                                    "steam",
                                    Some(app_id),
                                    Some(install_path),
                                ));
                            }
                        }
                    }
                }
            }
        }
    }

    games
}
