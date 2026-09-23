// Game IDs read straight from ROM/disc-image headers, with small bounded
// reads (a few hundred bytes at fixed offsets) — never a whole file, since a
// Switch dump can be tens of gigabytes. Formats, and where the ID lives:
//
// - GameCube / Wii disc image (.iso/.gcm): ID6 at 0x00, title at 0x20,
//   GameCube magic 0xC2339F3D at 0x1C or Wii magic 0x5D1C9EA3 at 0x18.
// - RVZ / WIA (Dolphin's compressed disc format): "RVZ\x01" / "WIA\x01" at
//   0x00; the first 0x80 bytes of the original disc (the same header as
//   above) sit at 0x58 (header_1 is 0x48 bytes, header_2 starts with
//   disc_type/compression_type/compression_level/chunk_size = 0x10 bytes).
// - Nintendo DS (.nds): 12-byte title at 0x00, 4-byte game code at 0x0C.
// - Nintendo 3DS cartridge dump (.3ds/.cci, NCSD): "NCSD" at 0x100, first
//   partition offset (media units of 0x200) at 0x120; inside that NCCH,
//   "NCCH" at +0x100 and the 16-byte product code ("CTR-P-AXCE") at +0x150.
//
// Not parsed here, by design: Switch NSP/XCI (the title id comes from the
// file name — PFS0/HFS0 parsing is out of scope), 3DS .cia containers, and
// PS2 serials (SYSTEM.CNF inside the ISO is out of scope; the SLUS-xxxxx
// serial is taken from the file name by the frontend parser).
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct RomHeader {
    pub game_id: String,
    pub title: Option<String>,
    pub format: &'static str,
}

const GC_MAGIC: u32 = 0xC233_9F3D;
const WII_MAGIC: u32 = 0x5D1C_9EA3;
const DISC_HEADER_LEN: usize = 0x60;
const WIA_DISC_HEADER_OFFSET: u64 = 0x58;
const NCSD_MEDIA_UNIT: u64 = 0x200;
const NCCH_PRODUCT_CODE_OFFSET: u64 = 0x150;

pub fn read_rom_header(path: &Path) -> Option<RomHeader> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let mut file = File::open(path).ok()?;
    match ext.as_str() {
        "iso" | "gcm" => parse_gc_wii_disc(&read_at(&mut file, 0, DISC_HEADER_LEN)?),
        "rvz" | "wia" => {
            let magic = read_at(&mut file, 0, 4)?;
            if &magic[..] != b"RVZ\x01" && &magic[..] != b"WIA\x01" {
                return None;
            }
            parse_gc_wii_disc(&read_at(&mut file, WIA_DISC_HEADER_OFFSET, DISC_HEADER_LEN)?)
        }
        "nds" => parse_nds(&read_at(&mut file, 0, 0x10)?),
        "3ds" | "cci" => {
            let ncsd = read_at(&mut file, 0x100, 0x24)?;
            if &ncsd[..4] != b"NCSD" {
                return None;
            }
            let partition_offset = u32::from_le_bytes([ncsd[0x20], ncsd[0x21], ncsd[0x22], ncsd[0x23]]) as u64 * NCSD_MEDIA_UNIT;
            let ncch_magic = read_at(&mut file, partition_offset + 0x100, 4)?;
            if &ncch_magic[..] != b"NCCH" {
                return None;
            }
            parse_ncch_product_code(&read_at(&mut file, partition_offset + NCCH_PRODUCT_CODE_OFFSET, 16)?)
        }
        _ => None,
    }
}

fn read_at(file: &mut File, offset: u64, len: usize) -> Option<Vec<u8>> {
    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf).ok()?;
    Some(buf)
}

fn ascii_field(bytes: &[u8]) -> Option<String> {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    let text = std::str::from_utf8(&bytes[..end]).ok()?.trim();
    if text.is_empty() { None } else { Some(text.to_string()) }
}

fn is_game_code(bytes: &[u8]) -> bool {
    !bytes.is_empty() && bytes.iter().all(|b| b.is_ascii_alphanumeric())
}

// The first 0x60 bytes of a GameCube/Wii disc.
pub fn parse_gc_wii_disc(head: &[u8]) -> Option<RomHeader> {
    if head.len() < DISC_HEADER_LEN {
        return None;
    }
    let wii = u32::from_be_bytes([head[0x18], head[0x19], head[0x1A], head[0x1B]]) == WII_MAGIC;
    let gc = u32::from_be_bytes([head[0x1C], head[0x1D], head[0x1E], head[0x1F]]) == GC_MAGIC;
    if !wii && !gc {
        return None;
    }
    if !is_game_code(&head[..6]) {
        return None;
    }
    Some(RomHeader {
        game_id: String::from_utf8_lossy(&head[..6]).to_string(),
        title: ascii_field(&head[0x20..0x60]),
        format: if wii { "wii" } else { "gamecube" },
    })
}

// The first 0x10 bytes of a Nintendo DS ROM.
pub fn parse_nds(head: &[u8]) -> Option<RomHeader> {
    if head.len() < 0x10 || !is_game_code(&head[0x0C..0x10]) {
        return None;
    }
    Some(RomHeader {
        game_id: String::from_utf8_lossy(&head[0x0C..0x10]).to_string(),
        title: ascii_field(&head[..0x0C]),
        format: "nds",
    })
}

// The 16-byte product code field of an NCCH ("CTR-P-AXCE").
pub fn parse_ncch_product_code(field: &[u8]) -> Option<RomHeader> {
    let code = ascii_field(field)?;
    if !code.starts_with("CTR-") && !code.starts_with("KTR-") {
        return None;
    }
    Some(RomHeader { game_id: code, title: None, format: "3ds" })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disc_header(id: &[u8; 6], title: &str, magic_offset: usize, magic: u32) -> Vec<u8> {
        let mut head = vec![0u8; DISC_HEADER_LEN];
        head[..6].copy_from_slice(id);
        head[magic_offset..magic_offset + 4].copy_from_slice(&magic.to_be_bytes());
        head[0x20..0x20 + title.len()].copy_from_slice(title.as_bytes());
        head
    }

    #[test]
    fn gamecube_disc_header_yields_id6_and_title() {
        let head = disc_header(b"GZ2E01", "THE LEGEND OF ZELDA TWILIGHT PRINCESS", 0x1C, GC_MAGIC);
        assert_eq!(
            parse_gc_wii_disc(&head),
            Some(RomHeader { game_id: "GZ2E01".into(), title: Some("THE LEGEND OF ZELDA TWILIGHT PRINCESS".into()), format: "gamecube" })
        );
    }

    #[test]
    fn wii_disc_header_is_told_apart_by_its_magic() {
        let head = disc_header(b"RFEP01", "FIRE EMBLEM", 0x18, WII_MAGIC);
        let parsed = parse_gc_wii_disc(&head).unwrap();
        assert_eq!(parsed.format, "wii");
        assert_eq!(parsed.game_id, "RFEP01");
    }

    #[test]
    fn a_ps2_iso_has_no_nintendo_magic_and_is_skipped() {
        let head = vec![0u8; DISC_HEADER_LEN];
        assert_eq!(parse_gc_wii_disc(&head), None);
        let mut garbage = disc_header(b"\x00\x01ABCD", "X", 0x1C, GC_MAGIC);
        garbage[0] = 0;
        assert_eq!(parse_gc_wii_disc(&garbage), None);
    }

    #[test]
    fn nds_header_yields_game_code_and_title() {
        let mut head = vec![0u8; 0x10];
        head[..6].copy_from_slice(b"LAYTON");
        head[0x0C..0x10].copy_from_slice(b"BLFS");
        assert_eq!(parse_nds(&head), Some(RomHeader { game_id: "BLFS".into(), title: Some("LAYTON".into()), format: "nds" }));
        assert_eq!(parse_nds(&[0u8; 0x10]), None);
    }

    #[test]
    fn ncch_product_code_is_validated() {
        let mut field = vec![0u8; 16];
        field[..10].copy_from_slice(b"CTR-P-AXCE");
        assert_eq!(parse_ncch_product_code(&field).unwrap().game_id, "CTR-P-AXCE");
        assert_eq!(parse_ncch_product_code(b"garbage\0\0\0\0\0\0\0\0\0"), None);
    }

    fn temp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("metadea-rom-header-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn rvz_file_reads_the_disc_header_at_0x58() {
        let mut bytes = vec![0u8; WIA_DISC_HEADER_OFFSET as usize];
        bytes[..4].copy_from_slice(b"RVZ\x01");
        bytes.extend(disc_header(b"RFEP01", "FIRE EMBLEM RADIANT DAWN", 0x18, WII_MAGIC));
        let path = temp_file("game.rvz", &bytes);
        let parsed = read_rom_header(&path).unwrap();
        assert_eq!((parsed.game_id.as_str(), parsed.format), ("RFEP01", "wii"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn ncsd_file_follows_the_first_partition_to_its_product_code() {
        let partition_units: u32 = 2; // partition 0 at 0x400
        let mut bytes = vec![0u8; 0x400 + 0x200];
        bytes[0x100..0x104].copy_from_slice(b"NCSD");
        bytes[0x120..0x124].copy_from_slice(&partition_units.to_le_bytes());
        bytes[0x400 + 0x100..0x400 + 0x104].copy_from_slice(b"NCCH");
        bytes[0x400 + 0x150..0x400 + 0x15A].copy_from_slice(b"CTR-P-AXCE");
        let path = temp_file("game.3ds", &bytes);
        assert_eq!(read_rom_header(&path).unwrap().game_id, "CTR-P-AXCE");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_truncated_file_yields_nothing_instead_of_an_error() {
        let path = temp_file("tiny.nds", b"abc");
        assert_eq!(read_rom_header(&path), None);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
