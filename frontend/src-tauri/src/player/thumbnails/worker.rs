// The thumbnailer thread: a second, headless libmpv handle — same loaded
// library, never the playback handle — that seeks through the file and
// grabs one small frame per sprite slot.
//
// Why `vo=null` + `screenshot-raw video` rather than `vo=image`:
// `vo=image` writes every displayed frame to disk under its own file
// names, which suits a linear dump, not random-access seeks, and still
// needs a file round-trip. mpv keeps the last frame handed to the VO in
// the VO core (vo.c `current_frame`), independent of the driver, so
// `screenshot-raw video` works with the null VO and returns the pixels
// (bgr0) in a node map — no encode/decode, no temp files. A paused handle
// still pushes the first frame after every seek to the VO, and
// `playback-restart` marks the moment it is there.
//
// Cost control: keyframe seeks (`hr-seek=no`, `+keyframes`), software
// decoding with the loop filter skipped and 2 decoder threads, no audio or
// subtitles, a tiny demuxer cache, lavfi downscaling to the tile width
// before the frame reaches the VO, one decode at a time, a short breather
// between frames and one job per process. The playback handle is never
// touched, so playback cannot block on this thread.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use image::RgbImage;
use serde::Serialize;

use super::super::libmpv_ffi::{LibMpv, MpvClient};
use super::super::mpv_api::{MpvApi, MpvEvent};
use super::cache::{self, ThumbnailManifest};
use super::frame::{compose_sheets, frame_to_tile, tile_data_url};
use super::plan::{capture_time, frame_count, generation_order, interval_for, tile_height, TILE_WIDTH};

const LOAD_TIMEOUT: Duration = Duration::from_secs(15);
const SEEK_TIMEOUT: Duration = Duration::from_secs(4);
/// Pause between two background frames: keeps the thumbnailer well below
/// one core and gives on-demand requests a slot.
const BREATHER: Duration = Duration::from_millis(25);
const EVENT_POLL_SECS: f64 = 0.05;

pub fn thumbnailer_options() -> Vec<(String, String)> {
    let scale = format!("lavfi=[scale=w={TILE_WIDTH}:h=-2:flags=fast_bilinear]");
    [
        ("vo", "null"),
        ("ao", "null"),
        ("aid", "no"),
        ("sid", "no"),
        ("pause", "yes"),
        ("keep-open", "yes"),
        ("idle", "yes"),
        ("hr-seek", "no"),
        ("hwdec", "no"),
        ("vd-lavc-threads", "2"),
        ("vd-lavc-skiploopfilter", "all"),
        ("vd-lavc-fast", "yes"),
        ("framedrop", "no"),
        ("cache", "no"),
        ("demuxer-max-bytes", "4MiB"),
        ("demuxer-max-back-bytes", "0"),
        ("demuxer-readahead-secs", "0"),
        ("sub-auto", "no"),
        ("audio-file-auto", "no"),
        ("cover-art-auto", "no"),
        ("osc", "no"),
        ("osd-level", "0"),
        ("input-default-bindings", "no"),
        ("input-vo-keyboard", "no"),
        ("load-scripts", "no"),
        ("load-stats-overlay", "no"),
        ("ytdl", "no"),
        ("config", "no"),
        ("terminal", "no"),
    ]
    .iter()
    .map(|(name, value)| (name.to_string(), value.to_string()))
    .chain(std::iter::once(("vf".to_string(), scale)))
    .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailFrameEvent {
    pub key: String,
    pub index: u32,
    pub count: u32,
    pub interval_secs: f64,
    pub tile_width: u32,
    pub tile_height: u32,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailsReadyEvent {
    pub key: String,
    pub manifest: ThumbnailManifest,
    /// Absolute paths of the sheets, in manifest order.
    pub sheets: Vec<String>,
}

pub trait ThumbnailSink: Send + 'static {
    fn frame(&self, frame: &ThumbnailFrameEvent);
    fn ready(&self, ready: &ThumbnailsReadyEvent);
}

/// State shared between the job thread and the commands.
#[derive(Default)]
pub struct JobShared {
    cancel: AtomicBool,
    finished: AtomicBool,
    /// Every frame produced so far, so a controls window that mounts late
    /// (overlay recreated, F5) starts with them instead of a blank bar.
    frames: Mutex<Vec<ThumbnailFrameEvent>>,
}

struct ExactRequest {
    secs: f64,
    reply: SyncSender<Option<String>>,
}

pub struct ThumbnailJob {
    pub key: String,
    shared: Arc<JobShared>,
    requests: Sender<ExactRequest>,
}

impl ThumbnailJob {
    pub fn cancel(&self) {
        self.shared.cancel.store(true, Ordering::Relaxed);
    }

    pub fn is_finished(&self) -> bool {
        self.shared.finished.load(Ordering::Relaxed)
    }

    pub fn frames(&self) -> Vec<ThumbnailFrameEvent> {
        self.shared.frames.lock().map(|frames| frames.clone()).unwrap_or_default()
    }

    /// Queues an on-demand frame at `secs`; the receiver yields a data URL
    /// (or `None` when the job ends first).
    pub fn request_exact(&self, secs: f64) -> Option<Receiver<Option<String>>> {
        if self.is_finished() {
            return None;
        }
        let (reply, receiver) = mpsc::sync_channel(1);
        self.requests.send(ExactRequest { secs, reply }).ok()?;
        Some(receiver)
    }
}

pub struct JobSpec {
    pub lib: Arc<LibMpv>,
    pub path: String,
    pub key: String,
    pub cache_root: PathBuf,
}

pub fn spawn_job(spec: JobSpec, sink: Box<dyn ThumbnailSink>) -> std::io::Result<ThumbnailJob> {
    let shared = Arc::new(JobShared::default());
    let (requests, receiver) = mpsc::channel();
    let key = spec.key.clone();
    let thread_shared = shared.clone();
    std::thread::Builder::new().name("metadea-thumbnailer".into()).spawn(move || {
        let key = spec.key.clone();
        if let Err(reason) = run_job(spec, &thread_shared, &receiver, sink.as_ref()) {
            log::info!("seek-bar thumbnails unavailable for {key}: {reason}");
        }
        thread_shared.finished.store(true, Ordering::Relaxed);
    })?;
    Ok(ThumbnailJob { key, shared, requests })
}

enum Wait {
    Reached,
    Ended,
    TimedOut,
    Cancelled,
}

fn wait_for(client: &MpvClient, shared: &JobShared, timeout: Duration, target: impl Fn(&MpvEvent) -> bool) -> Wait {
    let deadline = Instant::now() + timeout;
    loop {
        if shared.cancel.load(Ordering::Relaxed) {
            return Wait::Cancelled;
        }
        if Instant::now() >= deadline {
            return Wait::TimedOut;
        }
        let event = client.wait_event(EVENT_POLL_SECS);
        if target(&event) {
            return Wait::Reached;
        }
        if matches!(event, MpvEvent::EndFile(_) | MpvEvent::Shutdown) {
            return Wait::Ended;
        }
    }
}

struct Decoder<'a> {
    client: MpvClient,
    shared: &'a JobShared,
    tile_width: u32,
    tile_height: u32,
}

impl Decoder<'_> {
    fn capture(&self, secs: f64) -> Result<Option<RgbImage>, &'static str> {
        if self.client.command(&["seek", &format!("{secs:.3}"), "absolute+keyframes"]).is_err() {
            return Ok(None);
        }
        match wait_for(&self.client, self.shared, SEEK_TIMEOUT, |event| *event == MpvEvent::PlaybackRestart) {
            Wait::Reached => {}
            Wait::Cancelled => return Err("cancelled"),
            Wait::Ended => return Err("file ended"),
            Wait::TimedOut => return Ok(None),
        }
        let Ok(raw) = self.client.screenshot_raw() else {
            return Ok(None);
        };
        Ok(frame_to_tile(&raw, self.tile_width, self.tile_height))
    }

    fn serve(&self, request: ExactRequest) -> Result<(), &'static str> {
        let tile = self.capture(request.secs)?;
        let _ = request.reply.try_send(tile.as_ref().and_then(tile_data_url));
        Ok(())
    }
}

fn run_job(spec: JobSpec, shared: &JobShared, requests: &Receiver<ExactRequest>, sink: &dyn ThumbnailSink) -> Result<(), String> {
    let started = Instant::now();
    let client = MpvClient::create(spec.lib.clone(), &thumbnailer_options()).map_err(|error| error.to_string())?;
    client.command(&["loadfile", &spec.path, "replace"]).map_err(|error| error.to_string())?;
    match wait_for(&client, shared, LOAD_TIMEOUT, |event| *event == MpvEvent::FileLoaded) {
        Wait::Reached => {}
        Wait::Cancelled => return Ok(()),
        Wait::Ended => return Err("file could not be opened".into()),
        Wait::TimedOut => return Err("file load timed out".into()),
    }
    // The paused first frame; harmless if it never comes (seeks follow).
    if let Wait::Cancelled = wait_for(&client, shared, SEEK_TIMEOUT, |event| *event == MpvEvent::PlaybackRestart) {
        return Ok(());
    }
    let duration = client.get_property_f64("duration").filter(|secs| *secs > 0.0).ok_or("no duration")?;
    let (Some(display_width), Some(display_height)) = (client.get_property_i64("dwidth"), client.get_property_i64("dheight")) else {
        return Err("no video track".into());
    };
    let interval = interval_for(duration);
    let count = frame_count(duration, interval);
    let decoder = Decoder { client, shared, tile_width: TILE_WIDTH, tile_height: tile_height(display_width, display_height) };

    let mut tiles: Vec<Option<RgbImage>> = vec![None; count as usize];
    let mut slowest = Duration::ZERO;
    for index in generation_order(count) {
        while let Ok(request) = requests.try_recv() {
            if decoder.serve(request).is_err() {
                return Ok(());
            }
        }
        let frame_started = Instant::now();
        let tile = match decoder.capture(capture_time(index, interval, duration)) {
            Ok(tile) => tile,
            Err(_) => return Ok(()),
        };
        slowest = slowest.max(frame_started.elapsed());
        if let Some(data_url) = tile.as_ref().and_then(tile_data_url) {
            let event = ThumbnailFrameEvent {
                key: spec.key.clone(),
                index,
                count,
                interval_secs: interval,
                tile_width: decoder.tile_width,
                tile_height: decoder.tile_height,
                data_url,
            };
            if let Ok(mut frames) = shared.frames.lock() {
                frames.push(event.clone());
            }
            sink.frame(&event);
        }
        tiles[index as usize] = tile;
        match requests.recv_timeout(BREATHER) {
            Ok(request) => {
                if decoder.serve(request).is_err() {
                    return Ok(());
                }
            }
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => {}
        }
    }
    let elapsed = started.elapsed();
    log::info!(
        "seek-bar thumbnails: {count} frames in {} ms (avg {} ms/frame, slowest {} ms)",
        elapsed.as_millis(),
        elapsed.as_millis() / u128::from(count.max(1)),
        slowest.as_millis()
    );
    let tile_height = decoder.tile_height;
    drop(decoder);
    if tiles.iter().all(Option::is_none) {
        return Err("no frame could be decoded".into());
    }

    let mut manifest = ThumbnailManifest::new(duration, interval, count, TILE_WIDTH, tile_height);
    manifest.missing = tiles.iter().enumerate().filter(|(_, tile)| tile.is_none()).map(|(index, _)| index as u32).collect();
    let sheets = compose_sheets(&tiles, manifest.tile_width, manifest.tile_height).ok_or("sheet encoding failed")?;
    manifest.sheets = (0..sheets.len()).map(|sheet| format!("sheet_{sheet}.jpg")).collect();
    let dir = cache::entry_dir(&spec.cache_root, &spec.key);
    cache::write_entry(&dir, &manifest, &sheets).map_err(|error| error.to_string())?;
    cache::evict_lru(&spec.cache_root, cache::CACHE_CAP_BYTES, Some(&spec.key));
    let sheet_paths = manifest.sheets.iter().map(|sheet| dir.join(sheet).to_string_lossy().into_owned()).collect();
    sink.ready(&ThumbnailsReadyEvent { key: spec.key, manifest, sheets: sheet_paths });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_keep_the_thumbnailer_headless_silent_and_cheap() {
        let options = thumbnailer_options();
        let get = |name: &str| options.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str());
        assert_eq!(get("vo"), Some("null"));
        assert_eq!(get("aid"), Some("no"));
        assert_eq!(get("sid"), Some("no"));
        assert_eq!(get("hr-seek"), Some("no"));
        assert_eq!(get("pause"), Some("yes"));
        assert!(get("vf").unwrap().contains("scale=w=240"));
        assert!(get("wid").is_none());
    }
}

/// Live check against the bundled libmpv and a real video (Windows dev
/// machines): `METADEA_THUMB_TEST_FILE=C:\path\clip.mp4 cargo test
/// thumbnailer_live -- --ignored --nocapture`.
#[cfg(test)]
mod live {
    use super::*;

    struct PrintSink;
    impl ThumbnailSink for PrintSink {
        fn frame(&self, _frame: &ThumbnailFrameEvent) {}
        fn ready(&self, ready: &ThumbnailsReadyEvent) {
            println!("ready: {} frames, sheets {:?}", ready.manifest.count, ready.sheets);
        }
    }

    #[test]
    #[ignore]
    fn thumbnailer_live() {
        let Ok(file) = std::env::var("METADEA_THUMB_TEST_FILE") else { return };
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let lib = LibMpv::load(Some(&resources), None).expect("libmpv");
        let key = cache::cache_key_for_file(std::path::Path::new(&file)).expect("file");
        let root = std::env::temp_dir().join("metadea-thumb-live");
        let _ = std::fs::remove_dir_all(&root);

        // A playback handle decoding the same file at the same time, to
        // measure whether the thumbnailer makes it drop frames.
        let player = MpvClient::create(
            lib.clone(),
            &[("vo".into(), "null".into()), ("ao".into(), "null".into()), ("config".into(), "no".into()), ("idle".into(), "yes".into())],
        )
        .unwrap();
        player.command(&["loadfile", &file, "replace"]).unwrap();

        let job = spawn_job(JobSpec { lib, path: file.clone(), key: key.clone(), cache_root: root.clone() }, Box::new(PrintSink)).unwrap();
        let started = Instant::now();
        std::thread::sleep(Duration::from_millis(400));
        let exact = job.request_exact(12.0).and_then(|receiver| receiver.recv_timeout(Duration::from_secs(5)).ok()).flatten();
        println!("exact frame after {} ms: {}", started.elapsed().as_millis(), exact.as_ref().map_or(0, String::len));
        while !job.is_finished() && started.elapsed() < Duration::from_secs(120) {
            let _ = player.wait_event(0.05);
        }
        println!(
            "job finished in {} ms, {} frames; playback drops: decoder {:?}, vo {:?}, pos {:?}",
            started.elapsed().as_millis(),
            job.frames().len(),
            player.get_property_i64("decoder-frame-drop-count"),
            player.get_property_i64("frame-drop-count"),
            player.get_property_f64("time-pos"),
        );
        println!("mpv version: {:?}", player.get_property_string("mpv-version"));
        let manifest = cache::read_manifest(&cache::entry_dir(&root, &key)).expect("manifest written");
        assert!(manifest.count > 0);
        assert!(manifest.missing.len() < manifest.count as usize);
        assert!(exact.is_some());
    }
}
