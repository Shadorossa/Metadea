//! Where each emulator keeps its own saves, and how Metadea handles it.
//! Support matrix (kept in sync with docs/SAVES.md):
//!
//! | Emulator                 | Strategy | Battery saves                                   | Save states                 |
//! |--------------------------|----------|-------------------------------------------------|-----------------------------|
//! | RetroArch                | Redirect | `--appendconfig`: savefile_directory → central   | savestate_directory → central |
//! | DuckStation              | Mirror   | memcards/ (`shared_card_*` = shared)             | savestates/                 |
//! | PCSX2                    | Mirror   | memcards/ (shared by every game)                 | sstates/                    |
//! | PPSSPP                   | Mirror   | PSP/SAVEDATA/<folder>                            | PSP/PPSSPP_STATE/           |
//! | Dolphin                  | Mirror   | GC/…/*.gci (`*.raw` = shared), Wii/title/00010000/<id> | StateSaves/           |
//! | melonDS                  | Mirror   | <ROM folder>/<rom>.sav                           | <ROM folder>/<rom>.mlN      |
//! | DeSmuME                  | Mirror   | Battery/*.dsv                                    | States/                     |
//! | Citra / Lime3DS / Azahar | Mirror   | sdmc/Nintendo 3DS/…/title/…/<id>/data            | states/                     |
//! | Ryujinx / Ryubing        | Mirror   | bis/user/save/<n>                                | —                           |
//! | Yuzu / Suyu / Citron / Eden / Sudachi | Mirror | nand/user/save/0…0/<user>/<title id> | —                      |
//! | Cemu                     | Mirror   | mlc01/usr/save/00050000/<id>                     | —                           |
//! | RPCS3                    | Mirror   | dev_hdd0/home/00000001/savedata/<folder>         | savestates/                 |
//! | Vita3K                   | Mirror   | ux0/user/00/savedata/<id>                        | —                           |
//! | shadPS4                  | Mirror   | savedata/<user>/<id>                             | —                           |
//! | Xenia / Xenia Edge       | Mirror   | content/<profile>/<title id>/00000001            | —                           |
//! | ePSXe, PCSXR-PGXP        | Mirror   | memcards/ (shared)                               | sstates/                    |
//! | xemu                     | None     | saves live inside the HDD image                  | —                           |
//!
//! "Redirect" is only used where the emulator takes a per-launch override
//! that leaves the user's own configuration untouched. Every other emulator
//! is "Mirror": its files are copied to/from the central folder around each
//! session (mirror.rs). Portable layouts (next to the executable) are tried
//! first, then the per-user ones.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::layout::{self, GameIdentity, SaveKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Strategy {
    Redirect,
    Mirror,
    Unsupported,
}

/// The folders the table needs, resolved by the caller (tauri's path
/// resolver in the app, fixed paths in tests).
#[derive(Debug, Clone, Default)]
pub struct NativeContext {
    pub exe_path: PathBuf,
    pub rom_path: PathBuf,
    pub documents: Option<PathBuf>,
    /// %APPDATA% (Roaming) on Windows, ~/.local/share on Linux.
    pub roaming: Option<PathBuf>,
    /// %LOCALAPPDATA% on Windows.
    pub local: Option<PathBuf>,
}

/// How the entries under a root map to saves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Units {
    /// Every entry (file or folder) exactly this many folders below the root.
    Entries(u8),
    /// Every file up to this many folders below the root.
    FilesUpTo(u8),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shared {
    Never,
    Always,
    NamePrefix(&'static str),
    Extension(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RootSpec {
    pub id: &'static str,
    /// Relative to the base (empty = the base itself).
    pub sub: &'static str,
    pub kind: SaveKind,
    pub units: Units,
    /// Allowed extensions (lowercase; `ml*` = prefix). None = any.
    pub extensions: Option<&'static [&'static str]>,
    /// Only units with exactly this name (Citra's `data`, Xenia's `00000001`).
    pub unit_name: Option<&'static str>,
    pub shared: Shared,
    /// Centrally stored by file name alone (`battery/<name>`): RetroArch's
    /// sorted `saves/<core>/<name>` land where a redirected session reads.
    pub flat: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Base {
    pub dir: PathBuf,
    /// Any of these files next to it marks a portable install as active.
    /// Empty: the base is used whenever it exists.
    pub markers: &'static [&'static str],
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub id: &'static str,
    pub strategy: Strategy,
    pub bases: Vec<Base>,
    pub roots: Vec<RootSpec>,
}

const fn root(id: &'static str, sub: &'static str, kind: SaveKind, units: Units) -> RootSpec {
    RootSpec { id, sub, kind, units, extensions: None, unit_name: None, shared: Shared::Never, flat: false }
}

const BATTERY: SaveKind = SaveKind::Battery;
const STATE: SaveKind = SaveKind::State;

fn emulator_kind(emulator_name: &str, exe_path: &Path) -> &'static str {
    let exe = exe_path.file_stem().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let name = format!("{} {}", emulator_name.to_ascii_lowercase(), exe);
    let has = |needle: &str| name.contains(needle);
    if has("retroarch") {
        "retroarch"
    } else if has("duckstation") {
        "duckstation"
    } else if has("pcsx2") {
        "pcsx2"
    } else if has("ppsspp") {
        "ppsspp"
    } else if has("dolphin") {
        "dolphin"
    } else if has("melonds") {
        "melonds"
    } else if has("desmume") {
        "desmume"
    } else if has("lime3ds") {
        "lime3ds"
    } else if has("azahar") {
        "azahar"
    } else if has("citra") {
        "citra"
    } else if has("ryujinx") || has("ryubing") {
        "ryujinx"
    } else if has("citron") {
        "citron"
    } else if has("suyu") {
        "suyu"
    } else if has("sudachi") {
        "sudachi"
    } else if has("eden") {
        "eden"
    } else if has("yuzu") {
        "yuzu"
    } else if has("cemu") {
        "cemu"
    } else if has("rpcs3") {
        "rpcs3"
    } else if has("vita3k") {
        "vita3k"
    } else if has("shadps4") {
        "shadps4"
    } else if has("xenia") {
        "xenia"
    } else if has("xemu") {
        "xemu"
    } else if has("epsxe") {
        "epsxe"
    } else if has("pcsxr") {
        "pcsxr"
    } else {
        "unknown"
    }
}

pub fn profile_for(emulator_name: &str, ctx: &NativeContext) -> Profile {
    let exe_dir = ctx.exe_path.parent().filter(|dir| !dir.as_os_str().is_empty()).map(Path::to_path_buf);
    let rom_dir = ctx.rom_path.parent().filter(|dir| !dir.as_os_str().is_empty()).map(Path::to_path_buf);
    let exe = |sub: &str, markers: &'static [&'static str]| {
        exe_dir.as_ref().map(|dir| Base { dir: if sub.is_empty() { dir.clone() } else { dir.join(sub) }, markers })
    };
    let docs = |sub: &str| ctx.documents.as_ref().map(|dir| Base { dir: dir.join(sub), markers: &[] });
    let roaming = |sub: &str| ctx.roaming.as_ref().map(|dir| Base { dir: dir.join(sub), markers: &[] });
    let local = |sub: &str| ctx.local.as_ref().map(|dir| Base { dir: dir.join(sub), markers: &[] });

    let id = emulator_kind(emulator_name, &ctx.exe_path);
    let (strategy, bases, roots): (Strategy, Vec<Option<Base>>, Vec<RootSpec>) = match id {
        "retroarch" => (
            Strategy::Redirect,
            vec![exe("", &[]), roaming("RetroArch")],
            // Only read by "Import existing saves": sessions write straight
            // into the central folder.
            vec![
                RootSpec { flat: true, ..root("saves", "saves", BATTERY, Units::FilesUpTo(1)) },
                RootSpec { flat: true, ..root("states", "states", STATE, Units::FilesUpTo(1)) },
            ],
        ),
        "duckstation" => (
            Strategy::Mirror,
            vec![exe("", &["portable.txt"]), docs("DuckStation"), local("DuckStation")],
            vec![
                RootSpec { shared: Shared::NamePrefix("shared_card"), ..root("memcards", "memcards", BATTERY, Units::Entries(0)) },
                root("savestates", "savestates", STATE, Units::Entries(0)),
            ],
        ),
        "pcsx2" => (
            Strategy::Mirror,
            vec![exe("", &["portable.ini", "portable.txt"]), docs("PCSX2")],
            vec![
                RootSpec { shared: Shared::Always, ..root("memcards", "memcards", BATTERY, Units::Entries(0)) },
                root("sstates", "sstates", STATE, Units::Entries(0)),
            ],
        ),
        "ppsspp" => (
            Strategy::Mirror,
            vec![exe("memstick", &[]), docs("PPSSPP")],
            vec![root("savedata", "PSP/SAVEDATA", BATTERY, Units::Entries(0)), root("states", "PSP/PPSSPP_STATE", STATE, Units::Entries(0))],
        ),
        "dolphin" => (
            Strategy::Mirror,
            vec![exe("User", &["portable.txt"]), docs("Dolphin Emulator"), roaming("Dolphin Emulator"), roaming("dolphin-emu")],
            vec![
                RootSpec {
                    extensions: Some(&["gci", "raw"]),
                    shared: Shared::Extension("raw"),
                    ..root("gc", "GC", BATTERY, Units::FilesUpTo(2))
                },
                root("wii", "Wii/title/00010000", BATTERY, Units::Entries(0)),
                root("states", "StateSaves", STATE, Units::Entries(0)),
            ],
        ),
        "melonds" => (
            Strategy::Mirror,
            vec![rom_dir.map(|dir| Base { dir, markers: &[] })],
            vec![
                RootSpec { extensions: Some(&["sav"]), ..root("rom-battery", "", BATTERY, Units::Entries(0)) },
                RootSpec { extensions: Some(&["ml*"]), ..root("rom-states", "", STATE, Units::Entries(0)) },
            ],
        ),
        "desmume" => (
            Strategy::Mirror,
            vec![exe("", &[])],
            vec![
                RootSpec { extensions: Some(&["dsv"]), ..root("battery", "Battery", BATTERY, Units::Entries(0)) },
                root("states", "States", STATE, Units::Entries(0)),
            ],
        ),
        "citra" | "lime3ds" | "azahar" => {
            let folder = match id { "lime3ds" => "Lime3DS", "azahar" => "Azahar", _ => "Citra" };
            (
                Strategy::Mirror,
                vec![exe("user", &[]), roaming(folder)],
                vec![
                    RootSpec { unit_name: Some("data"), ..root("sdmc", "sdmc/Nintendo 3DS", BATTERY, Units::Entries(5)) },
                    root("states", "states", STATE, Units::Entries(0)),
                ],
            )
        }
        "ryujinx" => (
            Strategy::Mirror,
            vec![exe("portable", &[]), roaming("Ryujinx")],
            vec![root("save", "bis/user/save", BATTERY, Units::Entries(0))],
        ),
        "yuzu" | "suyu" | "citron" | "eden" | "sudachi" => (
            Strategy::Mirror,
            vec![exe("user", &[]), roaming(id)],
            vec![root("save", "nand/user/save/0000000000000000", BATTERY, Units::Entries(1))],
        ),
        "cemu" => (
            Strategy::Mirror,
            vec![exe("", &[]), roaming("Cemu")],
            vec![root("save", "mlc01/usr/save/00050000", BATTERY, Units::Entries(0))],
        ),
        "rpcs3" => (
            Strategy::Mirror,
            vec![exe("", &[])],
            vec![root("savedata", "dev_hdd0/home/00000001/savedata", BATTERY, Units::Entries(0)), root("savestates", "savestates", STATE, Units::FilesUpTo(1))],
        ),
        "vita3k" => (
            Strategy::Mirror,
            vec![exe("", &[]), roaming("Vita3K/Vita3K")],
            vec![root("savedata", "ux0/user/00/savedata", BATTERY, Units::Entries(0))],
        ),
        "shadps4" => (
            Strategy::Mirror,
            vec![exe("user", &[]), roaming("shadPS4")],
            vec![root("savedata", "savedata", BATTERY, Units::Entries(1))],
        ),
        "xenia" => (
            Strategy::Mirror,
            vec![exe("", &["portable.txt"]), docs("Xenia")],
            vec![RootSpec { unit_name: Some("00000001"), ..root("content", "content", BATTERY, Units::Entries(2)) }],
        ),
        "epsxe" | "pcsxr" => (
            Strategy::Mirror,
            vec![exe("", &[])],
            vec![
                RootSpec { shared: Shared::Always, ..root("memcards", "memcards", BATTERY, Units::Entries(0)) },
                root("sstates", "sstates", STATE, Units::Entries(0)),
            ],
        ),
        _ => (Strategy::Unsupported, Vec::new(), Vec::new()),
    };
    Profile { id, strategy, bases: bases.into_iter().flatten().collect(), roots }
}

/// One root on this PC: a spec under a base.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeRoot {
    /// `<profile>:<spec id>`, what manifests record.
    pub id: String,
    pub spec: RootSpec,
    pub dir: PathBuf,
    /// The base is the one this install uses (it exists, and a portable
    /// base has its marker).
    pub active: bool,
}

impl Profile {
    /// Every (base, spec) pair, portable first. Includes roots that do not
    /// exist yet (a fresh install): restores may create them.
    pub fn all_roots(&self) -> Vec<NativeRoot> {
        let mut out = Vec::new();
        for base in &self.bases {
            let active = base.dir.is_dir() && (base.markers.is_empty() || base.markers.iter().any(|m| base.dir.join(m).exists()));
            for spec in &self.roots {
                let dir = if spec.sub.is_empty() { base.dir.clone() } else { base.dir.join(spec.sub) };
                if out.iter().any(|root: &NativeRoot| root.dir == dir && root.spec.id == spec.id) {
                    continue;
                }
                out.push(NativeRoot { id: format!("{}:{}", self.id, spec.id), spec: *spec, dir, active });
            }
        }
        out
    }

    /// Roots that exist on this PC.
    pub fn existing_roots(&self) -> Vec<NativeRoot> {
        self.all_roots().into_iter().filter(|root| root.active && root.dir.is_dir()).collect()
    }

    /// Where a save recorded under `root_id` goes on this PC: the first
    /// existing root with that id, else the first active base's.
    pub fn resolve_root(&self, root_id: &str) -> Option<NativeRoot> {
        let candidates: Vec<NativeRoot> = self.all_roots().into_iter().filter(|root| root.id == root_id && root.active).collect();
        candidates.iter().find(|root| root.dir.is_dir()).cloned().or_else(|| candidates.into_iter().next())
    }
}

/// One save in an emulator's folders.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeUnit {
    pub root_id: String,
    pub kind: SaveKind,
    /// `/`-separated, relative to the root.
    pub rel: String,
    pub path: PathBuf,
    pub shared: bool,
    pub flat: bool,
}

impl NativeUnit {
    /// The path under the game's central folder: `battery/<rel>` (or
    /// `battery/<file name>` for a flat root).
    pub fn central_rel(&self) -> String {
        let rel = if self.flat { self.rel.rsplit('/').next().unwrap_or(&self.rel) } else { self.rel.as_str() };
        format!("{}/{}", self.kind.dir_name(), rel)
    }
}

fn extension_allowed(name: &str, allowed: Option<&[&str]>) -> bool {
    let Some(allowed) = allowed else { return true };
    let extension = name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()).unwrap_or_default();
    allowed.iter().any(|pattern| match pattern.strip_suffix('*') {
        Some(prefix) => extension.starts_with(prefix) && extension.len() > prefix.len(),
        None => extension == *pattern,
    })
}

fn is_ignored(name: &str) -> bool {
    name.starts_with('.')
        || name.ends_with(layout::NATIVE_BACKUP_SUFFIX)
        || name.ends_with(".tmp")
        || name.ends_with(".metadea-tmp")
        || name.eq_ignore_ascii_case("desktop.ini")
        || name.eq_ignore_ascii_case("thumbs.db")
}

fn is_shared(spec: &RootSpec, name: &str) -> bool {
    match spec.shared {
        Shared::Never => false,
        Shared::Always => true,
        Shared::NamePrefix(prefix) => name.to_ascii_lowercase().starts_with(prefix),
        Shared::Extension(ext) => name.rsplit_once('.').is_some_and(|(_, e)| e.eq_ignore_ascii_case(ext)),
    }
}

/// Every save under a root.
pub fn list_units(root: &NativeRoot) -> Vec<NativeUnit> {
    fn walk(root: &NativeRoot, dir: &Path, rel: &str, depth: u8, out: &mut Vec<NativeUnit>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_ignored(&name) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else { continue };
            if file_type.is_symlink() {
                continue;
            }
            let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let path = entry.path();
            let unit = |out: &mut Vec<NativeUnit>| {
                out.push(NativeUnit {
                    root_id: root.id.clone(),
                    kind: root.spec.kind,
                    rel: child_rel.clone(),
                    path: path.clone(),
                    shared: is_shared(&root.spec, &name),
                    flat: root.spec.flat,
                })
            };
            match root.spec.units {
                Units::Entries(target) if depth == target => {
                    let name_ok = root.spec.unit_name.map_or(true, |wanted| name.eq_ignore_ascii_case(wanted));
                    let ext_ok = file_type.is_dir() || extension_allowed(&name, root.spec.extensions);
                    if name_ok && ext_ok {
                        unit(out);
                    }
                }
                Units::Entries(_) => {
                    if file_type.is_dir() {
                        walk(root, &path, &child_rel, depth + 1, out);
                    }
                }
                Units::FilesUpTo(max) => {
                    if file_type.is_file() {
                        if extension_allowed(&name, root.spec.extensions) {
                            unit(out);
                        }
                    } else if file_type.is_dir() && depth < max {
                        walk(root, &path, &child_rel, depth + 1, out);
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    if root.dir.is_dir() {
        walk(root, &root.dir, "", 0, &mut out);
    }
    // A root whose files must have an allowed extension never yields folders.
    if root.spec.extensions.is_some() {
        out.retain(|unit| unit.path.is_file());
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}

/// True when a unit was written at or after `since` (with a little slack
/// for filesystem timestamp granularity).
pub fn modified_since(unit: &NativeUnit, since: SystemTime) -> bool {
    let slack = std::time::Duration::from_secs(2);
    super::files::newest_mtime(&unit.path).is_some_and(|mtime| mtime + slack >= since)
}

/// True when the unit can be attributed to this game by name alone (any
/// segment of its relative path, since ids are often folder names).
pub fn unit_matches_game(unit: &NativeUnit, identity: &GameIdentity) -> bool {
    unit.rel.split('/').any(|segment| layout::name_belongs_to_game(segment, identity))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    fn ctx(base: &Path, exe: &str, rom: &str) -> NativeContext {
        NativeContext {
            exe_path: base.join(exe),
            rom_path: base.join(rom),
            documents: Some(base.join("Documents")),
            roaming: Some(base.join("Roaming")),
            local: Some(base.join("Local")),
        }
    }

    fn rels(units: &[NativeUnit]) -> Vec<String> {
        units.iter().map(|unit| unit.rel.clone()).collect()
    }

    fn all_units(profile: &Profile) -> Vec<NativeUnit> {
        profile.existing_roots().iter().flat_map(list_units).collect()
    }

    #[test]
    fn strategies_by_emulator() {
        let context = NativeContext::default();
        assert_eq!(profile_for("RetroArch", &context).strategy, Strategy::Redirect);
        assert_eq!(profile_for("DuckStation", &context).strategy, Strategy::Mirror);
        assert_eq!(profile_for("Xemu", &context).strategy, Strategy::Unsupported);
        assert_eq!(profile_for("Something", &context).strategy, Strategy::Unsupported);
        // The executable's name is enough when the name is generic.
        let by_exe = NativeContext { exe_path: PathBuf::from(r"C:\Emu\retroarch.exe"), ..Default::default() };
        assert_eq!(profile_for("", &by_exe).id, "retroarch");
        assert_eq!(profile_for("Lime3DS", &context).id, "lime3ds");
        assert_eq!(profile_for("Ryujinx", &context).id, "ryujinx");
    }

    #[test]
    fn duckstation_user_layout_and_shared_cards() {
        let dir = crate::backup::layout::tempdir("saves-native-duck");
        touch(&dir.join("Documents/DuckStation/memcards/Crash Bandicoot (USA)_1.mcd"));
        touch(&dir.join("Documents/DuckStation/memcards/shared_card_1.mcd"));
        touch(&dir.join("Documents/DuckStation/savestates/SCUS94900_1.sav"));
        // A portable folder without portable.txt is not the active install.
        touch(&dir.join("emu/memcards/ignored_1.mcd"));
        let profile = profile_for("DuckStation", &ctx(&dir, "emu/duckstation-qt.exe", "roms/Crash Bandicoot (USA).chd"));
        let units = all_units(&profile);
        assert_eq!(rels(&units), vec!["Crash Bandicoot (USA)_1.mcd", "shared_card_1.mcd", "SCUS94900_1.sav"]);
        assert!(!units[0].shared && units[1].shared);
        assert_eq!(units[2].kind, SaveKind::State);
        assert_eq!(units[0].root_id, "duckstation:memcards");
        let game = GameIdentity::new("ps1", "roms/Crash Bandicoot (USA).chd", None);
        assert!(unit_matches_game(&units[0], &game));
        assert!(!unit_matches_game(&units[2], &game));

        // With portable.txt the exe folder wins.
        touch(&dir.join("emu/portable.txt"));
        let profile = profile_for("DuckStation", &ctx(&dir, "emu/duckstation-qt.exe", "roms/x.chd"));
        assert_eq!(profile.resolve_root("duckstation:memcards").unwrap().dir, dir.join("emu").join("memcards"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn dolphin_gci_wii_and_states() {
        let dir = crate::backup::layout::tempdir("saves-native-dolphin");
        let user = dir.join("Documents/Dolphin Emulator");
        touch(&user.join("GC/USA/Card A/01-GALE-SuperSmashBros.gci"));
        touch(&user.join("GC/USA/IPL.bin"));
        touch(&user.join("GC/MemoryCardA.USA.raw"));
        touch(&user.join("Wii/title/00010000/524d4745/data/banner.bin"));
        touch(&user.join("StateSaves/GALE01.s01"));
        let profile = profile_for("Dolphin", &ctx(&dir, "emu/Dolphin.exe", "roms/Melee.rvz"));
        let units = all_units(&profile);
        assert_eq!(rels(&units), vec!["MemoryCardA.USA.raw", "USA/Card A/01-GALE-SuperSmashBros.gci", "524d4745", "GALE01.s01"]);
        assert!(units[0].shared && !units[1].shared);
        let mut melee = GameIdentity::new("gamecube", "roms/Melee.rvz", None);
        melee.header_id = Some("GALE01".into());
        assert!(unit_matches_game(&units[1], &melee));
        assert!(unit_matches_game(&units[3], &melee));
        assert!(!unit_matches_game(&units[2], &melee));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn melonds_saves_next_to_the_rom_only_by_extension() {
        let dir = crate::backup::layout::tempdir("saves-native-melon");
        touch(&dir.join("roms/Pokemon Black (USA).nds"));
        touch(&dir.join("roms/Pokemon Black (USA).sav"));
        touch(&dir.join("roms/Pokemon Black (USA).ml1"));
        touch(&dir.join("roms/Other.sav"));
        let profile = profile_for("melonDS", &ctx(&dir, "emu/melonDS.exe", "roms/Pokemon Black (USA).nds"));
        let units = all_units(&profile);
        assert_eq!(rels(&units), vec!["Other.sav", "Pokemon Black (USA).sav", "Pokemon Black (USA).ml1"]);
        let game = GameIdentity::new("ds", &dir.join("roms/Pokemon Black (USA).nds").to_string_lossy(), None);
        let mine: Vec<_> = units.iter().filter(|u| unit_matches_game(u, &game)).map(|u| u.rel.clone()).collect();
        assert_eq!(mine, vec!["Pokemon Black (USA).sav", "Pokemon Black (USA).ml1"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn nested_folder_units() {
        let dir = crate::backup::layout::tempdir("saves-native-nested");
        touch(&dir.join("Roaming/Citra/sdmc/Nintendo 3DS/aaaa/bbbb/title/00040000/00055d00/data/00000001/main"));
        touch(&dir.join("Roaming/yuzu/nand/user/save/0000000000000000/USERID/0100A3D008C5C000/progress.bin"));
        touch(&dir.join("Documents/PPSSPP/PSP/SAVEDATA/ULUS10041DATA00/DATA.BIN"));
        touch(&dir.join("Documents/PPSSPP/PSP/PPSSPP_STATE/ULUS10041_1.00_0.ppst"));
        touch(&dir.join("Documents/PPSSPP/PSP/PPSSPP_STATE/ULUS10041_1.00_0.jpg"));
        let citra = all_units(&profile_for("Citra", &ctx(&dir, "emu/citra-qt.exe", "r.3ds")));
        assert_eq!(rels(&citra), vec!["aaaa/bbbb/title/00040000/00055d00/data"]);
        let yuzu = all_units(&profile_for("Yuzu", &ctx(&dir, "emu/yuzu.exe", "r.nsp")));
        assert_eq!(rels(&yuzu), vec!["USERID/0100A3D008C5C000"]);
        let switch_game = GameIdentity::new("switch", "Pokemon Scarlet [0100A3D008C5C000].nsp", None);
        assert!(unit_matches_game(&yuzu[0], &switch_game));
        let ppsspp = all_units(&profile_for("PPSSPP", &ctx(&dir, "emu/PPSSPPWindows64.exe", "r.iso")));
        assert_eq!(rels(&ppsspp), vec!["ULUS10041DATA00", "ULUS10041_1.00_0.jpg", "ULUS10041_1.00_0.ppst"]);
        let psp = GameIdentity::new("psp", "Monster Hunter [ULUS-10041].iso", None);
        assert!(ppsspp.iter().all(|unit| unit_matches_game(unit, &psp)));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn retroarch_sorted_saves_are_stored_flat() {
        let dir = crate::backup::layout::tempdir("saves-native-ra");
        touch(&dir.join("emu/saves/Snes9x/Chrono Trigger (USA).srm"));
        touch(&dir.join("emu/states/Snes9x/Chrono Trigger (USA).state1"));
        touch(&dir.join("emu/states/Snes9x/Chrono Trigger (USA).state1.png"));
        let units = all_units(&profile_for("RetroArch", &ctx(&dir, "emu/retroarch.exe", "roms/Chrono Trigger (USA).sfc")));
        let central: Vec<String> = units.iter().map(NativeUnit::central_rel).collect();
        assert_eq!(central, vec![
            "battery/Chrono Trigger (USA).srm",
            "states/Chrono Trigger (USA).state1",
            "states/Chrono Trigger (USA).state1.png",
        ]);
        let game = GameIdentity::new("snes", &dir.join("roms/Chrono Trigger (USA).sfc").to_string_lossy(), None);
        assert!(units.iter().all(|unit| unit_matches_game(unit, &game)));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn our_own_files_are_never_units() {
        let dir = crate::backup::layout::tempdir("saves-native-ignored");
        touch(&dir.join("Documents/DuckStation/memcards/Game_1.mcd.metadea-bak"));
        touch(&dir.join("Documents/DuckStation/memcards/.hidden"));
        touch(&dir.join("Documents/DuckStation/memcards/Game_1.mcd"));
        let units = all_units(&profile_for("DuckStation", &ctx(&dir, "emu/duckstation.exe", "r.chd")));
        assert_eq!(rels(&units), vec!["Game_1.mcd"]);
        let _ = std::fs::remove_dir_all(dir);
    }
}
