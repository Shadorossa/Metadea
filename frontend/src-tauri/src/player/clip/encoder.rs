// Runs one clip export on its own headless libmpv handle in encoding mode
// (`o=<file>`): never the playback handle, so playback keeps its own
// decoder, clock and window. mpv encodes untimed from `start` to `end`;
// progress is read from the encoder's `time-pos`, and the output file is
// finalised when the handle is destroyed.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::super::libmpv_ffi::{LibMpv, MpvClient};
use super::super::mpv_api::{EndFileReason, MpvApi, MpvEvent};
use super::plan::{encoding_options, ClipJob};
use crate::error_codes;

use super::super::error::PlayerError;

/// A 10 s clip takes seconds; these only stop a wedged encoder: an overall
/// cap and a watchdog on the encoder's position not moving.
const ENCODE_TIMEOUT: Duration = Duration::from_secs(120);
const STALL_TIMEOUT: Duration = Duration::from_secs(20);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

pub enum EncodeOutcome {
    Done,
    Cancelled,
}

pub fn encode(lib: Arc<LibMpv>, job: &ClipJob, cancel: &AtomicBool, progress: &dyn Fn(f64)) -> Result<EncodeOutcome, PlayerError> {
    if let Some(parent) = job.output.parent() {
        std::fs::create_dir_all(parent).map_err(|error| PlayerError::coded(error_codes::CAPTURE_DIR_CREATE, error.to_string()))?;
    }
    #[allow(unused_mut)]
    let mut options = encoding_options(job);
    // Live tests can ask for mpv's own log of the encode.
    #[cfg(test)]
    if let Ok(log_file) = std::env::var("METADEA_CLIP_LOG") {
        options.push(("log-file".into(), log_file));
    }
    let client = match MpvClient::create_requiring(lib, &options, &["o"]) {
        Ok(client) => client,
        Err(error) if error.code == "unsupported" => {
            return Err(PlayerError::coded(error_codes::CLIP_ENCODING_UNSUPPORTED, error.detail));
        }
        Err(error) => return Err(PlayerError::coded(error_codes::CLIP_ENCODE_FAILED, error.to_string())),
    };
    client
        .command(&["loadfile", &job.source, "replace"])
        .map_err(|error| PlayerError::coded(error_codes::CLIP_ENCODE_FAILED, error.to_string()))?;

    let started = Instant::now();
    let mut last_progress = Instant::now();
    let mut last_position: Option<f64> = None;
    let mut last_advance = Instant::now();
    let span = (job.end - job.start).max(0.001);
    let mut ended: Option<EndFileReason> = None;
    let mut cancelled = false;
    while ended.is_none() {
        if cancel.load(Ordering::Relaxed) {
            let _ = client.command(&["stop"]);
            cancelled = true;
            break;
        }
        if started.elapsed() > ENCODE_TIMEOUT || last_advance.elapsed() > STALL_TIMEOUT {
            let _ = client.command(&["stop"]);
            drop(client);
            remove_partial(&job.output);
            return Err(PlayerError::coded(error_codes::CLIP_ENCODE_FAILED, "timed out"));
        }
        match client.wait_event(0.1) {
            MpvEvent::EndFile(reason) => ended = Some(reason),
            MpvEvent::Shutdown => ended = Some(EndFileReason::Unknown),
            _ => {}
        }
        if last_progress.elapsed() >= PROGRESS_INTERVAL {
            last_progress = Instant::now();
            if let Some(position) = client.get_property_f64("time-pos") {
                if last_position.map_or(true, |previous| position > previous + 0.01) {
                    last_position = Some(position);
                    last_advance = Instant::now();
                }
                progress(((position - job.start) / span).clamp(0.0, 1.0));
            }
        }
    }
    // Destroying the handle flushes the encoder and writes the trailer.
    drop(client);
    log::info!("clip export {:?} in {} ms", job.codec, started.elapsed().as_millis());

    if cancelled {
        remove_partial(&job.output);
        return Ok(EncodeOutcome::Cancelled);
    }
    let written = std::fs::metadata(&job.output).map(|metadata| metadata.len()).unwrap_or(0);
    match ended {
        Some(EndFileReason::Eof) | Some(EndFileReason::Stop) | Some(EndFileReason::Unknown) if written > 0 => {
            progress(1.0);
            Ok(EncodeOutcome::Done)
        }
        other => {
            remove_partial(&job.output);
            Err(PlayerError::coded(error_codes::CLIP_ENCODE_FAILED, format!("end {other:?}, {written} bytes")))
        }
    }
}

fn remove_partial(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Whether `path` has a video stream. mpv keeps encoding the audio when the
/// video encoder cannot start (no Media Foundation, say), so a finished
/// file alone does not prove the clip worked.
pub fn has_video(lib: Arc<LibMpv>, path: &Path) -> bool {
    let options: Vec<(String, String)> = [("vo", "null"), ("ao", "null"), ("pause", "yes"), ("config", "no"), ("terminal", "no")]
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect();
    let Ok(probe) = MpvClient::create(lib, &options) else { return false };
    if probe.command(&["loadfile", &path.to_string_lossy(), "replace"]).is_err() {
        return false;
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match probe.wait_event(0.1) {
            // The VO (and `dwidth`) is not configured yet at file-loaded;
            // the track list already says whether a video stream exists.
            MpvEvent::FileLoaded => {
                let tracks = probe.get_property_string("track-list").unwrap_or_default();
                return serde_json::from_str::<serde_json::Value>(&tracks)
                    .ok()
                    .and_then(|value| value.as_array().map(|items| items.iter().any(|item| item["type"] == "video" && item["albumart"] != true)))
                    .unwrap_or(false);
            }
            MpvEvent::EndFile(_) | MpvEvent::Shutdown => return false,
            _ => {}
        }
    }
    false
}

/// Live check with the bundled libmpv (Windows dev machines):
/// `METADEA_CLIP_TEST_FILE=C:\clip.mkv cargo test clip_encoder_live -- --ignored --nocapture`.
#[cfg(test)]
mod live {
    use super::super::plan::{clamp_range, subtitle_source, ClipCodec, ClipSize};
    use super::*;
    use std::path::PathBuf;

    fn run(file: &str, codec: ClipCodec, size: ClipSize, audio: Option<i64>, sub: bool) -> (PathBuf, u64, u128) {
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let lib = LibMpv::load(Some(&resources), None).expect("libmpv");
        // Subtitle track as the player would see it.
        let probe = MpvClient::create(lib.clone(), &[("vo".into(), "null".into()), ("ao".into(), "null".into()), ("pause".into(), "yes".into())]).unwrap();
        probe.command(&["loadfile", file, "replace"]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline && probe.wait_event(0.1) != MpvEvent::FileLoaded {}
        let tracks = probe.get_property_string("track-list").unwrap_or_default();
        let subtitle = if sub {
            subtitle_source(&tracks).or_else(|| {
                // Nothing selected by default: take the first sub track.
                let value: serde_json::Value = serde_json::from_str(&tracks).ok()?;
                let id = value.as_array()?.iter().find(|t| t["type"] == "sub")?["id"].as_i64()?;
                Some(super::super::plan::SubtitleSource { id, external_file: None })
            })
        } else {
            None
        };
        drop(probe);
        let out = std::env::temp_dir().join(format!("metadea-clip-live.{}", codec.extension()));
        let _ = std::fs::remove_file(&out);
        let (start, end) = clamp_range(300.0, 310.0, 1_000.0);
        let job = ClipJob {
            source: file.to_string(),
            output: out.clone(),
            start,
            end,
            codec,
            size,
            audio_id: audio,
            subtitle,
            sub_delay: 0.0,
        };
        let started = Instant::now();
        let cancel = AtomicBool::new(false);
        let result = encode(lib.clone(), &job, &cancel, &|fraction| print!("{:.0}% ", fraction * 100.0));
        println!();
        if let Err(error) = &result {
            println!("error: {error}");
        }
        assert!(matches!(result, Ok(EncodeOutcome::Done)));
        assert!(has_video(lib, &out), "no video stream in {}", out.display());
        let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
        (out, size, started.elapsed().as_millis())
    }

    /// Prints the encoders this libmpv build offers (`ovc=help`/`oac=help`)
    /// into METADEA_CLIP_LOG.
    #[test]
    #[ignore]
    fn clip_encoder_list() {
        let Ok(log_file) = std::env::var("METADEA_CLIP_LOG") else { return };
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let lib = LibMpv::load(Some(&resources), None).expect("libmpv");
        let out = std::env::temp_dir().join("metadea-clip-help.mp4");
        let options: Vec<(String, String)> = vec![
            ("log-file".into(), log_file),
            ("o".into(), out.to_string_lossy().into_owned()),
            ("ovc".into(), "help".into()),
            ("oac".into(), "help".into()),
            ("of".into(), "help".into()),
        ];
        let _ = MpvClient::create(lib, &options);
    }

    #[test]
    #[ignore]
    fn clip_encoder_live() {
        let Ok(file) = std::env::var("METADEA_CLIP_TEST_FILE") else { return };
        for (codec, size, audio, sub) in [
            (ClipCodec::H264Mp4, ClipSize::P480, Some(1), true),
            (ClipCodec::H264Mp4, ClipSize::P720, None, false),
            (ClipCodec::Vp9Webm, ClipSize::P480, Some(1), true),
            (ClipCodec::Gif, ClipSize::P480, None, true),
        ] {
            let (out, bytes, ms) = run(&file, codec, size, audio, sub);
            println!("{codec:?} {size:?} audio={audio:?} sub={sub}: {bytes} bytes in {ms} ms -> {}", out.display());
            assert!(bytes > 10_000 && bytes <= super::super::plan::TARGET_BYTES, "{bytes}");
            let keep = std::env::temp_dir().join(format!("metadea-clip-live-{codec:?}-{size:?}.{}", codec.extension()));
            let _ = std::fs::rename(&out, keep);
        }
    }
}
