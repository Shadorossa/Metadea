//! "Mirror" emulators keep writing to their own folders; Metadea copies
//! around each session:
//!
//! * before launch, every save the manifest knows is compared with the
//!   emulator's copy: a newer central copy is put back (the emulator's file
//!   kept as `.metadea-bak`), a newer native copy is captured first;
//! * after the emulator exits, every save written during the session (or
//!   named after the game) is copied into the central folder, the previous
//!   central battery save going to `.history`.
//!
//! Native files are only ever overwritten after a backup, never deleted.

use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::files::{self, Fingerprint};
use super::layout::{self, GameIdentity, SaveKind};
use super::manifest::{GameManifest, NativeRef};
use super::native::{self, NativeUnit, Profile};

/// Clock/filesystem slack when comparing modification times.
const MTIME_SLACK_MS: i64 = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BeforeLaunch {
    InSync,
    /// The central copy is newer (or the emulator has none): put it back.
    Restore,
    /// The emulator's copy is newer (played outside Metadea): keep it.
    Capture,
}

pub fn decide_before_launch(central: &Fingerprint, native: Option<&Fingerprint>) -> BeforeLaunch {
    match native {
        None => BeforeLaunch::Restore,
        Some(native) if native.sha256 == central.sha256 => BeforeLaunch::InSync,
        Some(native) if central.mtime_ms > native.mtime_ms + MTIME_SLACK_MS => BeforeLaunch::Restore,
        Some(_) => BeforeLaunch::Capture,
    }
}

/// Whether a native save is copied into the central folder. `attributed`:
/// it is this game's (written during its session, named after it, or
/// recorded in its manifest). A newer central copy is never replaced by an
/// older native one.
pub fn should_capture(native: &Fingerprint, central: Option<&Fingerprint>, attributed: bool) -> bool {
    if !attributed {
        return false;
    }
    match central {
        None => true,
        Some(central) if central.sha256 == native.sha256 => false,
        Some(central) => native.mtime_ms + MTIME_SLACK_MS >= central.mtime_ms,
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorReport {
    pub restored: u32,
    pub captured: u32,
    pub skipped: u32,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Copies a native unit into `<game_dir>/<rel>`; the previous central
/// battery save moves into history first.
pub fn capture_unit(game_dir: &Path, rel: &str, kind: SaveKind, native_path: &Path, keep: u32) -> io::Result<Fingerprint> {
    let central = game_dir.join(layout::safe_relative(rel).map_err(io::Error::other)?);
    if central.exists() && (kind == SaveKind::Battery || central.is_dir()) {
        files::rotate_into_history(game_dir, rel, keep)?;
    }
    files::copy_unit(native_path, &central)?;
    files::fingerprint(&central)
}

fn native_path_for(profile: &Profile, native_ref: &NativeRef) -> Option<(PathBuf, PathBuf)> {
    let root = profile.resolve_root(&native_ref.root)?;
    let rel = layout::safe_relative(&native_ref.rel).ok()?;
    let path = root.dir.join(rel);
    layout::is_within(&path, &root.dir).then_some((path, root.dir))
}

/// Before launch: reconciles every save the manifest knows with the
/// emulator's copy (see BeforeLaunch). Returns what changed.
pub fn reconcile_before_launch(game_dir: &Path, manifest: &mut GameManifest, profile: &Profile, keep: u32) -> MirrorReport {
    let mut report = MirrorReport::default();
    let rels: Vec<String> = manifest.entries.keys().cloned().collect();
    for rel in rels {
        let Some(native_ref) = manifest.entries[&rel].native.clone() else { continue };
        let Some(kind) = rel.split('/').next().and_then(SaveKind::from_dir_name) else { continue };
        let Ok(central_rel) = layout::safe_relative(&rel) else { continue };
        let central = game_dir.join(central_rel);
        let Ok(central_fp) = files::fingerprint(&central) else { continue };
        let Some((native_path, _)) = native_path_for(profile, &native_ref) else {
            report.skipped += 1;
            continue;
        };
        let native_fp = files::fingerprint(&native_path).ok();
        let outcome = match decide_before_launch(&central_fp, native_fp.as_ref()) {
            BeforeLaunch::InSync => continue,
            BeforeLaunch::Restore => files::backup_native(&native_path, game_dir, &rel)
                .and_then(|_| files::copy_unit(&central, &native_path))
                .map(|_| report.restored += 1),
            BeforeLaunch::Capture => capture_unit(game_dir, &rel, kind, &native_path, keep).map(|fp| {
                let entry = manifest.entry_mut(&rel);
                entry.sha256 = Some(fp.sha256);
                entry.captured_at = Some(now_rfc3339());
                report.captured += 1;
            }),
        };
        if let Err(error) = outcome {
            log::warn!("Save reconcile failed for {rel}: {error}");
            report.skipped += 1;
        }
    }
    report
}

/// Which native saves an after-session capture (or an import, `since` =
/// None) attributes to this game.
pub fn attributed_units(profile: &Profile, identity: &GameIdentity, manifest: &GameManifest, since: Option<SystemTime>) -> Vec<NativeUnit> {
    let known: Vec<&NativeRef> = manifest.entries.values().filter_map(|entry| entry.native.as_ref()).collect();
    profile
        .existing_roots()
        .iter()
        .flat_map(native::list_units)
        .filter(|unit| {
            let recorded = known.iter().any(|native_ref| native_ref.root == unit.root_id && native_ref.rel == unit.rel);
            let during_session = since.is_some_and(|since| native::modified_since(unit, since));
            // Shared cards are written by every game; only the session says
            // they changed.
            if unit.shared {
                return during_session || (since.is_none() && recorded);
            }
            recorded || during_session || native::unit_matches_game(unit, identity)
        })
        .collect()
}

/// Copies attributed units into the game folder (shared ones into the
/// platform's shared folder) and records where they came from.
pub struct CaptureTarget<'a> {
    pub dir: &'a Path,
    pub manifest: &'a mut GameManifest,
}

pub fn capture_units(units: &[NativeUnit], game: CaptureTarget<'_>, shared: CaptureTarget<'_>, emulator: &str, keep: u32) -> MirrorReport {
    let mut report = MirrorReport::default();
    let CaptureTarget { dir: game_dir, manifest: game_manifest } = game;
    let CaptureTarget { dir: shared_dir, manifest: shared_manifest } = shared;
    for unit in units {
        let (dir, manifest) = if unit.shared { (shared_dir, &mut *shared_manifest) } else { (game_dir, &mut *game_manifest) };
        let rel = unit.central_rel();
        if layout::safe_relative(&rel).is_err() {
            report.skipped += 1;
            continue;
        }
        let Ok(native_fp) = files::fingerprint(&unit.path) else {
            report.skipped += 1;
            continue;
        };
        // Archived and not written since: it stays archived.
        if manifest.tombstone_sha(&rel) == Some(native_fp.sha256.as_str()) {
            continue;
        }
        let central_fp = files::fingerprint(&dir.join(layout::safe_relative(&rel).unwrap_or_default())).ok();
        let entry_native = NativeRef { root: unit.root_id.clone(), rel: unit.rel.clone() };
        if !should_capture(&native_fp, central_fp.as_ref(), true) {
            let entry = manifest.entry_mut(&rel);
            if entry.native.is_none() {
                entry.native = Some(entry_native);
            }
            continue;
        }
        match capture_unit(dir, &rel, unit.kind, &unit.path, keep) {
            Ok(fp) => {
                let entry = manifest.entry_mut(&rel);
                entry.sha256 = Some(fp.sha256);
                entry.native = Some(entry_native);
                entry.emulator = Some(emulator.to_string());
                entry.captured_at = Some(now_rfc3339());
                report.captured += 1;
            }
            Err(error) => {
                log::warn!("Save capture failed for {}: {error}", unit.path.display());
                report.skipped += 1;
            }
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::saves::native::{profile_for, NativeContext};

    fn fp(sha: &str, mtime_ms: i64) -> Fingerprint {
        Fingerprint { sha256: sha.into(), mtime_ms, size: 1 }
    }

    #[test]
    fn before_launch_decisions() {
        let central = fp("a", 10_000);
        assert_eq!(decide_before_launch(&central, None), BeforeLaunch::Restore);
        assert_eq!(decide_before_launch(&central, Some(&fp("a", 1))), BeforeLaunch::InSync);
        assert_eq!(decide_before_launch(&central, Some(&fp("b", 5_000))), BeforeLaunch::Restore);
        // Within the slack, or native newer: the native copy is kept.
        assert_eq!(decide_before_launch(&central, Some(&fp("b", 9_000))), BeforeLaunch::Capture);
        assert_eq!(decide_before_launch(&central, Some(&fp("b", 20_000))), BeforeLaunch::Capture);
    }

    #[test]
    fn capture_decisions() {
        let native = fp("n", 10_000);
        assert!(!should_capture(&native, None, false));
        assert!(should_capture(&native, None, true));
        assert!(!should_capture(&native, Some(&fp("n", 1)), true));
        assert!(should_capture(&native, Some(&fp("c", 5_000)), true));
        assert!(!should_capture(&native, Some(&fp("c", 60_000)), true));
    }

    fn write(path: &Path, bytes: &[u8], mtime: SystemTime) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
        std::fs::File::options().write(true).open(path).unwrap().set_modified(mtime).unwrap();
    }

    #[test]
    fn a_session_round_trip_with_duckstation() {
        let dir = crate::backup::layout::tempdir("saves-mirror");
        let ctx = NativeContext {
            exe_path: dir.join("emu/duckstation-qt.exe"),
            rom_path: dir.join("roms/Crash Bandicoot (USA).chd"),
            documents: Some(dir.join("Documents")),
            ..Default::default()
        };
        let profile = profile_for("DuckStation", &ctx);
        let identity = GameIdentity::new("ps1", &ctx.rom_path.to_string_lossy(), Some("Crash Bandicoot"));
        let memcards = dir.join("Documents/DuckStation/memcards");
        let states = dir.join("Documents/DuckStation/savestates");
        let t0 = SystemTime::now() - std::time::Duration::from_secs(3600);
        write(&memcards.join("Crash Bandicoot (USA)_1.mcd"), b"card-v1", t0);
        write(&memcards.join("Other Game_1.mcd"), b"other", t0);
        write(&memcards.join("shared_card_1.mcd"), b"shared-v1", t0);
        write(&states.join("SCUS94900_1.sav"), b"old-state", t0);

        let game_dir = dir.join("Saves/PS1/Crash Bandicoot");
        let shared_dir = dir.join("Saves/PS1/Shared memory cards");
        let mut manifest = GameManifest::new(&identity.game_key(), &identity.title, "ps1");
        let mut shared_manifest = GameManifest::new("shared:ps1", layout::SHARED_FOLDER, "ps1");

        // Import (no session): only what is named after the game.
        let units = attributed_units(&profile, &identity, &manifest, None);
        assert_eq!(units.iter().map(|u| u.rel.as_str()).collect::<Vec<_>>(), vec!["Crash Bandicoot (USA)_1.mcd"]);
        let report = capture_units(&units, CaptureTarget { dir: &game_dir, manifest: &mut manifest }, CaptureTarget { dir: &shared_dir, manifest: &mut shared_manifest }, "DuckStation", 5);
        assert_eq!(report.captured, 1);
        assert_eq!(std::fs::read(game_dir.join("battery/Crash Bandicoot (USA)_1.mcd")).unwrap(), b"card-v1");
        let entry = &manifest.entries["battery/Crash Bandicoot (USA)_1.mcd"];
        assert_eq!(entry.native.as_ref().unwrap().root, "duckstation:memcards");
        // Idempotent.
        let again = capture_units(&units, CaptureTarget { dir: &game_dir, manifest: &mut manifest }, CaptureTarget { dir: &shared_dir, manifest: &mut shared_manifest }, "DuckStation", 5);
        assert_eq!(again.captured, 0);

        // A session: the card, a new state and the shared card are written.
        let session_start = SystemTime::now() - std::time::Duration::from_secs(60);
        write(&memcards.join("Crash Bandicoot (USA)_1.mcd"), b"card-v2", SystemTime::now());
        write(&states.join("SCUS94900_2.sav"), b"new-state", SystemTime::now());
        write(&memcards.join("shared_card_1.mcd"), b"shared-v2", SystemTime::now());
        let units = attributed_units(&profile, &identity, &manifest, Some(session_start));
        let mut rels: Vec<&str> = units.iter().map(|u| u.rel.as_str()).collect();
        rels.sort();
        assert_eq!(rels, vec!["Crash Bandicoot (USA)_1.mcd", "SCUS94900_2.sav", "shared_card_1.mcd"]);
        let report = capture_units(&units, CaptureTarget { dir: &game_dir, manifest: &mut manifest }, CaptureTarget { dir: &shared_dir, manifest: &mut shared_manifest }, "DuckStation", 5);
        assert_eq!(report.captured, 3);
        assert_eq!(std::fs::read(game_dir.join("battery/Crash Bandicoot (USA)_1.mcd")).unwrap(), b"card-v2");
        assert_eq!(std::fs::read(shared_dir.join("battery/shared_card_1.mcd")).unwrap(), b"shared-v2");
        assert_eq!(std::fs::read(game_dir.join("states/SCUS94900_2.sav")).unwrap(), b"new-state");
        let history = files::history_versions(&game_dir, "battery/Crash Bandicoot (USA)_1.mcd");
        assert_eq!(history.len(), 1);
        assert_eq!(std::fs::read(&history[0].path).unwrap(), b"card-v1");

        // The emulator's card gets corrupted/rolled back to an older copy:
        // the next launch restores the central one and keeps a backup.
        write(&memcards.join("Crash Bandicoot (USA)_1.mcd"), b"broken", t0);
        let report = reconcile_before_launch(&game_dir, &mut manifest, &profile, 5);
        assert_eq!(report.restored, 1);
        assert_eq!(std::fs::read(memcards.join("Crash Bandicoot (USA)_1.mcd")).unwrap(), b"card-v2");
        assert_eq!(std::fs::read(memcards.join("Crash Bandicoot (USA)_1.mcd.metadea-bak")).unwrap(), b"broken");
        // Nothing left to do the second time.
        assert_eq!(reconcile_before_launch(&game_dir, &mut manifest, &profile, 5), MirrorReport::default());

        // Deleted from the emulator: restored, nothing else touched.
        std::fs::remove_file(states.join("SCUS94900_2.sav")).unwrap();
        assert_eq!(reconcile_before_launch(&game_dir, &mut manifest, &profile, 5).restored, 1);
        assert_eq!(std::fs::read(states.join("SCUS94900_2.sav")).unwrap(), b"new-state");
        assert_eq!(std::fs::read(memcards.join("Other Game_1.mcd")).unwrap(), b"other");
        let _ = std::fs::remove_dir_all(dir);
    }
}
