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

#[tauri::command]
pub async fn pick_backup_file(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app_handle
        .dialog()
        .file()
        .add_filter("Metadea backup", &["zip"])
        .blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn pick_save_file(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app_handle
        .dialog()
        .file()
        .add_filter("ZIP backup", &["zip"])
        .set_file_name("metadea-backup.zip")
        .blocking_save_file();
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

// Opens any URL (custom scheme like "steam://" included) via the OS's own
// handler — same opener plugin launch_game already uses below, needed
// separately since a plain <a target="_blank">/window.open from the
// frontend doesn't reliably hand a non-http(s) scheme off to the OS from
// inside the webview.
#[tauri::command]
pub async fn open_external_url(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app_handle.opener().open_url(url, None::<String>).str_err()
}

// Splits an emulator's launch_args string into process args, substituting
// the `{ROM}` placeholder (see EmulatorsTab.astro's own field, which shows
// that exact token as its placeholder text) with the actual ROM path
// wherever it appears; falls back to just appending the ROM path as the
// final argument when the user never typed `{ROM}` at all.
//
// Tokenizes `launch_args` itself FIRST (quote-aware, so the user can still
// group their OWN flags), then substitutes rom_path into whichever
// token(s) contain `{ROM}` — never the other way around. An earlier
// version built one combined string (`launch_args` with `{ROM}` already
// replaced by the real path) and tokenized THAT by whitespace instead: a
// real ROM's filename or folder almost always has spaces in it, and since
// nothing quoted the substituted path, tokenizing after the fact silently
// split it into multiple unrelated arguments — the emulator launched, but
// with a garbled/truncated file argument instead of the real ROM, reading
// as a generic "unsupported format" dialog rather than actually opening
// anything. Splitting first means rom_path always lands as exactly one
// argument (Command::args below doesn't need it quoted at all — each Vec
// entry is already atomic), no matter how many spaces are in it or
// whether the user's own template wrapped `{ROM}` in quotes or not.
fn build_emulator_args(launch_args: &str, rom_path: &str) -> Vec<String> {
    let template = if launch_args.trim().is_empty() { "{ROM}" } else { launch_args };

    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in template.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    let has_placeholder = tokens.iter().any(|t| t.contains("{ROM}"));
    let mut args: Vec<String> = tokens
        .into_iter()
        .map(|tok| if tok.contains("{ROM}") { tok.replace("{ROM}", rom_path) } else { tok })
        .collect();
    if !has_placeholder {
        args.push(rom_path.to_string());
    }
    args
}

#[tauri::command]
pub async fn launch_game(
    app_handle: tauri::AppHandle,
    launcher: String,
    app_id: Option<String>,
    install_path: Option<String>,
    rom_platform: Option<String>,
    external_id: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let is_direct_exe = install_path
        .as_deref()
        .map(|p| p.to_lowercase().ends_with(".exe"))
        .unwrap_or(false);

    if !is_direct_exe {
        if let Some(platform_id) = rom_platform {
            use tauri::Manager;
            use tauri::Emitter;
            let rom_path = install_path.ok_or("No ROM path for emulator game")?;
            let db = app_handle.state::<crate::db::MetadeaDb>();
            let (executable_path, launch_args) = {
                let conn = db.conn.lock().str_err()?;
                conn.query_row(
                    "SELECT executable_path, launch_args FROM emulator_configs WHERE platform_id = ?1",
                    [&platform_id],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .map_err(|_| format!("No emulator configured for {}", platform_id))?
            };
            if executable_path.is_empty() {
                return Err(format!("No emulator executable configured for {}", platform_id));
            }
            let args = build_emulator_args(&launch_args, &rom_path);
            let mut child = std::process::Command::new(&executable_path)
                .args(&args)
                .spawn()
                .map_err(|e| format!("Failed to launch emulator: {}", e))?;

            let handle = app_handle.clone();
            let ext_id = external_id.unwrap_or_default();
            let exe_path_buf = PathBuf::from(&executable_path);
            let root_filename = exe_path_buf.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let start = std::time::Instant::now();

            tokio::spawn(async move {
                let _ = tokio::task::spawn_blocking(move || {
                    let _ = child.wait();
                }).await;

                if !root_filename.is_empty() {
                    use sysinfo::System;
                    let mut sys = System::new();
                    let timeout = std::time::Duration::from_secs(30);
                    let poll = std::time::Duration::from_millis(500);
                    let mut elapsed = std::time::Duration::ZERO;
                    loop {
                        tokio::time::sleep(poll).await;
                        elapsed += poll;
                        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
                        let running = sys.processes().values().any(|p| {
                            p.name().to_string_lossy().eq_ignore_ascii_case(&root_filename)
                        });
                        if !running || elapsed >= timeout {
                            break;
                        }
                    }
                }

                let total_secs = start.elapsed().as_secs_f64();
                let hours = total_secs / 3600.0;
                if hours >= 0.01 && !ext_id.is_empty() {
                    let _ = handle.emit("game-session-ended", SessionEndedPayload {
                        external_id: ext_id,
                        hours,
                    });
                }
            });

            return Ok(());
        }
    }
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
            launch_gog_game(app_id, install_path)
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

#[cfg(windows)]
fn find_gog_galaxy_client() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;

    let subkey = "SOFTWARE\\GOG.com\\GalaxyClient\\paths";
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            if let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(subkey, KEY_READ | view) {
                if let Ok(client) = key.get_value::<String, _>("client") {
                    let path = PathBuf::from(client.trim_matches('"'));
                    if path.is_file() {
                        return Some(path);
                    }
                }
            }
        }
    }

    [
        r"C:\Program Files (x86)\GOG Galaxy\GalaxyClient.exe",
        r"C:\Program Files\GOG Galaxy\GalaxyClient.exe",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
}

#[cfg(windows)]
fn launch_gog_game(app_id: Option<String>, install_path: Option<String>) -> Result<(), String> {
    let id = app_id.ok_or("No GOG game ID")?;
    let client = find_gog_galaxy_client().ok_or("No se encontró GOG Galaxy (GalaxyClient.exe)")?;
    let mut command = std::process::Command::new(client);
    command.arg("/command=runGame").arg(format!("/gameId={}", id));
    if let Some(path) = install_path {
        command.arg(format!("/path={}", path));
    }
    command.spawn().map(|_| ()).map_err(|e| format!("No se pudo iniciar el juego de GOG: {}", e))
}

#[cfg(not(windows))]
fn launch_gog_game(_app_id: Option<String>, _install_path: Option<String>) -> Result<(), String> {
    Err("El inicio de juegos de GOG solo está disponible en Windows".into())
}

// Steam/GOG/Epic all intercept launch_game's URL scheme and start the actual
// game executable themselves — there's no child process handle to `.wait()`
// on. Instead this polls for any running process whose exe path lives under
// the game's own install folder, and reports the elapsed time once one
// showed up and then disappeared again. Fire-and-forget from the frontend's
// point of view: it returns immediately, and the result (if any) arrives
// later as a "game-session-ended" event.
#[derive(Clone, serde::Serialize)]
struct SessionEndedPayload {
    external_id: String,
    hours: f64,
}

#[tauri::command]
pub async fn start_playtime_session(
    app_handle: tauri::AppHandle,
    install_path: String,
    external_id: String,
    rom_platform: Option<String>,
    launcher: Option<String>,
    app_id: Option<String>,
) -> Result<(), String> {
    tokio::spawn(track_playtime_session(app_handle, install_path, external_id, rom_platform, launcher, app_id));
    Ok(())
}

fn normalize_path_for_compare(p: &std::path::Path) -> String {
    let s = p.to_string_lossy();
    let trimmed = s.strip_prefix(r"\\?\").unwrap_or(&s);
    trimmed.replace('/', "\\").to_lowercase()
}

fn gog_primary_executable(install_dir: &std::path::Path, app_id: &str) -> Option<PathBuf> {
    let info = install_dir.join(format!("goggame-{}.info", app_id));
    let content = std::fs::read_to_string(info).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&content).ok()?;
    let tasks = manifest.get("playTasks")?.as_array()?;
    let primary = tasks.iter().find(|task| {
        task.get("isPrimary").and_then(serde_json::Value::as_bool) == Some(true)
            && task.get("type").and_then(serde_json::Value::as_str)
                .map(|kind| kind.eq_ignore_ascii_case("FileTask"))
                .unwrap_or(true)
    })?;
    let relative_path = primary.get("path")?.as_str()?;
    let executable = install_dir.join(relative_path);
    executable.is_file().then_some(executable)
}

#[tauri::command]
pub fn stop_game_process(
    app_handle: tauri::AppHandle,
    install_path: String,
    rom_platform: Option<String>,
) -> Result<usize, String> {
    use sysinfo::System;

    if install_path.trim().is_empty() {
        return Err("No se conoce la ruta de instalación del juego".into());
    }

    let is_direct_exe = install_path.to_lowercase().ends_with(".exe");
    let (root, is_rom) = if !is_direct_exe {
        if let Some(platform_id) = rom_platform.as_deref() {
            use tauri::Manager;
            let db = app_handle.state::<crate::db::MetadeaDb>();
            let executable = {
                let conn = db.conn.lock().str_err()?;
                conn.query_row(
                    "SELECT executable_path FROM emulator_configs WHERE platform_id = ?1",
                    [platform_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|_| format!("No emulator configured for {}", platform_id))?
            };
            (PathBuf::from(executable), true)
        } else {
            (PathBuf::from(&install_path), false)
        }
    } else {
        (PathBuf::from(&install_path), false)
    };

    let root_filename = root.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let norm_root = normalize_path_for_compare(&root);

    let mut system = System::new();
    system.refresh_all();
    let mut stopped = 0;
    for process in system.processes().values() {
        let matches_session = if is_rom {
            if !root_filename.is_empty() && process.name().to_string_lossy().eq_ignore_ascii_case(&root_filename) {
                true
            } else {
                process.exe().map(|exe| {
                    let exe = normalize_path_for_compare(exe);
                    exe == norm_root || exe.ends_with(&norm_root) || norm_root.ends_with(&exe)
                }).unwrap_or(false)
            }
        } else {
                process.exe().map(|exe| {
                    let exe = normalize_path_for_compare(exe);
                    if is_direct_exe {
                        exe == norm_root
                    } else if norm_root.ends_with('\\') {
                        exe.starts_with(&norm_root)
                    } else {
                        exe.starts_with(&format!("{}\\", norm_root))
                    }
                }).unwrap_or(false)
        };
        if matches_session && process.kill() {
            stopped += 1;
        }
    }

    Ok(stopped)
}

async fn track_playtime_session(
    app_handle: tauri::AppHandle,
    install_path: String,
    external_id: String,
    rom_platform: Option<String>,
    launcher: Option<String>,
    app_id: Option<String>,
) {
    use std::time::{Duration, Instant};
    use sysinfo::System;
    use tauri::Emitter;

    let is_direct_exe = install_path.to_lowercase().ends_with(".exe");
    let watch_target: Option<PathBuf> = if !is_direct_exe && rom_platform.is_some() {
        let platform_id = rom_platform.as_ref().unwrap();
        use tauri::Manager;
        let db = app_handle.state::<crate::db::MetadeaDb>();
        let exe = {
            let Ok(conn) = db.conn.lock() else { return };
            conn.query_row(
                "SELECT executable_path FROM emulator_configs WHERE platform_id = ?1",
                [platform_id],
                |r| r.get::<_, String>(0),
            ).ok()
        };
        exe.filter(|e| !e.is_empty()).map(PathBuf::from)
    } else {
        Some(PathBuf::from(&install_path))
    };
    let Some(root) = watch_target else { return };
    let is_rom = !is_direct_exe && rom_platform.is_some();
    let gog_executable = if launcher.as_deref() == Some("gog") {
        app_id.as_deref().and_then(|id| gog_primary_executable(&root, id))
    } else {
        None
    };
    let root_filename = root.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let norm_root = normalize_path_for_compare(&root);

    let poll_every = Duration::from_secs(2);
    let start_timeout = Duration::from_secs(60);

    let mut sys = System::new();
    let mut waited = Duration::ZERO;
    let mut started_at: Option<Instant> = None;

    loop {
        tokio::time::sleep(poll_every).await;
        sys.refresh_all();
        let running = sys.processes().values().any(|p| {
            if is_rom {
                if !root_filename.is_empty() && p.name().to_string_lossy().eq_ignore_ascii_case(&root_filename) {
                    return true;
                }
                if let Some(exe) = p.exe() {
                    let norm_exe = normalize_path_for_compare(exe);
                    if norm_exe == norm_root || norm_exe.ends_with(&norm_root) || norm_root.ends_with(&norm_exe) {
                        return true;
                    }
                }
                false
            } else {
                if let Some(exe) = p.exe() {
                    let norm_exe = normalize_path_for_compare(exe);
                    if let Some(target) = &gog_executable {
                        norm_exe == normalize_path_for_compare(target)
                    } else {
                        norm_exe.starts_with(&norm_root)
                    }
                } else {
                    false
                }
            }
        });

        match (started_at, running) {
            (None, true) => started_at = Some(Instant::now()),
            (None, false) => {
                waited += poll_every;
                if waited >= start_timeout {
                    let _ = app_handle.emit("game-session-ended", SessionEndedPayload { external_id: external_id.clone(), hours: 0.0 });
                    return;
                }
            }
            (Some(start), false) => {
                let hours = start.elapsed().as_secs_f64() / 3600.0;
                let _ = app_handle.emit("game-session-ended", SessionEndedPayload { external_id, hours });
                return;
            }
            (Some(_), true) => {}
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

// Kills any VLC instance already running before a fresh "Reproducir" —
// VLC's single-instance mode otherwise silently forwards our new file list
// onto whatever window is already open instead of actually launching the
// process below, which means --extraintf/--http-port never take effect on
// it. get_vlc_playback_status then ends up polling that *other* window's
// real state (e.g. a much later episode from an earlier session left open),
// and playback-service.ts's track-boundary detection can match its filename
// far ahead in the current queue — mass-marking every episode in between as
// watched the moment that poll tick runs. Best-effort: a failure here (no
// VLC was running, or the platform command isn't available) is never fatal,
// the launch below still proceeds either way.
fn kill_existing_vlc() {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("taskkill").args(["/F", "/IM", "vlc.exe"]).status();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("pkill").args(["-x", "VLC"]).status();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("pkill").args(["-x", "vlc"]).status();

    // Only actually waits when a matching process was found and killed —
    // status() returning success/failure both return immediately otherwise.
    // The pause gives the OS a moment to release VLC's single-instance
    // socket/lock before this function's caller spawns a fresh instance,
    // which would otherwise itself get silently forwarded to the process
    // that's still in the middle of shutting down.
    if let Ok(status) = result {
        if status.success() {
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
    }
}

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
    kill_existing_vlc();
    // `--extraintf http` runs VLC's web status API *alongside* its normal
    // player window (it doesn't replace the UI) so get_vlc_playback_status
    // can poll episode progress. Now that any pre-existing VLC window is
    // closed above, this always launches a genuinely fresh instance, so
    // these flags (including --start-time below) reliably take effect
    // instead of risking being silently ignored by single-instance mode.
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

