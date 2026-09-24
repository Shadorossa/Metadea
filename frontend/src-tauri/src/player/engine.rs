// The player engine: owns the libmpv client, the session (queue + capture
// folder), the native video surface and the playback commands. The event
// thread that feeds `PlayerStatus` to the frontend lives in event_loop.rs;
// the engine only spawns it and shares the status slot with it.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde::Serialize;

use super::error::PlayerError;
use super::event_loop::{run_event_thread, StatusSink};
use super::libmpv_ffi::{LibMpv, MpvClient};
use super::mpv_api::MpvApi;
use super::night_mode::{apply_night_mode, NightModeLevel};
use super::screenshot_names::{available_screenshot_path, episode_label_for_index, screenshot_file_name, screenshot_timecode};
use super::status::{PlayerStatus, StatusTracker, MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED, OBSERVED_PROPERTIES};
use super::video_host::VideoHost;

#[derive(Debug, Clone, Serialize)]
pub struct PlayerSessionInfo {
    pub work_name: String,
    pub queue: Vec<String>,
    pub episode_labels: Vec<String>,
    pub titles: Vec<String>,
    /// Catalog id of the work (`anime:<anilistId>`) and the episode number
    /// of each queue entry, so the controls (a separate window in overlay
    /// mode) can look up skip segments for what is playing.
    pub external_id: Option<String>,
    pub episode_numbers: Vec<i64>,
    /// Queue episodes that are filler, sent only when the library entry is
    /// set to "Filler: Skipped" (lib/anime/filler.ts) — the controls offer
    /// "Next canon episode" instead of rolling into them.
    pub filler_episodes: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScreenshotSaved {
    pub work_name: String,
    pub episode_label: String,
    pub timecode: String,
    pub path: String,
}

pub struct OpenRequest {
    pub queue: Vec<String>,
    pub start_index: usize,
    pub start_seconds: Option<f64>,
    pub work_name: String,
    pub episode_labels: Vec<String>,
    pub titles: Vec<String>,
    pub external_id: Option<String>,
    pub episode_numbers: Vec<i64>,
    pub filler_episodes: Vec<i64>,
    pub capture_dir: PathBuf,
}

/// The mpv options applied before `mpv_initialize`. `wid` is appended by
/// the caller when a native surface exists.
pub fn engine_options() -> Vec<(String, String)> {
    [
        ("vo", "gpu-next,gpu"),
        ("hwdec", "auto-safe"),
        ("osc", "no"),
        ("osd-level", "0"),
        ("input-default-bindings", "no"),
        ("input-vo-keyboard", "no"),
        ("input-cursor", "no"),
        ("keep-open", "yes"),
        ("sub-auto", "fuzzy"),
        ("audio-file-auto", "fuzzy"),
        ("screenshot-format", "png"),
        ("ytdl", "no"),
        ("config", "no"),
        ("terminal", "no"),
        ("idle", "yes"),
    ]
    .iter()
    .map(|(name, value)| (name.to_string(), value.to_string()))
    .collect()
}

#[derive(Debug, Clone)]
pub struct ClipSource {
    pub path: String,
    pub duration: f64,
    pub audio_id: Option<i64>,
    pub track_list: String,
    pub sub_delay: f64,
    pub work_name: String,
    pub episode_label: String,
    pub episode_number: Option<f64>,
}

#[derive(Default)]
pub struct PlayerEngine {
    lib: Option<Arc<LibMpv>>,
    client: Option<Arc<dyn MpvApi>>,
    session: Option<PlayerSessionInfo>,
    capture_dir: Option<PathBuf>,
    status: Arc<Mutex<PlayerStatus>>,
    thread: Option<JoinHandle<()>>,
    /// Start offset (seconds) for the next file load; the event thread
    /// consumes it after `file-loaded` and seeks if mpv ignored `start`.
    pending_start: Arc<Mutex<Option<f64>>>,
    pub video_host: Option<VideoHost>,
    /// Physical-pixel rectangle (inside the main window's client area) the
    /// player modal last reported for the video; `None` until it mounts.
    pub video_rect: Option<(i32, i32, i32, i32)>,
    /// The main-window event hook is installed once per process.
    pub main_hooks_installed: bool,
    /// Last night-mode level applied to this client (night_mode.rs).
    night_mode: Mutex<NightModeLevel>,
}

#[derive(Default)]
pub struct PlayerEngineState(pub Mutex<PlayerEngine>);

impl PlayerEngine {
    pub fn is_open(&self) -> bool {
        self.client.is_some()
    }

    pub fn session(&self) -> Option<&PlayerSessionInfo> {
        self.session.as_ref()
    }

    pub fn status(&self) -> PlayerStatus {
        self.status.lock().map(|status| status.clone()).unwrap_or_default()
    }

    /// Pulls the live values straight from mpv into the shared snapshot —
    /// for a page that opens after the last event went out (a freshly
    /// created overlay, an F5) and cannot wait for the next tick.
    pub fn refresh_status(&self) -> PlayerStatus {
        let Some(client) = self.client.as_ref() else {
            return self.status();
        };
        let mut tracker = StatusTracker::default();
        let mut apply = |name: &str, value: super::mpv_api::PropertyValue| {
            tracker.apply(name, &value);
        };
        use super::mpv_api::PropertyValue;
        if let Some(path) = client.get_property_string("path") {
            apply("path", PropertyValue::Str(path));
        }
        for name in ["time-pos", "duration", "volume", "speed", "sub-delay"] {
            if let Some(value) = client.get_property_f64(name) {
                apply(name, PropertyValue::Double(value));
            }
        }
        for name in ["pause", "mute", "eof-reached"] {
            if let Some(value) = client.get_property_flag(name) {
                apply(name, PropertyValue::Flag(value));
            }
        }
        for name in ["playlist-pos", "playlist-count"] {
            if let Some(value) = client.get_property_i64(name) {
                apply(name, PropertyValue::Int(value));
            }
        }
        if let Some(track_list) = client.get_property_string("track-list") {
            apply("track-list", PropertyValue::Str(track_list));
        }
        if let Some(chapter_list) = client.get_property_string("chapter-list") {
            apply("chapter-list", PropertyValue::Str(chapter_list));
        }
        let mut refreshed = tracker.status;
        if refreshed.path.is_none() {
            // A fake/unavailable read must not wipe what the event thread
            // already knows.
            return self.status();
        }
        if let Ok(mut shared) = self.status.lock() {
            if refreshed.tracks.is_empty() {
                refreshed.tracks = shared.tracks.clone();
            }
            *shared = refreshed.clone();
        }
        refreshed
    }

    /// The library if a previous call already loaded it (the seek-bar
    /// thumbnailer opens its own handle on it).
    pub fn loaded_library(&self) -> Option<Arc<LibMpv>> {
        self.lib.clone()
    }

    /// Loads (and caches) libmpv without creating a client.
    pub fn ensure_library(&mut self, resource_dir: Option<PathBuf>, exe_dir: Option<PathBuf>) -> Result<Arc<LibMpv>, PlayerError> {
        if let Some(lib) = &self.lib {
            return Ok(lib.clone());
        }
        let lib = LibMpv::load(resource_dir.as_deref(), exe_dir.as_deref())?;
        self.lib = Some(lib.clone());
        Ok(lib)
    }

    /// Creates the real client with the standard options (+ `wid`) and
    /// attaches it.
    pub fn start_client(&mut self, lib: Arc<LibMpv>, wid: Option<i64>, sink: Box<dyn StatusSink>) -> Result<(), PlayerError> {
        let mut options = engine_options();
        if let Some(wid) = wid {
            options.push(("wid".into(), wid.to_string()));
        }
        let client = MpvClient::create(lib, &options)?;
        self.attach(Arc::new(client), sink)
    }

    /// Wires any `MpvApi` (real or fake) as the active client and spawns
    /// the event thread for it.
    pub fn attach(&mut self, client: Arc<dyn MpvApi>, sink: Box<dyn StatusSink>) -> Result<(), PlayerError> {
        for (index, (name, format)) in OBSERVED_PROPERTIES.iter().enumerate() {
            client.observe_property(index as u64 + 1, name, *format)?;
        }
        let shared = self.status.clone();
        let pending_start = self.pending_start.clone();
        let thread_client = client.clone();
        let thread = std::thread::Builder::new()
            .name("metadea-player-events".into())
            .spawn(move || run_event_thread(thread_client, shared, sink, pending_start))
            .map_err(|error| PlayerError::io(error.to_string()))?;
        self.client = Some(client);
        self.thread = Some(thread);
        Ok(())
    }

    fn client(&self) -> Result<&Arc<dyn MpvApi>, PlayerError> {
        self.client.as_ref().ok_or_else(PlayerError::not_open)
    }

    pub fn open(&mut self, request: OpenRequest) -> Result<PlayerSessionInfo, PlayerError> {
        if request.queue.is_empty() {
            return Err(PlayerError::invalid_argument("empty queue"));
        }
        let start_index = request.start_index.min(request.queue.len() - 1);
        let client = self.client()?.clone();
        client.command(&["playlist-clear"])?;
        client.command(&["stop"])?;
        match request.start_seconds.filter(|secs| *secs > 1.0) {
            Some(secs) => {
                client.set_property("start", &format!("{secs:.3}"))?;
                if let Ok(mut pending) = self.pending_start.lock() {
                    *pending = Some(secs);
                }
            }
            None => {
                client.set_property("start", "none")?;
                if let Ok(mut pending) = self.pending_start.lock() {
                    *pending = None;
                }
            }
        }
        for (index, path) in request.queue.iter().enumerate() {
            let flag = if index == 0 { "replace" } else { "append" };
            client.command(&["loadfile", path, flag])?;
        }
        if start_index > 0 {
            client.command(&["playlist-play-index", &start_index.to_string()])?;
        }
        client.set_property("pause", "no")?;
        let session = PlayerSessionInfo {
            work_name: request.work_name,
            queue: request.queue,
            episode_labels: request.episode_labels,
            titles: request.titles,
            external_id: request.external_id,
            episode_numbers: request.episode_numbers,
            filler_episodes: request.filler_episodes,
        };
        self.session = Some(session.clone());
        self.capture_dir = Some(request.capture_dir);
        Ok(session)
    }

    pub fn toggle_pause(&self) -> Result<(), PlayerError> {
        self.client()?.command(&["cycle", "pause"])
    }

    pub fn set_pause(&self, paused: bool) -> Result<(), PlayerError> {
        self.client()?.set_property("pause", if paused { "yes" } else { "no" })
    }

    pub fn seek(&self, seconds: f64, relative: bool) -> Result<(), PlayerError> {
        let mode = if relative { "relative" } else { "absolute" };
        self.client()?.command(&["seek", &format!("{seconds:.3}"), mode])
    }

    pub fn next(&self) -> Result<(), PlayerError> {
        self.client()?.command(&["playlist-next", "weak"])
    }

    pub fn prev(&self) -> Result<(), PlayerError> {
        self.client()?.command(&["playlist-prev", "weak"])
    }

    pub fn play_index(&self, index: usize) -> Result<(), PlayerError> {
        self.client()?.command(&["playlist-play-index", &index.to_string()])
    }

    pub fn set_track(&self, kind: &str, id: Option<i64>) -> Result<(), PlayerError> {
        let property = match kind {
            "audio" => "aid",
            "sub" => "sid",
            _ => return Err(PlayerError::invalid_argument(format!("unknown track kind {kind}"))),
        };
        let value = id.map_or_else(|| "no".to_string(), |id| id.to_string());
        self.client()?.set_property(property, &value)
    }

    pub fn set_volume(&self, volume: f64) -> Result<(), PlayerError> {
        self.client()?.set_property("volume", &format!("{:.0}", volume.clamp(0.0, 130.0)))
    }

    pub fn set_mute(&self, muted: bool) -> Result<(), PlayerError> {
        self.client()?.set_property("mute", if muted { "yes" } else { "no" })
    }

    /// Slower is allowed, faster than 1× never is.
    pub fn set_speed(&self, speed: f64) -> Result<(), PlayerError> {
        self.client()?.set_property("speed", &format!("{:.3}", speed.clamp(MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED)))
    }

    /// Night mode / clear dialogue on or off, live (night_mode.rs); returns
    /// the level that ended up active.
    pub fn set_night_mode(&self, enabled: bool) -> Result<NightModeLevel, PlayerError> {
        let client = self.client()?;
        let mut current = self.night_mode.lock().map_err(|_| PlayerError::mpv("night mode lock poisoned"))?;
        *current = apply_night_mode(client.as_ref(), enabled, *current);
        Ok(*current)
    }

    pub fn set_sub_delay(&self, seconds: f64) -> Result<(), PlayerError> {
        self.client()?.set_property("sub-delay", &format!("{seconds:.3}"))
    }

    /// One frame back or forward; mpv pauses playback as a side effect.
    pub fn frame_step(&self, direction: &str) -> Result<(), PlayerError> {
        let command = match direction {
            "back" => "frame-back-step",
            "forward" => "frame-step",
            _ => return Err(PlayerError::invalid_argument(format!("unknown frame step direction {direction}"))),
        };
        self.client()?.command(&[command])
    }

    /// Next subtitle/audio track, wrapping through "off" (mpv `cycle sub|audio`).
    pub fn cycle_track(&self, kind: &str) -> Result<(), PlayerError> {
        let property = match kind {
            "audio" => "audio",
            "sub" => "sub",
            _ => return Err(PlayerError::invalid_argument(format!("unknown track kind {kind}"))),
        };
        self.client()?.command(&["cycle", property])
    }

    /// Where the next F12 capture goes and what it is called, from the
    /// current status — separated from the mpv call so it is testable.
    pub fn next_screenshot(&self) -> Result<(PathBuf, ScreenshotSaved), PlayerError> {
        let session = self.session.as_ref().ok_or_else(PlayerError::not_open)?;
        let capture_dir = self.capture_dir.as_ref().ok_or_else(PlayerError::not_open)?;
        let status = self.status();
        let index = usize::try_from(status.playlist_index).unwrap_or(0);
        let episode_label = episode_label_for_index(&session.episode_labels, index);
        let millis = (status.position_secs.max(0.0) * 1_000.0).round() as u64;
        let filename = screenshot_file_name(&session.work_name, &episode_label, millis);
        let path = available_screenshot_path(capture_dir, &filename);
        let saved = ScreenshotSaved {
            work_name: session.work_name.clone(),
            episode_label,
            timecode: screenshot_timecode(millis),
            path: path.to_string_lossy().into_owned(),
        };
        Ok((path, saved))
    }

    pub fn screenshot(&self) -> Result<ScreenshotSaved, PlayerError> {
        let (path, saved) = self.next_screenshot()?;
        std::fs::create_dir_all(path.parent().unwrap_or(path.as_path()))?;
        let path_text = path.to_string_lossy();
        self.client()?.command(&["screenshot-to-file", &path_text, "subtitles"])?;
        Ok(saved)
    }

    /// The work and episode number of the queue entry at `playlist_index`
    /// — what a "continue watching" frame is filed under.
    pub fn episode_at(&self, playlist_index: i64) -> Option<(String, f64)> {
        let session = self.session.as_ref()?;
        let external_id = session.external_id.clone()?;
        let index = usize::try_from(playlist_index).ok()?;
        let episode = *session.episode_numbers.get(index)?;
        Some((external_id, episode as f64))
    }

    /// One video-only frame (no subtitles/OSD) of the current position into
    /// `path`; mpv picks the format from the extension.
    pub fn capture_frame(&self, path: &std::path::Path) -> Result<(), PlayerError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let path_text = path.to_string_lossy();
        self.client()?.command(&["screenshot-to-file", &path_text, "video"])
    }

    /// What a clip export needs from the playing file, read live from mpv:
    /// source path, duration, current audio id, the raw track list (the
    /// selected subtitle is resolved by clip::plan) and subtitle delay, plus
    /// the work/episode naming the output file.
    pub fn clip_source(&self) -> Option<ClipSource> {
        let client = self.client.as_ref()?;
        let session = self.session.as_ref()?;
        let path = client.get_property_string("path")?;
        let index = client.get_property_i64("playlist-pos").and_then(|pos| usize::try_from(pos).ok()).unwrap_or(0);
        Some(ClipSource {
            path,
            duration: client.get_property_f64("duration").unwrap_or(0.0),
            audio_id: client.get_property_i64("aid"),
            track_list: client.get_property_string("track-list").unwrap_or_default(),
            sub_delay: client.get_property_f64("sub-delay").unwrap_or(0.0),
            work_name: session.work_name.clone(),
            episode_label: episode_label_for_index(&session.episode_labels, index),
            episode_number: session.episode_numbers.get(index).map(|number| *number as f64),
        })
    }

    /// Loops `a`..`b` (clip-mode preview); `None` clears the loop.
    pub fn set_ab_loop(&self, range: Option<(f64, f64)>) -> Result<(), PlayerError> {
        let client = self.client()?;
        match range {
            Some((a, b)) => {
                client.set_property("ab-loop-a", &format!("{a:.3}"))?;
                client.set_property("ab-loop-b", &format!("{b:.3}"))
            }
            None => {
                client.set_property("ab-loop-a", "no")?;
                client.set_property("ab-loop-b", "no")
            }
        }
    }

    /// Quits mpv, waits for the event thread and releases the client. The
    /// library itself stays loaded for the next session.
    pub fn close(&mut self) {
        if let Some(client) = self.client.take() {
            let _ = client.command(&["quit"]);
            client.wakeup();
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        self.session = None;
        self.capture_dir = None;
        self.video_rect = None;
        if let Ok(mut night_mode) = self.night_mode.lock() {
            *night_mode = NightModeLevel::Off;
        }
        if let Ok(mut status) = self.status.lock() {
            *status = PlayerStatus::default();
        }
    }
}
