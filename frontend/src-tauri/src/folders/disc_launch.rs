// Which file a multi-disc game boots with (see platform_scanning/multi_disc.rs).
//
// Emulators that read .m3u playlists get the set's playlist, so their own
// "change disc" works without leaving the game. The rest get the disc the
// user picked in the game panel. Picking a disc other than the first on an
// m3u-capable emulator boots that disc file directly (a playlist always
// starts at its first entry).
//
// | Emulator                        | .m3u | Notes                                           |
// |---------------------------------|------|-------------------------------------------------|
// | RetroArch, no core given (-L)   | yes  | the core chosen by RetroArch handles it         |
// | RetroArch + Beetle PSX / PSX HW | yes  | mednafen_psx(_hw)                               |
// | RetroArch + SwanStation         | yes  |                                                 |
// | RetroArch + PCSX-ReARMed        | yes  |                                                 |
// | RetroArch + Beetle Saturn, Yabause, YabaSanshiro, Kronos | yes | Saturn                          |
// | RetroArch + Flycast             | yes  | Dreamcast                                       |
// | RetroArch + Genesis Plus GX, PicoDrive | yes | Sega CD                                   |
// | RetroArch + Beetle PCE / PCE Fast / PC-FX | yes | PC Engine CD, PC-FX                    |
// | RetroArch + Opera, PUAE, NeoCD, Dolphin | yes | 3DO, Amiga CD, Neo Geo CD, GameCube      |
// | DuckStation                     | yes  |                                                 |
// | Flycast (standalone)            | yes  |                                                 |
// | Mednafen                        | yes  |                                                 |
// | Dolphin                         | yes  | GameCube two-disc games                         |
// | PCSX2                           | no   | not needed: PS2 swaps discs through its own menu|
// | PPSSPP, ePSXe, anything else    | no   | the selected disc                               |

use std::path::Path;

const M3U_CORES: &[&str] = &[
    "mednafen_psx", "swanstation", "pcsx_rearmed", "mednafen_saturn", "yabause", "yabasanshiro", "kronos", "flycast",
    "genesis_plus_gx", "picodrive", "mednafen_pce", "mednafen_pcfx", "mednafen_supergrafx", "opera", "puae", "neocd",
    "dolphin",
];

const M3U_STANDALONE: &[&str] = &["duckstation", "flycast", "mednafen", "dolphin"];

fn file_name_lower(path: &str) -> String {
    Path::new(path.trim().trim_matches('"'))
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

// The core RetroArch is told to load: "-L cores/x_libretro.dll",
// "--libretro x.dll", "--libretro=x.dll". Quote-aware enough for paths
// with spaces.
fn retroarch_core(launch_args: &str) -> Option<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for c in launch_args.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    let mut iter = tokens.iter();
    while let Some(token) = iter.next() {
        if let Some(value) = token.strip_prefix("--libretro=") {
            return Some(file_name_lower(value));
        }
        if token == "-L" || token == "--libretro" {
            return iter.next().map(|value| file_name_lower(value));
        }
        if let Some(value) = token.strip_prefix("-L").filter(|v| !v.is_empty()) {
            return Some(file_name_lower(value));
        }
    }
    None
}

/// Whether the configured emulator (and, for RetroArch, its core) reads .m3u playlists.
pub fn emulator_supports_m3u(executable_path: &str, launch_args: &str) -> bool {
    let exe = file_name_lower(executable_path);
    if exe.contains("retroarch") {
        return match retroarch_core(launch_args) {
            None => true,
            Some(core) => M3U_CORES.iter().any(|name| core.contains(name)),
        };
    }
    M3U_STANDALONE.iter().any(|name| exe.contains(name))
}

fn same_file(a: &str, b: &str) -> bool {
    let norm = |p: &str| p.trim().replace('\\', "/").to_lowercase();
    norm(a) == norm(b)
}

/// The path handed to the emulator for `rom_path` (a set's first disc).
pub fn choose_launch_path(
    supports_m3u: bool,
    rom_path: &str,
    disc_path: Option<&str>,
    playlist: Option<&str>,
    exists: impl Fn(&Path) -> bool,
) -> String {
    let disc = disc_path.map(str::trim).filter(|d| !d.is_empty() && exists(Path::new(d)));
    let playlist = playlist
        .map(str::trim)
        .filter(|p| p.to_ascii_lowercase().ends_with(".m3u") && exists(Path::new(p)));
    let first_disc_selected = match disc {
        None => true,
        Some(d) => same_file(d, rom_path),
    };
    if let (true, true, Some(playlist)) = (supports_m3u, first_disc_selected, playlist) {
        return playlist.to_string();
    }
    disc.unwrap_or(rom_path).to_string()
}

/// launch_game's entry point: the file to boot for this ROM launch.
pub(super) fn resolve_rom_launch_path(
    executable_path: &str,
    launch_args: &str,
    rom_path: &str,
    disc_path: Option<&str>,
    playlist: Option<&str>,
) -> String {
    if disc_path.is_none() && playlist.is_none() {
        return rom_path.to_string();
    }
    choose_launch_path(emulator_supports_m3u(executable_path, launch_args), rom_path, disc_path, playlist, |p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn m3u_support_follows_the_emulator_and_retroarch_core() {
        assert!(emulator_supports_m3u(r"C:\Emu\duckstation-qt-x64-ReleaseLTCG.exe", ""));
        assert!(emulator_supports_m3u(r"C:\Emu\Dolphin.exe", "-b -e {ROM}"));
        assert!(emulator_supports_m3u(r"C:\Emu\flycast.exe", ""));
        assert!(!emulator_supports_m3u(r"C:\Emu\pcsx2-qt.exe", "-fullscreen"));
        assert!(!emulator_supports_m3u(r"C:\Emu\PPSSPPWindows64.exe", ""));
        assert!(emulator_supports_m3u(r"C:\RetroArch\retroarch.exe", ""));
        assert!(emulator_supports_m3u(r"C:\RetroArch\retroarch.exe", r#"-L "cores\swanstation_libretro.dll" {ROM}"#));
        assert!(emulator_supports_m3u(r"C:\RetroArch\retroarch.exe", r"-Lcores\mednafen_psx_hw_libretro.dll"));
        assert!(emulator_supports_m3u(r"C:\RetroArch\retroarch.exe", r"--libretro=C:\RA\cores\pcsx_rearmed_libretro.dll -f"));
        assert!(emulator_supports_m3u(r"C:\RetroArch\retroarch.exe", r"--libretro C:\RA\cores\mednafen_saturn_libretro.dll"));
        assert!(!emulator_supports_m3u(r"C:\RetroArch\retroarch.exe", r"-L cores\ppsspp_libretro.dll"));
    }

    const ROM: &str = r"C:\Roms\FF7 (Disc 1).chd";
    const DISC2: &str = r"C:\Roms\FF7 (Disc 2).chd";
    const M3U: &str = r"C:\Roms\FF7.m3u";

    fn all_exist(_: &Path) -> bool {
        true
    }

    #[test]
    fn m3u_emulators_boot_the_playlist_unless_a_later_disc_is_picked() {
        assert_eq!(choose_launch_path(true, ROM, None, Some(M3U), all_exist), M3U);
        assert_eq!(choose_launch_path(true, ROM, Some(ROM), Some(M3U), all_exist), M3U);
        assert_eq!(choose_launch_path(true, ROM, Some(&ROM.to_lowercase()), Some(M3U), all_exist), M3U);
        assert_eq!(choose_launch_path(true, ROM, Some(DISC2), Some(M3U), all_exist), DISC2);
    }

    #[test]
    fn other_emulators_boot_the_selected_disc() {
        assert_eq!(choose_launch_path(false, ROM, Some(DISC2), Some(M3U), all_exist), DISC2);
        assert_eq!(choose_launch_path(false, ROM, None, Some(M3U), all_exist), ROM);
    }

    #[test]
    fn missing_or_bogus_files_fall_back_to_the_first_disc() {
        let only_rom = |p: &Path| p == Path::new(ROM);
        assert_eq!(choose_launch_path(true, ROM, Some(DISC2), Some(M3U), only_rom), ROM);
        assert_eq!(choose_launch_path(true, ROM, None, Some(r"C:\Roms\FF7.txt"), all_exist), ROM);
        assert_eq!(choose_launch_path(true, ROM, Some("  "), None, all_exist), ROM);
    }
}
