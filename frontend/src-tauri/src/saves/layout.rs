//! Where a game's saves live inside the central folder, and how a game is
//! recognised again (on this PC or another one) from its ROM.
//!
//! ```text
//! <root>\<Platform>\<Game title>\
//!     metadea-saves.json          labels, source emulator, hashes (manifest.rs)
//!     battery\<native name>        .sav/.srm/.mcd/.gci… or a whole save folder
//!     battery\.history\<name>\<YYYY-MM-DD HH-MM-SS>\<name>
//!     states\<native name>         save states (+ their .png/.jpg thumbnails)
//!     .archive\<stamp>\<kind>\…    archived entries (never hard-deleted)
//!     .native-backups\<stamp>\…    emulator save folders replaced by a restore
//! <root>\<Platform>\Shared memory cards\   cards every game of a platform shares
//! ```
//!
//! Every name is human-readable and Windows-safe. Two games whose titles
//! sanitize to the same folder get a short, stable suffix derived from the
//! game key (`Title [1a2b3c]`).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

pub const MANIFEST_NAME: &str = "metadea-saves.json";
pub const HISTORY_DIR: &str = ".history";
pub const ARCHIVE_DIR: &str = ".archive";
pub const NATIVE_BACKUPS_DIR: &str = ".native-backups";
pub const SHARED_FOLDER: &str = "Shared memory cards";
/// Extension of the copy kept next to a native save file a restore replaced.
pub const NATIVE_BACKUP_SUFFIX: &str = ".metadea-bak";
const NAME_MAX_CHARS: usize = 80;
const FALLBACK_NAME: &str = "Untitled";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum SaveKind {
    Battery,
    State,
}

impl SaveKind {
    pub fn dir_name(self) -> &'static str {
        match self {
            SaveKind::Battery => "battery",
            SaveKind::State => "states",
        }
    }

    pub fn from_dir_name(name: &str) -> Option<Self> {
        match name {
            "battery" => Some(SaveKind::Battery),
            "states" => Some(SaveKind::State),
            _ => None,
        }
    }
}

/// The folder a platform's games go under. Short names people recognise.
pub fn platform_folder_name(platform_id: &str) -> String {
    let name = match platform_id {
        "gamecube" => "GameCube",
        "wii" => "Wii",
        "wiiu" => "Wii U",
        "ds" => "DS",
        "3ds" => "3DS",
        "switch" => "Switch",
        "ps1" => "PS1",
        "ps2" => "PS2",
        "ps3" => "PS3",
        "ps4" => "PS4",
        "ps5" => "PS5",
        "psp" => "PSP",
        "psvita" => "PS Vita",
        "xbox" => "Xbox",
        "xbox360" => "Xbox 360",
        "xboxone" => "Xbox One",
        "xboxseriesx" => "Xbox Series",
        other => return sanitize_name(&other.to_ascii_uppercase()),
    };
    name.to_string()
}

fn is_reserved_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).trim().to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit())
}

/// A title as a Windows-safe folder name: `Zelda: Twilight Princess` →
/// `Zelda - Twilight Princess`; reserved characters dropped, whitespace
/// collapsed, no trailing dots/spaces, no device names, at most 80 chars.
pub fn sanitize_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for character in name.chars() {
        match character {
            ':' => out.push_str(" -"),
            '/' | '\\' | '|' => out.push('-'),
            '<' | '>' | '"' | '?' | '*' => {}
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let capped: String = collapsed.chars().take(NAME_MAX_CHARS).collect();
    let trimmed = capped.trim_matches(|c: char| c == '.' || c.is_whitespace()).to_string();
    if trimmed.is_empty() {
        return FALLBACK_NAME.to_string();
    }
    if is_reserved_device_name(&trimmed) {
        return format!("{trimmed}_");
    }
    trimmed
}

/// Lowercase letters and digits only: "Zelda - Twilight Princess" and
/// "zelda_twilight_princess" compare equal.
pub fn normalized_key(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// "Game (USA) [v1.1]" → "Game".
pub fn bare_stem(stem: &str) -> &str {
    stem.split(['(', '[']).next().unwrap_or(stem).trim()
}

/// A disc serial in a file name ("Final Fantasy X [SLUS-20312]",
/// "SCES_123.45", "ULUS10041"): four letters, an optional separator, then
/// five digits (optionally split 3.2). Returned normalized: "SLUS20312".
pub fn parse_serial(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut index = 0;
    while index + 9 <= chars.len() {
        let starts_word = index == 0 || !chars[index - 1].is_ascii_alphanumeric();
        if starts_word && chars[index..index + 4].iter().all(|c| c.is_ascii_alphabetic()) {
            let mut cursor = index + 4;
            if matches!(chars.get(cursor), Some('-' | '_' | ' ')) {
                cursor += 1;
            }
            let mut digits = String::new();
            while digits.len() < 5 {
                match chars.get(cursor) {
                    Some(c) if c.is_ascii_digit() => digits.push(*c),
                    Some('.') if digits.len() == 3 => {}
                    _ => break,
                }
                cursor += 1;
            }
            let ends_word = chars.get(cursor).map_or(true, |c| !c.is_ascii_alphanumeric());
            if digits.len() == 5 && ends_word {
                let prefix: String = chars[index..index + 4].iter().collect::<String>().to_ascii_uppercase();
                return Some(format!("{prefix}{digits}"));
            }
        }
        index += 1;
    }
    None
}

/// What the app knows about one ROM, and the keys its native saves are
/// recognised by.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GameIdentity {
    pub platform_id: String,
    pub rom_path: PathBuf,
    pub rom_stem: String,
    /// Display title (catalog title, else the ROM's bare stem).
    pub title: String,
    /// GameCube/Wii ID6, DS game code, 3DS product code (rom_header.rs).
    pub header_id: Option<String>,
    /// Switch title id from the file name.
    pub title_id: Option<String>,
    /// PS1/PS2/PSP/PS3/Vita/PS4 serial from the file name.
    pub serial: Option<String>,
}

/// An id a native save's name may carry. `Prefix` ids start the name
/// (`GALE01.s01`, `SLUS-20312 (…).01.p2s`, `ULUS10041DATA00`); `Token` ids
/// are one whole dash/space-delimited word (`01-GALE-…gci`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdKey {
    Prefix(String),
    Token(String),
}

impl GameIdentity {
    pub fn new(platform_id: &str, rom_path: &str, title: Option<&str>) -> Self {
        let path = PathBuf::from(rom_path);
        let rom_stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let title = title
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| bare_stem(&rom_stem).to_string());
        let title_id = if platform_id == "switch" {
            crate::platform_scanning::rom_library::switch_title_id_and_kind(&rom_stem).0
        } else {
            None
        };
        let serial = if matches!(platform_id, "ps1" | "ps2" | "ps3" | "psp" | "psvita" | "ps4" | "ps5") {
            parse_serial(&rom_stem)
        } else {
            None
        };
        Self { platform_id: platform_id.to_string(), rom_path: path, rom_stem, title, header_id: None, title_id, serial }
    }

    /// Reads the ROM header (a few hundred bytes) for GameCube/Wii/DS/3DS.
    pub fn with_header(mut self) -> Self {
        if self.header_id.is_none() {
            self.header_id = crate::platform_scanning::rom_header::read_rom_header(&self.rom_path).map(|header| header.game_id);
        }
        self
    }

    /// Stable across PCs and ROM folders: `<platform>:<id>`, the id being
    /// the most specific one known (title id, header id, serial, then the
    /// normalized ROM file name).
    pub fn game_key(&self) -> String {
        let id = self
            .title_id
            .clone()
            .or_else(|| self.header_id.clone())
            .or_else(|| self.serial.clone())
            .map(|id| format!("id-{}", normalized_key(&id)))
            .unwrap_or_else(|| normalized_key(&self.rom_stem));
        format!("{}:{}", self.platform_id, id)
    }

    /// Other keys this game was known by (the ROM name when the key is an id).
    pub fn aliases(&self) -> Vec<String> {
        let stem_key = format!("{}:{}", self.platform_id, normalized_key(&self.rom_stem));
        if stem_key == self.game_key() { Vec::new() } else { vec![stem_key] }
    }

    /// Lowercased names a native file may be called after (`<name>.sav`,
    /// `<name>_1.mcd`, `<name>.state3`): the ROM stem, its bare form and the
    /// title. Under 3 characters would match almost anything.
    pub fn name_keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = [self.rom_stem.as_str(), bare_stem(&self.rom_stem), self.title.as_str()]
            .into_iter()
            .map(|key| key.trim().to_lowercase())
            .filter(|key| key.chars().count() >= 3)
            .collect();
        keys.sort();
        keys.dedup();
        keys
    }

    pub fn id_keys(&self) -> Vec<IdKey> {
        let mut keys = Vec::new();
        for id in [&self.title_id, &self.serial].into_iter().flatten() {
            keys.push(IdKey::Prefix(normalized_key(id)));
        }
        if let Some(header) = &self.header_id {
            let header = header.trim();
            keys.push(IdKey::Prefix(normalized_key(header)));
            if matches!(self.platform_id.as_str(), "gamecube" | "wii") && header.len() >= 4 && header.is_ascii() {
                let id4 = &header[..4];
                keys.push(IdKey::Token(normalized_key(id4)));
                if self.platform_id == "wii" {
                    // Wii NAND save folders are the ID4 as hex: RMGE → 524d4745.
                    keys.push(IdKey::Prefix(id4.bytes().map(|b| format!("{b:02x}")).collect()));
                }
            }
        }
        keys.retain(|key| match key {
            IdKey::Prefix(id) | IdKey::Token(id) => id.len() >= 4,
        });
        keys.dedup();
        keys
    }
}

/// True when a native save called `name` (a file or folder name) belongs to
/// this game. Strict on purpose: `Mario.sav`, `Mario_1.mcd`, `Mario.state3`
/// and `Mario_resume.sav` are Mario's; `Mario 2.sav`, `Mario Kart.sav` and
/// `Mario_Bros.sav` are not.
pub fn name_belongs_to_game(name: &str, identity: &GameIdentity) -> bool {
    let lower = name.to_lowercase();
    let by_name = identity.name_keys().iter().any(|key| {
        let Some(rest) = lower.strip_prefix(key.as_str()) else { return false };
        if let Some(extension) = rest.strip_prefix('.') {
            return !extension.is_empty() && extension.chars().all(|c| c.is_ascii_alphanumeric() || c == '.');
        }
        if let Some(slot) = rest.strip_prefix('_') {
            let (slot, extension) = slot.split_once('.').unwrap_or((slot, ""));
            let slot_ok = (!slot.is_empty() && slot.chars().all(|c| c.is_ascii_digit())) || slot == "resume" || slot == "auto";
            return slot_ok && extension.chars().all(|c| c.is_ascii_alphanumeric() || c == '.');
        }
        false
    });
    if by_name {
        return true;
    }
    let normalized = normalized_key(name);
    let tokens: Vec<String> = name.split(|c: char| !c.is_alphanumeric()).map(normalized_key).collect();
    identity.id_keys().iter().any(|key| match key {
        IdKey::Prefix(id) => normalized.starts_with(id.as_str()),
        IdKey::Token(id) => tokens.iter().any(|token| token == id),
    })
}

/// Six hex characters derived from the game key (stable, collision suffix).
pub fn stable_suffix(game_key: &str) -> String {
    short_hash(game_key, 6)
}

pub fn short_hash(text: &str, chars: usize) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect::<String>()[..chars].to_string()
}

/// The folder name for a new game: its sanitized title, or `Title [abc123]`
/// when another game (a different key) already owns that name.
pub fn choose_game_folder_name(title: &str, game_key: &str, taken: &[String]) -> String {
    let base = sanitize_name(title);
    if !taken.iter().any(|name| name.eq_ignore_ascii_case(&base)) {
        return base;
    }
    let suffixed = format!("{} [{}]", base, stable_suffix(game_key));
    if !taken.iter().any(|name| name.eq_ignore_ascii_case(&suffixed)) {
        return suffixed;
    }
    format!("{} [{}]", base, short_hash(game_key, 12))
}

/// A `/`-separated relative path from the webview (or a Drive file name),
/// checked to stay inside the folder it is joined to: no root, drive,
/// `..`, empty or reserved segments.
pub fn safe_relative(rel: &str) -> Result<PathBuf, String> {
    let unsafe_path = || crate::error_codes::with_detail(crate::error_codes::SAVES_PATH_UNSAFE, rel);
    if rel.is_empty() || rel.contains('\0') || rel.contains(':') {
        return Err(unsafe_path());
    }
    let mut out = PathBuf::new();
    for segment in rel.split(['/', '\\']) {
        if segment.is_empty() || segment == "." || segment == ".." || segment.trim() != segment || segment.ends_with('.') {
            return Err(unsafe_path());
        }
        let component = Path::new(segment).components().next();
        if !matches!(component, Some(Component::Normal(_))) || is_reserved_device_name(segment) {
            return Err(unsafe_path());
        }
        out.push(segment);
    }
    Ok(out)
}

/// `rel` as the `/`-separated form stored in manifests and on Drive.
pub fn to_slash(rel: &Path) -> String {
    rel.components()
        .filter_map(|component| match component {
            Component::Normal(segment) => Some(segment.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// True when `path` is `base` or inside it (both canonicalized when they
/// exist, so `..`/symlinks cannot escape).
pub fn is_within(path: &Path, base: &Path) -> bool {
    let canonical = |p: &Path| -> PathBuf {
        if let Ok(resolved) = p.canonicalize() {
            return resolved;
        }
        // Not created yet: resolve the nearest existing ancestor.
        let mut existing = p.to_path_buf();
        let mut tail = Vec::new();
        while !existing.exists() {
            match (existing.file_name().map(|n| n.to_os_string()), existing.parent()) {
                (Some(name), Some(parent)) => {
                    tail.push(name);
                    existing = parent.to_path_buf();
                }
                _ => return p.to_path_buf(),
            }
        }
        let mut resolved = existing.canonicalize().unwrap_or(existing);
        for name in tail.into_iter().rev() {
            resolved.push(name);
        }
        resolved
    };
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return false;
    }
    canonical(path).starts_with(canonical(base))
}

/// `YYYY-MM-DD HH-MM-SS` in local time: sortable and readable in Explorer.
pub fn stamp(time: SystemTime) -> String {
    chrono::DateTime::<chrono::Local>::from(time).format("%Y-%m-%d %H-%M-%S").to_string()
}

/// The slot a save state file name encodes, when it encodes one:
/// `Game.state` → 0, `Game.state3` → 3, `Game.state.auto` / `_resume` →
/// auto/resume, `GALE01.s02` → 2, `Game.ml4`/`.ss4`/`.ds4` → 4,
/// `SLUS-20312 (…).03.p2s` → 3, `ULUS10041_1.00_2.ppst` → 2,
/// `00040000001B5000.01.cst` → 1, `SLUS00001_resume.sav` → resume.
pub fn parse_slot(file_name: &str) -> Option<String> {
    let lower = file_name.to_ascii_lowercase();
    let (stem, extension) = lower.rsplit_once('.').unwrap_or((lower.as_str(), ""));
    if extension == "auto" {
        return Some("auto".into());
    }
    if extension == "state" {
        return Some("0".into());
    }
    for prefix in ["state", "ml", "ss", "ds", "st", "s"] {
        if let Some(digits) = extension.strip_prefix(prefix) {
            if !digits.is_empty() && digits.len() <= 2 && digits.chars().all(|c| c.is_ascii_digit()) {
                return Some(trim_slot(digits));
            }
        }
    }
    // Slot inside the stem: last `.NN` or `_NN` / `_resume`.
    let tail = stem.rsplit(['.', '_']).next().unwrap_or("");
    if tail == "resume" || tail == "auto" {
        return Some(tail.to_string());
    }
    if tail != stem && !tail.is_empty() && tail.len() <= 2 && tail.chars().all(|c| c.is_ascii_digit()) {
        return Some(trim_slot(tail));
    }
    None
}

fn trim_slot(digits: &str) -> String {
    let trimmed = digits.trim_start_matches('0');
    if trimmed.is_empty() { "0".to_string() } else { trimmed.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_titles_into_windows_safe_folder_names() {
        assert_eq!(sanitize_name("Zelda: Twilight Princess"), "Zelda - Twilight Princess");
        assert_eq!(sanitize_name("  What?  <Now>  "), "What Now");
        assert_eq!(sanitize_name("AC/DC | Live"), "AC-DC - Live");
        assert_eq!(sanitize_name("Game..."), "Game");
        assert_eq!(sanitize_name("CON"), "CON_");
        assert_eq!(sanitize_name("com1.txt"), "com1.txt_");
        assert_eq!(sanitize_name("???"), "Untitled");
        assert_eq!(sanitize_name("Pokémon™ Edición"), "Pokémon™ Edición");
        assert_eq!(sanitize_name(&"x".repeat(200)).chars().count(), 80);
    }

    #[test]
    fn platform_folders_use_short_names() {
        assert_eq!(platform_folder_name("ps2"), "PS2");
        assert_eq!(platform_folder_name("gamecube"), "GameCube");
        assert_eq!(platform_folder_name("psvita"), "PS Vita");
        assert_eq!(platform_folder_name("snes"), "SNES");
    }

    #[test]
    fn folder_name_collisions_get_a_stable_suffix() {
        assert_eq!(choose_game_folder_name("Game", "ps2:a", &[]), "Game");
        let taken = vec!["game".to_string()];
        let first = choose_game_folder_name("Game", "ps2:a", &taken);
        assert!(first.starts_with("Game [") && first.len() == "Game [123456]".len());
        assert_eq!(first, choose_game_folder_name("Game", "ps2:a", &taken));
        assert_ne!(first, choose_game_folder_name("Game", "ps2:b", &taken));
    }

    #[test]
    fn serials_are_found_in_file_names() {
        assert_eq!(parse_serial("Final Fantasy X [SLUS-20312]").as_deref(), Some("SLUS20312"));
        assert_eq!(parse_serial("SCES_123.45 Game").as_deref(), Some("SCES12345"));
        assert_eq!(parse_serial("ULUS10041").as_deref(), Some("ULUS10041"));
        assert_eq!(parse_serial("Game (USA) (v1.00)"), None);
        assert_eq!(parse_serial("ABCDE12345"), None);
    }

    #[test]
    fn game_key_prefers_ids_and_is_stable() {
        let plain = GameIdentity::new("ds", r"C:\Roms\Pokemon Black (USA).nds", Some("Pokémon Black"));
        assert_eq!(plain.game_key(), "ds:pokemonblackusa");
        assert!(plain.aliases().is_empty());
        let mut with_header = plain.clone();
        with_header.header_id = Some("IRBO".into());
        assert_eq!(with_header.game_key(), "ds:id-irbo");
        assert_eq!(with_header.aliases(), vec!["ds:pokemonblackusa".to_string()]);
        let switch = GameIdentity::new("switch", r"C:\Roms\Zelda [01007EF00011E000][v0].nsp", None);
        assert_eq!(switch.game_key(), "switch:id-01007ef00011e000");
        assert_eq!(switch.title, "Zelda");
    }

    fn mario() -> GameIdentity {
        GameIdentity::new("ds", r"C:\Roms\Mario (USA).nds", Some("Mario"))
    }

    #[test]
    fn native_names_match_strictly() {
        let game = mario();
        for name in ["Mario (USA).sav", "Mario (USA).ml1", "mario_1.mcd", "Mario.state.auto", "Mario_resume.sav", "Mario.srm"] {
            assert!(name_belongs_to_game(name, &game), "{name}");
        }
        for name in ["Mario 2.sav", "Mario Kart.sav", "Mario_Bros.sav", "Wario.sav", "Mario"] {
            assert!(!name_belongs_to_game(name, &game), "{name}");
        }
    }

    #[test]
    fn native_names_match_by_id() {
        let mut gc = GameIdentity::new("gamecube", r"C:\Roms\Melee.rvz", None);
        gc.header_id = Some("GALE01".into());
        assert!(name_belongs_to_game("GALE01.s01", &gc));
        assert!(name_belongs_to_game("01-GALE-SuperSmashBros0110290334.gci", &gc));
        assert!(!name_belongs_to_game("01-GALX-Other.gci", &gc));
        let mut wii = GameIdentity::new("wii", r"C:\Roms\Galaxy.rvz", None);
        wii.header_id = Some("RMGE01".into());
        assert!(name_belongs_to_game("524d4745", &wii));
        let ps2 = GameIdentity::new("ps2", r"C:\Roms\Final Fantasy X [SLUS-20312].iso", None);
        assert!(name_belongs_to_game("SLUS-20312 (5BBC0D6E).01.p2s", &ps2));
        assert!(!name_belongs_to_game("SLUS-20313 (5BBC0D6E).01.p2s", &ps2));
    }

    #[test]
    fn relative_paths_cannot_escape() {
        assert!(safe_relative("battery/Game.sav").is_ok());
        assert!(safe_relative("battery/USA/Card A/01-GALE.gci").is_ok());
        for bad in ["", "../x", "battery/../../x", "/etc/passwd", "C:/x", r"battery\..\x", "a//b", "battery/CON", "a/b. ", "a/ b"] {
            assert!(safe_relative(bad).is_err(), "{bad}");
        }
        assert_eq!(to_slash(&safe_relative(r"battery\x\y.sav").unwrap()), "battery/x/y.sav");
    }

    #[test]
    fn within_rejects_traversal() {
        let dir = crate::backup::layout::tempdir("saves-within");
        assert!(is_within(&dir.join("a").join("b"), &dir));
        assert!(!is_within(&dir.join("..").join("x"), &dir));
        assert!(!is_within(&std::env::temp_dir(), &dir));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn slots_are_parsed_from_every_emulator_naming() {
        let cases = [
            ("Game.state", Some("0")),
            ("Game.state3", Some("3")),
            ("Game.state.auto", Some("auto")),
            ("GALE01.s02", Some("2")),
            ("GALE01.s10", Some("10")),
            ("Game.ml4", Some("4")),
            ("Game.ss0", Some("0")),
            ("SLUS-20312 (5BBC0D6E).03.p2s", Some("3")),
            ("ULUS10041_1.00_2.ppst", Some("2")),
            ("00040000001B5000.01.cst", Some("1")),
            ("SLUS00001_resume.sav", Some("resume")),
            ("SLUS00001_4.sav", Some("4")),
            ("Game.srm", None),
        ];
        for (name, slot) in cases {
            assert_eq!(parse_slot(name).as_deref(), slot, "{name}");
        }
    }
}
