// The event thread behind the engine: turns mpv events into throttled
// `PlayerStatus` snapshots plus track-change / end / error notifications.
//
// `EventLoopState` is pure (no mpv, no Tauri) so the throttling, track-change
// detection and start-offset handling are unit-tested with scripted events;
// `run_event_thread` is the thin loop that feeds it from a real `MpvApi`.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::mpv_api::{EndFileReason, MpvApi, MpvEvent};
use super::status::{PlayerStatus, StatusChange, StatusTracker};

/// Minimum gap between two position-only status emissions (≤ 4/s).
pub const STATUS_THROTTLE: Duration = Duration::from_millis(250);
const WAIT_EVENT_TIMEOUT_SECS: f64 = 0.1;

/// Where the event thread delivers what the frontend should hear about.
pub trait StatusSink: Send + 'static {
    fn status(&self, status: &PlayerStatus);
    fn track_changed(&self, index: i64, path: Option<&str>);
    fn ended(&self, reason: &str);
    fn load_failed(&self);
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outgoing {
    Status(PlayerStatus),
    TrackChanged { index: i64, path: Option<String> },
    Ended(String),
    LoadFailed,
    /// The one-shot `start` offset has been consumed: seek there if mpv
    /// ignored it, then clear it so the next queued file starts from zero.
    ClearStartOffset,
    Exit,
}

#[derive(Default)]
pub struct EventLoopState {
    tracker: StatusTracker,
    dirty: bool,
    last_emit: Option<Instant>,
    last_index: Option<i64>,
    start_offset_pending: bool,
}

impl EventLoopState {
    pub fn arm_start_offset(&mut self) {
        self.start_offset_pending = true;
    }

    pub fn handle(&mut self, event: MpvEvent, now: Instant) -> Vec<Outgoing> {
        let mut out = Vec::new();
        match event {
            MpvEvent::Shutdown => {
                out.push(Outgoing::Ended("shutdown".into()));
                out.push(Outgoing::Exit);
                return out;
            }
            MpvEvent::FileLoaded => {
                if std::mem::take(&mut self.start_offset_pending) {
                    out.push(Outgoing::ClearStartOffset);
                }
            }
            MpvEvent::EndFile(reason) => {
                if std::mem::take(&mut self.start_offset_pending) {
                    out.push(Outgoing::ClearStartOffset);
                }
                if reason == EndFileReason::Error {
                    out.push(Outgoing::LoadFailed);
                }
            }
            MpvEvent::PropertyChange { name, value } => {
                let change = self.tracker.apply(&name, &value);
                if name == "playlist-pos" {
                    let index = self.tracker.status.playlist_index;
                    if index >= 0 && self.last_index != Some(index) {
                        if self.last_index.is_some() {
                            out.push(Outgoing::TrackChanged { index, path: self.tracker.status.path.clone() });
                        }
                        self.last_index = Some(index);
                    }
                }
                match change {
                    StatusChange::Urgent => {
                        self.dirty = false;
                        self.last_emit = Some(now);
                        out.push(Outgoing::Status(self.tracker.status.clone()));
                    }
                    StatusChange::Position => self.dirty = true,
                    StatusChange::None => {}
                }
            }
            MpvEvent::Timeout | MpvEvent::StartFile | MpvEvent::Other => {}
        }
        if let Some(status) = self.flush(now) {
            out.push(status);
        }
        out
    }

    fn flush(&mut self, now: Instant) -> Option<Outgoing> {
        if !self.dirty {
            return None;
        }
        let due = match self.last_emit {
            None => true,
            Some(last) => now.duration_since(last) >= STATUS_THROTTLE,
        };
        if !due {
            return None;
        }
        self.dirty = false;
        self.last_emit = Some(now);
        Some(Outgoing::Status(self.tracker.status.clone()))
    }
}

pub fn run_event_thread(
    client: Arc<dyn MpvApi>,
    shared: Arc<Mutex<PlayerStatus>>,
    sink: Box<dyn StatusSink>,
    pending_start: Arc<Mutex<Option<f64>>>,
) {
    let mut state = EventLoopState::default();
    let mut armed_start: Option<f64> = None;
    loop {
        if let Some(secs) = pending_start.lock().ok().and_then(|mut pending| pending.take()) {
            state.arm_start_offset();
            armed_start = Some(secs);
        }
        let event = client.wait_event(WAIT_EVENT_TIMEOUT_SECS);
        let mut exit = false;
        for outgoing in state.handle(event, Instant::now()) {
            match outgoing {
                Outgoing::Status(status) => {
                    if let Ok(mut slot) = shared.lock() {
                        *slot = status.clone();
                    }
                    sink.status(&status);
                }
                Outgoing::TrackChanged { index, path } => sink.track_changed(index, path.as_deref()),
                Outgoing::Ended(reason) => sink.ended(&reason),
                Outgoing::LoadFailed => sink.load_failed(),
                Outgoing::ClearStartOffset => {
                    // Belt and braces: some builds apply `start` lazily or
                    // not at all for a playlist entry - seek explicitly when
                    // the position is not where the resume point asked.
                    if let Some(secs) = armed_start.take() {
                        let behind = match client.get_property_f64("time-pos") {
                            None => true,
                            Some(pos) => pos < secs - 1.0,
                        };
                        if behind {
                            let _ = client.command(&["seek", &format!("{secs:.3}"), "absolute"]);
                        }
                    }
                    let _ = client.set_property("start", "none");
                }
                Outgoing::Exit => exit = true,
            }
        }
        if exit {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::mpv_api::PropertyValue;

    fn prop(name: &str, value: PropertyValue) -> MpvEvent {
        MpvEvent::PropertyChange { name: name.into(), value }
    }

    #[test]
    fn position_ticks_are_throttled_but_state_changes_go_out_at_once() {
        let mut state = EventLoopState::default();
        let t0 = Instant::now();
        let out = state.handle(prop("path", PropertyValue::Str("a.mkv".into())), t0);
        assert!(matches!(out.as_slice(), [Outgoing::Status(_)]));
        // Two ticks inside the throttle window: nothing goes out yet.
        assert!(state.handle(prop("time-pos", PropertyValue::Double(1.0)), t0 + Duration::from_millis(50)).is_empty());
        assert!(state.handle(prop("time-pos", PropertyValue::Double(1.1)), t0 + Duration::from_millis(100)).is_empty());
        // Past the window the latest position is flushed exactly once.
        let out = state.handle(MpvEvent::Timeout, t0 + STATUS_THROTTLE);
        assert!(matches!(out.as_slice(), [Outgoing::Status(s)] if s.position_secs == 1.1));
        assert!(state.handle(MpvEvent::Timeout, t0 + STATUS_THROTTLE + Duration::from_millis(10)).is_empty());
    }

    #[test]
    fn track_change_is_reported_only_after_the_first_index() {
        let mut state = EventLoopState::default();
        let now = Instant::now();
        let first = state.handle(prop("playlist-pos", PropertyValue::Int(0)), now);
        assert!(!first.iter().any(|o| matches!(o, Outgoing::TrackChanged { .. })));
        let same = state.handle(prop("playlist-pos", PropertyValue::Int(0)), now);
        assert!(!same.iter().any(|o| matches!(o, Outgoing::TrackChanged { .. })));
        let next = state.handle(prop("playlist-pos", PropertyValue::Int(1)), now);
        assert!(next.contains(&Outgoing::TrackChanged { index: 1, path: None }));
    }

    #[test]
    fn start_offset_is_cleared_once_after_the_first_load_or_failure() {
        let mut state = EventLoopState::default();
        let now = Instant::now();
        state.arm_start_offset();
        assert_eq!(state.handle(MpvEvent::FileLoaded, now), vec![Outgoing::ClearStartOffset]);
        assert!(state.handle(MpvEvent::FileLoaded, now).is_empty());

        let mut failing = EventLoopState::default();
        failing.arm_start_offset();
        let out = failing.handle(MpvEvent::EndFile(EndFileReason::Error), now);
        assert_eq!(out, vec![Outgoing::ClearStartOffset, Outgoing::LoadFailed]);
    }

    #[test]
    fn shutdown_ends_the_session_and_exits() {
        let mut state = EventLoopState::default();
        let out = state.handle(MpvEvent::Shutdown, Instant::now());
        assert_eq!(out, vec![Outgoing::Ended("shutdown".into()), Outgoing::Exit]);
    }
}
