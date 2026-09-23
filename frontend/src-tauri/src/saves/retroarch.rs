//! RetroArch takes extra configuration for one run through
//! `--appendconfig <file>` ("loaded after -c, overriding it"; several files
//! are joined with `|`). Metadea writes a small file that points the save
//! and state folders at the game's central folders, so RetroArch reads and
//! writes them there directly and the user's retroarch.cfg is never edited.
//!
//! `config_save_on_exit = "false"` keeps RetroArch from writing these
//! overrides back into retroarch.cfg when the session ends (changes made in
//! RetroArch's menu during a Metadea-launched session are therefore not
//! saved automatically; "Save Current Configuration" still works).

use std::path::Path;

/// Keys set by the appended file. Sorting by core/content is turned off so
/// the files land directly in the game's `battery/` and `states/` folders.
pub fn appendconfig_contents(battery_dir: &Path, states_dir: &Path) -> String {
    // RetroArch's config parser takes the quoted value verbatim (no escape
    // sequences), so Windows backslashes are fine as they are.
    let quote = |path: &Path| path.to_string_lossy().replace('"', "");
    let lines = [
        ("savefile_directory", quote(battery_dir)),
        ("savestate_directory", quote(states_dir)),
        ("savefiles_in_content_dir", "false".to_string()),
        ("savestates_in_content_dir", "false".to_string()),
        ("sort_savefiles_enable", "false".to_string()),
        ("sort_savestates_enable", "false".to_string()),
        ("sort_savefiles_by_content_enable", "false".to_string()),
        ("sort_savestates_by_content_enable", "false".to_string()),
        ("config_save_on_exit", "false".to_string()),
    ];
    let mut out = String::from("# Written by Metadea for one session; safe to delete.\n");
    for (key, value) in lines {
        out.push_str(&format!("{key} = \"{value}\"\n"));
    }
    out
}

/// Adds the appended config to an argument list. A user's own
/// `--appendconfig` (either `--appendconfig=a.cfg` or `--appendconfig a.cfg`)
/// keeps working: ours is chained after it with `|`, so it wins.
pub fn inject_appendconfig(args: Vec<String>, cfg_path: &Path) -> Vec<String> {
    let cfg = cfg_path.to_string_lossy().into_owned();
    let mut out = Vec::with_capacity(args.len() + 2);
    let mut merged = false;
    let mut iter = args.into_iter().peekable();
    while let Some(arg) = iter.next() {
        if merged {
            out.push(arg);
            continue;
        }
        if let Some(value) = arg.strip_prefix("--appendconfig=") {
            out.push(format!("--appendconfig={value}|{cfg}"));
            merged = true;
        } else if arg == "--appendconfig" {
            out.push(arg);
            match iter.next() {
                Some(value) => out.push(format!("{value}|{cfg}")),
                None => out.push(cfg.clone()),
            }
            merged = true;
        } else {
            out.push(arg);
        }
    }
    if !merged {
        out.insert(0, cfg);
        out.insert(0, "--appendconfig".to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn appendconfig_points_both_folders_at_the_game() {
        let text = appendconfig_contents(Path::new(r"C:\Saves\SNES\Chrono Trigger\battery"), Path::new(r"C:\Saves\SNES\Chrono Trigger\states"));
        assert!(text.contains("savefile_directory = \"C:\\Saves\\SNES\\Chrono Trigger\\battery\"\n"));
        assert!(text.contains("savestate_directory = \"C:\\Saves\\SNES\\Chrono Trigger\\states\"\n"));
        for key in ["sort_savefiles_enable", "sort_savestates_enable", "savefiles_in_content_dir", "savestates_in_content_dir", "config_save_on_exit"] {
            assert!(text.contains(&format!("{key} = \"false\"")), "{key}");
        }
        // A stray quote in a folder name cannot break the line.
        let odd = appendconfig_contents(Path::new("a\"b"), Path::new("c"));
        assert!(odd.contains("savefile_directory = \"ab\""));
    }

    #[test]
    fn appendconfig_is_prepended_or_chained() {
        let cfg = PathBuf::from(r"C:\Temp\metadea.cfg");
        let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            inject_appendconfig(args(&["-L", "cores/snes9x.dll", "rom.sfc"]), &cfg),
            args(&["--appendconfig", r"C:\Temp\metadea.cfg", "-L", "cores/snes9x.dll", "rom.sfc"]),
        );
        assert_eq!(
            inject_appendconfig(args(&["--appendconfig=mine.cfg", "rom.sfc"]), &cfg),
            args(&[r"--appendconfig=mine.cfg|C:\Temp\metadea.cfg", "rom.sfc"]),
        );
        assert_eq!(
            inject_appendconfig(args(&["--appendconfig", "mine.cfg", "rom.sfc"]), &cfg),
            args(&["--appendconfig", r"mine.cfg|C:\Temp\metadea.cfg", "rom.sfc"]),
        );
    }
}
