// What the frontend sees: `PlayerStatus`, and the tracker that folds mpv
// property-change events into it.

use serde::Serialize;

use super::mpv_api::{PropertyFormat, PropertyValue};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackState {
    #[default]
    Idle,
    Playing,
    Paused,
    Ended,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct TrackInfo {
    pub id: i64,
    pub kind: String,
    pub title: Option<String>,
    pub lang: Option<String>,
    pub selected: bool,
    pub is_default: bool,
    pub codec: Option<String>,
    pub external: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlayerStatus {
    pub state: PlaybackState,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub path: Option<String>,
    pub playlist_index: i64,
    pub playlist_len: i64,
    pub tracks: Vec<TrackInfo>,
    pub volume: f64,
    pub muted: bool,
    pub speed: f64,
    pub sub_delay_secs: f64,
}

impl Default for PlayerStatus {
    fn default() -> Self {
        PlayerStatus {
            state: PlaybackState::Idle,
            position_secs: 0.0,
            duration_secs: 0.0,
            path: None,
            playlist_index: -1,
            playlist_len: 0,
            tracks: Vec::new(),
            volume: 100.0,
            muted: false,
            speed: 1.0,
            sub_delay_secs: 0.0,
        }
    }
}

/// Every property the engine observes, with the format it asks mpv for.
/// `track-list` is a node property; asking for it as a string yields JSON.
pub const OBSERVED_PROPERTIES: &[(&str, PropertyFormat)] = &[
    ("time-pos", PropertyFormat::Double),
    ("duration", PropertyFormat::Double),
    ("pause", PropertyFormat::Flag),
    ("path", PropertyFormat::String),
    ("playlist-pos", PropertyFormat::Int64),
    ("playlist-count", PropertyFormat::Int64),
    ("track-list", PropertyFormat::String),
    ("eof-reached", PropertyFormat::Flag),
    ("core-idle", PropertyFormat::Flag),
    ("volume", PropertyFormat::Double),
    ("mute", PropertyFormat::Flag),
    ("speed", PropertyFormat::Double),
    ("sub-delay", PropertyFormat::Double),
];

pub fn parse_track_list(json: &str) -> Vec<TrackInfo> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let kind = item.get("type")?.as_str()?.to_string();
            Some(TrackInfo {
                id: item.get("id")?.as_i64()?,
                kind,
                title: item.get("title").and_then(|v| v.as_str()).map(str::to_string),
                lang: item.get("lang").and_then(|v| v.as_str()).map(str::to_string),
                selected: item.get("selected").and_then(|v| v.as_bool()).unwrap_or(false),
                is_default: item.get("default").and_then(|v| v.as_bool()).unwrap_or(false),
                codec: item.get("codec").and_then(|v| v.as_str()).map(str::to_string),
                external: item.get("external").and_then(|v| v.as_bool()).unwrap_or(false),
            })
        })
        .collect()
}

/// Which kind of change a property update represents — position ticks are
/// throttled by the engine, everything else goes out immediately.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusChange {
    None,
    Position,
    Urgent,
}

#[derive(Debug, Default)]
pub struct StatusTracker {
    pub status: PlayerStatus,
    pause: bool,
    eof_reached: bool,
}

impl StatusTracker {
    pub fn apply(&mut self, name: &str, value: &PropertyValue) -> StatusChange {
        let before = self.status.clone();
        let mut change = StatusChange::Urgent;
        match (name, value) {
            ("time-pos", PropertyValue::Double(secs)) => {
                self.status.position_secs = secs.max(0.0);
                change = StatusChange::Position;
            }
            ("time-pos", PropertyValue::None) => {
                self.status.position_secs = 0.0;
                change = StatusChange::Position;
            }
            ("duration", PropertyValue::Double(secs)) => self.status.duration_secs = secs.max(0.0),
            ("duration", PropertyValue::None) => self.status.duration_secs = 0.0,
            ("pause", PropertyValue::Flag(paused)) => self.pause = *paused,
            ("path", PropertyValue::Str(path)) => self.status.path = Some(path.clone()),
            ("path", PropertyValue::None) => self.status.path = None,
            ("playlist-pos", PropertyValue::Int(index)) => self.status.playlist_index = *index,
            ("playlist-count", PropertyValue::Int(len)) => self.status.playlist_len = *len,
            ("track-list", PropertyValue::Str(json)) => self.status.tracks = parse_track_list(json),
            ("eof-reached", PropertyValue::Flag(eof)) => self.eof_reached = *eof,
            ("eof-reached", PropertyValue::None) => self.eof_reached = false,
            ("volume", PropertyValue::Double(volume)) => self.status.volume = *volume,
            ("mute", PropertyValue::Flag(muted)) => self.status.muted = *muted,
            ("speed", PropertyValue::Double(speed)) => self.status.speed = *speed,
            ("sub-delay", PropertyValue::Double(delay)) => self.status.sub_delay_secs = *delay,
            _ => change = StatusChange::None,
        }
        self.status.state = derive_state(self.status.path.is_some(), self.pause, self.eof_reached);
        if change == StatusChange::None {
            return StatusChange::None;
        }
        if change == StatusChange::Position {
            // A position tick that also flipped the derived state (first
            // frame after a load) must not wait for the throttle.
            return if before.state != self.status.state { StatusChange::Urgent } else { StatusChange::Position };
        }
        if before == self.status { StatusChange::None } else { StatusChange::Urgent }
    }
}

pub fn derive_state(has_path: bool, paused: bool, eof_reached: bool) -> PlaybackState {
    if !has_path {
        PlaybackState::Idle
    } else if eof_reached {
        PlaybackState::Ended
    } else if paused {
        PlaybackState::Paused
    } else {
        PlaybackState::Playing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tracker_with_file() -> StatusTracker {
        let mut tracker = StatusTracker::default();
        tracker.apply("path", &PropertyValue::Str("C:/a.mkv".into()));
        tracker.apply("pause", &PropertyValue::Flag(false));
        tracker
    }

    #[test]
    fn state_follows_path_pause_and_eof() {
        assert_eq!(derive_state(false, false, false), PlaybackState::Idle);
        assert_eq!(derive_state(true, false, false), PlaybackState::Playing);
        assert_eq!(derive_state(true, true, false), PlaybackState::Paused);
        assert_eq!(derive_state(true, true, true), PlaybackState::Ended);
    }

    #[test]
    fn position_ticks_are_throttleable_but_state_flips_are_urgent() {
        let mut tracker = StatusTracker::default();
        assert_eq!(tracker.apply("time-pos", &PropertyValue::Double(1.0)), StatusChange::Position);
        assert_eq!(tracker.apply("path", &PropertyValue::Str("x.mkv".into())), StatusChange::Urgent);
        assert_eq!(tracker.status.state, PlaybackState::Playing);
        assert_eq!(tracker.apply("time-pos", &PropertyValue::Double(2.0)), StatusChange::Position);
        assert_eq!(tracker.apply("pause", &PropertyValue::Flag(true)), StatusChange::Urgent);
        assert_eq!(tracker.status.state, PlaybackState::Paused);
        // Same value again: nothing changed.
        assert_eq!(tracker.apply("pause", &PropertyValue::Flag(true)), StatusChange::None);
    }

    #[test]
    fn unknown_properties_are_ignored() {
        let mut tracker = tracker_with_file();
        assert_eq!(tracker.apply("something-else", &PropertyValue::Int(3)), StatusChange::None);
    }

    #[test]
    fn negative_positions_are_clamped_and_none_resets() {
        let mut tracker = tracker_with_file();
        tracker.apply("time-pos", &PropertyValue::Double(-0.5));
        assert_eq!(tracker.status.position_secs, 0.0);
        tracker.apply("duration", &PropertyValue::Double(120.0));
        tracker.apply("duration", &PropertyValue::None);
        assert_eq!(tracker.status.duration_secs, 0.0);
        tracker.apply("path", &PropertyValue::None);
        assert_eq!(tracker.status.state, PlaybackState::Idle);
    }

    #[test]
    fn track_list_json_maps_to_track_info() {
        let json = r#"[
          {"id":1,"type":"video","selected":true,"codec":"h264"},
          {"id":1,"type":"audio","title":"Japanese","lang":"jpn","selected":true,"default":true},
          {"id":2,"type":"sub","lang":"eng","selected":false,"external":true},
          {"type":"sub"}
        ]"#;
        let tracks = parse_track_list(json);
        assert_eq!(tracks.len(), 3);
        assert_eq!(tracks[1].title.as_deref(), Some("Japanese"));
        assert!(tracks[1].is_default);
        assert_eq!(tracks[2].kind, "sub");
        assert!(tracks[2].external);
        assert!(parse_track_list("not json").is_empty());
    }

    #[test]
    fn observed_property_names_are_unique() {
        let mut names: Vec<&str> = OBSERVED_PROPERTIES.iter().map(|(name, _)| *name).collect();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total);
    }
}
