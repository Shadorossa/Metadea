use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
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

// -- Category routes (routes.json) --------------------------------------------

#[tauri::command]
async fn read_routes(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("routes.json");
    if !path.exists() {
        return Ok("{}".to_string());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_routes(app_handle: tauri::AppHandle, routes_json: String) -> Result<(), String> {
    let dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("routes.json"), routes_json).map_err(|e| e.to_string())
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

// -- IGDB -----------------------------------------------------------------------

struct TwitchToken {
    access_token: String,
    expires: Instant,
}

static TWITCH_TOKEN: Mutex<Option<TwitchToken>> = Mutex::new(None);

async fn get_twitch_token(client_id: &str, client_secret: &str) -> Result<String, String> {
    {
        let cache = TWITCH_TOKEN.lock().unwrap();
        if let Some(ref t) = *cache {
            if t.expires > Instant::now() + Duration::from_secs(60) {
                return Ok(t.access_token.clone());
            }
        }
    }

    #[derive(Deserialize)]
    struct TwitchResp { access_token: String, expires_in: u64 }

    let client = reqwest::Client::new();
    let http = client
        .post("https://id.twitch.tv/oauth2/token")
        .query(&[
            ("client_id",     client_id),
            ("client_secret", client_secret),
            ("grant_type",    "client_credentials"),
        ])
        .send()
        .await
        .map_err(|e| format!("Twitch request failed: {}", e))?;
    if !http.status().is_success() {
        let status = http.status();
        let body   = http.text().await.unwrap_or_default();
        return Err(format!("Twitch auth failed (HTTP {}): {}", status, body));
    }
    let resp = http.json::<TwitchResp>().await
        .map_err(|e| format!("Twitch parse failed: {}", e))?;

    let token   = resp.access_token.clone();
    let expires = Instant::now() + Duration::from_secs(resp.expires_in);
    *TWITCH_TOKEN.lock().unwrap() = Some(TwitchToken { access_token: resp.access_token, expires });
    Ok(token)
}

fn sanitize_folder_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Downloads the IGDB cover for a Steam game.
/// Saves to `{app_data}/metadata/{game_name}/{image_id}_cover.jpg`.
/// Returns the absolute path, or None if no cover found in IGDB.
#[tauri::command]
async fn igdb_get_cover_by_steam_id(
    app_handle: tauri::AppHandle,
    app_id: String,
    game_name: String,
) -> Result<Option<String>, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let meta_root = app_data_dir.join("metadata");
    let game_dir  = meta_root.join(&app_id);

    // Early exit: if we already have a _cover.jpg for this game, skip IGDB entirely.
    if game_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&game_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.ends_with("_cover.jpg") {
                    return Ok(Some(entry.path().to_string_lossy().to_string()));
                }
            }
        }
    }

    let cfg = {
        let path = app_data_dir.join("env.json");
        if !path.exists() { return Err("No env.json — configure IGDB keys first".into()); }
        let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str::<EnvConfig>(&data).map_err(|e| e.to_string())?
    };

    let client_id     = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token         = get_twitch_token(&client_id, &client_secret).await?;

    let client = reqwest::Client::new();

    // 1. Try Steam external_games lookup (exact match)
    let ext_http = client
        .post("https://api.igdb.com/v4/external_games")
        .header("Client-ID", &client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(format!("fields game.cover.image_id; where uid = \"{}\" & category = 1; limit 1;", app_id))
        .send().await.map_err(|e| e.to_string())?;
    if !ext_http.status().is_success() {
        let s = ext_http.status();
        let b = ext_http.text().await.unwrap_or_default();
        return Err(format!("IGDB error (HTTP {}): {}", s, b));
    }
    let ext_resp = ext_http.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;

    let image_id = if let Some(id) = ext_resp[0]["game"]["cover"]["image_id"].as_str() {
        id.to_string()
    } else {
        // 2. Fallback: fuzzy name search
        let name_http = client
            .post("https://api.igdb.com/v4/games")
            .header("Client-ID", &client_id)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "text/plain")
            .body(format!(
                "fields cover.image_id; search \"{}\"; where cover != null; limit 1;",
                game_name.replace('"', "")
            ))
            .send().await.map_err(|e| e.to_string())?;
        if !name_http.status().is_success() {
            let s = name_http.status();
            let b = name_http.text().await.unwrap_or_default();
            return Err(format!("IGDB error (HTTP {}): {}", s, b));
        }
        let name_resp = name_http.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
        match name_resp[0]["cover"]["image_id"].as_str() {
            Some(id) => id.to_string(),
            None     => return Ok(None),
        }
    };

    // Download cover image
    std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;
    let cover_path = game_dir.join(format!("{}_cover.jpg", image_id));

    if !cover_path.exists() {
        let bytes = client
            .get(format!("https://images.igdb.com/igdb/image/upload/t_cover_big/{}.jpg", image_id))
            .send().await.map_err(|e| e.to_string())?
            .bytes().await.map_err(|e| e.to_string())?;
        std::fs::write(&cover_path, &bytes).map_err(|e| e.to_string())?;
    }

    // Update metadata/index.json
    let index_path = meta_root.join("index.json");
    let mut index: serde_json::Value = std::fs::read_to_string(&index_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = index.as_object_mut() {
        obj.insert(app_id.clone(), serde_json::json!({
            "name":     game_name,
            "image_id": image_id,
            "file":     format!("{}/{}_cover.jpg", app_id, image_id),
            "path":     cover_path.to_string_lossy(),
        }));
    }
    let _ = std::fs::write(&index_path, serde_json::to_string_pretty(&index).unwrap_or_default());

    Ok(Some(cover_path.to_string_lossy().to_string()))
}

/// Reads metadata/index.json and returns { app_id → "data:image/jpeg;base64,..." }
/// for all covers that exist on disk.
#[tauri::command]
async fn read_metadata_index(
    app_handle: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, String>, String> {
    let meta_root  = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("metadata");
    let index_path = meta_root.join("index.json");
    if !index_path.exists() {
        return Ok(std::collections::HashMap::new());
    }
    let data  = std::fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let index: serde_json::Value = serde_json::from_str(&data).unwrap_or_else(|_| serde_json::json!({}));
    let mut out = std::collections::HashMap::new();
    if let Some(obj) = index.as_object() {
        for (app_id, entry) in obj {
            // Prefer the stored absolute path; fall back to reconstructing from "file"
            let file_path = if let Some(p) = entry["path"].as_str() {
                std::path::PathBuf::from(p)
            } else if let Some(file) = entry["file"].as_str() {
                file.split('/').fold(meta_root.clone(), |p, s| p.join(s))
            } else {
                continue;
            };
            if let Ok(bytes) = std::fs::read(&file_path) {
                out.insert(app_id.clone(), format!("data:image/jpeg;base64,{}", base64_encode(&bytes)));
            }
        }
    }
    Ok(out)
}

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

// -- User metadata (avatar / banner) ------------------------------------------

fn user_metadata_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("user_metadata");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
async fn save_user_image(
    app_handle: tauri::AppHandle,
    key: String,
    data_url: String,
) -> Result<(), String> {
    let allowed = ["avatar", "banner"];
    if !allowed.contains(&key.as_str()) {
        return Err(format!("Invalid key: {}", key));
    }
    let path = user_metadata_dir(&app_handle)?.join(&key);
    // Strip the data URL prefix, write raw bytes
    let base64_data = data_url
        .splitn(2, ',')
        .nth(1)
        .ok_or("Invalid data URL")?;
    let bytes = base64_decode(base64_data)?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_user_image(
    app_handle: tauri::AppHandle,
    key: String,
) -> Result<Option<String>, String> {
    let allowed = ["avatar", "banner"];
    if !allowed.contains(&key.as_str()) {
        return Err(format!("Invalid key: {}", key));
    }
    let path = user_metadata_dir(&app_handle)?.join(&key);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    // Detect mime type by magic bytes
    let mime = if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else {
        "image/webp"
    };
    let encoded = base64_encode(&bytes);
    Ok(Some(format!("data:{};base64,{}", mime, encoded)))
}

#[tauri::command]
async fn remove_user_image(
    app_handle: tauri::AppHandle,
    key: String,
) -> Result<(), String> {
    let allowed = ["avatar", "banner"];
    if !allowed.contains(&key.as_str()) {
        return Err(format!("Invalid key: {}", key));
    }
    let path = user_metadata_dir(&app_handle)?.join(&key);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Minimal base64 encode/decode (no external crate needed)
fn base64_encode(input: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        out.push(CHARS[(b0 >> 2)] as char);
        out.push(CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 { CHARS[((b1 & 15) << 2) | (b2 >> 6)] as char } else { '=' });
        out.push(if chunk.len() > 2 { CHARS[b2 & 63] as char } else { '=' });
    }
    out
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let input: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let mut table = [0u8; 128];
    for (i, &c) in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".iter().enumerate() {
        table[c as usize] = i as u8;
    }
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let bytes = input.as_bytes();
    let mut i = 0;
    while i + 3 < bytes.len() {
        let (a, b, c, d) = (
            table[bytes[i] as usize] as usize,
            table[bytes[i + 1] as usize] as usize,
            table[bytes[i + 2] as usize] as usize,
            table[bytes[i + 3] as usize] as usize,
        );
        out.push(((a << 2) | (b >> 4)) as u8);
        if bytes[i + 2] != b'=' { out.push(((b << 4) | (c >> 2)) as u8); }
        if bytes[i + 3] != b'=' { out.push(((c << 6) | d) as u8); }
        i += 4;
    }
    Ok(out)
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
            igdb_get_cover_by_steam_id,
            read_metadata_index,
            debug_scan_info,
            open_env_folder,
            save_user_image,
            get_user_image,
            remove_user_image,
            read_routes,
            write_routes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
