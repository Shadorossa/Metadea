// The scanned-game model plus the helpers every launcher scanner shares.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LocalGame {
    pub name: String,
    pub launcher: String,
    pub app_id: Option<String>,
    pub external_id: Option<String>,
    pub install_path: Option<String>,
    pub playtime_minutes: Option<u64>,
    pub last_played: Option<u64>,
    pub installed: Option<bool>,
    // Which specific emulator_configs platform_id (e.g. "3ds", "ps4") this
    // ROM was scanned under — `launcher` itself only ever holds the
    // company-level grouping ("nintendo"/"playstation"/"xbox") a ROM's
    // console groups under in Local's own sidebar, so this is what
    // launch_game actually looks up the right EmulatorConfig by. None for
    // every non-ROM (Steam/Epic/GOG/...) game.
    #[serde(default)]
    pub rom_platform: Option<String>,
    // Multi-disc sets (platform_scanning/multi_disc.rs): every disc in boot
    // order (install_path is the first) and the set's .m3u, when it has one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub discs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disc_playlist: Option<String>,
    // app_ids of the entries this one replaced (a set's other discs, a cue
    // sheet's .bin); scan_all_games folds their data in (rom_disc_merge.rs).
    #[serde(skip)]
    pub replaced_app_ids: Vec<String>,
    // (launcher, link_key) identities this entry stands for besides its own:
    // a duplicate another scanner reported for the same install (see
    // dedupe_scanned_games), a Switch update/DLC dump or an alternate dump
    // grouped under it. scan_all_games counts them as present, so their old
    // local_games_seen rows never come back as "not installed" ghosts.
    #[serde(skip)]
    pub aliases: Vec<(String, String)>,
}

impl LocalGame {
    pub(super) fn installed(name: String, launcher: &str, app_id: Option<String>, install_path: Option<String>) -> Self {
        Self {
            name, launcher: launcher.to_string(), app_id, external_id: None,
            install_path, playtime_minutes: None, last_played: None, installed: Some(true),
            rom_platform: None, discs: Vec::new(), disc_playlist: None, replaced_app_ids: Vec::new(),
            aliases: Vec::new(),
        }
    }
}

// The same (launcher, link_key) identity local_game_links/local_games_seen
// key on — must exactly match how scan_all_games has always derived it, or
// a saved link silently stops resolving. install_path only ever applies to
// a live-scanned game; a restored ghost (game_links::restore_missing_seen_games)
// never has one, so this falls through to app_id/name for those too.
pub(super) fn game_link_key(game: &LocalGame) -> String {
    game.app_id.as_deref()
        .or(game.install_path.as_deref())
        .unwrap_or(&game.name)
        .to_string()
}

pub(super) fn apply_game_link(game: &mut LocalGame, links: &std::collections::HashMap<(String, String), String>) {
    let key = game_link_key(game);
    if let Some(eid) = links.get(&(game.launcher.clone(), key)) {
        game.external_id = Some(eid.clone());
    }
}

// One spelling per filesystem location: Windows paths compare case-
// insensitively and with either separator ("c:/program files (x86)/steam"
// from the registry is libraryfolders.vdf's "C:\Program Files (x86)\Steam").
pub(crate) fn normalized_path(path: &str) -> String {
    let mut out = path.trim().replace('\\', "/").to_lowercase();
    while out.len() > 1 && out.ends_with('/') {
        out.pop();
    }
    out
}

// The folder a scanned game lives in, whatever its install_path points at:
// a VN folder entry's install_path is its executable (scan_vn_folder), the
// same folder the videojuegos-folder scan reports as the game itself.
fn identity_path(game: &LocalGame) -> Option<String> {
    let path = game.install_path.as_deref().filter(|p| !p.trim().is_empty())?;
    if game.rom_platform.as_deref() == Some("vnovel") {
        if let Some(parent) = std::path::Path::new(path).parent() {
            return Some(normalized_path(&parent.to_string_lossy()));
        }
    }
    Some(normalized_path(path))
}

// Folds `dropped` (another report of the same game) into `kept`, keeping
// whatever `kept` lacks.
fn absorb_duplicate(kept: &mut LocalGame, dropped: LocalGame) {
    let dropped_identity = (dropped.launcher.clone(), game_link_key(&dropped));
    if dropped_identity != (kept.launcher.clone(), game_link_key(kept)) && !kept.aliases.contains(&dropped_identity) {
        kept.aliases.push(dropped_identity);
    }
    kept.aliases.extend(dropped.aliases);
    if kept.install_path.is_none() {
        kept.install_path = dropped.install_path;
    }
    if kept.external_id.is_none() {
        kept.external_id = dropped.external_id;
    }
    kept.playtime_minutes = kept.playtime_minutes.max(dropped.playtime_minutes);
    kept.last_played = kept.last_played.max(dropped.last_played);
    if dropped.installed == Some(true) {
        kept.installed = Some(true);
    }
    if kept.discs.is_empty() {
        kept.discs = dropped.discs;
    }
    if kept.disc_playlist.is_none() {
        kept.disc_playlist = dropped.disc_playlist;
    }
    if dropped.launcher == kept.launcher {
        kept.replaced_app_ids.extend(dropped.replaced_app_ids);
    }
}

// Every launcher scan's output merged into one entry per game: the same
// (launcher, link_key) is by definition one game (links, seen and hidden
// rows all key on it), and so is one install folder reported by two
// scanners (a Steam library also configured as the videojuegos folder, one
// folder set as both the videojuegos and visual-novel route). The first
// report wins — scan_all_launchers orders the store launchers first — and
// the others become its aliases.
pub(crate) fn dedupe_scanned_games(games: Vec<LocalGame>) -> Vec<LocalGame> {
    let mut kept: Vec<LocalGame> = Vec::with_capacity(games.len());
    let mut by_key: std::collections::HashMap<(String, String), usize> = std::collections::HashMap::new();
    let mut by_path: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for game in games {
        let key = (game.launcher.clone(), game_link_key(&game));
        let path = identity_path(&game);
        // Two store ids of one launcher sharing a folder (an app and its
        // tool/playtest installed together) are still two apps.
        let same_path = path.as_ref().and_then(|p| by_path.get(p).copied()).filter(|&idx| {
            let other = &kept[idx];
            other.launcher != game.launcher || is_location_key(&key.1) || is_location_key(&game_link_key(other))
        });
        let existing = by_key.get(&key).copied().or(same_path);
        match existing {
            Some(idx) => absorb_duplicate(&mut kept[idx], game),
            None => {
                by_key.insert(key, kept.len());
                if let Some(path) = path {
                    by_path.insert(path, kept.len());
                }
                kept.push(game);
            }
        }
    }
    kept
}

// Same-launcher name dedupe for the scanners that find one game through
// two sources (EA Desktop manifests + classic folders, several Xbox roots,
// GOG registry + folder fallback). `Vec::dedup_by` only ever compared
// neighbours, so a game found in two roots stayed twice.
pub(super) fn dedupe_by_name(games: &mut Vec<LocalGame>) {
    let mut seen = std::collections::HashSet::new();
    games.retain(|g| seen.insert(g.name.trim().to_lowercase()));
}

// A comparable form of a scanned title: case, accents, punctuation and every
// (...)/[...] tag (region, languages, revision, Switch title id and version)
// dropped. "Inazuma Eleven GO - Chrono Stones - Thunderflash (Europe)
// (En,Fr,De,Es,It)" and the cleaned-up "Inazuma Eleven GO - Chrono Stones -
// Thunderflash" compare equal.
pub(crate) fn normalized_title(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut depth = 0usize;
    for c in name.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth > 0 => {}
            _ => {
                for lower in c.to_lowercase() {
                    let folded = match lower {
                        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
                        'è' | 'é' | 'ê' | 'ë' => 'e',
                        'ì' | 'í' | 'î' | 'ï' => 'i',
                        'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
                        'ù' | 'ú' | 'û' | 'ü' => 'u',
                        'ñ' => 'n',
                        'ç' => 'c',
                        other => other,
                    };
                    out.push(if folded.is_alphanumeric() { folded } else { ' ' });
                }
            }
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

// Whether a link_key is derived from where a game sits on disk (a
// synthetic_app_id hash, or a raw path from before those existed) rather
// than a store's own id (Steam appid, Epic catalog id, GOG product id). Such
// a key changes whenever the file or folder moves or is renamed, so a stale
// one says nothing about whether the game is still there.
pub(crate) fn is_location_key(key: &str) -> bool {
    if key.contains(['\\', '/', ':']) {
        return true;
    }
    match key.rsplit_once('_') {
        Some((prefix, hash)) => {
            !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_lowercase()) && hash.len() == 16 && hash.chars().all(|c| c.is_ascii_hexdigit())
        }
        None => false,
    }
}

// What this scan found, indexed for restore_missing_seen_games: a
// previously-seen game that no source reports under its old key is only a
// "not installed" ghost when none of these say it is still here under a
// new one.
#[derive(Default)]
pub(crate) struct LiveGames {
    keys: std::collections::HashSet<(String, String)>,
    paths: std::collections::HashSet<(String, String)>,
    titles: std::collections::HashSet<(String, String)>,
}

impl LiveGames {
    pub(crate) fn from_games(games: &[LocalGame]) -> Self {
        let mut live = LiveGames::default();
        for game in games {
            live.keys.insert((game.launcher.clone(), game_link_key(game)));
            live.keys.extend(game.aliases.iter().cloned());
            for path in game.install_path.iter().chain(game.discs.iter()) {
                live.paths.insert((game.launcher.clone(), normalized_path(path)));
            }
            let title = normalized_title(&game.name);
            if !title.is_empty() {
                live.titles.insert((game.launcher.clone(), title));
            }
        }
        live
    }

    pub(crate) fn contains_key(&self, launcher: &str, key: &str) -> bool {
        self.keys.contains(&(launcher.to_string(), key.to_string()))
    }

    // Whether a seen row (launcher, key, name) is a game this scan already
    // shows under another identity: one of its aliases, the same install
    // path recorded under a pre-synthetic-id path key, or — for keys that
    // only encode a location, never for a store id — the same title in the
    // same launcher after the file or folder was moved or renamed (the ROM
    // clean-up, a manual rename, a new drive letter).
    pub(crate) fn supersedes(&self, launcher: &str, key: &str, name: &str) -> bool {
        if self.contains_key(launcher, key) {
            return true;
        }
        if key.contains(['\\', '/', ':']) && self.paths.contains(&(launcher.to_string(), normalized_path(key))) {
            return true;
        }
        if !is_location_key(key) {
            return false;
        }
        let title = normalized_title(name);
        !title.is_empty() && self.titles.contains(&(launcher.to_string(), title))
    }
}

pub(super) fn extract_xml_attr(content: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    if let Some(pos) = content.find(&needle) {
        let rest = &content[pos + needle.len()..];
        if let Some(end) = rest.find('"') {
            let val = rest[..end].trim().to_string();
            if !val.is_empty() {
                return Some(val);
            }
        }
    }
    None
}

// A stable, filesystem-safe stand-in for app_id — every cover/IGDB-link
// mechanism in this codebase (readGameInfo, igdb_force_by_igdb_id,
// game_link_key, IgdbPickerModal's "editar metadatos") keys its cache
// directory by app_id and only bothers running at all when one is present,
// so any launcher that never had a real one (ROMs; Xbox/EA/local-folder
// installs, whose own scanners have nothing ID-like to report) needs one
// too, or it'd silently get none of that — cover, manual IGDB link,
// everything. `prefix` just keeps each launcher's ids visually distinct in
// debugging; only `install_path` feeds the hash. Deterministic (the same
// path always hashes to the same id, so a pick made once survives every
// future rescan) and DefaultHasher::new() is fixed-seed (unlike HashMap's
// own randomized default), so this doesn't change between runs. Must be
// plain hex — this gets used as a single path segment (join()) downstream,
// so anything else (slashes, a drive letter's colon) would either break the
// join or, worse, get treated as an absolute path and silently escape the
// intended metadata folder entirely.
pub(crate) fn synthetic_app_id(prefix: &str, install_path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    install_path.hash(&mut hasher);
    format!("{}_{:016x}", prefix, hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(launcher: &str, name: &str, app_id: Option<&str>, path: Option<&str>) -> LocalGame {
        LocalGame::installed(name.into(), launcher, app_id.map(String::from), path.map(String::from))
    }

    #[test]
    fn the_same_launcher_and_key_twice_is_one_game_keeping_the_richer_data() {
        let first = game("steam", "Hades", Some("1145360"), Some(r"C:\Program Files (x86)\Steam\steamapps\common\Hades"));
        let mut second = game("steam", "Hades", Some("1145360"), Some("c:/program files (x86)/steam/steamapps/common/Hades"));
        second.playtime_minutes = Some(900);
        let games = dedupe_scanned_games(vec![first, second]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].playtime_minutes, Some(900));
        assert!(games[0].aliases.is_empty(), "same identity, nothing to alias");
    }

    #[test]
    fn one_folder_reported_by_two_scanners_is_one_game() {
        let folder = r"D:\SteamLibrary\steamapps\common\Celeste";
        let steam = game("steam", "Celeste", Some("504230"), Some(folder));
        let local = game("local", "Celeste", Some(&synthetic_app_id("local", folder)), Some("d:/steamlibrary/steamapps/common/celeste/"));
        let local_key = game_link_key(&local);
        let games = dedupe_scanned_games(vec![steam, local]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].launcher, "steam");
        assert_eq!(games[0].aliases, vec![("local".to_string(), local_key)]);
    }

    #[test]
    fn a_folder_set_as_both_vn_and_videojuegos_route_is_one_entry() {
        let (exe, dir) = (r"D:\VN\Umineko\Umineko1to4.exe", r"D:\VN\Umineko");
        let mut vn = game("local", "Umineko", Some(&synthetic_app_id("local", exe)), Some(exe));
        vn.rom_platform = Some("vnovel".into());
        let folder = game("local", "Umineko", Some(&synthetic_app_id("local", dir)), Some(dir));
        let games = dedupe_scanned_games(vec![vn, folder]);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].rom_platform.as_deref(), Some("vnovel"));
    }

    #[test]
    fn two_store_apps_sharing_a_folder_stay_two() {
        let folder = r"D:\SteamLibrary\steamapps\common\Game";
        let games = dedupe_scanned_games(vec![
            game("steam", "Game", Some("100"), Some(folder)),
            game("steam", "Game Playtest", Some("200"), Some(folder)),
        ]);
        assert_eq!(games.len(), 2);
    }

    #[test]
    fn name_dedupe_is_not_limited_to_neighbours() {
        let mut games = vec![
            game("ea", "Mass Effect", Some("ea_1"), None),
            game("ea", "Dead Space", Some("ea_2"), None),
            game("ea", "mass effect", Some("ea_3"), None),
        ];
        dedupe_by_name(&mut games);
        assert_eq!(games.iter().map(|g| g.name.as_str()).collect::<Vec<_>>(), vec!["Mass Effect", "Dead Space"]);
    }

    #[test]
    fn titles_compare_without_tags_case_accents_or_punctuation() {
        assert_eq!(
            normalized_title("Inazuma Eleven GO - Chrono Stones - Thunderflash (Europe) (En,Fr,De,Es,It)"),
            normalized_title("Inazuma Eleven GO - Chrono Stones - Thunderflash"),
        );
        assert_eq!(normalized_title("Pokémon Scarlet [0100A3D008C5C800][v786432]"), "pokemon scarlet");
        assert_ne!(normalized_title("Final Fantasy VII"), normalized_title("Final Fantasy VIII"));
    }

    #[test]
    fn location_keys_are_told_apart_from_store_ids() {
        assert!(is_location_key(&synthetic_app_id("rom", r"D:\a.nds")));
        assert!(is_location_key(r"C:\XboxGames\GameSave"));
        assert!(!is_location_key("1245620"));
        assert!(!is_location_key("4b0c8d1a2e3f4a5b6c7d8e9f0a1b2c3d"));
        assert!(!is_location_key("1141086411"));
    }

    // The owner's local_games_seen rows (2026-09-23): Inazuma Eleven's
    // 3DS dump seen under a raw path key before synthetic ids existed, then
    // renamed by the ROM clean-up; Pokémon Scarlet's update and DLC dumps
    // seen as cards of their own before they were grouped under the base.
    #[test]
    fn stale_seen_rows_of_a_game_still_shown_are_not_ghosts() {
        let inazuma_path = r"D:\Media consuming\videojuegos\Nintendo 3Ds\Inazuma Eleven GO - Chrono Stones - Thunderflash.3ds";
        let inazuma = game("nintendo", "Inazuma Eleven GO - Chrono Stones - Thunderflash", Some(&synthetic_app_id("rom", inazuma_path)), Some(inazuma_path));
        let mut scarlet = game("nintendo", "Pokemon Scarlet [0100A3D008C5C000]", Some("rom_e6186e992f5b4821"), Some(r"D:\Switch\Pokemon Scarlet [0100A3D008C5C000].xci"));
        scarlet.aliases.push(("nintendo".into(), "rom_66b999118d56a0d8".into()));
        let elden = game("steam", "ELDEN RING", Some("1245620"), None);
        let live = LiveGames::from_games(&[inazuma, scarlet, elden]);

        let legacy = r"D:\Media consuming\videojuegos\Nintendo 3Ds\Inazuma Eleven GO - Chrono Stones - Thunderflash (Europe) (En,Fr,De,Es,It).3ds";
        assert!(live.supersedes("nintendo", legacy, "Inazuma Eleven GO - Chrono Stones - Thunderflash (Europe) (En,Fr,De,Es,It)"));
        assert!(live.supersedes("nintendo", "rom_66b999118d56a0d8", "Pokémon Scarlet [0100A3D008C5C800][v786432]"));
        assert!(live.supersedes("nintendo", "rom_0ad06028dff0408e", "Pokemon Scarlet [New Uniform Set] [0100A3D008C5D001]"));
        // The same path under a pre-synthetic-id key.
        assert!(live.supersedes("nintendo", &inazuma_path.to_uppercase(), "whatever"));
        // A genuinely missing game still comes back as not installed.
        assert!(!live.supersedes("nintendo", "rom_0123456789abcdef", "Fire Emblem - Radiant Dawn"));
        // Same title on another platform grouping is another game.
        assert!(!live.supersedes("playstation", "rom_0123456789abcdef", "Pokemon Scarlet"));
        // Store ids never match by title: two Steam apps can share a name.
        assert!(!live.supersedes("steam", "999", "ELDEN RING"));
    }
}
