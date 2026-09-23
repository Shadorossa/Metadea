// Engine tests driven by a scripted MpvApi fake (no libmpv needed):
// playlist construction, start-offset handling, the event thread's
// delivery to the sink and F12 capture naming.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::engine::{engine_options, OpenRequest, PlayerEngine};
use super::error::PlayerError;
use super::event_loop::{StatusSink, STATUS_THROTTLE};
use super::mpv_api::{MpvApi, MpvEvent, PropertyFormat, PropertyValue};
use super::status::PlayerStatus;

// Scripted stand-in for libmpv: replays `events`, then idles with
// `Timeout`s (like a real handle) until `quit`, after which it reports
// `Shutdown` exactly as mpv does.
struct FakeMpv {
    events: Mutex<VecDeque<MpvEvent>>,
    commands: Mutex<Vec<Vec<String>>>,
    properties: Mutex<Vec<(String, String)>>,
    quit: AtomicBool,
}

impl FakeMpv {
    fn new(events: Vec<MpvEvent>) -> Arc<FakeMpv> {
        Arc::new(FakeMpv {
            events: Mutex::new(events.into()),
            commands: Mutex::new(Vec::new()),
            properties: Mutex::new(Vec::new()),
            quit: AtomicBool::new(false),
        })
    }
}

impl MpvApi for FakeMpv {
    fn set_property(&self, name: &str, value: &str) -> Result<(), PlayerError> {
        self.properties.lock().unwrap().push((name.into(), value.into()));
        Ok(())
    }
    fn get_property_i64(&self, _: &str) -> Option<i64> { None }
    fn get_property_f64(&self, _: &str) -> Option<f64> { None }
    fn get_property_flag(&self, _: &str) -> Option<bool> { None }
    fn get_property_string(&self, _: &str) -> Option<String> { None }
    fn command(&self, args: &[&str]) -> Result<(), PlayerError> {
        if args == ["quit"] {
            self.quit.store(true, Ordering::Release);
        }
        self.commands.lock().unwrap().push(args.iter().map(|a| a.to_string()).collect());
        Ok(())
    }
    fn observe_property(&self, _: u64, _: &str, _: PropertyFormat) -> Result<(), PlayerError> { Ok(()) }
    fn wait_event(&self, timeout_secs: f64) -> MpvEvent {
        if let Some(event) = self.events.lock().unwrap().pop_front() {
            return event;
        }
        if self.quit.load(Ordering::Acquire) {
            return MpvEvent::Shutdown;
        }
        std::thread::sleep(Duration::from_secs_f64(timeout_secs));
        MpvEvent::Timeout
    }
    fn wakeup(&self) {}
}

#[derive(Default)]
struct RecordingSink {
    statuses: Mutex<Vec<PlayerStatus>>,
    track_changes: Mutex<Vec<i64>>,
    ended: Mutex<Vec<String>>,
}

struct SinkHandle(Arc<RecordingSink>);

impl StatusSink for SinkHandle {
    fn status(&self, status: &PlayerStatus) { self.0.statuses.lock().unwrap().push(status.clone()); }
    fn track_changed(&self, index: i64, _: Option<&str>) { self.0.track_changes.lock().unwrap().push(index); }
    fn ended(&self, reason: &str) { self.0.ended.lock().unwrap().push(reason.into()); }
    fn load_failed(&self) {}
}

fn prop(name: &str, value: PropertyValue) -> MpvEvent {
    MpvEvent::PropertyChange { name: name.into(), value }
}

#[test]
fn open_builds_the_playlist_and_arms_the_start_offset() {
    let fake = FakeMpv::new(vec![]);
    let sink = Arc::new(RecordingSink::default());
    let mut engine = PlayerEngine::default();
    engine.attach(fake.clone(), Box::new(SinkHandle(sink.clone()))).unwrap();
    let session = engine
        .open(OpenRequest {
            queue: vec!["a.mkv".into(), "b.mkv".into(), "c.mkv".into()],
            start_index: 1,
            start_seconds: Some(42.5),
            work_name: "Show".into(),
            episode_labels: vec!["S01E01".into(), "S01E02".into(), "S01E03".into()],
            titles: vec![],
            external_id: None,
            episode_numbers: vec![],
            filler_episodes: vec![],
            capture_dir: std::env::temp_dir(),
        })
        .unwrap();
    assert_eq!(session.queue.len(), 3);
    engine.close();

    let commands = fake.commands.lock().unwrap().clone();
    assert!(commands.contains(&vec!["loadfile".to_string(), "a.mkv".into(), "replace".into()]));
    assert!(commands.contains(&vec!["loadfile".to_string(), "c.mkv".into(), "append".into()]));
    assert!(commands.contains(&vec!["playlist-play-index".to_string(), "1".into()]));
    assert!(commands.contains(&vec!["quit".to_string()]));
    let properties = fake.properties.lock().unwrap().clone();
    assert!(properties.contains(&("start".to_string(), "42.500".into())));
    assert_eq!(sink.ended.lock().unwrap().as_slice(), ["shutdown"]);
}

#[test]
fn event_thread_delivers_status_and_track_changes_to_the_sink() {
    let fake = FakeMpv::new(vec![
        prop("path", PropertyValue::Str("a.mkv".into())),
        prop("playlist-pos", PropertyValue::Int(0)),
        prop("playlist-pos", PropertyValue::Int(1)),
    ]);
    let sink = Arc::new(RecordingSink::default());
    let mut engine = PlayerEngine::default();
    engine.attach(fake, Box::new(SinkHandle(sink.clone()))).unwrap();
    engine.close();
    assert!(!sink.statuses.lock().unwrap().is_empty());
    assert_eq!(sink.track_changes.lock().unwrap().as_slice(), [1]);
    assert_eq!(engine.status(), PlayerStatus::default(), "close resets the shared status");
}

#[test]
fn screenshot_name_uses_the_current_queue_index_and_position() {
    let fake = FakeMpv::new(vec![
        prop("path", PropertyValue::Str("b.mkv".into())),
        prop("playlist-pos", PropertyValue::Int(1)),
        prop("time-pos", PropertyValue::Double(3723.456)),
    ]);
    let sink = Arc::new(RecordingSink::default());
    let mut engine = PlayerEngine::default();
    engine.attach(fake, Box::new(SinkHandle(sink))).unwrap();
    engine
        .open(OpenRequest {
            queue: vec!["a.mkv".into(), "b.mkv".into()],
            start_index: 0,
            start_seconds: None,
            work_name: "Teen Titans".into(),
            episode_labels: vec!["S01E24".into(), "S01E25".into()],
            titles: vec![],
            external_id: None,
            episode_numbers: vec![],
            filler_episodes: vec![],
            capture_dir: PathBuf::from("/captures"),
        })
        .unwrap();
    // Let the (fake) event thread drain its script, which needs the
    // throttle window to elapse for the position tick.
    std::thread::sleep(STATUS_THROTTLE + Duration::from_millis(400));
    let (path, saved) = engine.next_screenshot().unwrap();
    assert_eq!(saved.episode_label, "S01E25");
    assert_eq!(saved.timecode, "01h02m03s456");
    assert!(path.ends_with("Teen Titans - S01E25 - 01h02m03s456.png"));
    engine.close();
}

#[test]
fn commands_without_a_client_report_not_open() {
    let engine = PlayerEngine::default();
    assert_eq!(engine.toggle_pause().unwrap_err().code, "player_not_open");
    assert!(engine.set_track("video", Some(1)).is_err());
    assert_eq!(engine.frame_step("back").unwrap_err().code, "player_not_open");
    assert_eq!(engine.cycle_track("sub").unwrap_err().code, "player_not_open");
}

#[test]
fn frame_step_and_cycle_track_forward_the_matching_mpv_commands() {
    let fake = FakeMpv::new(vec![]);
    let sink = Arc::new(RecordingSink::default());
    let mut engine = PlayerEngine::default();
    engine.attach(fake.clone(), Box::new(SinkHandle(sink))).unwrap();
    engine.frame_step("back").unwrap();
    engine.frame_step("forward").unwrap();
    engine.cycle_track("sub").unwrap();
    engine.cycle_track("audio").unwrap();
    assert!(engine.frame_step("sideways").is_err());
    assert!(engine.cycle_track("video").is_err());
    engine.close();

    let commands = fake.commands.lock().unwrap().clone();
    assert!(commands.contains(&vec!["frame-back-step".to_string()]));
    assert!(commands.contains(&vec!["frame-step".to_string()]));
    assert!(commands.contains(&vec!["cycle".to_string(), "sub".into()]));
    assert!(commands.contains(&vec!["cycle".to_string(), "audio".into()]));
}

#[test]
fn options_include_the_ui_less_engine_setup() {
    let options = engine_options();
    let get = |name: &str| options.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str());
    assert_eq!(get("osc"), Some("no"));
    assert_eq!(get("input-default-bindings"), Some("no"));
    assert_eq!(get("vo"), Some("gpu-next,gpu"));
    assert_eq!(get("keep-open"), Some("yes"));
    assert_eq!(get("config"), Some("no"));
}

// Loads the real DLL from `target/debug/` (see resources/README-libmpv.md)
// and spins up a UI-less client. Ignored by default so CI without the DLL
// stays green: `cargo test real_libmpv -- --ignored`.
mod real_library_tests {
    use std::path::Path;
    use std::sync::Arc;

    use crate::player::libmpv_ffi::{LibMpv, MpvClient};
    use crate::player::mpv_api::MpvApi;

    #[test]
    #[ignore]
    fn real_libmpv_loads_and_initializes() {
        let exe_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("debug");
        let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        let lib = LibMpv::load(Some(&resource_dir), Some(&exe_dir)).expect("libmpv-2.dll next to the app");
        let options = vec![
            ("vo".to_string(), "null".to_string()),
            ("ao".to_string(), "null".to_string()),
            ("idle".to_string(), "yes".to_string()),
            ("config".to_string(), "no".to_string()),
            ("terminal".to_string(), "no".to_string()),
        ];
        let client = MpvClient::create(lib, &options).expect("mpv_initialize");
        assert_eq!(client.get_property_flag("idle-active"), Some(true));
        assert!(client.get_property_string("mpv-version").is_some());
    }

    // Resume offset end to end through the real engine: `start` + the
    // seek fallback in event_loop must land a synthetic 100 s clip at 30 s.
    #[test]
    #[ignore]
    fn real_libmpv_applies_the_start_offset() {
        use crate::player::engine::{engine_options, OpenRequest, PlayerEngine};
        use crate::player::event_loop::StatusSink;
        use crate::player::status::PlayerStatus;

        struct NullSink;
        impl StatusSink for NullSink {
            fn status(&self, _: &PlayerStatus) {}
            fn track_changed(&self, _: i64, _: Option<&str>) {}
            fn ended(&self, _: &str) {}
            fn load_failed(&self) {}
        }

        let exe_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("debug");
        let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        let lib = LibMpv::load(Some(&resource_dir), Some(&exe_dir)).expect("libmpv-2.dll next to the app");
        let mut options = engine_options();
        options.retain(|(name, _)| name != "vo" && name != "hwdec");
        options.push(("vo".into(), "null".into()));
        options.push(("ao".into(), "null".into()));
        let client = MpvClient::create(lib, &options).expect("mpv_initialize");
        let mut engine = PlayerEngine::default();
        engine.attach(Arc::new(client), Box::new(NullSink)).unwrap();
        engine
            .open(OpenRequest {
                queue: vec!["av://lavfi:testsrc=duration=100:size=64x64:rate=10".into()],
                start_index: 0,
                start_seconds: Some(30.0),
                work_name: "Test".into(),
                episode_labels: vec![],
                titles: vec![],
                external_id: None,
                episode_numbers: vec![],
                filler_episodes: vec![],
                capture_dir: std::env::temp_dir(),
            })
            .unwrap();
        let mut position = 0.0;
        for _ in 0..40 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            position = engine.refresh_status().position_secs;
            if position >= 29.0 {
                break;
            }
        }
        engine.close();
        assert!(position >= 29.0, "expected playback to start near 30 s, got {position}");
    }
}
