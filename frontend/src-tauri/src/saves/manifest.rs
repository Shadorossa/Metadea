//! `metadea-saves.json`, one per game folder: which game it is, the labels
//! the user gave its saves, where each save came from (so it can be put
//! back) and what was archived. It travels with the folder (a copy of the
//! folder, a backup, Google Drive), so everything the UI needs is in it.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

use super::layout::MANIFEST_NAME;

pub const MANIFEST_VERSION: u32 = 1;
pub const LABEL_MAX_CHARS: usize = 120;

fn manifest_version() -> u32 {
    MANIFEST_VERSION
}

/// Where a save lives in the emulator's own folders: the profile root it
/// was found under (`duckstation:memcards`) and its path relative to that
/// root. Resolved against this PC's folders at restore time, so it stays
/// valid on another computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativeRef {
    pub root: String,
    pub rel: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// RFC 3339; decides which label wins when two copies are merged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label_updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<NativeRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emulator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchivedEntry {
    /// `battery/…` or `states/…` as it was before archiving.
    pub rel: String,
    /// Where it went, relative to the game folder.
    pub archived_to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub archived_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameManifest {
    #[serde(default = "manifest_version")]
    pub version: u32,
    pub game_key: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub platform_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emulator: Option<String>,
    /// Keyed by `battery/<rel>` / `states/<rel>` (`/`-separated).
    #[serde(default)]
    pub entries: BTreeMap<String, ManifestEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub archived: Vec<ArchivedEntry>,
}

impl GameManifest {
    pub fn new(game_key: &str, title: &str, platform_id: &str) -> Self {
        Self {
            version: MANIFEST_VERSION,
            game_key: game_key.to_string(),
            aliases: Vec::new(),
            title: title.to_string(),
            platform_id: platform_id.to_string(),
            emulator: None,
            entries: BTreeMap::new(),
            archived: Vec::new(),
        }
    }

    pub fn is_for(&self, key: &str, aliases: &[String]) -> bool {
        let mine: Vec<&str> = std::iter::once(self.game_key.as_str()).chain(self.aliases.iter().map(String::as_str)).collect();
        std::iter::once(key).chain(aliases.iter().map(String::as_str)).any(|candidate| mine.contains(&candidate))
    }

    pub fn add_aliases(&mut self, aliases: &[String]) -> bool {
        let mut changed = false;
        for alias in aliases {
            if alias != &self.game_key && !self.aliases.contains(alias) {
                self.aliases.push(alias.clone());
                changed = true;
            }
        }
        changed
    }

    pub fn entry_mut(&mut self, rel: &str) -> &mut ManifestEntry {
        self.entries.entry(rel.to_string()).or_default()
    }

    /// Sets (or clears, with None/blank) a label. Returns false when the
    /// label is longer than LABEL_MAX_CHARS.
    pub fn set_label(&mut self, rel: &str, label: Option<&str>, now: &str) -> bool {
        let label = label.map(str::trim).filter(|label| !label.is_empty());
        if label.is_some_and(|label| label.chars().count() > LABEL_MAX_CHARS) {
            return false;
        }
        let entry = self.entry_mut(rel);
        entry.label = label.map(str::to_string);
        entry.label_updated_at = Some(now.to_string());
        true
    }

    /// Merges the copy of another PC (Drive) into this one: entries are
    /// unioned, the newer label wins, this PC's hashes and native paths are
    /// kept (they describe this PC's files), archive records are unioned.
    pub fn merge(&self, other: &GameManifest) -> GameManifest {
        let mut merged = self.clone();
        for alias in std::iter::once(&other.game_key).chain(other.aliases.iter()) {
            if alias != &merged.game_key && !merged.aliases.contains(alias) {
                merged.aliases.push(alias.clone());
            }
        }
        if merged.title.is_empty() {
            merged.title = other.title.clone();
        }
        for (rel, theirs) in &other.entries {
            match merged.entries.get_mut(rel) {
                None => {
                    merged.entries.insert(rel.clone(), theirs.clone());
                }
                Some(mine) => {
                    let theirs_newer = match (&mine.label_updated_at, &theirs.label_updated_at) {
                        (None, Some(_)) => true,
                        (Some(a), Some(b)) => later_than(b, a),
                        _ => false,
                    };
                    if theirs_newer {
                        mine.label = theirs.label.clone();
                        mine.label_updated_at = theirs.label_updated_at.clone();
                    }
                    if mine.native.is_none() {
                        mine.native = theirs.native.clone();
                    }
                }
            }
        }
        for archived in &other.archived {
            if !merged.archived.iter().any(|a| a.rel == archived.rel && a.archived_at == archived.archived_at) {
                merged.archived.push(archived.clone());
            }
        }
        merged
    }

    /// The sha256 an archived `rel` had, the latest archive first.
    pub fn tombstone_sha(&self, rel: &str) -> Option<&str> {
        self.archived.iter().rev().find(|a| a.rel == rel).and_then(|a| a.sha256.as_deref())
    }
}

fn later_than(a: &str, b: &str) -> bool {
    match (chrono::DateTime::parse_from_rfc3339(a), chrono::DateTime::parse_from_rfc3339(b)) {
        (Ok(a), Ok(b)) => a > b,
        _ => a > b,
    }
}

pub fn manifest_path(game_dir: &Path) -> std::path::PathBuf {
    game_dir.join(MANIFEST_NAME)
}

pub fn read_manifest(game_dir: &Path) -> Option<GameManifest> {
    let bytes = std::fs::read(manifest_path(game_dir)).ok()?;
    parse_manifest(&bytes)
}

pub fn parse_manifest(bytes: &[u8]) -> Option<GameManifest> {
    let text = std::str::from_utf8(bytes).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

pub fn write_manifest(game_dir: &Path, manifest: &GameManifest) -> Result<(), String> {
    std::fs::create_dir_all(game_dir).map_err(|e| crate::error_codes::with_detail(crate::error_codes::SAVES_IO, e))?;
    crate::backup::write_json_atomic(&manifest_path(game_dir), manifest)
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::SAVES_IO, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> GameManifest {
        let mut manifest = GameManifest::new("ps2:id-slus20312", "Final Fantasy X", "ps2");
        manifest.emulator = Some("PCSX2".into());
        manifest.set_label("states/SLUS-20312 (5BBC0D6E).01.p2s", Some("  Before Yunalesca "), "2026-09-23T10:00:00Z");
        let entry = manifest.entry_mut("states/SLUS-20312 (5BBC0D6E).01.p2s");
        entry.sha256 = Some("ab".repeat(32));
        entry.native = Some(NativeRef { root: "pcsx2:sstates".into(), rel: "SLUS-20312 (5BBC0D6E).01.p2s".into() });
        manifest
    }

    #[test]
    fn labels_round_trip_through_json() {
        let manifest = sample();
        let json = serde_json::to_vec_pretty(&manifest).unwrap();
        let back = parse_manifest(&json).unwrap();
        assert_eq!(back, manifest);
        assert_eq!(back.entries["states/SLUS-20312 (5BBC0D6E).01.p2s"].label.as_deref(), Some("Before Yunalesca"));
        // A BOM (Notepad) and unknown fields do not break it.
        let mut with_bom = "\u{feff}".as_bytes().to_vec();
        with_bom.extend_from_slice(br#"{"game_key":"x","future":1}"#);
        let parsed = parse_manifest(&with_bom).unwrap();
        assert_eq!(parsed.version, MANIFEST_VERSION);
        assert!(parsed.entries.is_empty());
    }

    #[test]
    fn clearing_and_capping_labels() {
        let mut manifest = sample();
        assert!(manifest.set_label("battery/x", Some("   "), "2026-09-23T10:00:00Z"));
        assert_eq!(manifest.entries["battery/x"].label, None);
        assert!(!manifest.set_label("battery/x", Some(&"x".repeat(LABEL_MAX_CHARS + 1)), "t"));
    }

    #[test]
    fn merge_keeps_the_newer_label_and_local_paths() {
        let local = sample();
        let mut remote = sample();
        let rel = "states/SLUS-20312 (5BBC0D6E).01.p2s";
        remote.set_label(rel, Some("Route B"), "2026-09-24T10:00:00Z");
        remote.entry_mut(rel).native = Some(NativeRef { root: "pcsx2:sstates".into(), rel: "other".into() });
        remote.set_label("battery/Mcd001.ps2", Some("Main card"), "2026-09-20T10:00:00Z");
        let merged = local.merge(&remote);
        assert_eq!(merged.entries[rel].label.as_deref(), Some("Route B"));
        assert_eq!(merged.entries[rel].native.as_ref().unwrap().rel, "SLUS-20312 (5BBC0D6E).01.p2s");
        assert_eq!(merged.entries["battery/Mcd001.ps2"].label.as_deref(), Some("Main card"));
        // Older remote label loses.
        let mut stale = sample();
        stale.set_label(rel, Some("Old"), "2026-09-01T10:00:00Z");
        assert_eq!(local.merge(&stale).entries[rel].label.as_deref(), Some("Before Yunalesca"));
    }

    #[test]
    fn identity_matches_key_or_alias() {
        let mut manifest = sample();
        assert!(manifest.is_for("ps2:id-slus20312", &[]));
        assert!(!manifest.is_for("ps2:other", &[]));
        assert!(manifest.add_aliases(&["ps2:finalfantasyx".into()]));
        assert!(!manifest.add_aliases(&["ps2:finalfantasyx".into()]));
        assert!(manifest.is_for("ps2:finalfantasyx", &[]));
        assert!(manifest.is_for("ps2:new", &["ps2:id-slus20312".into()]));
    }

    #[test]
    fn manifest_file_round_trip() {
        let dir = crate::backup::layout::tempdir("saves-manifest");
        let manifest = sample();
        write_manifest(&dir, &manifest).unwrap();
        assert_eq!(read_manifest(&dir), Some(manifest));
        let _ = std::fs::remove_dir_all(dir);
    }
}
