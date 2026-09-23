// Playtime sessions: watching for the game's process to appear and exit,
// and force-stopping it on request.

use std::path::PathBuf;
use crate::db::ToStringErr;

// Steam/GOG/Epic all intercept launch_game's URL scheme and start the actual
// game executable themselves — there's no child process handle to `.wait()`
// on. Instead this polls for any running process whose exe path lives under
// the game's own install folder. The session lives in the registry
// (game_sessions.rs) from the moment this is called, so the presence shows
// while a slow launcher is still starting; playtime counts from the moment
// the game's process shows up, and the registry records it when it exits.
// Fire-and-forget from the frontend's point of view.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command arguments are its IPC fields
pub async fn start_playtime_session(
    app_handle: tauri::AppHandle,
    install_path: String,
    external_id: String,
    rom_platform: Option<String>,
    launcher: Option<String>,
    app_id: Option<String>,
    // Presence data for the session registry; optional for older callers.
    title: Option<String>,
    cover_url: Option<String>,
) -> Result<(), String> {
    use crate::game_sessions::{register, NewSession, Registration};
    let title = title
        .filter(|t| !t.trim().is_empty())
        .or_else(|| PathBuf::from(&install_path).file_stem().map(|s| s.to_string_lossy().to_string()))
        .unwrap_or_else(|| external_id.clone());
    let registration = register(&app_handle, NewSession {
        external_id,
        title,
        cover_url,
        platform: rom_platform.clone(),
        launcher: launcher.clone().unwrap_or_default(),
        app_id: app_id.clone(),
        install_path: Some(install_path.clone()),
        exe_path: None,
        pids: Vec::new(),
        running: false,
    });
    // A second Play click on a game that is already tracked starts nothing.
    let Registration::New(session_id) = registration else { return Ok(()) };
    tokio::spawn(track_playtime_session(app_handle, session_id, install_path, rom_platform, launcher, app_id));
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
        return Err(crate::error_codes::GAME_INSTALL_PATH_UNKNOWN.into());
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
    session_id: String,
    install_path: String,
    rom_platform: Option<String>,
    launcher: Option<String>,
    app_id: Option<String>,
) {
    use std::time::Duration;
    use sysinfo::System;
    use crate::game_sessions::{self, ProcessMatcher};

    let is_direct_exe = install_path.to_lowercase().ends_with(".exe");
    let watch_target: Option<PathBuf> = if let (false, Some(platform_id)) = (is_direct_exe, rom_platform.as_ref()) {
        use tauri::Manager;
        let db = app_handle.state::<crate::db::MetadeaDb>();
        let exe = match db.conn.lock() {
            Ok(conn) => conn.query_row(
                "SELECT executable_path FROM emulator_configs WHERE platform_id = ?1",
                [platform_id],
                |r| r.get::<_, String>(0),
            ).ok(),
            Err(_) => None,
        };
        exe.filter(|e| !e.is_empty()).map(PathBuf::from)
    } else {
        Some(PathBuf::from(&install_path))
    };
    let Some(root) = watch_target else {
        game_sessions::cancel(&app_handle, &session_id);
        return;
    };
    let is_rom = !is_direct_exe && rom_platform.is_some();
    let gog_executable = if launcher.as_deref() == Some("gog") {
        app_id.as_deref().and_then(|id| gog_primary_executable(&root, id))
    } else {
        None
    };
    let norm_root = normalize_path_for_compare(&root);
    let emulator_matcher = ProcessMatcher::executable(&root);
    // Nothing to exclude: by the time this runs the game may already be up
    // (launch_game's own ROM path is the one that snapshots beforehand).
    let preexisting = std::collections::HashSet::new();

    let poll_every = Duration::from_secs(2);
    // Store launchers (Steam/Epic/GOG…) can take minutes to update and start
    // the game; a direct .exe shows up within seconds.
    let start_timeout = if is_direct_exe { Duration::from_secs(60) } else { Duration::from_secs(180) };

    let mut sys = System::new();
    let mut waited = Duration::ZERO;
    let mut started = false;
    let mut last_seen = game_sessions::now_unix();

    loop {
        tokio::time::sleep(poll_every).await;
        if !game_sessions::is_active(&app_handle, &session_id) {
            return;
        }
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        let mut first_exe: Option<String> = None;
        let pids = game_sessions::exclude_preexisting(
            sys.processes().iter().filter_map(|(pid, p)| {
                let hit = if is_rom {
                    emulator_matcher.matches(&p.name().to_string_lossy(), p.exe())
                } else if let Some(exe) = p.exe() {
                    let norm_exe = normalize_path_for_compare(exe);
                    if let Some(target) = &gog_executable {
                        norm_exe == normalize_path_for_compare(target)
                    } else {
                        norm_exe.starts_with(&norm_root)
                    }
                } else {
                    false
                };
                if hit && first_exe.is_none() {
                    first_exe = p.exe().map(|e| e.to_string_lossy().to_string());
                }
                hit.then(|| pid.as_u32())
            }),
            &preexisting,
        );

        match (started, pids.is_empty()) {
            (false, false) => {
                started = true;
                last_seen = game_sessions::now_unix();
                game_sessions::mark_running(&app_handle, &session_id, pids, first_exe, last_seen);
            }
            (false, true) => {
                waited += poll_every;
                if waited >= start_timeout {
                    game_sessions::cancel(&app_handle, &session_id);
                    return;
                }
            }
            (true, true) => {
                game_sessions::finish(&app_handle, &session_id, last_seen);
                return;
            }
            (true, false) => {
                last_seen = game_sessions::now_unix();
                game_sessions::set_pids(&app_handle, &session_id, pids);
            }
        }
    }
}
