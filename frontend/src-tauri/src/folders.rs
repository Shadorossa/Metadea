use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub async fn pick_folder(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app_handle.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

// "Localizar → elegir un archivo suelto" (LocalMediaDetailPanel) — for a
// folder that holds several distinct catalog entries at once (e.g. a movie
// collection with one file per film), where picking the whole *folder*
// would wrongly rename every sibling as if they were episodes of the same
// work.
#[tauri::command]
pub async fn pick_file(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app_handle.dialog().file().blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

// Used by the "Localizar" flow (LocalMediaDetailPanel) to rename a picked
// folder and its episode files into a format the automatic matcher (see
// folderMatch.ts) can always recognize afterward. Refuses to clobber an
// existing file/folder at the destination — the caller is expected to have
// already generated non-colliding names, but this is the last line of
// defense against actually losing data if it didn't.
#[tauri::command]
pub async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    let old = PathBuf::from(&old_path);
    let new = PathBuf::from(&new_path);
    if !old.exists() {
        return Err(format!("Source path does not exist: {}", old_path));
    }
    if new.exists() && new != old {
        return Err(format!("A file or folder already exists at: {}", new_path));
    }
    std::fs::rename(&old, &new).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_folder_contents(path: String) -> Result<Vec<FolderEntry>, String> {
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

#[tauri::command]
pub async fn read_routes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<String, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn
        .prepare("SELECT key, path FROM local_routes")
        .str_err()?;
    let mut map = serde_json::Map::new();
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .str_err()?;
    for row in rows.flatten() {
        map.insert(row.0, serde_json::Value::String(row.1));
    }
    serde_json::to_string(&map).str_err()
}

#[tauri::command]
pub async fn write_routes(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    routes_json: String,
) -> Result<(), String> {
    let v: serde_json::Value =
        serde_json::from_str(&routes_json).str_err()?;
    let obj = v.as_object().ok_or("Expected JSON object")?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    for (k, val) in obj.iter() {
        if let Some(p) = val.as_str() {
            conn.execute(
                "INSERT INTO local_routes (key, path, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at",
                rusqlite::params![k, p, now],
            )
            .str_err()?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_env_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?;
    std::fs::create_dir_all(&app_data_dir).str_err()?;
    let path_str = app_data_dir.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(&path_str)
            .spawn()
            .str_err()?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(&path_str)
            .spawn()
            .str_err()?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .str_err()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn launch_game(
    app_handle: tauri::AppHandle,
    launcher: String,
    app_id: Option<String>,
    install_path: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    match launcher.as_str() {
        "steam" => {
            let id = app_id.ok_or("No app_id for Steam game")?;
            app_handle.opener().open_url(format!("steam://run/{}", id), None::<String>)
                .str_err()
        }
        "epic" => {
            if let Some(id) = app_id {
                app_handle.opener()
                    .open_url(format!("com.epicgames.launcher://apps/{}?action=launch&silent=true", id), None::<String>)
                    .str_err()
            } else if let Some(path) = install_path {
                app_handle.opener().open_path(path, None::<String>).str_err()
            } else {
                Err("No launch target for Epic game".into())
            }
        }
        "gog" => {
            if let Some(id) = app_id {
                app_handle.opener()
                    .open_url(format!("goggalaxy://openGame/{}", id), None::<String>)
                    .str_err()
            } else if let Some(path) = install_path {
                app_handle.opener().open_path(path, None::<String>).str_err()
            } else {
                Err("No launch target for GOG game".into())
            }
        }
        _ => {
            if let Some(path) = install_path {
                app_handle.opener().open_path(path, None::<String>).str_err()
            } else {
                Err(format!("No launch target for {} game", launcher))
            }
        }
    }
}

// A plain `Command::new("vlc")` only works when VLC's install dir was added
// to PATH, which the default Windows installer does *not* do — that silent
// spawn failure was why the "Reproducir" button did nothing. This looks up
// VLC the same way Windows itself does (the "App Paths" registry key VLC's
// installer registers), then falls back to the two standard install
// locations, and only tries bare "vlc" last in case it *is* on PATH.
#[cfg(windows)]
fn vlc_path_from_registry() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;
    const SUBKEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\vlc.exe";
    // VLC is very commonly still distributed/installed as a 32-bit build even
    // on 64-bit Windows — its App Paths entry then only exists in the WOW64
    // 32-bit registry view, which a 64-bit process (this app) does not see
    // by default. Check both views on both hives explicitly.
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            if let Ok(key) =
                RegKey::predef(hive).open_subkey_with_flags(SUBKEY, KEY_READ | view)
            {
                if let Ok(path) = key.get_value::<String, _>("") {
                    let p = PathBuf::from(path.trim_matches('"'));
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn vlc_path_from_registry() -> Option<PathBuf> {
    None
}

fn find_vlc_executable() -> PathBuf {
    if let Some(p) = vlc_path_from_registry() {
        return p;
    }
    for candidate in [
        "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
        "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
    ] {
        let p = PathBuf::from(candidate);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("vlc")
}

// Fixed loopback-only port/password for VLC's HTTP status interface — this
// only ever talks to a VLC instance we ourselves just spawned on the same
// machine, so a hardcoded local secret is fine (nothing external can reach
// it, and there's no sensitive data behind it beyond "what's playing").
const VLC_HTTP_PORT: u16 = 39321;
const VLC_HTTP_PASSWORD: &str = "metadea-local";

// file_paths is played in order as one VLC playlist (a plain multi-argument
// launch queues them sequentially, no shuffle) — lets "Reproducir" queue
// every remaining episode in one go instead of relaunching per episode.
// start_seconds only ever applies to the first path (VLC's --start-time
// only affects whatever plays first when the process starts).
#[tauri::command]
pub async fn play_file_with_vlc(file_paths: Vec<String>, start_seconds: Option<f64>) -> Result<(), String> {
    if file_paths.is_empty() {
        return Err("No files to play".into());
    }
    // `--extraintf http` runs VLC's web status API *alongside* its normal
    // player window (it doesn't replace the UI) so get_vlc_playback_status
    // can poll episode progress. If VLC is already running in single-instance
    // mode, this queue just gets forwarded to that instance and these flags
    // (including --start-time below) are silently ignored — a known
    // limitation of external control this way.
    let mut cmd = std::process::Command::new(find_vlc_executable());
    cmd.args(&file_paths);
    if let Some(seconds) = start_seconds {
        if seconds > 1.0 {
            cmd.arg(format!("--start-time={seconds}"));
        }
    }
    cmd.arg("--extraintf").arg("http")
        .arg("--http-host").arg("127.0.0.1")
        .arg("--http-port").arg(VLC_HTTP_PORT.to_string())
        .arg("--http-password").arg(VLC_HTTP_PASSWORD)
        .spawn()
        .map_err(|e| format!("Failed to launch VLC: {}", e))?;
    Ok(())
}

// Fire-and-forget playback control — VLC's status.json endpoint doubles as a
// command sink via `?command=`. Known commands actually used here: pl_forcepause,
// pl_forceresume, pl_stop, pl_next. Errors (VLC not reachable) are swallowed the
// same way get_vlc_playback_status treats them — the next poll tick already
// surfaces "nothing is playing" on its own once VLC is genuinely gone.
#[tauri::command]
pub async fn send_vlc_command(command: String, val: Option<String>) -> Result<(), String> {
    let mut url = format!("http://127.0.0.1:{}/requests/status.json?command={}", VLC_HTTP_PORT, command);
    if let Some(v) = val {
        url.push_str(&format!("&val={v}"));
    }
    let client = reqwest::Client::new();
    let _ = client
        .get(&url)
        .basic_auth("", Some(VLC_HTTP_PASSWORD))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VlcPlaybackStatus {
    pub state:    String,
    pub position: f64,
    pub time:     i64,
    pub length:   i64,
    // The currently loaded file's own name (VLC's status.json exposes it
    // under information.category.meta.filename) — lets the frontend tell
    // "VLC moved on to the next queued file" apart from "the user seeked
    // backward within this one" by comparing against the queue's own file
    // paths directly, instead of inferring it from time/duration, which
    // can't tell those two cases apart when consecutive episodes happen to
    // share the exact same runtime. None if VLC's response doesn't carry
    // this metadata for whatever reason — callers fall back accordingly.
    pub filename: Option<String>,
}

// Polled by the frontend while an episode is playing to auto-mark it as
// watched once position crosses 80%. Returns Ok(None) whenever VLC's HTTP
// interface isn't reachable (not running yet, or running without
// --extraintf http) rather than erroring — that's an expected, frequent
// state (e.g. right after spawn, before VLC has finished starting up), not
// a failure the caller needs to react to.
#[tauri::command]
pub async fn get_vlc_playback_status() -> Result<Option<VlcPlaybackStatus>, String> {
    let url = format!("http://127.0.0.1:{}/requests/status.json", VLC_HTTP_PORT);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .basic_auth("", Some(VLC_HTTP_PASSWORD))
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;

    let resp = match resp {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(None),
    };

    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    let filename = json.get("information")
        .and_then(|i| i.get("category"))
        .and_then(|c| c.get("meta"))
        .and_then(|m| m.get("filename"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(Some(VlcPlaybackStatus {
        state:    json.get("state").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        position: json.get("position").and_then(|v| v.as_f64()).unwrap_or(0.0),
        time:     json.get("time").and_then(|v| v.as_i64()).unwrap_or(0),
        length:   json.get("length").and_then(|v| v.as_i64()).unwrap_or(0),
        filename,
    }))
}

