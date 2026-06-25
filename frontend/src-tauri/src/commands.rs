use crate::db::{Database, LibraryItem, AuthSession};
use crate::igdb::{IgdbTokenCache, IgdbGame};
use tauri::State;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Serialize, Deserialize};
use rfd;

// ─── Database init ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn init_database(
  app_data_dir: String,
  database: State<'_, Database>,
) -> Result<String, String> {
  let path = PathBuf::from(app_data_dir);
  std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
  database.init(path).map_err(|e| e.to_string())?;
  Ok("ok".to_string())
}

// ─── Auth token ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn store_auth_token(
  token:    String,
  username: String,
  database: State<'_, Database>,
) -> Result<(), String> {
  database.set_config("auth_token",    &token)    .map_err(|e| e.to_string())?;
  database.set_config("auth_username", &username) .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn get_auth_token(
  database: State<'_, Database>,
) -> Result<Option<AuthSession>, String> {
  let token    = database.get_config("auth_token")   .map_err(|e| e.to_string())?;
  let username = database.get_config("auth_username").map_err(|e| e.to_string())?;

  match token {
    Some(t) => Ok(Some(AuthSession {
      token:    t,
      username: username.unwrap_or_default(),
    })),
    None => Ok(None),
  }
}

#[tauri::command]
pub async fn clear_auth_token(
  database: State<'_, Database>,
) -> Result<(), String> {
  database.delete_config("auth_token")   .map_err(|e| e.to_string())?;
  database.delete_config("auth_username").map_err(|e| e.to_string())?;
  Ok(())
}

// ─── Library ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_library_item(
  external_id: String,
  item_type:   String,
  rating:      Option<i32>,
  status:      Option<String>,
  database:    State<'_, Database>,
) -> Result<String, String> {
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_secs();

  let item = LibraryItem {
    id:          None,
    external_id: external_id.clone(),
    item_type,
    rating,
    status:      status.unwrap_or_else(|| "planning".to_string()),
    created_at:  now.to_string(),
  };

  database.save_item(item).map_err(|e| e.to_string())?;
  Ok(format!("saved:{}", external_id))
}

#[tauri::command]
pub async fn get_library_items(
  database: State<'_, Database>,
) -> Result<Vec<LibraryItem>, String> {
  database.get_all_items().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_library_stats(
  database: State<'_, Database>,
) -> Result<serde_json::Value, String> {
  database.get_stats().map_err(|e| e.to_string())
}

// ─── Local Library ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalGame {
  pub name:         String,
  pub launcher:     String,
  pub app_id:       Option<String>,
  pub install_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalFolderEntry {
  pub name:        String,
  pub is_dir:      bool,
  pub size:        u64,
  pub child_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedFolder {
  pub path:  String,
  pub label: String,
}

// ── VDF helper ────────────────────────────────────────────────────────────────

fn vdf_value(content: &str, key: &str) -> Option<String> {
  let needle = format!("\"{}\"", key);
  let mut pos = 0;
  while pos < content.len() {
    if let Some(idx) = content[pos..].find(&needle) {
      let abs  = pos + idx;
      let rest = content[abs + needle.len()..].trim_start();
      if rest.starts_with('"') {
        let inner = &rest[1..];
        if let Some(end) = inner.find('"') {
          return Some(inner[..end].to_string());
        }
      }
      pos = abs + 1;
    } else {
      break;
    }
  }
  None
}

// ── Steam ─────────────────────────────────────────────────────────────────────

fn steam_library_paths() -> Vec<PathBuf> {
  let candidates = [
    r"C:\Program Files (x86)\Steam",
    r"C:\Program Files\Steam",
    r"D:\Steam",
    r"D:\SteamLibrary",
    r"E:\Steam",
    r"E:\SteamLibrary",
  ];
  let mut roots: Vec<PathBuf> = candidates
    .iter()
    .map(PathBuf::from)
    .filter(|p| p.exists())
    .collect();

  // Parse libraryfolders.vdf from the first found root
  if let Some(root) = roots.first().cloned() {
    let vdf = root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(content) = std::fs::read_to_string(&vdf) {
      let mut pos = 0;
      while let Some(idx) = content[pos..].find("\"path\"") {
        let abs  = pos + idx;
        let rest = content[abs + 6..].trim_start();
        if rest.starts_with('"') {
          let inner = &rest[1..];
          if let Some(end) = inner.find('"') {
            let p = PathBuf::from(&inner[..end]);
            if p.exists() && !roots.contains(&p) {
              roots.push(p);
            }
          }
        }
        pos = abs + 1;
      }
    }
  }
  roots
}

fn scan_steam() -> Vec<LocalGame> {
  let mut games = Vec::new();
  for root in steam_library_paths() {
    let apps_dir = root.join("steamapps");
    let Ok(entries) = std::fs::read_dir(&apps_dir) else { continue };
    for entry in entries.flatten() {
      let path = entry.path();
      if path.extension().and_then(|e| e.to_str()) != Some("acf") { continue; }
      let Ok(content) = std::fs::read_to_string(&path) else { continue };
      let Some(name) = vdf_value(&content, "name") else { continue };
      if name.is_empty() { continue; }
      games.push(LocalGame {
        name,
        launcher:     "steam".to_string(),
        app_id:       vdf_value(&content, "appid"),
        install_path: vdf_value(&content, "installdir")
          .map(|d| apps_dir.join("common").join(d).to_string_lossy().to_string()),
      });
    }
  }
  games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  games
}

// ── Epic Games ────────────────────────────────────────────────────────────────

fn scan_epic() -> Vec<LocalGame> {
  let manifests = PathBuf::from(
    r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests"
  );
  if !manifests.exists() { return Vec::new(); }

  let Ok(entries) = std::fs::read_dir(&manifests) else { return Vec::new() };
  let mut games: Vec<LocalGame> = entries
    .flatten()
    .filter_map(|e| {
      let path = e.path();
      if path.extension()?.to_str()? != "item" { return None; }
      let content = std::fs::read_to_string(&path).ok()?;
      let json: serde_json::Value = serde_json::from_str(&content).ok()?;
      let name = json["DisplayName"].as_str()?.trim().to_string();
      if name.is_empty() { return None; }
      Some(LocalGame {
        name,
        launcher:     "epic".to_string(),
        app_id:       json["AppName"].as_str().map(String::from),
        install_path: json["InstallLocation"].as_str().map(String::from),
      })
    })
    .collect();
  games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  games
}

// ── Xbox ──────────────────────────────────────────────────────────────────────

fn scan_xbox() -> Vec<LocalGame> {
  let candidates = [
    r"C:\XboxGames",
    r"D:\XboxGames",
    r"E:\XboxGames",
  ];
  let mut games = Vec::new();
  for dir in candidates.iter().map(PathBuf::from).filter(|p| p.exists()) {
    let Ok(entries) = std::fs::read_dir(&dir) else { continue };
    for entry in entries.flatten() {
      if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
      games.push(LocalGame {
        name:         entry.file_name().to_string_lossy().to_string(),
        launcher:     "xbox".to_string(),
        app_id:       None,
        install_path: Some(entry.path().to_string_lossy().to_string()),
      });
    }
  }
  games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  games
}

// ── GOG ───────────────────────────────────────────────────────────────────────

fn scan_gog() -> Vec<LocalGame> {
  let candidates = [
    r"C:\GOG Games",
    r"D:\GOG Games",
    r"C:\Program Files (x86)\GOG Galaxy\Games",
  ];
  let mut games = Vec::new();
  for dir in candidates.iter().map(PathBuf::from).filter(|p| p.exists()) {
    let Ok(entries) = std::fs::read_dir(&dir) else { continue };
    for entry in entries.flatten() {
      if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
      games.push(LocalGame {
        name:         entry.file_name().to_string_lossy().to_string(),
        launcher:     "gog".to_string(),
        app_id:       None,
        install_path: Some(entry.path().to_string_lossy().to_string()),
      });
    }
  }
  games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  games
}

// ── EA ────────────────────────────────────────────────────────────────────────

fn scan_ea() -> Vec<LocalGame> {
  let candidates = [
    r"C:\Program Files\EA Games",
    r"C:\Program Files (x86)\Origin Games",
    r"D:\EA Games",
    r"D:\Origin Games",
    r"E:\EA Games",
  ];
  let mut games = Vec::new();
  for dir in candidates.iter().map(PathBuf::from).filter(|p| p.exists()) {
    let Ok(entries) = std::fs::read_dir(&dir) else { continue };
    for entry in entries.flatten() {
      if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
      let name = entry.file_name().to_string_lossy().to_string();
      if name.starts_with('.') { continue; }
      games.push(LocalGame {
        name,
        launcher:     "ea".to_string(),
        app_id:       None,
        install_path: Some(entry.path().to_string_lossy().to_string()),
      });
    }
  }
  games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  games
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scan_all_games() -> Result<Vec<LocalGame>, String> {
  let mut games = Vec::new();
  games.extend(scan_steam());
  games.extend(scan_epic());
  games.extend(scan_gog());
  games.extend(scan_xbox());
  games.extend(scan_ea());
  Ok(games)
}

#[tauri::command]
pub fn pick_folder() -> Option<String> {
  rfd::FileDialog::new()
    .set_title("Seleccionar carpeta")
    .pick_folder()
    .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn scan_folder_contents(path: String) -> Result<Vec<LocalFolderEntry>, String> {
  let dir = PathBuf::from(&path);
  if !dir.is_dir() { return Err("Not a directory".into()); }

  let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
  let mut result = Vec::new();

  for entry in entries.flatten() {
    let meta     = entry.metadata().ok();
    let is_dir   = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
    let size     = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let name     = entry.file_name().to_string_lossy().to_string();

    // Skip hidden files
    if name.starts_with('.') { continue; }

    let child_count = if is_dir {
      std::fs::read_dir(entry.path()).ok().map(|d| d.count())
    } else {
      None
    };

    result.push(LocalFolderEntry { name, is_dir, size, child_count });
  }

  result.sort_by(|a, b| {
    b.is_dir.cmp(&a.is_dir)
      .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
  });

  Ok(result)
}

#[tauri::command]
pub async fn get_local_folders(
  database: State<'_, Database>,
) -> Result<Vec<SavedFolder>, String> {
  let raw = database
    .get_config("local_folders")
    .map_err(|e| e.to_string())?
    .unwrap_or_else(|| "[]".to_string());
  serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_local_folders(
  folders_json: String,
  database:     State<'_, Database>,
) -> Result<(), String> {
  database
    .set_config("local_folders", &folders_json)
    .map_err(|e| e.to_string())
}

// ─── Env config (%APPDATA%\Metadea\env.json) ─────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct EnvConfig {
  pub igdb_client_id:     Option<String>,
  pub igdb_client_secret: Option<String>,
}

fn metadea_env_path() -> Result<PathBuf, String> {
  let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
  let dir = PathBuf::from(appdata).join("Metadea");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir.join("env.json"))
}

#[tauri::command]
pub fn read_env_config() -> Result<EnvConfig, String> {
  let path = metadea_env_path()?;
  if !path.exists() {
    return Ok(EnvConfig::default());
  }
  let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
  serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_env_config(config: EnvConfig) -> Result<(), String> {
  let path = metadea_env_path()?;
  let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
  std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ─── IGDB search ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn igdb_search(
  name:        String,
  token_cache: State<'_, IgdbTokenCache>,
) -> Result<Vec<IgdbGame>, String> {
  let cfg = read_env_config()?;
  let client_id     = cfg.igdb_client_id    .ok_or("IGDB Client ID no configurado")?;
  let client_secret = cfg.igdb_client_secret.ok_or("IGDB Client Secret no configurado")?;

  let token = crate::igdb::get_bearer_token(&client_id, &client_secret, &token_cache).await?;
  crate::igdb::search_games(&name, &client_id, &token).await
}
