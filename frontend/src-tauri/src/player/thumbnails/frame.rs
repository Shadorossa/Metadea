// Turning a `screenshot-raw` frame into a tile: pixel-format conversion,
// a resize when mpv's own scale filter did not already produce the tile
// size, JPEG encoding and sprite-sheet composition. No mpv here, so it is
// all unit-tested with synthetic frames.

use base64::Engine as _;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::{self, FilterType};
use image::{Rgb, RgbImage};

use super::super::libmpv_ffi::RawFrame;
use super::plan::{rows_in_sheet, tile_position, SHEET_COLUMNS};

/// Single tiles travel as data URLs in events; sheets are what the cache
/// keeps. Both are small enough that quality ~75 is visually clean.
const TILE_JPEG_QUALITY: u8 = 72;
const SHEET_JPEG_QUALITY: u8 = 75;

/// Byte offsets of R, G, B inside one 4-byte pixel for the packed formats
/// `screenshot-raw` produces (`bgr0` is the default).
fn channel_offsets(format: &str) -> Option<(usize, usize, usize)> {
    match format {
        "bgr0" | "bgra" => Some((2, 1, 0)),
        "rgb0" | "rgba" => Some((0, 1, 2)),
        "0rgb" | "argb" => Some((1, 2, 3)),
        "0bgr" | "abgr" => Some((3, 2, 1)),
        _ => None,
    }
}

/// RGB tile of exactly `tile_width`×`tile_height`.
pub fn frame_to_tile(frame: &RawFrame, tile_width: u32, tile_height: u32) -> Option<RgbImage> {
    let (r, g, b) = channel_offsets(&frame.format)?;
    let mut rgb = RgbImage::new(frame.width, frame.height);
    for (y, row) in frame.data.chunks(frame.stride).take(frame.height as usize).enumerate() {
        for x in 0..frame.width as usize {
            let pixel = &row[x * 4..x * 4 + 4];
            rgb.put_pixel(x as u32, y as u32, Rgb([pixel[r], pixel[g], pixel[b]]));
        }
    }
    if rgb.width() == tile_width && rgb.height() == tile_height {
        Some(rgb)
    } else {
        Some(imageops::resize(&rgb, tile_width, tile_height, FilterType::Triangle))
    }
}

pub fn encode_jpeg(image: &RgbImage, quality: u8) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, quality).encode_image(image).ok()?;
    Some(bytes)
}

pub fn tile_data_url(tile: &RgbImage) -> Option<String> {
    let bytes = encode_jpeg(tile, TILE_JPEG_QUALITY)?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Lays `tiles` (index = frame index; `None` = not decoded) out on sheets
/// of SHEET_COLUMNS × SHEET_ROWS and encodes each one.
pub fn compose_sheets(tiles: &[Option<RgbImage>], tile_width: u32, tile_height: u32) -> Option<Vec<Vec<u8>>> {
    let count = tiles.len() as u32;
    let sheets = super::plan::sheet_count(count);
    let mut images: Vec<RgbImage> = (0..sheets)
        .map(|sheet| RgbImage::new(SHEET_COLUMNS * tile_width, rows_in_sheet(sheet, count).max(1) * tile_height))
        .collect();
    for (index, tile) in tiles.iter().enumerate() {
        let Some(tile) = tile else { continue };
        let position = tile_position(index as u32);
        let sheet = images.get_mut(position.sheet as usize)?;
        imageops::replace(sheet, tile, i64::from(position.column * tile_width), i64::from(position.row * tile_height));
    }
    images.iter().map(|image| encode_jpeg(image, SHEET_JPEG_QUALITY)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_frame(width: u32, height: u32, stride_pad: usize, format: &str, bgr: [u8; 3]) -> RawFrame {
        let stride = width as usize * 4 + stride_pad;
        let mut data = vec![0u8; stride * height as usize];
        for y in 0..height as usize {
            for x in 0..width as usize {
                let at = y * stride + x * 4;
                data[at..at + 4].copy_from_slice(&[bgr[0], bgr[1], bgr[2], 255]);
            }
        }
        RawFrame { width, height, stride, format: format.into(), data }
    }

    #[test]
    fn bgr0_is_converted_to_rgb_and_padding_is_ignored() {
        let frame = solid_frame(4, 2, 8, "bgr0", [10, 20, 30]);
        let tile = frame_to_tile(&frame, 4, 2).unwrap();
        assert_eq!(tile.get_pixel(3, 1), &Rgb([30, 20, 10]));
    }

    #[test]
    fn a_frame_of_the_wrong_size_is_resized_to_the_tile() {
        let frame = solid_frame(480, 270, 0, "rgb0", [200, 100, 50]);
        let tile = frame_to_tile(&frame, 240, 136).unwrap();
        assert_eq!(tile.dimensions(), (240, 136));
        assert_eq!(tile.get_pixel(120, 60), &Rgb([200, 100, 50]));
    }

    #[test]
    fn unknown_formats_are_rejected() {
        assert!(frame_to_tile(&solid_frame(2, 2, 0, "yuv420p", [0, 0, 0]), 2, 2).is_none());
    }

    #[test]
    fn tiles_encode_as_jpeg_data_urls() {
        let url = tile_data_url(&RgbImage::new(24, 14)).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,/9j/"));
    }

    #[test]
    fn sheets_hold_ten_by_ten_tiles_and_the_last_one_is_cropped() {
        let tiles: Vec<Option<RgbImage>> =
            (0..144).map(|index| (index % 7 != 0).then(|| RgbImage::from_pixel(8, 6, Rgb([255, 0, 0])))).collect();
        let sheets = compose_sheets(&tiles, 8, 6).unwrap();
        assert_eq!(sheets.len(), 2);
        let first = image::load_from_memory(&sheets[0]).unwrap();
        let second = image::load_from_memory(&sheets[1]).unwrap();
        assert_eq!((first.width(), first.height()), (80, 60));
        assert_eq!((second.width(), second.height()), (80, 30));
    }
}
