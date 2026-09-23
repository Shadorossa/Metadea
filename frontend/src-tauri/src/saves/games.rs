//! Finding a game's folder under the central root (by the key in its
//! manifest, whatever the folder is called) and creating it.

use std::fs;
use std::path::{Path, PathBuf};

use super::layout::{self, GameIdentity, MANIFEST_NAME};
use super::manifest::{self, GameManifest};

pub fn shared_key(platform_id: &str) -> String {
    format!("shared:{platform_id}")
}

/// Every game folder (one with a manifest) under the root.
pub fn all_game_dirs(root: &Path) -> Vec<(PathBuf, GameManifest)> {
    let mut out = Vec::new();
    let Ok(platforms) = fs::read_dir(root) else { return out };
    for platform in platforms.flatten() {
        let platform_path = platform.path();
        if !platform_path.is_dir() || platform.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(games) = fs::read_dir(&platform_path) else { continue };
        for game in games.flatten() {
            let game_path = game.path();
            if game_path.join(MANIFEST_NAME).is_file() {
                if let Some(manifest) = manifest::read_manifest(&game_path) {
                    out.push((game_path, manifest));
                }
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn folder_names(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .map(|entries| entries.flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default()
}

/// The folder of the game with this key (or one of its aliases).
pub fn find_game_dir(root: &Path, platform_folder: &str, key: &str, aliases: &[String]) -> Option<(PathBuf, GameManifest)> {
    let platform_dir = root.join(platform_folder);
    let entries = fs::read_dir(&platform_dir).ok()?;
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()).collect();
    dirs.sort();
    // An exact key match beats an alias match.
    let manifests: Vec<(PathBuf, GameManifest)> = dirs.into_iter().filter_map(|dir| manifest::read_manifest(&dir).map(|m| (dir, m))).collect();
    manifests
        .iter()
        .find(|(_, manifest)| manifest.game_key == key)
        .or_else(|| manifests.iter().find(|(_, manifest)| manifest.is_for(key, aliases)))
        .cloned()
}

/// Where a new game with this title/key goes (not created).
pub fn plan_game_dir(root: &Path, platform_folder: &str, title: &str, key: &str) -> PathBuf {
    let platform_dir = root.join(platform_folder);
    let taken = folder_names(&platform_dir);
    platform_dir.join(layout::choose_game_folder_name(title, key, &taken))
}

/// This game's folder and manifest. With `create`, a missing folder is
/// created (with its manifest); otherwise None when it does not exist yet.
pub fn open_game(root: &Path, identity: &GameIdentity, create: bool) -> Result<Option<(PathBuf, GameManifest)>, String> {
    let platform_folder = layout::platform_folder_name(&identity.platform_id);
    let key = identity.game_key();
    let aliases = identity.aliases();
    if let Some((dir, mut manifest)) = find_game_dir(root, &platform_folder, &key, &aliases) {
        let mut changed = manifest.add_aliases(&aliases);
        if manifest.game_key != key {
            changed |= manifest.add_aliases(std::slice::from_ref(&key));
        }
        if changed {
            manifest::write_manifest(&dir, &manifest)?;
        }
        return Ok(Some((dir, manifest)));
    }
    if !create {
        return Ok(None);
    }
    let dir = plan_game_dir(root, &platform_folder, &identity.title, &key);
    let mut manifest = GameManifest::new(&key, &identity.title, &identity.platform_id);
    manifest.add_aliases(&aliases);
    manifest::write_manifest(&dir, &manifest)?;
    Ok(Some((dir, manifest)))
}

/// The platform's "Shared memory cards" folder (PCSX2/ePSXe cards, Dolphin
/// raw cards, DuckStation shared cards).
pub fn open_shared(root: &Path, platform_id: &str, create: bool) -> Result<Option<(PathBuf, GameManifest)>, String> {
    let platform_folder = layout::platform_folder_name(platform_id);
    let key = shared_key(platform_id);
    if let Some(found) = find_game_dir(root, &platform_folder, &key, &[]) {
        return Ok(Some(found));
    }
    if !create {
        return Ok(None);
    }
    let dir = plan_game_dir(root, &platform_folder, layout::SHARED_FOLDER, &key);
    let manifest = GameManifest::new(&key, layout::SHARED_FOLDER, platform_id);
    manifest::write_manifest(&dir, &manifest)?;
    Ok(Some((dir, manifest)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn games_are_found_again_by_key_whatever_the_folder_is_called() {
        let root = crate::backup::layout::tempdir("saves-games");
        let game = GameIdentity::new("ps2", r"C:\Roms\Final Fantasy X (USA).iso", Some("Final Fantasy X"));
        assert!(open_game(&root, &game, false).unwrap().is_none());
        let (dir, _) = open_game(&root, &game, true).unwrap().unwrap();
        assert_eq!(dir, root.join("PS2").join("Final Fantasy X"));
        // Same ROM, another display title: same folder.
        let renamed = GameIdentity::new("ps2", r"D:\Other\Final Fantasy X (USA).iso", Some("FINAL FANTASY X"));
        assert_eq!(open_game(&root, &renamed, false).unwrap().unwrap().0, dir);
        // Another ROM with the same title gets a suffixed folder.
        let other = GameIdentity::new("ps2", r"C:\Roms\Final Fantasy X (Europe).iso", Some("Final Fantasy X"));
        let (other_dir, _) = open_game(&root, &other, true).unwrap().unwrap();
        assert_ne!(other_dir, dir);
        assert!(other_dir.file_name().unwrap().to_string_lossy().starts_with("Final Fantasy X ["));
        // Shared cards have their own folder.
        let (shared, manifest) = open_shared(&root, "ps2", true).unwrap().unwrap();
        assert_eq!(shared, root.join("PS2").join(layout::SHARED_FOLDER));
        assert_eq!(manifest.game_key, "shared:ps2");
        assert_eq!(all_game_dirs(&root).len(), 3);
        let _ = fs::remove_dir_all(root);
    }
}
