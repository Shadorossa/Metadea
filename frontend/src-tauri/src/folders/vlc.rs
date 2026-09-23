// VLC: locating the executable, spawning playback, and the loopback HTTP
// status/control interface the frontend polls.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use super::screenshots::{sanitize_capture_folder_name, watch_and_rename_vlc_screenshots};

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

pub(super) async fn read_vlc_screenshot_position(client: &reqwest::Client) -> Option<(String, u64)> {
    let url = format!("http://127.0.0.1:{VLC_HTTP_PORT}/requests/status.json");
    let response = client
        .get(url)
        .basic_auth("", Some(VLC_HTTP_PASSWORD))
        .timeout(std::time::Duration::from_millis(700))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let json: serde_json::Value = response.json().await.ok()?;
    let filename = json
        .get("information")
        .and_then(|info| info.get("category"))
        .and_then(|category| category.get("meta"))
        .and_then(|meta| meta.get("filename"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    let seconds = json
        .get("time")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default()
        .max(0) as u64;
    let position_millis = json
        .get("position")
        .and_then(serde_json::Value::as_f64)
        .zip(json.get("length").and_then(serde_json::Value::as_i64))
        .filter(|(position, length)| position.is_finite() && *length > 0)
        .map(|(position, length)| (position.clamp(0.0, 1.0) * length as f64 * 1_000.0).round() as u64)
        .unwrap_or(seconds.saturating_mul(1_000));
    Some((filename, position_millis))
}

// file_paths is played in order as one VLC playlist (a plain multi-argument
// launch queues them sequentially, no shuffle) — lets "Reproducir" queue
// every remaining episode in one go instead of relaunching per episode.
// start_seconds only ever applies to the first path (VLC's --start-time
// only affects whatever plays first when the process starts).
#[tauri::command]
pub async fn play_file_with_vlc(
    app_handle: tauri::AppHandle,
    file_paths: Vec<String>,
    start_seconds: Option<f64>,
    work_name: String,
    episode_labels: Vec<String>,
) -> Result<(), String> {
    if file_paths.is_empty() {
        return Err("No files to play".into());
    }

    use tauri::Manager;

    let capture_dir = app_handle
        .path()
        .picture_dir()
        .map_err(|e| format!("No se pudo localizar Imágenes: {e}"))?
        .join("Metadea")
        .join(sanitize_capture_folder_name(&work_name));
    std::fs::create_dir_all(&capture_dir)
        .map_err(|e| format!("No se pudo crear la carpeta de capturas: {e}"))?;

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
    // VLC creates each F12 image with this temporary prefix. A lightweight
    // watcher then replaces it with the work, current episode and VLC timecode.
    let capture_prefix = "Metadea-";
    cmd.arg(format!("--snapshot-path={}", capture_dir.display()))
        .arg(format!("--snapshot-prefix={capture_prefix}"))
        .arg("--snapshot-format=png")
        .arg("--key-snapshot=F12")
        // Prevent the large snapshot-path OSD notification from covering playback.
        .arg("--no-osd")
        // VLC's snapshot preview is a separate image overlay, independent of the OSD.
        .arg("--no-snapshot-preview");
    cmd.arg("--extraintf").arg("http")
        .arg("--http-host").arg("127.0.0.1")
        .arg("--http-port").arg(VLC_HTTP_PORT.to_string())
        .arg("--http-password").arg(VLC_HTTP_PASSWORD);
    let child = cmd.spawn()
        .map_err(|e| format!("Failed to launch VLC: {}", e))?;
    tokio::spawn(watch_and_rename_vlc_screenshots(
        child,
        app_handle.clone(),
        capture_dir,
        work_name,
        file_paths,
        episode_labels,
    ));
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
    let client = crate::http::http_client();
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
    let client = crate::http::http_client();
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
