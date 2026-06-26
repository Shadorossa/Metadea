use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use chrono;

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

async fn igdb_query(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    endpoint: &str,
    body: &str,
) -> Result<serde_json::Value, String> {
    let resp = client
        .post(endpoint)
        .header("Client-ID", client_id)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "text/plain")
        .body(body.to_string())
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let s = resp.status();
        let b = resp.text().await.unwrap_or_default();
        return Err(format!("IGDB error (HTTP {}): {}", s, b));
    }
    resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
}

/// Extracts cover_image_id and igdb_game_id from a /games IGDB entry,
/// returning the full game object for later metadata extraction.
fn extract_cover_and_game(game: &serde_json::Value) -> (Option<String>, Option<u64>, serde_json::Value) {
    let cover   = game["cover"]["image_id"].as_str().map(String::from);
    let game_id = game["id"].as_u64();
    (cover, game_id, game.clone())
}

/// Fetches a banner image_id from IGDB using a known game ID.
/// Tries /artworks (opaque only, alpha_channel=false) first, then /screenshots.
async fn fetch_banner_id(
    client:    &reqwest::Client,
    client_id: &str,
    token:     &str,
    game_id:   u64,
) -> Option<String> {
    // Fetch non-transparent artworks with dimensions to filter by aspect ratio
    if let Ok(arts) = igdb_query(client, client_id, token,
        "https://api.igdb.com/v4/artworks",
        &format!("fields image_id,width,height; where game = {} & alpha_channel = false; limit 10;", game_id),
    ).await {
        // Prefer 16:9-ish: width/height >= 1.5 (landscape by a significant margin)
        if let Some(arr) = arts.as_array() {
            for entry in arr {
                let w = entry["width"].as_f64().unwrap_or(0.0);
                let h = entry["height"].as_f64().unwrap_or(1.0);
                if h > 0.0 && w / h >= 1.5 {
                    if let Some(id) = entry["image_id"].as_str() {
                        return Some(id.to_string());
                    }
                }
            }
            // No landscape artwork found — fall through to screenshots
        }
    }
    let ss = igdb_query(client, client_id, token,
        "https://api.igdb.com/v4/screenshots",
        &format!("fields image_id; where game = {}; limit 1;", game_id),
    ).await.ok()?;
    ss[0]["image_id"].as_str().map(String::from)
}

/// Saves IGDB game metadata to `metadata/{app_id}/info.json`.
fn save_game_info(game_dir: &std::path::PathBuf, igdb_game: &serde_json::Value, app_id: &str) -> Result<(), String> {
    let mut info = serde_json::json!({
        "app_id": app_id,
        "name": igdb_game["name"].as_str().unwrap_or(""),
        "igdb_id": igdb_game["id"].as_u64(),
        "summary": igdb_game["summary"].as_str().unwrap_or(""),
        "release_date": igdb_game["first_release_date"].as_u64(),
        "rating": igdb_game["rating"],
        "last_fetched": chrono::Utc::now().to_rfc3339(),
    });

    // Extract genres
    if let Some(genres) = igdb_game["genres"].as_array() {
        let genre_names: Vec<String> = genres
            .iter()
            .filter_map(|g| g["name"].as_str().map(|s| s.to_string()))
            .collect();
        info["genres"] = serde_json::Value::Array(
            genre_names.into_iter().map(serde_json::Value::String).collect()
        );
    }

    // Extract developers and publishers
    if let Some(companies) = igdb_game["involved_companies"].as_array() {
        let mut developers = Vec::new();
        let mut publishers = Vec::new();
        for company in companies {
            let is_dev = company["developer"].as_bool().unwrap_or(false);
            let is_pub = company["publisher"].as_bool().unwrap_or(false);
            if let Some(name) = company["company"]["name"].as_str() {
                if is_dev { developers.push(name.to_string()); }
                if is_pub { publishers.push(name.to_string()); }
            }
        }
        if !developers.is_empty() {
            info["developers"] = serde_json::Value::Array(
                developers.into_iter().map(serde_json::Value::String).collect()
            );
        }
        if !publishers.is_empty() {
            info["publishers"] = serde_json::Value::Array(
                publishers.into_iter().map(serde_json::Value::String).collect()
            );
        }
    }

    let info_path = game_dir.join("info.json");
    std::fs::write(&info_path, serde_json::to_string_pretty(&info).unwrap_or_default())
        .map_err(|e| e.to_string())
}

/// Downloads cover + banner for a Steam game from IGDB.
/// Files saved under `{app_data}/metadata/{app_id}/`.
#[tauri::command]
async fn igdb_get_cover_by_steam_id(
    app_handle: tauri::AppHandle,
    app_id: String,
    game_name: String,
) -> Result<Option<String>, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let meta_root    = app_data_dir.join("metadata");
    let game_dir     = meta_root.join(&app_id);

    // Early exit only when BOTH cover and banner already exist on disk.
    if game_dir.exists() {
        let mut has_cover = false;
        let mut has_banner = false;
        if let Ok(entries) = std::fs::read_dir(&game_dir) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.ends_with("_cover.jpg")  { has_cover  = true; }
                if n.ends_with("_banner.jpg") { has_banner = true; }
            }
        }
        if has_cover && has_banner { return Ok(Some(game_dir.to_string_lossy().to_string())); }
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

    let client    = reqwest::Client::new();
    let safe      = game_name.replace('"', "");
    let name_low  = game_name.to_lowercase();

    const FULL_FIELDS: &str = "id,cover.image_id,name,summary,first_release_date,genres.name,rating,involved_companies.company.name,involved_companies.developer,involved_companies.publisher";

    // 1. Steam external_games — uid is globally unique, no category filter needed
    let ext = igdb_query(&client, &client_id, &token,
        "https://api.igdb.com/v4/external_games",
        &format!("fields game.id,game.cover.image_id,game.name,game.summary,game.first_release_date,game.genres.name,game.rating,game.involved_companies.company.name,game.involved_companies.developer,game.involved_companies.publisher; where uid = \"{app_id}\"; limit 1;"),
    ).await?;
    let (cover_id, igdb_game_id, igdb_game) = if !ext[0]["game"].is_null() {
        extract_cover_and_game(&ext[0]["game"])
    } else {
        // 2. Exact name match — prevents "Max Payne" → "Max Payne 2"
        let exact = igdb_query(&client, &client_id, &token,
            "https://api.igdb.com/v4/games",
            &format!("fields {FULL_FIELDS}; where name = \"{safe}\" & cover != null; limit 1;"),
        ).await?;
        let (c, gid, g) = extract_cover_and_game(&exact[0]);
        if c.is_some() {
            (c, gid, g)
        } else {
            // 3. Fuzzy search — 5 candidates, pick best name match
            let search = igdb_query(&client, &client_id, &token,
                "https://api.igdb.com/v4/games",
                &format!("fields name,{FULL_FIELDS}; search \"{safe}\"; where cover != null; limit 5;"),
            ).await?;
            let best = search.as_array().and_then(|arr| {
                arr.iter()
                    .find(|r| r["name"].as_str().map(|n| n.to_lowercase() == name_low).unwrap_or(false))
                    .or_else(|| arr.iter().find(|r| {
                        r["name"].as_str().map(|n| n.to_lowercase().starts_with(&name_low)).unwrap_or(false)
                    }))
                    .or_else(|| arr.first())
            });
            best.map(|r| extract_cover_and_game(r)).unwrap_or((None, None, serde_json::json!({})))
        }
    };

    let cover_image_id = match cover_id {
        Some(id) => id,
        None     => return Ok(None),
    };

    // Fetch banner separately via /artworks then /screenshots (array relations
    // cannot be expanded inline in /games queries in IGDB v4)
    let banner_id = if let Some(gid) = igdb_game_id {
        fetch_banner_id(&client, &client_id, &token, gid).await
    } else {
        None
    };

    std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;

    // Download cover  (t_cover_big ≈ 264×374)
    let cover_path = game_dir.join(format!("{}_cover.jpg", cover_image_id));
    if !cover_path.exists() {
        let bytes = client
            .get(format!("https://images.igdb.com/igdb/image/upload/t_cover_big/{}.jpg", cover_image_id))
            .send().await.map_err(|e| e.to_string())?
            .bytes().await.map_err(|e| e.to_string())?;
        std::fs::write(&cover_path, &bytes).map_err(|e| e.to_string())?;
    }

    // Download banner (t_screenshot_big ≈ 1280×720)
    if let Some(bid) = &banner_id {
        let banner_path = game_dir.join(format!("{}_banner.jpg", bid));
        if !banner_path.exists() {
            if let Ok(resp) = client
                .get(format!("https://images.igdb.com/igdb/image/upload/t_screenshot_big/{}.jpg", bid))
                .send().await
            {
                if let Ok(bytes) = resp.bytes().await {
                    let _ = std::fs::write(&banner_path, &bytes);
                }
            }
        }
    }

    // Save game metadata to info.json
    if !igdb_game.is_null() {
        let _ = save_game_info(&game_dir, &igdb_game, &app_id);
    }

    // Update metadata/index.json
    let index_path = meta_root.join("index.json");
    let mut index: serde_json::Value = std::fs::read_to_string(&index_path)
        .ok().and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = index.as_object_mut() {
        let mut entry = serde_json::json!({
            "name": game_name,
            "cover": cover_path.to_string_lossy(),
        });
        if let Some(bid) = &banner_id {
            let banner_path = game_dir.join(format!("{}_banner.jpg", bid));
            entry["banner"] = serde_json::Value::String(banner_path.to_string_lossy().to_string());
        }
        obj.insert(app_id.clone(), entry);
    }
    let _ = std::fs::write(&index_path, serde_json::to_string_pretty(&index).unwrap_or_default());

    Ok(Some(cover_path.to_string_lossy().to_string()))
}

/// Returns { app_id → { cover?: { path }, banner?: { path } } } — just paths, not data URLs.
/// Frontend will convert paths to data URLs using tauri::fs API to avoid IPC message size limits.
#[tauri::command]
async fn read_metadata_index(
    app_handle: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
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
            let mut result = serde_json::json!({});

            // Cover
            if let Some(p) = entry["cover"].as_str() {
                if std::path::Path::new(p).exists() {
                    result["cover_path"] = serde_json::Value::String(p.to_string());
                }
            }

            // Banner
            if let Some(p) = entry["banner"].as_str() {
                if std::path::Path::new(p).exists() {
                    result["banner_path"] = serde_json::Value::String(p.to_string());
                }
            }

            if result.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
                out.insert(app_id.clone(), result);
            }
        }
    }

    Ok(out)
}

/// Reads game metadata from `metadata/{app_id}/info.json`.
#[tauri::command]
async fn read_game_info(
    app_handle: tauri::AppHandle,
    app_id: String,
) -> Result<serde_json::Value, String> {
    let meta_root = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("metadata");
    let info_path = meta_root.join(&app_id).join("info.json");
    if !info_path.exists() {
        return Ok(serde_json::json!({}));
    }
    let data = std::fs::read_to_string(&info_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

/// Convert a file path to a data URL (base64 encoded JPEG).
#[tauri::command]
async fn file_to_data_url(file_path: String) -> Result<String, String> {
    let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", base64_encode(&bytes)))
}

// Visual Novel filter matching Metamedia's logic:
// VN = genre 34 in top-3 genres, not RPG (12) or Fighting (4)
// Inherited from parent if the game itself lacks genres
fn detect_vn(game: &serde_json::Value) -> bool {
    let genres = game["genres"].as_array().cloned().unwrap_or_default();
    let top3: Vec<u64> = genres.iter().take(3).filter_map(|g| g["id"].as_u64()).collect();
    let all_ids: Vec<u64> = genres.iter().filter_map(|g| g["id"].as_u64()).collect();

    let has_vn  = top3.contains(&34) && !all_ids.contains(&12) && !all_ids.contains(&4);
    if has_vn { return true; }

    // Inherit from parent if no own genres
    for parent_key in &["version_parent", "parent_game"] {
        let parent = &game[parent_key];
        if parent.is_null() { continue; }
        let pg = parent["genres"].as_array().cloned().unwrap_or_default();
        let pt3: Vec<u64> = pg.iter().take(3).filter_map(|g| g["id"].as_u64()).collect();
        let pa: Vec<u64>  = pg.iter().filter_map(|g| g["id"].as_u64()).collect();
        if pt3.contains(&34) && !pa.contains(&12) && !pa.contains(&4) {
            return true;
        }
    }
    false
}

#[tauri::command]
async fn igdb_search(
    app_handle: tauri::AppHandle,
    query: String,
    is_visual_novel: bool,
) -> Result<serde_json::Value, String> {
    if query.is_empty() {
        return Ok(serde_json::json!([]));
    }

    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
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
    let safe_query = query.replace('"', "");

    const PAGE: usize = 100;
    let mut all: Vec<serde_json::Value> = Vec::new();
    let mut offset: usize = 0;

    loop {
        let page = igdb_query(
            &client,
            &client_id,
            &token,
            "https://api.igdb.com/v4/games",
            &format!(
                "fields id,name,cover.image_id,rating,first_release_date,\
                 genres.id,genres.name,\
                 version_parent.id,version_parent.genres.id,\
                 parent_game.id,parent_game.genres.id,\
                 version_title; \
                 search \"{}\"; where cover != null; limit {}; offset {};",
                safe_query, PAGE, offset
            ),
        ).await?;

        let items = page.as_array().map(|a| a.clone()).unwrap_or_default();
        let count = items.len();

        for item in items {
            // Skip packaging editions (version_parent or version_title set)
            if !item["version_parent"].is_null() || !item["version_title"].is_null() {
                continue;
            }
            let vn = detect_vn(&item);
            if is_visual_novel == vn {
                all.push(item);
            }
        }

        if count < PAGE { break; }
        offset += PAGE;
    }

    Ok(serde_json::Value::Array(all))
}

#[tauri::command]
async fn igdb_get_game_detail(
    app_handle: tauri::AppHandle,
    igdb_id: u64,
) -> Result<serde_json::Value, String> {
    let app_data_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let cfg = {
        let path = app_data_dir.join("env.json");
        if !path.exists() { return Err("No env.json".into()); }
        let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str::<EnvConfig>(&data).map_err(|e| e.to_string())?
    };
    let client_id     = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token         = get_twitch_token(&client_id, &client_secret).await?;
    let client        = reqwest::Client::new();

    let games = igdb_query(
        &client, &client_id, &token,
        "https://api.igdb.com/v4/games",
        &format!(
            "fields id,name,cover.image_id,summary,first_release_date,rating,\
             genres.name,involved_companies.company.name,\
             involved_companies.developer,involved_companies.publisher,platforms.name; \
             where id = {}; limit 1;",
            igdb_id
        ),
    ).await?;

    let mut game = games[0].clone();
    if game.is_null() {
        return Ok(serde_json::json!(null));
    }

    // Fetch banner: artworks first, then screenshots
    let banner_id = fetch_banner_id(&client, &client_id, &token, igdb_id).await;
    game["banner_image_id"] = banner_id
        .map(|id| serde_json::Value::String(id))
        .unwrap_or(serde_json::Value::Null);

    // Fetch store links from external_games — detect platform from URL (more reliable than category enum)
    if let Ok(ext) = igdb_query(
        &client, &client_id, &token,
        "https://api.igdb.com/v4/external_games",
        &format!("fields category,url; where game = {}; limit 30;", igdb_id),
    ).await {
        if let Some(arr) = ext.as_array() {
            let links: Vec<serde_json::Value> = arr.iter()
                .filter_map(|e| {
                    let url = e["url"].as_str().filter(|u| !u.is_empty())?;
                    let platform = if url.contains("store.steampowered.com") { "steam" }
                        else if url.contains("gog.com")           { "gog" }
                        else if url.contains("epicgames.com")     { "epic" }
                        else if url.contains("xbox.com") || url.contains("microsoft.com/store") { "xbox" }
                        else if url.contains("playstation.com")   { "playstation" }
                        else { return None; };
                    Some(serde_json::json!({ "platform": platform, "url": url }))
                })
                .collect();
            if !links.is_empty() {
                game["store_links"] = serde_json::Value::Array(links);
            }
        }
    }

    Ok(game)
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

#[tauri::command]
async fn save_user_info(
    app_handle: tauri::AppHandle,
    info: serde_json::Value,
) -> Result<(), String> {
    let path = user_metadata_dir(&app_handle)?.join("user_info.json");
    // Merge with existing data so partial updates don't wipe other fields
    let existing: serde_json::Value = if path.exists() {
        let raw = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    let mut merged = existing;
    if let (Some(obj), Some(new_obj)) = (merged.as_object_mut(), info.as_object()) {
        for (k, v) in new_obj { obj.insert(k.clone(), v.clone()); }
    }
    let out = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    std::fs::write(path, out).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_user_info(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = user_metadata_dir(&app_handle)?.join("user_info.json");
    if !path.exists() { return Ok(serde_json::json!({})); }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_opener::init())
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
            igdb_get_game_detail,
            igdb_get_cover_by_steam_id,
            read_metadata_index,
            read_game_info,
            file_to_data_url,
            debug_scan_info,
            open_env_folder,
            save_user_image,
            get_user_image,
            remove_user_image,
            save_user_info,
            get_user_info,
            read_routes,
            write_routes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
