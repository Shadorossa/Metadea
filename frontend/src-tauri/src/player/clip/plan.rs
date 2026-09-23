// Pure planning for a clip: range clamping, the bitrate that keeps an MP4
// under Discord's free upload limit, the output file name and the mpv
// encoding options. Unit-tested; no mpv, no Tauri.

use std::path::{Path, PathBuf};

use super::super::screenshot_names::sanitize_capture_folder_name;

pub const MIN_CLIP_SECS: f64 = 3.0;
pub const MAX_CLIP_SECS: f64 = 10.0;
/// Discord's free upload limit is 10 MB; aim a little below it.
pub const TARGET_BYTES: u64 = 10 * 1000 * 1000;
/// Share of the budget left for the MP4 container and rate-control overshoot.
const CONTAINER_MARGIN: f64 = 0.88;
pub const AUDIO_KBPS: u32 = 128;
const MIN_VIDEO_KBPS: u32 = 300;
pub const GIF_WIDTH: u32 = 480;
pub const GIF_FPS: u32 = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipFormat {
    Mp4,
    Gif,
}

/// How a clip is actually encoded. The bundled libmpv is an LGPL build (no
/// libx264), so "MP4" is H.264 through Windows Media Foundation (`h264_mf`,
/// part of Windows) with AAC; where MF is missing (Windows N without the
/// Media Feature Pack) it falls back to VP9 + Opus in WebM, which Discord
/// and Telegram play just as well.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClipCodec {
    H264Mp4,
    Vp9Webm,
    Gif,
}

impl ClipCodec {
    /// Encoders to try, in order, for a requested format.
    pub fn attempts(format: ClipFormat) -> &'static [ClipCodec] {
        match format {
            ClipFormat::Mp4 => &[ClipCodec::H264Mp4, ClipCodec::Vp9Webm],
            ClipFormat::Gif => &[ClipCodec::Gif],
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            ClipCodec::H264Mp4 => "mp4",
            ClipCodec::Vp9Webm => "webm",
            ClipCodec::Gif => "gif",
        }
    }
}

/// Output height: 480p (default) or 720p. GIFs are always 480 px wide.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
pub enum ClipSize {
    #[serde(rename = "480p")]
    P480,
    #[serde(rename = "720p")]
    P720,
}

impl ClipSize {
    pub fn height(self) -> u32 {
        match self {
            ClipSize::P480 => 480,
            ClipSize::P720 => 720,
        }
    }

    /// Quality ceiling: short clips have budget to spare, no need to burn it.
    fn max_video_kbps(self) -> u32 {
        match self {
            ClipSize::P480 => 2_500,
            ClipSize::P720 => 5_000,
        }
    }
}

/// Clamps a requested selection to 3–10 s inside the file. Keeps the start
/// where possible and moves it back when the end would pass the file end.
pub fn clamp_range(start: f64, end: f64, duration: f64) -> (f64, f64) {
    let duration = if duration.is_finite() && duration > 0.0 { duration } else { f64::MAX };
    let start = if start.is_finite() { start.max(0.0) } else { 0.0 };
    let requested = if end.is_finite() { end - start } else { MIN_CLIP_SECS };
    let length = requested.clamp(MIN_CLIP_SECS, MAX_CLIP_SECS).min(duration);
    let start = start.min((duration - length).max(0.0));
    (start, start + length)
}

/// Video bitrate (kbit/s) so video + audio fit in TARGET_BYTES for a clip
/// of `duration_secs`, capped by the size's quality ceiling.
pub fn video_bitrate_kbps(duration_secs: f64, audio_kbps: u32, size: ClipSize) -> u32 {
    let duration = duration_secs.max(MIN_CLIP_SECS);
    let total_kbps = (TARGET_BYTES as f64 * 8.0 * CONTAINER_MARGIN) / 1000.0 / duration;
    let budget = (total_kbps - f64::from(audio_kbps)).floor().max(0.0) as u32;
    budget.clamp(MIN_VIDEO_KBPS, size.max_video_kbps())
}

/// `mm-ss` (or `h-mm-ss` past an hour) of the clip start, file-name safe.
pub fn clip_timecode(start_secs: f64) -> String {
    let total = start_secs.max(0.0).floor() as u64;
    let (hours, minutes, seconds) = (total / 3600, (total % 3600) / 60, total % 60);
    if hours > 0 {
        format!("{hours}-{minutes:02}-{seconds:02}")
    } else {
        format!("{minutes:02}-{seconds:02}")
    }
}

/// `E12` / `E12.5` from the episode number, else the sanitised queue label
/// (`S01E03`, `M01`).
pub fn episode_part(episode_number: Option<f64>, episode_label: &str) -> String {
    match episode_number.filter(|number| number.is_finite() && *number > 0.0) {
        Some(number) if number.fract() == 0.0 => format!("E{}", number as i64),
        Some(number) => format!("E{number}"),
        None => sanitize_capture_folder_name(episode_label),
    }
}

/// `<Series> - E<ep> - <mm-ss>.<ext>`, every part sanitised.
pub fn clip_file_name(work_name: &str, episode: &str, start_secs: f64, codec: ClipCodec) -> String {
    let title: String = sanitize_capture_folder_name(work_name).chars().take(100).collect();
    let episode = sanitize_capture_folder_name(episode);
    format!("{title} - {episode} - {}.{}", clip_timecode(start_secs), codec.extension())
}

/// `name.ext`, or `name-2.ext`, `name-3.ext`… when taken.
pub fn available_path(directory: &Path, file_name: &str) -> PathBuf {
    let preferred = directory.join(file_name);
    if !preferred.exists() {
        return preferred;
    }
    let stem = preferred.file_stem().unwrap_or_default().to_string_lossy().into_owned();
    let extension = preferred.extension().unwrap_or_default().to_string_lossy().into_owned();
    (2u32..)
        .map(|suffix| directory.join(format!("{stem}-{suffix}.{extension}")))
        .find(|candidate| !candidate.exists())
        .unwrap_or(preferred)
}

/// What to encode, resolved from the player's state.
#[derive(Debug, Clone)]
pub struct ClipJob {
    pub source: String,
    pub output: PathBuf,
    pub start: f64,
    pub end: f64,
    pub codec: ClipCodec,
    pub size: ClipSize,
    /// Audio track id to keep (MP4 with audio), `None` = no audio.
    pub audio_id: Option<i64>,
    /// Subtitle track to burn in, with its external file when it is one.
    pub subtitle: Option<SubtitleSource>,
    pub sub_delay: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SubtitleSource {
    /// Track id in a fresh handle opened on the same file.
    pub id: i64,
    pub external_file: Option<String>,
}

fn push(options: &mut Vec<(String, String)>, name: &str, value: impl Into<String>) {
    options.push((name.to_string(), value.into()));
}

fn push_audio(options: &mut Vec<(String, String)>, audio_id: Option<i64>, codec: &str, codec_options: String) {
    match audio_id {
        Some(id) => {
            push(options, "aid", id.to_string());
            push(options, "oac", codec);
            push(options, "oacopts", codec_options);
        }
        None => push(options, "aid", "no"),
    }
}

/// Options for a headless encoding handle. mpv's encoding mode (`o`)
/// replaces the VO with vo_lavc, which draws the selected subtitle track
/// into each frame after the filter chain — so burning subtitles is just
/// selecting them (`sid`) — and runs untimed (as fast as it can decode).
pub fn encoding_options(job: &ClipJob) -> Vec<(String, String)> {
    let mut options = Vec::new();
    for (name, value) in [
        ("config", "no"),
        ("terminal", "no"),
        ("osc", "no"),
        ("osd-level", "0"),
        ("input-default-bindings", "no"),
        ("load-scripts", "no"),
        ("ytdl", "no"),
        ("idle", "no"),
        ("keep-open", "no"),
        ("pause", "no"),
        ("hwdec", "no"),
        ("hr-seek", "yes"),
        ("sub-auto", "no"),
        ("audio-file-auto", "no"),
        ("ocopy-metadata", "no"),
    ] {
        push(&mut options, name, value);
    }
    push(&mut options, "o", job.output.to_string_lossy());
    push(&mut options, "start", format!("{:.3}", job.start));
    push(&mut options, "end", format!("{:.3}", job.end));
    let audio_kbps = if job.audio_id.is_some() { AUDIO_KBPS } else { 0 };
    let video_kbps = video_bitrate_kbps(job.end - job.start, audio_kbps, job.size);
    let height = job.size.height();
    match job.codec {
        ClipCodec::H264Mp4 => {
            push(&mut options, "of", "mp4");
            push(&mut options, "ofopts", "movflags=+faststart");
            push(&mut options, "ovc", "h264_mf");
            // Media Foundation's software H.264 MFT has no CRF: unconstrained
            // VBR at the size budget, fed NV12.
            push(&mut options, "ovcopts", format!("b={video_kbps}k,rate_control=u_vbr,hw_encoding=0,scenario=archive"));
            push(&mut options, "vf", format!("lavfi=[scale=w=-2:h={height}:flags=bicubic,format=nv12]"));
            push_audio(&mut options, job.audio_id, "aac", format!("b={AUDIO_KBPS}k"));
        }
        ClipCodec::Vp9Webm => {
            push(&mut options, "of", "webm");
            push(&mut options, "ovc", "libvpx-vp9");
            push(&mut options, "ovcopts", format!("b={video_kbps}k,deadline=realtime,cpu-used=8,row-mt=1"));
            push(&mut options, "vf", format!("lavfi=[scale=w=-2:h={height}:flags=bicubic,format=yuv420p]"));
            // FFmpeg's native Opus encoder is flagged experimental.
            push_audio(&mut options, job.audio_id, "opus", format!("b={AUDIO_KBPS}k,strict=-2"));
        }
        ClipCodec::Gif => {
            // One palette, taken from the first frame (`trim` + `palettegen
            // stats_mode=single`) and kept for the whole clip (`paletteuse`
            // default new=0): a global palettegen only emits at EOF, which
            // mpv's chain never delivers when `end` stops the clip, and
            // per-frame palettes break the GIF encoder's inter-frame
            // compression (a 10 s clip went over 13 MB).
            push(&mut options, "of", "gif");
            push(&mut options, "ovc", "gif");
            push(
                &mut options,
                "vf",
                format!(
                    // `sub` burns the subtitles in before palettisation: the
                    // encoder's own OSD pass cannot draw onto pal8 frames.
                    "lavfi=[fps={GIF_FPS},scale=w={GIF_WIDTH}:h=-2:flags=lanczos],sub,lavfi=[split[a][b];[a]trim=end_frame=1,palettegen=stats_mode=single[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle]"
                ),
            );
            push(&mut options, "aid", "no");
        }
    }
    match &job.subtitle {
        Some(subtitle) => {
            if let Some(file) = &subtitle.external_file {
                push(&mut options, "sub-files", file.clone());
            }
            push(&mut options, "sid", subtitle.id.to_string());
            push(&mut options, "sub-visibility", "yes");
            push(&mut options, "sub-delay", format!("{:.3}", job.sub_delay));
        }
        None => push(&mut options, "sid", "no"),
    }
    options
}

/// The selected subtitle track of the playback handle's `track-list`,
/// translated to the id it gets in a fresh handle (embedded tracks keep
/// their id; an external file is re-added alone, after the embedded ones).
pub fn subtitle_source(track_list_json: &str) -> Option<SubtitleSource> {
    let serde_json::Value::Array(tracks) = serde_json::from_str(track_list_json).ok()? else {
        return None;
    };
    let subs: Vec<&serde_json::Value> = tracks.iter().filter(|track| track.get("type").and_then(|v| v.as_str()) == Some("sub")).collect();
    let selected = subs.iter().find(|track| track.get("selected").and_then(|v| v.as_bool()) == Some(true))?;
    let external = selected.get("external").and_then(|v| v.as_bool()).unwrap_or(false);
    if !external {
        return Some(SubtitleSource { id: selected.get("id")?.as_i64()?, external_file: None });
    }
    let file = selected.get("external-filename").and_then(|v| v.as_str())?.to_string();
    let embedded = subs.iter().filter(|track| track.get("external").and_then(|v| v.as_bool()) != Some(true)).count() as i64;
    Some(SubtitleSource { id: embedded + 1, external_file: Some(file) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_is_clamped_to_three_to_ten_seconds_inside_the_file() {
        assert_eq!(clamp_range(100.0, 105.0, 1400.0), (100.0, 105.0));
        assert_eq!(clamp_range(100.0, 101.0, 1400.0), (100.0, 103.0));
        assert_eq!(clamp_range(100.0, 130.0, 1400.0), (100.0, 110.0));
        assert_eq!(clamp_range(100.0, 90.0, 1400.0), (100.0, 103.0));
        assert_eq!(clamp_range(-4.0, 2.0, 1400.0), (0.0, 3.0));
        // Near the end the start moves back so the clip keeps its length.
        assert_eq!(clamp_range(1398.0, 1403.0, 1400.0), (1395.0, 1400.0));
        // A file shorter than the minimum yields the whole file.
        assert_eq!(clamp_range(0.0, 5.0, 2.0), (0.0, 2.0));
        assert_eq!(clamp_range(f64::NAN, f64::NAN, 100.0), (0.0, 3.0));
    }

    #[test]
    fn bitrate_keeps_ten_second_clips_under_the_limit() {
        // 10 s at 480p: the budget (≈ 6.9 Mbit/s) is above the 480p ceiling.
        assert_eq!(video_bitrate_kbps(10.0, AUDIO_KBPS, ClipSize::P480), 2_500);
        assert_eq!(video_bitrate_kbps(10.0, AUDIO_KBPS, ClipSize::P720), 5_000);
        // The raw budget for any duration fits: (v + a) · t ≤ target.
        for secs in [3.0, 5.0, 10.0, 60.0, 600.0] {
            let video = video_bitrate_kbps(secs, AUDIO_KBPS, ClipSize::P720);
            let bytes = f64::from(video + AUDIO_KBPS) * 1000.0 / 8.0 * secs;
            assert!(bytes <= TARGET_BYTES as f64 || video == 300, "{secs}s -> {video} kbps");
        }
        // Long durations hit the budget, not the ceiling; floor at 300 kbps.
        assert_eq!(video_bitrate_kbps(60.0, AUDIO_KBPS, ClipSize::P720), 1_045);
        assert_eq!(video_bitrate_kbps(3_600.0, AUDIO_KBPS, ClipSize::P720), 300);
    }

    #[test]
    fn file_names_are_sanitised_and_carry_episode_and_time() {
        assert_eq!(clip_file_name("Black Jack", "E3", 83.9, ClipCodec::H264Mp4), "Black Jack - E3 - 01-23.mp4");
        assert_eq!(clip_file_name("Re:Zero / Part?", "E12.5", 3725.0, ClipCodec::Gif), "Re_Zero _ Part_ - E12.5 - 1-02-05.gif");
        assert_eq!(clip_file_name("A", "E1", 5.0, ClipCodec::Vp9Webm), "A - E1 - 00-05.webm");
        assert_eq!(clip_file_name("   ", "S01E03", 0.0, ClipCodec::H264Mp4), "Obra - S01E03 - 00-00.mp4");
        assert_eq!(episode_part(Some(7.0), "S01E07"), "E7");
        assert_eq!(episode_part(Some(12.5), "x"), "E12.5");
        assert_eq!(episode_part(None, "S01E03"), "S01E03");
        assert_eq!(episode_part(Some(0.0), "M01"), "M01");
        let long = "a".repeat(300);
        assert!(clip_file_name(&long, "E1", 0.0, ClipCodec::H264Mp4).len() < 130);
    }

    #[test]
    fn taken_names_get_a_numeric_suffix() {
        let dir = std::env::temp_dir().join(format!("metadea-clip-names-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(available_path(&dir, "a.mp4"), dir.join("a.mp4"));
        std::fs::write(dir.join("a.mp4"), b"x").unwrap();
        assert_eq!(available_path(&dir, "a.mp4"), dir.join("a-2.mp4"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn job(codec: ClipCodec, audio: Option<i64>, subtitle: Option<SubtitleSource>) -> ClipJob {
        ClipJob {
            source: "C:/v/a.mkv".into(),
            output: PathBuf::from("C:/out/a.mp4"),
            start: 10.0,
            end: 15.0,
            codec,
            size: ClipSize::P480,
            audio_id: audio,
            subtitle,
            sub_delay: 0.0,
        }
    }

    fn get<'a>(options: &'a [(String, String)], name: &str) -> Option<&'a str> {
        options.iter().rev().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
    }

    #[test]
    fn mp4_options_encode_h264_aac_with_burned_subtitles() {
        let options = encoding_options(&job(ClipCodec::H264Mp4, Some(2), Some(SubtitleSource { id: 3, external_file: None })));
        assert_eq!(get(&options, "o"), Some("C:/out/a.mp4"));
        assert_eq!(get(&options, "ovc"), Some("h264_mf"));
        assert_eq!(get(&options, "of"), Some("mp4"));
        assert_eq!(get(&options, "oac"), Some("aac"));
        assert_eq!(get(&options, "aid"), Some("2"));
        assert_eq!(get(&options, "sid"), Some("3"));
        assert_eq!(get(&options, "start"), Some("10.000"));
        assert_eq!(get(&options, "end"), Some("15.000"));
        assert!(get(&options, "vf").unwrap().contains("h=480"));
        assert!(get(&options, "ovcopts").unwrap().contains("b=2500k"));
    }

    #[test]
    fn mp4_falls_back_to_vp9_webm() {
        assert_eq!(ClipCodec::attempts(ClipFormat::Mp4), &[ClipCodec::H264Mp4, ClipCodec::Vp9Webm]);
        assert_eq!(ClipCodec::attempts(ClipFormat::Gif), &[ClipCodec::Gif]);
        let options = encoding_options(&job(ClipCodec::Vp9Webm, None, None));
        assert_eq!(get(&options, "ovc"), Some("libvpx-vp9"));
        assert_eq!(get(&options, "of"), Some("webm"));
        assert_eq!(get(&options, "aid"), Some("no"));
        assert!(get(&options, "oac").is_none());
    }

    #[test]
    fn gif_options_use_a_palette_and_no_audio() {
        let options = encoding_options(&job(ClipCodec::Gif, Some(1), None));
        assert_eq!(get(&options, "of"), Some("gif"));
        assert_eq!(get(&options, "aid"), Some("no"));
        assert_eq!(get(&options, "sid"), Some("no"));
        assert!(get(&options, "vf").unwrap().contains("palettegen"));
        assert!(get(&options, "oac").is_none());
    }

    #[test]
    fn selected_subtitles_map_to_the_fresh_handle() {
        let embedded = r#"[{"id":1,"type":"video"},{"id":1,"type":"sub","selected":false},{"id":2,"type":"sub","selected":true}]"#;
        assert_eq!(subtitle_source(embedded), Some(SubtitleSource { id: 2, external_file: None }));
        let external = r#"[{"id":1,"type":"sub"},{"id":2,"type":"sub"},{"id":3,"type":"sub","selected":true,"external":true,"external-filename":"C:/v/a.es.ass"}]"#;
        assert_eq!(subtitle_source(external), Some(SubtitleSource { id: 3, external_file: Some("C:/v/a.es.ass".into()) }));
        assert_eq!(subtitle_source(r#"[{"id":1,"type":"sub"}]"#), None);
        assert_eq!(subtitle_source("nonsense"), None);
    }
}
