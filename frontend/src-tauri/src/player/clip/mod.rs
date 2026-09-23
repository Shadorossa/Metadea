// Instant clip/GIF export from the built-in player (the scissors button).
//
// - plan:      3–10 s clamping, ≤ 10 MB bitrate, file name, mpv encoding options
// - encoder:   the headless libmpv handle in encoding mode (`o=<file>`)
// - clipboard: CF_HDROP so Ctrl+V in Discord/Telegram attaches the file
//
// Output: $PICTURES/Metadea/Clips/<Series> - E<ep> - <mm-ss>.mp4|gif, next
// to the F12 captures' $PICTURES/Metadea/<work>/ folders. One export at a
// time; `player://clip-progress` reports it and `player_clip_cancel` stops
// it. Errors are `E_CLIP_*` codes (error_codes.rs) the controls translate.

mod clipboard;
mod encoder;
mod plan;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use super::engine::PlayerEngineState;
use super::error::PlayerError;
use crate::error_codes;
use encoder::{encode, EncodeOutcome};
use plan::{available_path, clamp_range, clip_file_name, episode_part, subtitle_source, ClipCodec, ClipFormat, ClipJob, ClipSize};

pub const EVENT_CLIP_PROGRESS: &str = "player://clip-progress";

/// The running export's cancel flag; `Some` while one runs.
#[derive(Default)]
pub struct ClipState(Mutex<Option<Arc<AtomicBool>>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRequest {
    pub start_secs: f64,
    pub end_secs: f64,
    pub format: ClipFormat,
    pub size: ClipSize,
    pub include_audio: bool,
    pub burn_subtitles: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipResult {
    pub path: String,
    pub bytes: u64,
    /// Whether the file made it onto the clipboard (CF_HDROP).
    pub copied: bool,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    fraction: f64,
}

fn clips_dir(app: &AppHandle) -> Result<PathBuf, PlayerError> {
    let pictures = app.path().picture_dir().map_err(|error| PlayerError::coded(error_codes::PICTURES_DIR_LOCATE, error.to_string()))?;
    Ok(pictures.join("Metadea").join("Clips"))
}

/// Clears the running flag when the export ends, however it ends.
struct Running<'a>(&'a ClipState);

impl Drop for Running<'_> {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.0 .0.lock() {
            *slot = None;
        }
    }
}

#[tauri::command]
pub async fn player_clip_export(
    app: AppHandle,
    engine: State<'_, PlayerEngineState>,
    clips: State<'_, ClipState>,
    request: ClipRequest,
) -> Result<ClipResult, PlayerError> {
    let (lib, source) = {
        let engine = engine.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
        (engine.loaded_library(), engine.clip_source())
    };
    let (Some(lib), Some(source)) = (lib, source) else {
        return Err(PlayerError::coded(error_codes::CLIP_NO_SOURCE, "nothing is playing"));
    };
    if !Path::new(&source.path).is_file() {
        return Err(PlayerError::coded(error_codes::CLIP_NO_SOURCE, "not a local file"));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = clips.0.lock().map_err(|_| PlayerError::mpv("clip lock poisoned"))?;
        if slot.is_some() {
            return Err(PlayerError::coded(error_codes::CLIP_BUSY, ""));
        }
        *slot = Some(cancel.clone());
    }
    let _running = Running(&clips);

    let (start, end) = clamp_range(request.start_secs, request.end_secs, source.duration);
    let episode = episode_part(source.episode_number, &source.episode_label);
    let directory = clips_dir(&app)?;
    std::fs::create_dir_all(&directory).map_err(|error| PlayerError::coded(error_codes::CAPTURE_DIR_CREATE, error.to_string()))?;
    let with_audio = request.format == ClipFormat::Mp4 && request.include_audio;
    let base = ClipJob {
        source: source.path.clone(),
        output: PathBuf::new(),
        start,
        end,
        codec: ClipCodec::attempts(request.format)[0],
        size: request.size,
        audio_id: if with_audio { source.audio_id } else { None },
        subtitle: if request.burn_subtitles { subtitle_source(&source.track_list) } else { None },
        sub_delay: source.sub_delay,
    };
    let work_name = source.work_name.clone();
    let emitter = app.clone();
    let output = tauri::async_runtime::spawn_blocking(move || -> Result<Option<PathBuf>, PlayerError> {
        // H.264/MP4 first, then the VP9/WebM fallback (see ClipCodec).
        let mut last_error = None;
        for &codec in ClipCodec::attempts(request.format) {
            let output = available_path(&directory, &clip_file_name(&work_name, &episode, start, codec));
            let job = ClipJob { output: output.clone(), codec, ..base.clone() };
            let outcome = encode(lib.clone(), &job, &cancel, &|fraction| {
                let _ = emitter.emit(EVENT_CLIP_PROGRESS, ProgressPayload { fraction });
            });
            match outcome {
                Ok(EncodeOutcome::Cancelled) => return Ok(None),
                Ok(EncodeOutcome::Done) if encoder::has_video(lib.clone(), &output) => return Ok(Some(output)),
                Ok(EncodeOutcome::Done) => {
                    log::info!("clip encoder {codec:?} produced no video, trying the next one");
                    let _ = std::fs::remove_file(&output);
                }
                Err(error) if error.code == error_codes::CLIP_ENCODE_FAILED => last_error = Some(error),
                Err(error) => return Err(error),
            }
        }
        Err(last_error.unwrap_or_else(|| PlayerError::coded(error_codes::CLIP_ENCODING_UNSUPPORTED, "no working video encoder")))
    })
    .await
    .map_err(|error| PlayerError::coded(error_codes::CLIP_ENCODE_FAILED, error.to_string()))??;
    let Some(output) = output else {
        return Err(PlayerError::coded(error_codes::CLIP_CANCELLED, ""));
    };

    let path = output.to_string_lossy().into_owned();
    let copied = match clipboard::copy_files_to_clipboard(&[&path]) {
        Ok(()) => true,
        Err(error) => {
            log::warn!("clip saved but not copied to the clipboard: {error}");
            false
        }
    };
    let bytes = std::fs::metadata(&output).map(|metadata| metadata.len()).unwrap_or(0);
    Ok(ClipResult { path, bytes, copied })
}

#[tauri::command]
pub fn player_clip_cancel(clips: State<'_, ClipState>) -> Result<(), PlayerError> {
    if let Some(cancel) = clips.0.lock().map_err(|_| PlayerError::mpv("clip lock poisoned"))?.as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Clip-mode preview: loop the selection (`None` = stop looping).
#[tauri::command]
pub fn player_set_ab_loop(engine: State<'_, PlayerEngineState>, start_secs: Option<f64>, end_secs: Option<f64>) -> Result<(), PlayerError> {
    let engine = engine.0.lock().map_err(|_| PlayerError::mpv("engine lock poisoned"))?;
    engine.set_ab_loop(start_secs.zip(end_secs))
}

/// Only files inside the Clips folder can be revealed from the toast.
fn clip_inside(directory: &Path, path: &Path) -> bool {
    match (directory.canonicalize(), path.canonicalize()) {
        (Ok(directory), Ok(path)) => path.starts_with(directory) && path.is_file(),
        _ => false,
    }
}

#[tauri::command]
pub fn player_clip_reveal(app: AppHandle, path: String) -> Result<(), PlayerError> {
    let directory = clips_dir(&app)?;
    let path = PathBuf::from(path);
    if !clip_inside(&directory, &path) {
        return Err(PlayerError::coded(error_codes::CLIP_PATH_INVALID, ""));
    }
    app.opener().reveal_item_in_dir(&path).map_err(|error| PlayerError::coded(error_codes::CLIP_PATH_INVALID, error.to_string()))
}

#[tauri::command]
pub fn player_clip_open_folder(app: AppHandle) -> Result<(), PlayerError> {
    let directory = clips_dir(&app)?;
    std::fs::create_dir_all(&directory).map_err(|error| PlayerError::coded(error_codes::CAPTURE_DIR_CREATE, error.to_string()))?;
    app.opener()
        .open_path(directory.to_string_lossy(), None::<&str>)
        .map_err(|error| PlayerError::coded(error_codes::CLIP_PATH_INVALID, error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_files_inside_the_clips_folder_can_be_revealed() {
        let root = std::env::temp_dir().join(format!("metadea-clip-reveal-{}", std::process::id()));
        let clips = root.join("Clips");
        std::fs::create_dir_all(&clips).unwrap();
        std::fs::write(clips.join("a.mp4"), b"x").unwrap();
        std::fs::write(root.join("b.mp4"), b"x").unwrap();
        assert!(clip_inside(&clips, &clips.join("a.mp4")));
        assert!(!clip_inside(&clips, &root.join("b.mp4")));
        assert!(!clip_inside(&clips, &clips.join("..").join("b.mp4")));
        assert!(!clip_inside(&clips, &clips.join("missing.mp4")));
        let _ = std::fs::remove_dir_all(&root);
    }
}
