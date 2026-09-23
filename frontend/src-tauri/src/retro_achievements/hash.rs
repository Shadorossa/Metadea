//! ROM hashing for RetroAchievements. RA identifies a game by a hash that is
//! specific to each system (rcheevos' `rc_hash`: a DS ROM hashes its header
//! plus the ARM code blocks and icon, a PS2 disc hashes the boot executable,
//! …), so a plain MD5 of the file would produce ids that silently match
//! nothing. The only implementation is therefore the vendored rcheevos
//! library (`cfg(rcheevos_vendored)`, wired by build.rs); without it the
//! hasher reports itself unavailable instead of guessing.

use crate::error_codes;

pub trait RomHasher: Send + Sync {
    /// True when this build can produce real RA hashes.
    fn is_available(&self) -> bool;
    /// The 32-hex-char RA hash for `rom_path` on `console_id` (an RA / rcheevos
    /// console id, see consoles.rs). Errors are `E_*` codes.
    fn hash_rom(&self, rom_path: &str, console_id: u32) -> Result<String, String>;
}

/// The hasher this build ships with.
pub fn default_hasher() -> &'static dyn RomHasher {
    #[cfg(rcheevos_vendored)]
    {
        &rcheevos::RcHashHasher
    }
    #[cfg(not(rcheevos_vendored))]
    {
        &UnavailableHasher
    }
}

/// Stand-in for builds without the vendored rcheevos tree.
#[cfg_attr(rcheevos_vendored, allow(dead_code))]
pub struct UnavailableHasher;

impl RomHasher for UnavailableHasher {
    fn is_available(&self) -> bool {
        false
    }

    fn hash_rom(&self, _rom_path: &str, _console_id: u32) -> Result<String, String> {
        Err(error_codes::RA_HASH_UNAVAILABLE.to_string())
    }
}

#[cfg(rcheevos_vendored)]
mod rcheevos {
    use super::RomHasher;
    use crate::error_codes;
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int};

    unsafe extern "C" {
        // rc_hash.h: `int rc_hash_generate_from_file(char hash[33], uint32_t
        // console_id, const char* path)`. Returns non-zero when `hash` was
        // written (32 hex chars + NUL). The path is UTF-8; rcheevos' Windows
        // file reader converts it to a wide path itself.
        fn rc_hash_generate_from_file(hash: *mut c_char, console_id: u32, path: *const c_char) -> c_int;
    }

    pub struct RcHashHasher;

    impl RomHasher for RcHashHasher {
        fn is_available(&self) -> bool {
            true
        }

        fn hash_rom(&self, rom_path: &str, console_id: u32) -> Result<String, String> {
            let path = CString::new(rom_path)
                .map_err(|_| error_codes::with_detail(error_codes::RA_HASH_FAILED, "path contains NUL"))?;
            let mut hash = [0u8; 33];
            // SAFETY: `hash` is a 33-byte buffer, exactly what the C signature
            // documents (32 hex chars plus the terminating NUL); `path` is a
            // valid NUL-terminated string that outlives the call; rc_hash only
            // reads the path and only writes within `hash`.
            let generated = unsafe { rc_hash_generate_from_file(hash.as_mut_ptr() as *mut c_char, console_id, path.as_ptr()) };
            if generated == 0 {
                return Err(error_codes::RA_HASH_FAILED.to_string());
            }
            let len = hash.iter().position(|&b| b == 0).unwrap_or(hash.len());
            let text = std::str::from_utf8(&hash[..len])
                .map_err(|_| error_codes::with_detail(error_codes::RA_HASH_FAILED, "non-utf8 hash"))?
                .to_ascii_lowercase();
            if text.len() != 32 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(error_codes::with_detail(error_codes::RA_HASH_FAILED, format!("unexpected hash {text:?}")));
            }
            Ok(text)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_hasher_reports_the_stable_error_code() {
        let hasher = UnavailableHasher;
        assert!(!hasher.is_available());
        assert_eq!(hasher.hash_rom("C:/roms/game.nds", 18), Err("E_RA_HASH_UNAVAILABLE".to_string()));
    }

    #[cfg(not(rcheevos_vendored))]
    #[test]
    fn without_the_vendored_tree_the_default_hasher_is_unavailable() {
        assert!(!default_hasher().is_available());
    }

    // A synthetic Nintendo DS image with the layout rc_hash_nintendo_ds reads:
    // 512-byte header holding the ARM9/ARM7 code offsets and sizes at the
    // documented positions, both code blocks, then the 0xA00-byte icon block.
    #[cfg(rcheevos_vendored)]
    fn synthetic_nds() -> Vec<u8> {
        let arm9_addr: u32 = 0x200;
        let arm9_size: u32 = 0x100;
        let arm7_addr: u32 = 0x300;
        let arm7_size: u32 = 0x100;
        let icon_addr: u32 = 0x400;
        let mut rom = vec![0u8; (icon_addr + 0xA00) as usize];
        rom[..12].copy_from_slice(b"METADEA TEST");
        rom[0x20..0x24].copy_from_slice(&arm9_addr.to_le_bytes());
        rom[0x2C..0x30].copy_from_slice(&arm9_size.to_le_bytes());
        rom[0x30..0x34].copy_from_slice(&arm7_addr.to_le_bytes());
        rom[0x3C..0x40].copy_from_slice(&arm7_size.to_le_bytes());
        rom[0x68..0x6C].copy_from_slice(&icon_addr.to_le_bytes());
        for (i, byte) in rom[0x200..0x400].iter_mut().enumerate() {
            *byte = (i * 7 % 251) as u8;
        }
        for (i, byte) in rom[0x400..].iter_mut().enumerate() {
            *byte = (i * 13 % 241) as u8;
        }
        rom
    }

    #[cfg(rcheevos_vendored)]
    #[test]
    fn vendored_rc_hash_hashes_a_synthetic_ds_rom_deterministically() {
        let dir = std::env::temp_dir().join(format!("metadea-ra-hash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("synthetic.nds");
        std::fs::write(&path, synthetic_nds()).unwrap();
        let hasher = default_hasher();
        assert!(hasher.is_available());
        let first = hasher.hash_rom(path.to_str().unwrap(), 18).unwrap();
        let second = hasher.hash_rom(path.to_str().unwrap(), 18).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(first.len(), 32, "{first}");
        assert!(first.bytes().all(|b| b.is_ascii_hexdigit()), "{first}");
        assert_eq!(first, second);
        // A DS hash covers only the header/code/icon regions, so it must
        // differ from a plain MD5-of-file style digest of a zeroed buffer.
        assert_ne!(first, "d41d8cd98f00b204e9800998ecf8427e");
    }

    #[cfg(rcheevos_vendored)]
    #[test]
    fn vendored_rc_hash_reports_a_missing_file_as_a_failure_code() {
        let err = default_hasher().hash_rom("C:/definitely/missing/metadea.nds", 18).unwrap_err();
        assert!(err.starts_with("E_RA_HASH_FAILED"), "{err}");
    }
}
