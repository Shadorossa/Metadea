// Playtime sessions: watching for the game's process to appear and exit,
// and force-stopping it on request.

use std::path::PathBuf;
use crate::db::ToStringErr;

// Steam/GOG/Epic all intercept launch_game's URL scheme and start the actual
// game executable themselves — there's no child process handle to `.wait()`
// on. Instead this polls for any running process whose exe path lives under
// the game's own install folder, and reports the elapsed time once one
// showed up and then disappeared again. Fire-and-forget from the frontend's
// point of view: it returns immediately, and the result (if any) arrives
// later as a "game-session-ended" event.
#[derive(Clone, serde::Serialize)]
pub(super) struct SessionEndedPayload {
    pub(super) external_id: String,
    pub(super) hours: f64,
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
    let watch_target: Option<PathBuf> = if let (false, Some(platform_id)) = (is_direct_exe, rom_platform.as_ref()) {
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
