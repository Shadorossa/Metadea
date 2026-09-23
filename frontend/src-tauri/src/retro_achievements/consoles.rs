//! Fixed mapping from the platforms Metadea knows (IGDB platform ids, and
//! the `emulator_configs.platform_id` strings the ROM scanner tags a ROM
//! with) to RetroAchievements console ids. RA console ids are the same
//! numbering rcheevos uses for `rc_hash` (`RC_CONSOLE_*`), so one id serves
//! both the API calls and the hasher.
//!
//! `None` means RA has no achievement set for that system (3DS, Wii, Wii U,
//! Switch, PS3+, Xbox and later, PC) — the UI then hides the panel.

/// IGDB platform id -> RA console id.
pub fn ra_console_for_igdb_platform(igdb_platform_id: i64) -> Option<u32> {
    let id = match igdb_platform_id {
        18 => 7,   // NES / Famicom
        19 => 3,   // SNES / Super Famicom
        4 => 2,    // Nintendo 64
        21 => 16,  // GameCube
        20 => 18,  // Nintendo DS
        159 => 78, // Nintendo DSi
        33 => 4,   // Game Boy
        22 => 6,   // Game Boy Color
        24 => 5,   // Game Boy Advance
        87 => 28,  // Virtual Boy
        307 => 24, // Pokémon Mini
        7 => 12,   // PlayStation
        8 => 21,   // PlayStation 2
        38 => 41,  // PlayStation Portable
        29 => 1,   // Mega Drive / Genesis
        64 => 11,  // Master System
        35 => 15,  // Game Gear
        78 => 9,   // Sega CD / Mega-CD
        30 => 10,  // Sega 32X
        32 => 39,  // Saturn
        23 => 40,  // Dreamcast
        84 => 33,  // SG-1000
        86 => 8,   // TurboGrafx-16 / PC Engine
        150 => 76, // TurboGrafx-CD / PC Engine CD
        274 => 49, // PC-FX
        59 => 25,  // Atari 2600
        66 => 50,  // Atari 5200
        60 => 51,  // Atari 7800
        61 => 13,  // Atari Lynx
        62 => 17,  // Atari Jaguar
        410 => 77, // Atari Jaguar CD
        63 => 36,  // Atari ST
        119 => 14, // Neo Geo Pocket
        120 => 14, // Neo Geo Pocket Color (shares the NGP set)
        136 => 56, // Neo Geo CD
        57 => 53,  // WonderSwan
        123 => 53, // WonderSwan Color (shares the WonderSwan set)
        68 => 44,  // ColecoVision
        67 => 45,  // Intellivision
        70 => 46,  // Vectrex
        133 => 23, // Magnavox Odyssey 2
        127 => 57, // Fairchild Channel F
        52 => 27,  // Arcade
        50 => 43,  // 3DO
        117 => 42, // Philips CD-i
        27 => 29,  // MSX
        53 => 29,  // MSX2 (shares the MSX set)
        15 => 30,  // Commodore 64
        26 => 59,  // ZX Spectrum
        75 => 38,  // Apple II
        121 => 35, // Amiga
        13 => 26,  // MS-DOS
        125 => 47, // PC-8800
        149 => 48, // PC-9800
        // 3DS (37), Wii (5), Wii U (41), Switch (130), PS3 (9), PS4 (48),
        // Xbox 360 (12), PC (6), Amstrad CPC (122): no RA set.
        _ => return None,
    };
    Some(id)
}

/// `emulator_configs.platform_id` (the ROM scanner's `rom_platform`) -> RA
/// console id. Mirrors lib/local/emulator-catalog.ts's ids.
pub fn ra_console_for_rom_platform(rom_platform: &str) -> Option<u32> {
    match rom_platform.trim().to_ascii_lowercase().as_str() {
        "nes" | "famicom" => Some(7),
        "snes" | "sfc" => Some(3),
        "n64" => Some(2),
        "gamecube" | "gc" | "ngc" => Some(16),
        "ds" | "nds" => Some(18),
        "dsi" => Some(78),
        "gb" => Some(4),
        "gbc" => Some(6),
        "gba" => Some(5),
        "vb" | "virtualboy" => Some(28),
        "ps1" | "psx" => Some(12),
        "ps2" => Some(21),
        "psp" => Some(41),
        "genesis" | "megadrive" | "md" => Some(1),
        "sms" | "mastersystem" => Some(11),
        "gg" | "gamegear" => Some(15),
        "segacd" | "megacd" => Some(9),
        "32x" => Some(10),
        "saturn" => Some(39),
        "dreamcast" | "dc" => Some(40),
        "pce" | "tg16" | "pcengine" => Some(8),
        "pcecd" | "tgcd" => Some(76),
        "atari2600" => Some(25),
        "atari5200" => Some(50),
        "atari7800" => Some(51),
        "lynx" => Some(13),
        "jaguar" => Some(17),
        "ngp" | "ngpc" => Some(14),
        "wonderswan" | "ws" | "wsc" => Some(53),
        "arcade" | "mame" | "fbneo" => Some(27),
        "3do" => Some(43),
        "msx" => Some(29),
        "c64" => Some(30),
        "amiga" => Some(35),
        "dos" | "msdos" => Some(26),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn igdb_ids_from_the_spec_map_to_the_expected_ra_consoles() {
        let expected = [
            (20, Some(18)), (21, Some(16)), (7, Some(12)), (8, Some(21)), (38, Some(41)),
            (24, Some(5)), (33, Some(4)), (22, Some(6)), (19, Some(3)), (18, Some(7)),
            (4, Some(2)), (29, Some(1)), (64, Some(11)), (35, Some(15)), (32, Some(39)),
            (23, Some(40)), (119, Some(14)), (59, Some(25)),
        ];
        for (igdb, ra) in expected {
            assert_eq!(ra_console_for_igdb_platform(igdb), ra, "igdb platform {igdb}");
        }
    }

    #[test]
    fn systems_without_an_ra_set_map_to_none() {
        // 3DS, Wii, Wii U, Switch, PS3, PS4, Xbox 360, PC, Amstrad CPC.
        for igdb in [37, 5, 41, 130, 9, 48, 12, 6, 122, -1, 0] {
            assert_eq!(ra_console_for_igdb_platform(igdb), None, "igdb platform {igdb}");
        }
    }

    #[test]
    fn rom_platform_ids_match_the_igdb_mapping() {
        assert_eq!(ra_console_for_rom_platform("ds"), ra_console_for_igdb_platform(20));
        assert_eq!(ra_console_for_rom_platform("gamecube"), ra_console_for_igdb_platform(21));
        assert_eq!(ra_console_for_rom_platform("PS2"), ra_console_for_igdb_platform(8));
        assert_eq!(ra_console_for_rom_platform("psp"), Some(41));
        assert_eq!(ra_console_for_rom_platform("3ds"), None);
        assert_eq!(ra_console_for_rom_platform("wii"), None);
        assert_eq!(ra_console_for_rom_platform("switch"), None);
        assert_eq!(ra_console_for_rom_platform(""), None);
    }
}
