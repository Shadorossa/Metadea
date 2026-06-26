use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalGame {
    pub name: String,
    pub launcher: String,
    pub app_id: Option<String>,
    pub install_path: Option<String>,
}

#[cfg(windows)]
fn steam_root_from_registry() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
        if let Ok(path) = key.get_value::<String, _>("SteamPath") {
            let p = PathBuf::from(path);
            if p.exists() { return Some(p); }
        }
    }
    if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam")
    {
        if let Ok(path) = key.get_value::<String, _>("InstallPath") {
            let p = PathBuf::from(path);
            if p.exists() { return Some(p); }
        }
    }
    None
}

#[cfg(not(windows))]
fn steam_root_from_registry() -> Option<PathBuf> { None }

fn scan_steam_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    let mut steam_root = steam_root_from_registry();

    if steam_root.is_none() {
        let mut candidates: Vec<PathBuf> = Vec::new();
        for drive in &["C", "D", "E", "F"] {
            candidates.push(PathBuf::from(format!("{}:\\Program Files (x86)\\Steam", drive)));
            candidates.push(PathBuf::from(format!("{}:\\Program Files\\Steam", drive)));
            candidates.push(PathBuf::from(format!("{}:\\Steam", drive)));
            candidates.push(PathBuf::from(format!("{}:\\Games\\Steam", drive)));
        }
        steam_root = candidates.into_iter().find(|p| p.join("steamapps").exists());
    }

    let steam_root = match steam_root {
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
                    let path_str = if raw.contains("\\\\")
                        { raw.replace("\\\\", "\\") }
                        else { raw.to_string() };
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
                                    "name"       => name        = parts[3].to_string(),
                                    "appid"      => app_id      = parts[3].to_string(),
                                    "installdir" => install_dir = parts[3].to_string(),
                                    _ => {}
                                }
                            }
                        }
                        if !name.is_empty() && !app_id.is_empty() {
                            let install_path = lib_path
                                .join("common")
                                .join(&install_dir)
                                .to_string_lossy()
                                .to_string();
                            games.push(LocalGame {
                                name,
                                launcher: "steam".to_string(),
                                app_id: Some(app_id),
                                install_path: Some(install_path),
                            });
                        }
                    }
                }
            }
        }
    }

    games
}

fn scan_epic_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    if let Ok(prog_data) = std::env::var("PROGRAMDATA") {
        let manifests_dir = PathBuf::from(&prog_data)
            .join("Epic")
            .join("EpicGamesLauncher")
            .join("Data")
            .join("Manifests");
        if manifests_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&manifests_dir) {
                for entry in entries.flatten() {
                    if entry.path().extension().map_or(false, |e| e == "item") {
                        if let Ok(content) = std::fs::read_to_string(entry.path()) {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                let name = json["DisplayName"].as_str().unwrap_or("").to_string();
                                let install_path = json["InstallLocation"].as_str().map(|s| s.to_string());
                                let app_id = json["CatalogItemId"].as_str().map(|s| s.to_string());
                                let is_game = json["bIsApplication"].as_bool().unwrap_or(true);
                                if !name.is_empty() && is_game {
                                    games.push(LocalGame {
                                        name,
                                        launcher: "epic".to_string(),
                                        app_id,
                                        install_path,
                                    });
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

fn scan_gog_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    let gog_dirs: Vec<PathBuf> = ["C", "D", "E"].iter().flat_map(|drive| vec![
        PathBuf::from(format!("{}:\\GOG Games", drive)),
        PathBuf::from(format!("{}:\\Program Files (x86)\\GOG Galaxy\\Games", drive)),
        PathBuf::from(format!("{}:\\Games\\GOG", drive)),
    ]).collect();

    for base_dir in &gog_dirs {
        if !base_dir.exists() { continue; }
        if let Ok(entries) = std::fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() { continue; }
                let game_dir = entry.path();
                let gameinfo = game_dir.join("gameinfo");
                if gameinfo.exists() {
                    if let Ok(content) = std::fs::read_to_string(&gameinfo) {
                        let name = content.lines().next().map(|s| s.trim().to_string()).unwrap_or_default();
                        if !name.is_empty() {
                            games.push(LocalGame {
                                name,
                                launcher: "gog".to_string(),
                                app_id: None,
                                install_path: Some(game_dir.to_string_lossy().to_string()),
                            });
                        }
                    }
                } else if let Ok(sub) = std::fs::read_dir(&game_dir) {
                    for sub_entry in sub.flatten() {
                        let sfname = sub_entry.file_name();
                        let sfname = sfname.to_string_lossy();
                        if sfname.starts_with("goggame-") && sfname.ends_with(".info") {
                            if let Ok(content) = std::fs::read_to_string(sub_entry.path()) {
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                    let name = json["gameTitle"].as_str().unwrap_or("").to_string();
                                    let app_id = json["gameId"].as_str().map(|s| s.to_string());
                                    if !name.is_empty() {
                                        games.push(LocalGame {
                                            name,
                                            launcher: "gog".to_string(),
                                            app_id,
                                            install_path: Some(game_dir.to_string_lossy().to_string()),
                                        });
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    games.dedup_by(|a, b| a.name == b.name);
    games
}

fn extract_xml_attr(content: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    if let Some(pos) = content.find(&needle) {
        let rest = &content[pos + needle.len()..];
        if let Some(end) = rest.find('"') {
            let val = rest[..end].trim().to_string();
            if !val.is_empty() { return Some(val); }
        }
    }
    None
}

trait Pipe: Sized {
    fn pipe<F: FnOnce(Self) -> Self>(self, f: F) -> Self { f(self) }
}
impl Pipe for PathBuf {}

fn scan_xbox_games() -> Vec<LocalGame> {
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
        if !base_dir.exists() { continue; }
        let entries = match std::fs::read_dir(base_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() { continue; }

            let config = path.join("Content").join("MicrosoftGame.config")
                .pipe(|p| if p.exists() { p } else { path.join("MicrosoftGame.config") });
            let msix = path.join("Content").join("AppxManifest.xml")
                .pipe(|p| if p.exists() { p } else { path.join("AppxManifest.xml") });

            let name: Option<String> = if config.exists() {
                if let Ok(c) = std::fs::read_to_string(&config) {
                    extract_xml_attr(&c, "DefaultDisplayName")
                        .or_else(|| extract_xml_attr(&c, "Name"))
                        .or_else(|| extract_xml_attr(&c, "TitleId"))
                } else { None }
            } else if msix.exists() {
                if let Ok(c) = std::fs::read_to_string(&msix) {
                    extract_xml_attr(&c, "DisplayName")
                } else { None }
            } else {
                path.file_name().map(|n| {
                    let s = n.to_string_lossy().to_string();
                    if let Some(idx) = s.rfind('.') {
                        let after = &s[idx+1..];
                        if !after.is_empty() && after.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                            return after.to_string();
                        }
                    }
                    s
                })
            };

            if let Some(name) = name {
                if name.starts_with("ms-resource:") || name.is_empty() { continue; }
                games.push(LocalGame {
                    name,
                    launcher: "xbox".to_string(),
                    app_id: None,
                    install_path: Some(path.to_string_lossy().to_string()),
                });
            }
        }
    }

    games.dedup_by(|a, b| a.name == b.name);
    games
}

fn scan_ea_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    if let Ok(prog_data) = std::env::var("PROGRAMDATA") {
        let install_data = PathBuf::from(&prog_data).join("EA Desktop").join("InstallData");
        if install_data.exists() {
            if let Ok(entries) = std::fs::read_dir(&install_data) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() { continue; }
                    let manifest = path.join("__Installer").join("installerdata.xml");
                    if manifest.exists() {
                        if let Ok(content) = std::fs::read_to_string(&manifest) {
                            if let Some(name) = extract_xml_attr(&content, "displayName")
                                .or_else(|| extract_xml_attr(&content, "title"))
                            {
                                games.push(LocalGame {
                                    name,
                                    launcher: "ea".to_string(),
                                    app_id: None,
                                    install_path: Some(path.to_string_lossy().to_string()),
                                });
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
            if !base_dir.exists() { continue; }
            if let Ok(entries) = std::fs::read_dir(&base_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() { continue; }
                    let has_exe = std::fs::read_dir(&path).ok().map(|mut d| {
                        d.any(|e| e.ok().map_or(false, |f| {
                            f.path().extension().map_or(false, |ext| ext == "exe")
                        }))
                    }).unwrap_or(false);
                    if has_exe {
                        if let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) {
                            games.push(LocalGame {
                                name,
                                launcher: "ea".to_string(),
                                app_id: None,
                                install_path: Some(path.to_string_lossy().to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    games.dedup_by(|a, b| a.name == b.name);
    games
}

#[tauri::command]
pub async fn scan_all_games() -> Result<Vec<LocalGame>, String> {
    let mut all: Vec<LocalGame> = Vec::new();
    all.extend(scan_steam_games());
    all.extend(scan_epic_games());
    all.extend(scan_gog_games());
    all.extend(scan_xbox_games());
    all.extend(scan_ea_games());
    Ok(all)
}

#[tauri::command]
pub async fn debug_scan_info() -> Result<String, String> {
    let steam = scan_steam_games();
    let epic  = scan_epic_games();
    let gog   = scan_gog_games();
    let xbox  = scan_xbox_games();
    let ea    = scan_ea_games();
    Ok(format!(
        "Steam: {} | Epic: {} | GOG: {} | Xbox: {} | EA: {}",
        steam.len(), epic.len(), gog.len(), xbox.len(), ea.len()
    ))
}
