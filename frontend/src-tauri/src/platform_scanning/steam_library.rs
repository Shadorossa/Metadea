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

// Every steamapps directory: the root's own plus each extra library
// folder listed in libraryfolders.vdf.
// Compared by normalized_path: the registry's SteamPath is spelled
// "c:/program files (x86)/steam" while libraryfolders.vdf lists the same
// root as "C:\Program Files (x86)\Steam", and a plain PathBuf comparison
// kept both, so every game in the main library was scanned twice.
pub(super) fn steam_library_paths(steam_root: &std::path::Path) -> Vec<PathBuf> {
    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
    let content = std::fs::read_to_string(&vdf_path).unwrap_or_default();
    library_paths_from_vdf(steam_root, &content, |path| path.exists())
}

fn library_paths_from_vdf(steam_root: &std::path::Path, content: &str, exists: impl Fn(&std::path::Path) -> bool) -> Vec<PathBuf> {
    let mut library_paths: Vec<PathBuf> = vec![steam_root.join("steamapps")];
    let mut seen: std::collections::HashSet<String> =
        library_paths.iter().map(|p| super::common::normalized_path(&p.to_string_lossy())).collect();

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
                if exists(&lib_path) && seen.insert(super::common::normalized_path(&lib_path.to_string_lossy())) {
                    library_paths.push(lib_path);
                }
            }
        }
    }
    library_paths
}

// Cheap change signature for scan_steam_games (see scan_cache.rs): the
// library list file plus every appmanifest's name/mtime/size per library.
pub(super) fn steam_scan_signature() -> Option<String> {
    let Some(root) = steam_root() else { return Some("absent".into()) };
    let vdf = root.join("steamapps").join("libraryfolders.vdf");
    let parts = std::iter::once(super::scan_cache::path_signature(&vdf)).chain(
        steam_library_paths(&root).into_iter().map(|lib| {
            super::scan_cache::dir_children_signature(&lib, |name, _| name.starts_with("appmanifest_") && name.ends_with(".acf"))
        }),
    );
    Some(super::scan_cache::join_signatures(parts))
}

pub(super) fn scan_steam_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    let steam_root = match steam_root() {
        Some(r) => r,
        None => return games,
    };
    let library_paths = steam_library_paths(&steam_root);

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

#[cfg(test)]
mod tests {
    use super::*;

    // The owner's own setup: HKCU SteamPath "c:/program files (x86)/steam",
    // libraryfolders.vdf listing that same root in its own spelling.
    #[test]
    fn the_root_library_is_listed_once_however_it_is_spelled() {
        let vdf = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\Program Files (x86)\Steam"
	}
	"1"
	{
		"path"		"D:\SteamLibrary"
	}
}
"#;
        let paths = library_paths_from_vdf(std::path::Path::new("c:/program files (x86)/steam"), vdf, |_| true);
        let normalized: Vec<String> = paths.iter().map(|p| crate::platform_scanning::common::normalized_path(&p.to_string_lossy())).collect();
        assert_eq!(normalized, vec!["c:/program files (x86)/steam/steamapps", "d:/steamlibrary/steamapps"]);
    }
}
