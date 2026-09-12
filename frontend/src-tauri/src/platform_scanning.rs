use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalGame {
    pub name: String,
    pub launcher: String,
    pub app_id: Option<String>,
    pub external_id: Option<String>,
    pub install_path: Option<String>,
    pub playtime_minutes: Option<u64>,
    pub last_played: Option<u64>,
    pub installed: Option<bool>,
    // Which specific emulator_configs platform_id (e.g. "3ds", "ps4") this
    // ROM was scanned under — `launcher` itself only ever holds the
    // company-level grouping ("nintendo"/"playstation"/"xbox") a ROM's
    // console groups under in Local's own sidebar, so this is what
    // launch_game actually looks up the right EmulatorConfig by. None for
    // every non-ROM (Steam/Epic/GOG/...) game.
    #[serde(default)]
    pub rom_platform: Option<String>,
}

impl LocalGame {
    fn installed(name: String, launcher: &str, app_id: Option<String>, install_path: Option<String>) -> Self {
        Self {
            name, launcher: launcher.to_string(), app_id, external_id: None,
            install_path, playtime_minutes: None, last_played: None, installed: Some(true),
            rom_platform: None,
        }
    }
}

// The same (launcher, link_key) identity local_game_links/local_games_seen
// key on — must exactly match how scan_all_games has always derived it, or
// a saved link silently stops resolving. install_path only ever applies to
// a live-scanned game; a restored ghost (game_links::restore_missing_seen_games)
// never has one, so this falls through to app_id/name for those too.
fn game_link_key(game: &LocalGame) -> String {
    game.app_id.as_deref()
        .or(game.install_path.as_deref())
        .unwrap_or(&game.name)
        .to_string()
}

fn apply_game_link(game: &mut LocalGame, links: &std::collections::HashMap<(String, String), String>) {
    let key = game_link_key(game);
    if let Some(eid) = links.get(&(game.launcher.clone(), key)) {
        game.external_id = Some(eid.clone());
    }
}


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

fn scan_steam_games() -> Vec<LocalGame> {
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

// GOG Galaxy writes one subkey per installed game here regardless of where
// the user actually chose to install it — the folder-scan below only ever
// caught installs under 3 hardcoded parent directories, missing anything
// on a custom path (e.g. a Steam-library-style "D:\Games\GOG\..." the user
// picked themselves, or really any path other than those 3). Same registry-
// based approach scan_steam_games already relies on instead of guessing
// folders.
fn scan_gog_games_registry() -> Vec<LocalGame> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut games = Vec::new();
    let Ok(parent) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\GOG.com\\Games") else {
        return games;
    };

    for game_id in parent.enum_keys().flatten() {
        let Ok(key) = parent.open_subkey(&game_id) else { continue };
        let name: String = key.get_value("gameName").unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let path: Option<String> = key.get_value("path").ok();
        games.push(LocalGame {
            name,
            launcher: "gog".to_string(),
            app_id: Some(game_id),
            external_id: None,
            install_path: path,
            playtime_minutes: None,
            last_played: None,
            installed: Some(true),
            rom_platform: None,
        });
    }

    games
}

fn scan_gog_games() -> Vec<LocalGame> {
    let mut games = scan_gog_games_registry();
    // Folder-scan fallback below still adds anything the registry missed
    // (e.g. a game installed by copying files rather than through Galaxy
    // itself) — deduped by name against what the registry already found.
    let registry_names: std::collections::HashSet<String> =
        games.iter().map(|g| g.name.clone()).collect();

    let gog_dirs: Vec<PathBuf> = ["C", "D", "E"]
        .iter()
        .flat_map(|drive| {
            vec![
                PathBuf::from(format!("{}:\\GOG Games", drive)),
                PathBuf::from(format!(
                    "{}:\\Program Files (x86)\\GOG Galaxy\\Games",
                    drive
                )),
                PathBuf::from(format!("{}:\\Games\\GOG", drive)),
            ]
        })
        .collect();

    for base_dir in &gog_dirs {
        if !base_dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let game_dir = entry.path();
                let gameinfo = game_dir.join("gameinfo");
                if gameinfo.exists() {
                    if let Ok(content) = std::fs::read_to_string(&gameinfo) {
                        let name = content
                            .lines()
                            .next()
                            .map(|s| s.trim().to_string())
                            .unwrap_or_default();
                        if !name.is_empty() && !registry_names.contains(&name) {
                            games.push(LocalGame::installed(
                                name,
                                "gog",
                                None,
                                Some(game_dir.to_string_lossy().to_string()),
                            ));
                        }
                    }
                } else if let Ok(sub) = std::fs::read_dir(&game_dir) {
                    for sub_entry in sub.flatten() {
                        let sfname = sub_entry.file_name();
                        let sfname = sfname.to_string_lossy();
                        if sfname.starts_with("goggame-") && sfname.ends_with(".info") {
                            if let Ok(content) = std::fs::read_to_string(sub_entry.path()) {
                                if let Ok(json) =
                                    serde_json::from_str::<serde_json::Value>(&content)
                                {
                                    let name = json["gameTitle"].as_str().unwrap_or("").to_string();
                                    let app_id = json["gameId"].as_str().map(|s| s.to_string());
                                    if !name.is_empty() && !registry_names.contains(&name) {
                                        games.push(LocalGame {
                                            name,
                                            launcher: "gog".to_string(),
                                            app_id,
                                            external_id: None,
                                            install_path: Some(
                                                game_dir.to_string_lossy().to_string(),
                                            ),
                                            playtime_minutes: None,
                                            last_played: None,
                                            installed: Some(true),
                                            rom_platform: None,
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
            if !val.is_empty() {
                return Some(val);
            }
        }
    }
    None
}



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
                games.push(LocalGame::installed(
                    name,
                    "xbox",
                    None,
                    Some(path.to_string_lossy().to_string()),
                ));
            }
        }
    }

    games.dedup_by(|a, b| a.name == b.name);
    games
}

fn scan_ea_games() -> Vec<LocalGame> {
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
                                games.push(LocalGame::installed(
                                    name,
                                    "ea",
                                    None,
                                    Some(path.to_string_lossy().to_string()),
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
                                e.ok().map_or(false, |f| {
                                    f.path().extension().map_or(false, |ext| ext == "exe")
                                })
                            })
                        })
                        .unwrap_or(false);
                    if has_exe {
                        if let Some(name) =
                            path.file_name().map(|n| n.to_string_lossy().to_string())
                        {
                            games.push(LocalGame::installed(
                                name,
                                "ea",
                                None,
                                Some(path.to_string_lossy().to_string()),
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

fn scan_local_folder(folder: &str) -> Vec<LocalGame> {
    let path = std::path::Path::new(folder);
    if !path.is_dir() {
        return vec![];
    }
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| LocalGame::installed(
                    e.file_name().to_string_lossy().to_string(),
                    "local",
                    None,
                    Some(e.path().to_string_lossy().to_string()),
                ))
                .collect()
        })
        .unwrap_or_default()
}

// Which emulator_configs platform_id values group under which company-level
// launcher for Local's own sidebar (see frontend LAUNCHER_ORDER) — several
// consoles share one company tab (every Nintendo console groups under
// "nintendo", every PlayStation one under "playstation", etc), the same way
// EmulatorsTab.astro's own COMPANIES groups its platform pickers.
fn company_for_platform(platform_id: &str) -> &'static str {
    match platform_id {
        "gamecube" | "ds" | "wii" | "3ds" | "wiiu" | "switch" => "nintendo",
        "ps1" | "ps2" | "psp" | "ps3" | "psvita" | "ps4" | "ps5" => "playstation",
        "xbox" | "xbox360" | "xboxone" | "xboxseriesx" => "xbox",
        _ => "local",
    }
}

// Recognized ROM/disc-image extensions per platform_id — the union of every
// emulator EmulatorsTab.astro's own EMULATORS_DB lists for that platform,
// since one ROM folder isn't tied to exactly one of several possible
// emulators for the same console.
fn rom_extensions_for_platform(platform_id: &str) -> &'static [&'static str] {
    match platform_id {
        "gamecube" | "wii" => &[".elf", ".dol", ".gcm", ".tgc", ".ciso", ".gcz", ".iso", ".wad", ".dff", ".rvz", ".m3u"],
        "ds"                => &[".nds", ".zip", ".7z", ".rar", ".gz"],
        "3ds"               => &[".3ds", ".3dsx", ".cci", ".zcci", ".cxi", ".elf", ".cia"],
        "wiiu"              => &[".wud", ".wux", ".rpx", ".wua"],
        "switch"            => &[".nsp", ".xci", ".nso", ".nro", ".nca"],
        "ps1"               => &[".bin", ".img", ".exe", ".chd", ".psexe", ".m3u", ".cue", ".pbp", ".iso", ".zip"],
        "ps2"               => &[".bin", ".chd", ".cso", ".gz", ".img", ".iso", ".m3u", ".mdf", ".nrg"],
        "psp"               => &[".chd", ".cso", ".iso", ".pbp"],
        "ps3"               => &[".bin", ".iso"],
        "psvita"            => &[".vpk"],
        "ps4" | "ps5"       => &[".bin", ".iso"],
        "xbox"              => &[".iso", ".xiso"],
        "xbox360"           => &[".iso", ".xex", ".cci", ".cxi", ".elf", ".zar"],
        "xboxone" | "xboxseriesx" => &[".iso", ".xex"],
        _ => &[],
    }
}

// A stable, filesystem-safe stand-in for app_id — every cover/IGDB-link
// mechanism in this codebase (readGameInfo, igdb_force_by_igdb_id,
// game_link_key, IgdbPickerModal's "editar metadatos") keys its cache
// directory by app_id and only bothers running at all when one is present,
// so a ROM (which has no real app_id) needs one too, or it'd silently get
// none of that — cover, manual IGDB link, everything. Deterministic (same
// ROM path always hashes to the same id, so a pick made once survives every
// future rescan) and DefaultHasher::new() is fixed-seed (unlike HashMap's
// own randomized default), so this doesn't change between runs. Must be
// plain hex — this gets used as a single path segment (join()) downstream,
// so anything else (slashes, a drive letter's colon) would either break the
// join or, worse, get treated as an absolute path and silently escape the
// intended metadata folder entirely.
fn synthetic_rom_app_id(install_path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    install_path.hash(&mut hasher);
    format!("rom_{:016x}", hasher.finish())
}

fn push_if_rom_match(path: &std::path::Path, extensions: &[&str], launcher: &str, platform_id: &str, out: &mut Vec<LocalGame>) {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else { return };
    let ext_lower = format!(".{}", ext.to_lowercase());
    if !extensions.contains(&ext_lower.as_str()) {
        return;
    }
    let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { return };
    let install_path = path.to_string_lossy().to_string();
    out.push(LocalGame {
        name: stem.to_string(),
        launcher: launcher.to_string(),
        app_id: Some(synthetic_rom_app_id(&install_path)),
        external_id: None,
        install_path: Some(install_path),
        playtime_minutes: None,
        last_played: None,
        installed: Some(true),
        rom_platform: Some(platform_id.to_string()),
    });
}

// Top-level files, plus one level into subfolders (some ROM collections
// keep each game in its own subfolder alongside box art/saves/etc) — deep
// enough for how these folders are typically organized without risking a
// slow, unbounded walk of an arbitrarily large drive.
fn scan_rom_folder(folder: &str, extensions: &[&str], platform_id: &str) -> Vec<LocalGame> {
    let mut games = Vec::new();
    let root = std::path::Path::new(folder);
    if !root.is_dir() {
        return games;
    }
    let launcher = company_for_platform(platform_id);

    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                push_if_rom_match(&path, extensions, launcher, platform_id, &mut games);
            } else if path.is_dir() {
                if let Ok(sub_entries) = std::fs::read_dir(&path) {
                    for sub_entry in sub_entries.flatten() {
                        let sub_path = sub_entry.path();
                        if sub_path.is_file() {
                            push_if_rom_match(&sub_path, extensions, launcher, platform_id, &mut games);
                        }
                    }
                }
            }
        }
    }

    // A dump collection commonly has more than one file for the same game
    // (e.g. a "Game.3ds" AND a "Game.cia" side by side) — each valid
    // extension otherwise added its own separate LocalGame with the
    // identical display name. Keep just the first file found per
    // normalized name so it only shows up once.
    let mut seen_names = std::collections::HashSet::new();
    games.retain(|g| seen_names.insert(g.name.trim().to_lowercase()));

    games
}

// Every configured emulator (see emulators::EmulatorConfig) whose rom_folder
// is set gets scanned for files matching that platform's known ROM
// extensions — each match becomes its own LocalGame grouped under the
// console's company-level launcher (company_for_platform) so it shows up in
// Local > Videojuegos next to that platform's Steam/Epic/... installs
// instead of nowhere at all.
fn scan_emulator_roms(conn: &rusqlite::Connection) -> Vec<LocalGame> {
    let mut games = Vec::new();
    let mut stmt = match conn.prepare(
        "SELECT platform_id, rom_folder FROM emulator_configs WHERE rom_folder IS NOT NULL AND rom_folder != ''",
    ) {
        Ok(s) => s,
        Err(_) => return games,
    };
    let rows = match stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
        Ok(r) => r,
        Err(_) => return games,
    };
    for (platform_id, rom_folder) in rows.filter_map(|r| r.ok()) {
        let extensions = rom_extensions_for_platform(&platform_id);
        if extensions.is_empty() {
            continue;
        }
        games.extend(scan_rom_folder(&rom_folder, extensions, &platform_id));
    }
    games
}

#[tauri::command]
pub async fn scan_all_games(
    local_db: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<LocalGame>, String> {
    let mut all: Vec<LocalGame> = Vec::new();
    all.extend(scan_steam_games());
    all.extend(scan_epic_games());
    all.extend(scan_gog_games());
    all.extend(scan_xbox_games());
    all.extend(scan_ea_games());

    let conn = local_db.conn.lock().str_err()?;

    all.extend(scan_emulator_roms(&conn));

    // Read custom local folder from local_routes DB
    let videojuegos_path: Option<String> = conn
        .query_row(
            "SELECT path FROM local_routes WHERE key = 'videojuegos'",
            [],
            |r| r.get(0),
        )
        .ok();
    if let Some(folder) = videojuegos_path {
        if !folder.is_empty() {
            all.extend(scan_local_folder(&folder));
        }
    }

    // Populate external_id from local_game_links
    let links = crate::game_links::lookup_game_links(&conn);
    let mut seen: Vec<(String, String, String)> = Vec::with_capacity(all.len());
    for game in &mut all {
        apply_game_link(game, &links);
        seen.push((game.launcher.clone(), game_link_key(game), game.name.clone()));
    }
    crate::game_links::touch_games_seen(&conn, &seen);
    crate::game_links::prune_stale_game_links(&conn);

    // Anything ever scanned before that no live source (this scan, or
    // Steam's owned-games API on the frontend) still knows about — see
    // restore_missing_seen_games's own comment for why this can't just rely
    // on "was it in `all`" alone.
    let present: std::collections::HashSet<(String, String)> =
        seen.iter().map(|(l, k, _)| (l.clone(), k.clone())).collect();
    let mut restored = crate::game_links::restore_missing_seen_games(&conn, &present);
    for game in &mut restored {
        apply_game_link(game, &links);
    }
    all.extend(restored);

    Ok(all)
}

#[tauri::command]
pub async fn debug_scan_info(local_db: tauri::State<'_, crate::db::MetadeaDb>) -> Result<String, String> {
    let steam = scan_steam_games();
    let epic = scan_epic_games();
    let gog = scan_gog_games();
    let xbox = scan_xbox_games();
    let ea = scan_ea_games();
    let roms = {
        let conn = local_db.conn.lock().str_err()?;
        scan_emulator_roms(&conn)
    };
    Ok(format!(
        "Steam: {} | Epic: {} | GOG: {} | Xbox: {} | EA: {} | ROMs: {}",
        steam.len(),
        epic.len(),
        gog.len(),
        xbox.len(),
        ea.len(),
        roms.len()
    ))
}
