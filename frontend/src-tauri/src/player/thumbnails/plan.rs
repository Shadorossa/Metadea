// Which frames a seek-bar sprite holds and where each one sits. Pure math,
// mirrored on the frontend by lib/player/seek-preview.ts (tile position,
// frame index for a hover time).
//
// Frame `i` stands for the span [i·interval, (i+1)·interval) of the video
// and is captured at the middle of it, so hovering anywhere in that span
// shows a frame from inside it.

/// Width of one generated tile, in pixels (displayed at ~200 CSS px).
pub const TILE_WIDTH: u32 = 240;
/// Upper bound on frames per video; longer videos get a longer interval.
pub const MAX_FRAMES: u32 = 200;
/// Interval for anything up to MAX_FRAMES × this (≈ 33 min).
pub const BASE_INTERVAL_SECS: f64 = 10.0;
/// Tiles per sprite sheet: 10 × 10, so ≤ 2 sheets per video.
pub const SHEET_COLUMNS: u32 = 10;
pub const SHEET_ROWS: u32 = 10;

/// Seconds between frames: 10 s up to ~33 min, then whatever keeps the
/// count at MAX_FRAMES, rounded up to a whole second.
pub fn interval_for(duration_secs: f64) -> f64 {
    if !duration_secs.is_finite() || duration_secs <= 0.0 {
        return BASE_INTERVAL_SECS;
    }
    (duration_secs / f64::from(MAX_FRAMES)).ceil().max(BASE_INTERVAL_SECS)
}

pub fn frame_count(duration_secs: f64, interval_secs: f64) -> u32 {
    if !duration_secs.is_finite() || duration_secs <= 0.0 || interval_secs <= 0.0 {
        return 0;
    }
    ((duration_secs / interval_secs).ceil() as u32).clamp(1, MAX_FRAMES)
}

/// Where frame `index` is captured: the middle of its span, kept just
/// inside the end of the file.
pub fn capture_time(index: u32, interval_secs: f64, duration_secs: f64) -> f64 {
    let middle = f64::from(index) * interval_secs + interval_secs / 2.0;
    middle.min((duration_secs - 0.5).max(0.0))
}

/// Coarse-to-fine order (0, n/2, n/4, 3n/4, …): after a handful of frames
/// every part of the bar already has a nearby one to show.
pub fn generation_order(count: u32) -> Vec<u32> {
    let count = count as usize;
    let mut seen = vec![false; count];
    let mut order = Vec::with_capacity(count);
    let mut step = count.next_power_of_two().max(1);
    while step >= 1 {
        for index in (0..count).step_by(step) {
            if !seen[index] {
                seen[index] = true;
                order.push(index as u32);
            }
        }
        step /= 2;
    }
    order
}

/// Tile height for a video shown at `display_width`×`display_height`
/// (display aspect, anamorphic already applied), even and sane.
pub fn tile_height(display_width: i64, display_height: i64) -> u32 {
    let (display_width, display_height) =
        if display_width <= 0 || display_height <= 0 { (16, 9) } else { (display_width, display_height) };
    let height = (f64::from(TILE_WIDTH) * display_height as f64 / display_width as f64).round() as u32;
    (height.clamp(60, 480) + 1) & !1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TilePosition {
    pub sheet: u32,
    pub column: u32,
    pub row: u32,
}

pub fn tile_position(index: u32) -> TilePosition {
    let per_sheet = SHEET_COLUMNS * SHEET_ROWS;
    let within = index % per_sheet;
    TilePosition { sheet: index / per_sheet, column: within % SHEET_COLUMNS, row: within / SHEET_COLUMNS }
}

pub fn sheet_count(frame_count: u32) -> u32 {
    frame_count.div_ceil(SHEET_COLUMNS * SHEET_ROWS)
}

/// Rows actually used by `sheet` (the last one may be partial).
pub fn rows_in_sheet(sheet: u32, frame_count: u32) -> u32 {
    let per_sheet = SHEET_COLUMNS * SHEET_ROWS;
    let in_sheet = frame_count.saturating_sub(sheet * per_sheet).min(per_sheet);
    in_sheet.div_ceil(SHEET_COLUMNS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_is_ten_seconds_up_to_half_an_hour_then_caps_the_count() {
        assert_eq!(interval_for(24.0 * 60.0), 10.0);
        assert_eq!(interval_for(30.0 * 60.0), 10.0);
        assert_eq!(interval_for(2.0 * 3600.0), 36.0);
        assert_eq!(interval_for(0.0), 10.0);
        assert_eq!(interval_for(f64::NAN), 10.0);
        for duration in [60.0, 1440.0, 1800.0, 2400.0, 5400.0, 10_000.0, 36_000.0] {
            assert!(frame_count(duration, interval_for(duration)) <= MAX_FRAMES, "{duration}");
        }
        assert_eq!(frame_count(1440.0, 10.0), 144);
        assert_eq!(frame_count(1445.0, 10.0), 145);
        assert_eq!(frame_count(3.0, 10.0), 1);
        assert_eq!(frame_count(0.0, 10.0), 0);
    }

    #[test]
    fn capture_time_is_the_middle_of_the_span_but_inside_the_file() {
        assert_eq!(capture_time(0, 10.0, 100.0), 5.0);
        assert_eq!(capture_time(3, 10.0, 100.0), 35.0);
        assert_eq!(capture_time(9, 10.0, 92.0), 91.5);
        assert_eq!(capture_time(0, 10.0, 0.2), 0.0);
    }

    #[test]
    fn generation_order_is_coarse_to_fine_and_covers_every_frame_once() {
        assert_eq!(generation_order(8), vec![0, 4, 2, 6, 1, 3, 5, 7]);
        assert_eq!(generation_order(1), vec![0]);
        assert!(generation_order(0).is_empty());
        for count in [5, 144, 200] {
            let mut order = generation_order(count);
            assert_eq!(order.len(), count as usize);
            order.sort_unstable();
            order.dedup();
            assert_eq!(order.len(), count as usize);
        }
        let order = generation_order(144);
        assert_eq!(&order[..3], &[0, 128, 64]);
    }

    #[test]
    fn tile_height_follows_the_display_aspect() {
        assert_eq!(tile_height(1920, 1080), 136);
        assert_eq!(tile_height(1280, 720), 136);
        assert_eq!(tile_height(1440, 1080), 180);
        assert_eq!(tile_height(1080, 1920), 428);
        assert_eq!(tile_height(0, 0), 136);
        assert_eq!(tile_height(10_000, 10), 60);
    }

    #[test]
    fn tiles_fill_sheets_row_by_row() {
        assert_eq!(tile_position(0), TilePosition { sheet: 0, column: 0, row: 0 });
        assert_eq!(tile_position(13), TilePosition { sheet: 0, column: 3, row: 1 });
        assert_eq!(tile_position(99), TilePosition { sheet: 0, column: 9, row: 9 });
        assert_eq!(tile_position(100), TilePosition { sheet: 1, column: 0, row: 0 });
        assert_eq!(tile_position(143), TilePosition { sheet: 1, column: 3, row: 4 });
        assert_eq!(sheet_count(144), 2);
        assert_eq!(sheet_count(100), 1);
        assert_eq!(rows_in_sheet(0, 144), 10);
        assert_eq!(rows_in_sheet(1, 144), 5);
        assert_eq!(rows_in_sheet(2, 144), 0);
    }
}
