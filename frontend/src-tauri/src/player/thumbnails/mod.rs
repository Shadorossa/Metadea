// Seek-bar hover thumbnails (the frame preview above the progress bar).
//
// - plan:   which frames, at what interval, where on the sprite sheet
// - cache:  $APPCACHE/thumbnails/<key>/ sheets + index.json, LRU-capped
// - frame:  raw mpv frame -> RGB tile -> JPEG / sprite sheet
// - worker: the headless libmpv thumbnailer thread (see its header for the
//           vo=null + screenshot-raw choice)
//
// Flow: the controls call `player_thumbnails_start(path)` when a file
// starts. A cached entry comes back at once (sheets via the asset
// protocol); otherwise one background job generates frames coarse-to-fine,
// emitting `player://thumbnail` per frame and `player://thumbnails-ready`
// with the sheets at the end. While it runs, `player_thumbnail_at` serves
// an on-demand frame for a hover spot nothing covers yet. Starting another
// file, `player_thumbnails_stop` or closing the player cancels the job.

mod cache;
mod frame;
mod plan;
mod worker;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::engine::PlayerEngineState;
use super::error::PlayerError;
use cache::ThumbnailManifest;
use worker::{spawn_job, JobSpec, ThumbnailFrameEvent, ThumbnailJob, ThumbnailSink, ThumbnailsReadyEvent};

pub const EVENT_THUMBNAIL: &str = "player://thumbnail";
pub const EVENT_THUMBNAILS_READY: &str = "player://thumbnails-ready";
const EXACT_TIMEOUT: Duration = Duration::from_secs(5);

/// The one thumbnail job of the process (at most one decode at a time).
#[derive(Default)]
pub struct ThumbnailState(Mutex<Option<ThumbnailJob>>);

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ThumbnailsStart {
    /// Streams, missing files, no libmpv: no previews for this file.
    Unavailable,
    Cached { key: String, manifest: ThumbnailManifest, sheets: Vec<String> },
    /// A job is (now) running; `frames` holds what it produced so far.
    Generating { key: String, frames: Vec<ThumbnailFrameEvent> },
}

struct TauriThumbnailSink {
    app: AppHandle,
}

impl ThumbnailSink for TauriThumbnailSink {
    fn frame(&self, frame: &ThumbnailFrameEvent) {
        let _ = self.app.emit(EVENT_THUMBNAIL, frame);
    }

    fn ready(&self, ready: &ThumbnailsReadyEvent) {
        let _ = self.app.emit(EVENT_THUMBNAILS_READY, ready);
    }
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, PlayerError> {
    Ok(app.path().app_cache_dir()?.join("thumbnails"))
}

fn local_path(path: &str) -> Option<PathBuf> {
    if !cache::is_local_path(path) {
        return None;
    }
    let trimmed = path.trim();
    let plain = match trimmed.get(..7).filter(|scheme| scheme.eq_ignore_ascii_case("file://")) {
        // file:///C:/x -> C:/x on Windows, file:///home/x -> /home/x elsewhere.
        Some(_) => {
            let rest = &trimmed[7..];
            let drive = rest.len() > 2 && rest.starts_with('/') && rest.as_bytes()[2] == b':';
            if drive { &rest[1..] } else { rest }
        }
        None => trimmed,
    };
    Some(PathBuf::from(plain))
}

fn cached(root: &Path, key: &str) -> Option<ThumbnailsStart> {
    let dir = cache::entry_dir(root, key);
    let manifest = cache::read_manifest(&dir)?;
    cache::touch(&dir);
    let sheets = manifest.sheets.iter().map(|sheet| dir.join(sheet).to_string_lossy().into_owned()).collect();
    Some(ThumbnailsStart::Cached { key: key.to_string(), manifest, sheets })
}

/// Cancels the running job, if any (player closed, file changed).
pub fn cancel_current(app: &AppHandle) {
    if let Some(state) = app.try_state::<ThumbnailState>() {
        if let Ok(mut slot) = state.0.lock() {
            if let Some(job) = slot.take() {
                job.cancel();
            }
        }
    }
}

/// Background startup pass over the cache: half-written entries out, LRU
/// cap enforced. Never blocks startup.
pub fn spawn_thumbnail_cache_cleanup(app: &AppHandle) {
    let Ok(root) = cache_root(app) else { return };
    let _ = std::thread::Builder::new().name("metadea-thumbnail-cleanup".into()).spawn(move || {
        let removed = cache::startup_cleanup(&root, cache::CACHE_CAP_BYTES);
        if removed > 0 {
            log::info!("seek-bar thumbnail cache: removed {removed} entr(y/ies)");
        }
    });
}

#[tauri::command]
pub fn player_thumbnails_start(
    app: AppHandle,
    engine: State<'_, PlayerEngineState>,
    thumbnails: State<'_, ThumbnailState>,
    path: String,
) -> Result<ThumbnailsStart, PlayerError> {
    let Some(local) = local_path(&path) else {
        return Ok(ThumbnailsStart::Unavailable);
    };
    let Some(key) = cache::cache_key_for_file(&local) else {
        return Ok(ThumbnailsStart::Unavailable);
    };
    let root = cache_root(&app)?;
    let mut slot = thumbnails.0.lock().map_err(|_| PlayerError::mpv("thumbnail lock poisoned"))?;
    if let Some(hit) = cached(&root, &key) {
        return Ok(hit);
    }
    if let Some(job) = slot.as_ref() {
        if job.key == key {
            // Same file: hand over what exists; a finished job without a
            // cache entry failed and is not retried for this file.
            return Ok(if job.is_finished() {
                ThumbnailsStart::Unavailable
            } else {
                ThumbnailsStart::Generating { key, frames: job.frames() }
            });
        }
    }
    if let Some(previous) = slot.take() {
        previous.cancel();
    }
    let lib = {
        let engine = engine.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
        engine.loaded_library()
    };
    let Some(lib) = lib else {
        return Ok(ThumbnailsStart::Unavailable);
    };
    let spec = JobSpec { lib, path: local.to_string_lossy().into_owned(), key: key.clone(), cache_root: root };
    let job = spawn_job(spec, Box::new(TauriThumbnailSink { app: app.clone() }))?;
    *slot = Some(job);
    Ok(ThumbnailsStart::Generating { key, frames: Vec::new() })
}

/// An on-demand frame (JPEG data URL) at `seconds` from the running job
/// for `key`; `None` when no job for that file is running any more.
#[tauri::command]
pub async fn player_thumbnail_at(thumbnails: State<'_, ThumbnailState>, key: String, seconds: f64) -> Result<Option<String>, PlayerError> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(PlayerError::invalid_argument("seconds must be a non-negative number"));
    }
    let receiver = {
        let slot = thumbnails.0.lock().map_err(|_| PlayerError::mpv("thumbnail lock poisoned"))?;
        match slot.as_ref().filter(|job| job.key == key) {
            Some(job) => job.request_exact(seconds),
            None => None,
        }
    };
    let Some(receiver) = receiver else {
        return Ok(None);
    };
    let frame = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(EXACT_TIMEOUT).ok().flatten())
        .await
        .map_err(|error| PlayerError::io(error.to_string()))?;
    Ok(frame)
}

#[tauri::command]
pub fn player_thumbnails_stop(app: AppHandle) -> Result<(), PlayerError> {
    cancel_current(&app);
    Ok(())
}
