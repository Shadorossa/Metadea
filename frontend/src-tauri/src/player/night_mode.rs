// Night mode / clear dialogue: one labelled entry (`@night`) on mpv's `af`
// list that evens out loudness over time, tames peaks and lifts voices. It is
// added and removed live (`af add` / `af remove`), without touching any other
// filter and without restarting playback.
//
// The whole chain is a single `lavfi=[…]` graph so one label covers it:
// - dynaudnorm: loudness evened out over time (quiet dialogue up, loud
//   scenes down) with a 150 ms frame and a short gaussian window;
// - acompressor: catches the peaks dynaudnorm lets through (~-21 dBFS, 4:1);
// - equalizer: a gentle +3 dB presence lift around 2.5 kHz (Q 1.2 spans
//   roughly 1.5–3.8 kHz, where consonants live);
// - alimiter: a ceiling against clipping (auto-level off: it must not
//   raise the volume on its own).
//
// The bundled libmpv's FFmpeg may lack a filter or one of its options. While
// an audio chain exists, mpv rejects a bad `af add` synchronously and keeps
// the previous list, so the candidates are tried richest first and the first
// one accepted wins; if none is, night mode is reported unavailable. With no
// audio track there is no chain to validate against (mpv would only store the
// option and fail later, at audio init), so the engine waits for one.
//
// No centre-channel boost for surround sources: a `pan` downmix names input
// channels that are only checked against the real layout when the graph is
// configured — after `af add` has already succeeded — and a mismatch there
// (5.1 vs 5.1(side) vs 7.1) would silence the file instead of falling back.

use serde::Serialize;

use super::mpv_api::MpvApi;

pub const NIGHT_MODE_LABEL: &str = "@night";

const FULL_GRAPH: &str = concat!(
    "dynaudnorm=f=150:g=15:p=0.9:m=10:s=12,",
    "acompressor=threshold=0.089:ratio=4:attack=5:release=120:makeup=2,",
    "equalizer=f=2500:t=q:w=1.2:g=3,",
    "alimiter=limit=0.95:level=0",
);
const BASIC_GRAPH: &str = "dynaudnorm=f=150:g=15:p=0.9:m=10:s=12";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NightModeLevel {
    #[default]
    Off,
    /// The whole chain is active.
    Full,
    /// Only dynaudnorm: the build rejected the full chain.
    Basic,
    /// Wanted, but nothing applied yet: no audio track to validate against.
    Pending,
    /// The build rejected every candidate.
    Unavailable,
}

impl NightModeLevel {
    pub fn is_active(self) -> bool {
        matches!(self, NightModeLevel::Full | NightModeLevel::Basic)
    }
}

/// The `af` list entry for a lavfi graph under the night-mode label.
pub fn night_filter_entry(graph: &str) -> String {
    format!("{NIGHT_MODE_LABEL}:lavfi=[{graph}]")
}

/// Richest first: what `apply_night_mode` tries, in order.
pub fn night_mode_candidates() -> [(NightModeLevel, String); 2] {
    [
        (NightModeLevel::Full, night_filter_entry(FULL_GRAPH)),
        (NightModeLevel::Basic, night_filter_entry(BASIC_GRAPH)),
    ]
}

/// Whether mpv's current `af` list (as a string) still holds our entry.
fn chain_present(af: Option<&str>) -> bool {
    af.is_some_and(|list| list.contains(&format!("{NIGHT_MODE_LABEL}:")))
}

/// Turns the chain on or off and returns the resulting level. `current` is
/// the last level returned for this client: an active chain that is still in
/// the list is left alone (re-adding it would reinit the audio chain and
/// cause a dropout on every file change).
pub fn apply_night_mode(client: &dyn MpvApi, enabled: bool, current: NightModeLevel) -> NightModeLevel {
    if !enabled {
        // Removing a label that is not there is harmless (mpv only warns).
        let _ = client.command(&["af", "remove", NIGHT_MODE_LABEL]);
        return NightModeLevel::Off;
    }
    if current.is_active() && chain_present(client.get_property_string("af").as_deref()) {
        return current;
    }
    if client.get_property_i64("aid").is_none() {
        return NightModeLevel::Pending;
    }
    let _ = client.command(&["af", "remove", NIGHT_MODE_LABEL]);
    for (level, entry) in night_mode_candidates() {
        match client.command(&["af", "add", &entry]) {
            Ok(()) => return level,
            Err(error) => log::info!("night mode: libmpv rejected the {level:?} chain: {error}"),
        }
    }
    NightModeLevel::Unavailable
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::player::error::PlayerError;
    use crate::player::mpv_api::{MpvEvent, PropertyFormat};

    // An `af` list that rejects any entry naming one of `missing`, like a
    // libmpv whose FFmpeg was built without those filters.
    struct FakeAf {
        missing: Vec<&'static str>,
        aid: Option<i64>,
        list: Mutex<Vec<String>>,
        commands: Mutex<Vec<Vec<String>>>,
    }

    impl FakeAf {
        fn new(missing: Vec<&'static str>, aid: Option<i64>) -> FakeAf {
            FakeAf { missing, aid, list: Mutex::new(Vec::new()), commands: Mutex::new(Vec::new()) }
        }

        fn adds(&self) -> usize {
            self.commands.lock().unwrap().iter().filter(|args| args.get(1).map(String::as_str) == Some("add")).count()
        }
    }

    impl MpvApi for FakeAf {
        fn set_property(&self, _: &str, _: &str) -> Result<(), PlayerError> { Ok(()) }
        fn get_property_i64(&self, name: &str) -> Option<i64> { if name == "aid" { self.aid } else { None } }
        fn get_property_f64(&self, _: &str) -> Option<f64> { None }
        fn get_property_flag(&self, _: &str) -> Option<bool> { None }
        fn get_property_string(&self, name: &str) -> Option<String> {
            (name == "af").then(|| self.list.lock().unwrap().join(","))
        }
        fn command(&self, args: &[&str]) -> Result<(), PlayerError> {
            self.commands.lock().unwrap().push(args.iter().map(|arg| arg.to_string()).collect());
            let mut list = self.list.lock().unwrap();
            match args {
                ["af", "add", entry] => {
                    if self.missing.iter().any(|name| entry.contains(name)) {
                        return Err(PlayerError::mpv("filter not found"));
                    }
                    list.push(entry.to_string());
                }
                ["af", "remove", label] => list.retain(|entry| !entry.starts_with(&format!("{label}:"))),
                _ => {}
            }
            Ok(())
        }
        fn observe_property(&self, _: u64, _: &str, _: PropertyFormat) -> Result<(), PlayerError> { Ok(()) }
        fn wait_event(&self, _: f64) -> MpvEvent { MpvEvent::Timeout }
        fn wakeup(&self) {}
    }

    #[test]
    fn entries_are_one_labelled_lavfi_graph() {
        let [(full_level, full), (basic_level, basic)] = night_mode_candidates();
        assert_eq!((full_level, basic_level), (NightModeLevel::Full, NightModeLevel::Basic));
        assert!(full.starts_with("@night:lavfi=[dynaudnorm="));
        assert!(full.ends_with(']'));
        for filter in ["acompressor=", "equalizer=", "alimiter="] {
            assert!(full.contains(filter), "{filter} missing from {full}");
        }
        assert_eq!(basic, "@night:lavfi=[dynaudnorm=f=150:g=15:p=0.9:m=10:s=12]");
        // mpv's list parser only keeps the commas inside the brackets.
        assert_eq!(full.matches('[').count(), 1);
        assert_eq!(full.matches(']').count(), 1);
    }

    #[test]
    fn full_chain_when_the_build_has_every_filter() {
        let mpv = FakeAf::new(vec![], Some(1));
        assert_eq!(apply_night_mode(&mpv, true, NightModeLevel::Off), NightModeLevel::Full);
        assert_eq!(mpv.list.lock().unwrap().len(), 1);
    }

    #[test]
    fn falls_back_to_dynaudnorm_then_to_unavailable() {
        let mpv = FakeAf::new(vec!["alimiter"], Some(1));
        assert_eq!(apply_night_mode(&mpv, true, NightModeLevel::Off), NightModeLevel::Basic);
        assert_eq!(mpv.list.lock().unwrap().as_slice(), [night_filter_entry(BASIC_GRAPH)]);

        let bare = FakeAf::new(vec!["dynaudnorm"], Some(1));
        assert_eq!(apply_night_mode(&bare, true, NightModeLevel::Off), NightModeLevel::Unavailable);
        assert!(bare.list.lock().unwrap().is_empty());
    }

    #[test]
    fn waits_for_an_audio_track() {
        let mpv = FakeAf::new(vec![], None);
        assert_eq!(apply_night_mode(&mpv, true, NightModeLevel::Off), NightModeLevel::Pending);
        assert_eq!(mpv.adds(), 0);
    }

    #[test]
    fn an_active_chain_is_not_re_added() {
        let mpv = FakeAf::new(vec![], Some(1));
        let level = apply_night_mode(&mpv, true, NightModeLevel::Off);
        assert_eq!(apply_night_mode(&mpv, true, level), NightModeLevel::Full);
        assert_eq!(mpv.adds(), 1);
    }

    #[test]
    fn off_removes_only_the_labelled_entry() {
        let mpv = FakeAf::new(vec![], Some(1));
        mpv.list.lock().unwrap().push("@user:lavfi=[volume=2]".into());
        apply_night_mode(&mpv, true, NightModeLevel::Off);
        assert_eq!(apply_night_mode(&mpv, false, NightModeLevel::Full), NightModeLevel::Off);
        assert_eq!(mpv.list.lock().unwrap().as_slice(), ["@user:lavfi=[volume=2]".to_string()]);
    }
}
