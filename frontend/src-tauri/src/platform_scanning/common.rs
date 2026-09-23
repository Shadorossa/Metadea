// The scanned-game model plus the helpers every launcher scanner shares.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
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
}

impl LocalGame {
    pub(super) fn installed(name: String, launcher: &str, app_id: Option<String>, install_path: Option<String>) -> Self {
        Self {
            name, launcher: launcher.to_string(), app_id, external_id: None,
            install_path, playtime_minutes: None, last_played: None, installed: Some(true),
            rom_platform: None, discs: Vec::new(), disc_playlist: None, replaced_app_ids: Vec::new(),
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
