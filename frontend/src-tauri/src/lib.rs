use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

// -- Auth ---------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthSession {
    pub token: String,
    pub username: String,
}

#[tauri::command]
async fn init_database() -> Result<String, String> {
    Ok("Database initialized".to_string())
}

#[tauri::command]
async fn store_auth_token(
    app_handle: tauri::AppHandle,
    token: String,
    username: String,
) -> Result<String, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let session_path = app_data_dir.join("session.json");
    let session = AuthSession { token, username };
    let json = serde_json::to_string(&session).map_err(|e| e.to_string())?;
    std::fs::write(session_path, json).map_err(|e| e.to_string())?;
    Ok("Token stored".to_string())
}

#[tauri::command]
async fn get_auth_token(
    app_handle: tauri::AppHandle,
) -> Result<Option<AuthSession>, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let session_path = app_data_dir.join("session.json");
    if !session_path.exists() {
        return Ok(None);
    }
    let data = std::fs::read_to_string(session_path).map_err(|e| e.to_string())?;
    let session: AuthSession = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(Some(session))
}

#[tauri::command]
async fn clear_auth_token(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let session_path = app_data_dir.join("session.json");
    if session_path.exists() {
        std::fs::remove_file(session_path).map_err(|e| e.to_string())?;
    }
    Ok("Token cleared".to_string())
}

// -- Library stubs -------------------------------------------------------------

#[tauri::command]
async fn save_library_item() -> Result<String, String> {
    Ok("Item saved".to_string())
}

#[tauri::command]
async fn get_library_items() -> Result<Vec<String>, String> {
    Ok(vec![])
}

#[tauri::command]
async fn get_library_stats() -> Result<String, String> {
    Ok("{}".to_string())
}

// -- Local game scan -----------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalGame {
    pub name: String,
    pub launcher: String,
    pub app_id: Option<String>,
    pub install_path: Option<String>,
}

/// Get Steam root from Windows registry (most reliable method)
#[cfg(windows)]
fn steam_root_from_registry() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;
    // Try HKCU (user install)
    if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Valve\\Steam")
    {
        if let Ok(path) = key.get_value::<String, _>("SteamPath") {
            let p = PathBuf::from(path);
            if p.exists() { return Some(p); }
        }
    }
    // Try HKLM (machine-wide install)
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

    // 1. Try registry first (Windows)
    let mut steam_root = steam_root_from_registry();

    // 2. Fallback: common install paths
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

    // Collect all library paths from libraryfolders.vdf
    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
    let mut library_paths: Vec<PathBuf> = vec![steam_root.join("steamapps")];

    if let Ok(content) = std::fs::read_to_string(&vdf_path) {
        for line in content.lines() {
            let line = line.trim();
            // Both old format ("path") and new format lines with a quoted path value
            if line.contains("\"path\"") {
                // Format: 	"path"		"C:\\Steam"
                let parts: Vec<&str> = line.splitn(5, '"').collect();
                // parts: ["", "path", "\t\t", "C:\\Steam", ...]
                if parts.len() >= 4 {
                    let raw = parts[3];
                    // VDF escapes backslashes as \\ in older format
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

    // Read appmanifest_*.acf in each library
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

fn scan_xbox_games() -> Vec<LocalGame> {
    let mut games = Vec::new();

    // Collect candidate directories:
    // 1. GamingRootMetadata.json on each drive root
    // 2. Default XboxGames folders
    // 3. Registry (Xbox app stores ContentDirectory in the registry)
    let mut candidates: Vec<PathBuf> = Vec::new();

    for drive in &["C", "D", "E", "F"] {
        // Default Xbox Game Pass install dir (since Xbox app v2021+)
        candidates.push(PathBuf::from(format!("{}:\\XboxGames", drive)));
        candidates.push(PathBuf::from(format!("{}:\\Xbox Games", drive)));
        candidates.push(PathBuf::from(format!("{}:\\Games\\Xbox Game Pass", drive)));
        candidates.push(PathBuf::from(format!("{}:\\Games\\XboxGames", drive)));

        // GamingRootMetadata.json — written by Xbox app when user picks a custom dir
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

    // Also try registry for Xbox content dirs
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        // Xbox app stores content dirs here
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

    // Deduplicate candidates
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

            // Look for MicrosoftGame.config (newer Xbox games)
            let config   = path.join("Content").join("MicrosoftGame.config")
                .pipe(|p| if p.exists() { p } else { path.join("MicrosoftGame.config") });
            let msix     = path.join("Content").join("AppxManifest.xml")
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
                // Fallback: use folder name (it's usually the game name)
                path.file_name().map(|n| {
                    // Xbox folders are often "GameName" or "Publisher.GameName"
                    let s = n.to_string_lossy().to_string();
                    // Strip publisher prefix if present (e.g. "Microsoft.Halo5" -> "Halo5")
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

/// Helper trait to allow `.pipe()` method chaining
trait Pipe: Sized {
    fn pipe<F: FnOnce(Self) -> Self>(self, f: F) -> Self { f(self) }
}
impl Pipe for PathBuf {}

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

    // Fallback: scan common EA Games dirs
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
async fn scan_all_games() -> Result<Vec<LocalGame>, String> {
    let mut all: Vec<LocalGame> = Vec::new();
    all.extend(scan_steam_games());
    all.extend(scan_epic_games());
    all.extend(scan_gog_games());
    all.extend(scan_xbox_games());
    all.extend(scan_ea_games());
    Ok(all)
}

// -- Folder browser ------------------------------------------------------------

#[tauri::command]
async fn pick_folder(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app_handle
        .dialog()
        .file()
        .blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
async fn scan_folder_contents(path: String) -> Result<Vec<FolderEntry>, String> {
    let dir = PathBuf::from(&path);
    if !dir.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    let mut entries = Vec::new();
    if let Ok(read_dir) = std::fs::read_dir(&dir) {
        for entry in read_dir.flatten() {
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = metadata.is_dir();
            let size = if is_dir { 0 } else { metadata.len() };
            entries.push(FolderEntry { name, is_dir, size });
        }
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

// -- Saved folders -------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedFolder {
    pub path: String,
    pub label: String,
}

#[tauri::command]
async fn get_local_folders(app_handle: tauri::AppHandle) -> Result<Vec<SavedFolder>, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let folders_path = app_data_dir.join("local_folders.json");
    if !folders_path.exists() {
        return Ok(vec![]);
    }
    let data = std::fs::read_to_string(folders_path).map_err(|e| e.to_string())?;
    let folders: Vec<SavedFolder> = serde_json::from_str(&data).unwrap_or_default();
    Ok(folders)
}

#[tauri::command]
async fn save_local_folders(
    app_handle: tauri::AppHandle,
    folders_json: String,
) -> Result<String, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let folders_path = app_data_dir.join("local_folders.json");
    std::fs::write(folders_path, &folders_json).map_err(|e| e.to_string())?;
    Ok("Folders saved".to_string())
}

// -- Env config ----------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct EnvConfig {
    pub igdb_client_id: Option<String>,
    pub igdb_client_secret: Option<String>,
}

#[tauri::command]
async fn read_env_config(app_handle: tauri::AppHandle) -> Result<EnvConfig, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let env_path = app_data_dir.join("env.json");
    if !env_path.exists() {
        return Ok(EnvConfig { igdb_client_id: None, igdb_client_secret: None });
    }
    let data = std::fs::read_to_string(env_path).map_err(|e| e.to_string())?;
    let config: EnvConfig = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
async fn write_env_config(
    app_handle: tauri::AppHandle,
    config: EnvConfig,
) -> Result<String, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let env_path = app_data_dir.join("env.json");
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    std::fs::write(env_path, json).map_err(|e| e.to_string())?;
    Ok("Config saved".to_string())
}

// -- IGDB stub -----------------------------------------------------------------

#[tauri::command]
async fn igdb_search(_query: String) -> Result<String, String> {
    Ok("[]".to_string())
}

// -- Debug ---------------------------------------------------------------------

#[tauri::command]
async fn debug_scan_info() -> Result<String, String> {
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

// -- Env folder opener ---------------------------------------------------------

#[tauri::command]
async fn open_env_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    // Make sure the directory exists before opening
    std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    let path_str = app_data_dir.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    { use std::process::Command; Command::new("explorer").arg(&path_str).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")]
    { use std::process::Command; Command::new("open").arg(&path_str).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "linux")]
    { use std::process::Command; Command::new("xdg-open").arg(&path_str).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

// -- Entry point ---------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_database,
            store_auth_token,
            get_auth_token,
            clear_auth_token,
            save_library_item,
            get_library_items,
            get_library_stats,
            scan_all_games,
            pick_folder,
            scan_folder_contents,
            get_local_folders,
            save_local_folders,
            read_env_config,
            write_env_config,
            igdb_search,
            debug_scan_info,
            open_env_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
