//! Full application-data backup and restore.
//!
//! A backup is a `.7z` of everything under the app data folder that cannot be
//! rebuilt (see `layout.rs`), with the live database replaced by a consistent
//! snapshot and a manifest of hashes (see `archive.rs`). The ZIP backups of
//! earlier versions still restore (`legacy_zip.rs`).
//!
//! Restore is deliberately staged. The running process never replaces its
//! own database; it validates and extracts the archive, makes a safety
//! backup of the current data, writes a marker, and the next process startup
//! swaps the staged directory into place.

pub mod archive;
pub mod layout;
pub mod legacy_zip;
pub mod progress;
pub mod secrets;
pub mod snapshot;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::error_codes;
use archive::{ArchiveMeta, Manifest};
use progress::{EventProgress, OperationGuard, ProgressSink};

pub const MARKER_NAME: &str = "metadea-pending-restore.json";
/// "Last local export" facts for the Backup tab; machine-local, never backed up.
pub const LOCAL_STATE_FILE_NAME: &str = "backup-state.json";

#[derive(Debug, Serialize, Deserialize)]
struct PendingRestore {
    stage_dir: String,
    backup_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LocalBackupState {
    pub last_export: Option<ExportResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub path: String,
    pub size: u64,
    pub created_at: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    /// `"7z"` or `"zip"` (the pre-0.7 format).
    pub format: &'static str,
    pub created_at: String,
    pub app_version: Option<String>,
    pub schema_version: Option<i64>,
    pub file_count: Option<usize>,
    pub total_size: Option<u64>,
    pub archive_size: u64,
    /// Game saves the backup carries (src/saves/backup.rs); None without.
    pub saves_count: Option<usize>,
    pub saves_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestorePrepared {
    /// The automatic backup of the data being replaced, if there was any.
    pub safety_backup_path: Option<String>,
    /// Saved credentials that could not be decrypted on this machine and
    /// were cleared; the user has to reconnect those accounts.
    pub cleared_secrets: u32,
    pub created_at: String,
    /// Game saves put into the saves folder, and how many of them met a
    /// different local copy (the older of the two went to history).
    pub saves_restored: u32,
    pub saves_conflicts: u32,
}

pub(crate) fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

pub(crate) fn app_version(app: &tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

fn sibling_path(data_dir: &Path, prefix: &str) -> PathBuf {
    let stamp = Utc::now().format("%Y%m%d-%H%M%S%.3f").to_string().replace('.', "-");
    data_dir.parent().unwrap_or_else(|| Path::new(".")).join(format!("{}-{}", prefix, stamp))
}

/// Writes JSON through a temp file + rename, so a crash never leaves a
/// half-written state file.
pub(crate) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

pub(crate) fn read_json_or_default<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

/// A scratch folder next to the data folder, removed when dropped.
pub(crate) struct WorkDir(pub PathBuf);

impl WorkDir {
    pub fn new(data_dir: &Path, prefix: &str) -> Result<Self, String> {
        let dir = sibling_path(data_dir, prefix);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Self(dir))
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Maps every phase an inner step reports to one fixed phase name.
struct FixedPhase<'a> {
    inner: &'a dyn ProgressSink,
    phase: &'static str,
}

impl ProgressSink for FixedPhase<'_> {
    fn report(&self, _phase: &str, percent: f64) {
        self.inner.report(self.phase, percent);
    }
    fn cancelled(&self) -> bool {
        self.inner.cancelled()
    }
}

pub(crate) struct BuiltArchive {
    pub manifest: Manifest,
    pub size: u64,
}

/// Snapshots the database, collects the files and writes the archive to
/// `destination` (through `<destination>.part`). With `skip_if_unchanged`,
/// the content is hashed first and `Ok(None)` is returned when its
/// fingerprint matches — the scheduled upload's "nothing changed" case.
/// With `saves_root`, the game saves go in under `saves/`.
pub(crate) fn build_archive(
    data_dir: &Path,
    app_version: &str,
    destination: &Path,
    skip_if_unchanged: Option<&str>,
    saves_root: Option<&Path>,
    progress: &dyn ProgressSink,
) -> Result<Option<BuiltArchive>, String> {
    let work = WorkDir::new(data_dir, "metadea-backup-work")?;
    progress.report("snapshot", 0.0);
    let snapshot = work.0.join(layout::DATABASE_NAME);
    snapshot::snapshot_database(&data_dir.join(layout::DATABASE_NAME), &snapshot)?;
    let schema_version = snapshot::schema_version_of(&snapshot)?;
    progress.report("snapshot", 100.0);
    progress.check_cancelled()?;

    let (mut sources, excluded) = layout::collect_files(data_dir)?;
    let snapshot_size = fs::metadata(&snapshot).map_err(|e| e.to_string())?.len();
    sources.insert(0, layout::SourceFile { archive_path: layout::DATABASE_NAME.into(), disk_path: snapshot, size: snapshot_size });
    if let Some(root) = saves_root {
        sources.extend(crate::saves::backup::backup_sources(root, &work.0)?);
    }

    if let Some(previous) = skip_if_unchanged {
        let hashed = archive::hash_sources(&sources, progress)?;
        let current = archive::fingerprint(hashed.iter().map(|f| (f.path.as_str(), f.sha256.as_str())));
        if !crate::google_drive::schedule::should_upload(&current, Some(previous)) {
            return Ok(None);
        }
    }

    let part = PathBuf::from(format!("{}.part", destination.display()));
    let meta = ArchiveMeta { app_version, schema_version, excluded };
    let manifest = match archive::write_archive(&sources, &part, meta, progress) {
        Ok(manifest) => manifest,
        Err(error) => {
            let _ = fs::remove_file(&part);
            return Err(error);
        }
    };
    fs::rename(&part, destination).map_err(|e| error_codes::with_detail(error_codes::BACKUP_ARCHIVE_WRITE, e))?;
    let size = fs::metadata(destination).map(|m| m.len()).unwrap_or(0);
    Ok(Some(BuiltArchive { manifest, size }))
}

/// Whether `path` (which may not exist yet) would land inside `directory`,
/// judged by its nearest existing ancestor.
fn is_inside(path: &Path, directory: &Path) -> bool {
    let Ok(directory) = directory.canonicalize() else { return false };
    path.ancestors()
        .skip(1)
        .find_map(|ancestor| ancestor.canonicalize().ok())
        .is_some_and(|ancestor| ancestor.starts_with(&directory))
}

/// Forces the `.7z` extension: a name without one, or with `.zip`, would
/// otherwise hold 7z data under a misleading name.
fn export_destination(requested: &Path) -> PathBuf {
    match requested.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("7z") => requested.to_path_buf(),
        _ => requested.with_extension("7z"),
    }
}

pub(crate) fn export_to(
    data_dir: &Path,
    app_version: &str,
    destination: &Path,
    saves_root: Option<&Path>,
    progress: &dyn ProgressSink,
) -> Result<ExportResult, String> {
    if destination.is_dir() {
        return Err(error_codes::BACKUP_DEST_IS_DIR.into());
    }
    if is_inside(destination, data_dir) {
        return Err(error_codes::BACKUP_INSIDE_DATA_DIR.into());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let built = build_archive(data_dir, app_version, destination, None, saves_root, progress)?
        .ok_or_else(|| error_codes::BACKUP_ARCHIVE_WRITE.to_string())?;
    Ok(ExportResult {
        path: destination.to_string_lossy().to_string(),
        size: built.size,
        created_at: built.manifest.created_at.clone(),
        file_count: built.manifest.files.len(),
    })
}

pub(crate) fn inspect(archive_path: &Path) -> Result<BackupInfo, String> {
    if !archive_path.is_file() {
        return Err(error_codes::BACKUP_FILE_NOT_FOUND.into());
    }
    let archive_size = fs::metadata(archive_path).map(|m| m.len()).unwrap_or(0);
    if archive::is_seven_zip(archive_path) {
        let manifest = archive::read_manifest(archive_path, snapshot::supported_schema_version())?;
        let saves = crate::saves::backup::summarize_archive(manifest.files.iter().map(|f| (f.path.as_str(), f.size)));
        return Ok(BackupInfo {
            format: "7z",
            created_at: manifest.created_at.clone(),
            app_version: Some(manifest.app_version.clone()),
            schema_version: Some(manifest.schema_version),
            file_count: Some(manifest.files.len()),
            total_size: Some(manifest.total_size()),
            archive_size,
            saves_count: saves.map(|s| s.files),
            saves_size: saves.map(|s| s.bytes),
        });
    }
    if legacy_zip::is_zip(archive_path) {
        let manifest = legacy_zip::read_manifest(archive_path)?;
        return Ok(BackupInfo {
            format: "zip",
            created_at: manifest.created_at,
            app_version: None,
            schema_version: None,
            file_count: None,
            total_size: None,
            archive_size,
            saves_count: None,
            saves_size: None,
        });
    }
    Err(error_codes::BACKUP_NOT_METADEA.into())
}

/// Validates and stages `archive_path`, backs up the current data, and
/// leaves the marker `apply_pending_restore` acts on at the next start.
/// Game saves in the backup are merged into `saves_target` (root, history
/// size) right away, never overwriting a newer local file (they live
/// outside the data folder the marker swaps).
pub(crate) fn prepare_restore_from(
    data_dir: &Path,
    app_version: &str,
    archive_path: &Path,
    saves_target: Option<(&Path, u32)>,
    progress: &dyn ProgressSink,
) -> Result<RestorePrepared, String> {
    if !archive_path.is_file() {
        return Err(error_codes::BACKUP_FILE_NOT_FOUND.into());
    }
    fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let supported = snapshot::supported_schema_version();
    let stage_dir = sibling_path(data_dir, "metadea-restore-staging");
    let staged = stage(archive_path, &stage_dir, supported, progress).and_then(|created_at| {
        let staged_db = stage_dir.join(layout::DATABASE_NAME);
        // The manifest's claim is checked against the database itself.
        let schema = snapshot::schema_version_of(&staged_db)?;
        if schema > supported {
            return Err(error_codes::with_detail(error_codes::BACKUP_SCHEMA_NEWER, format!("backup schema {schema} > supported {supported}")));
        }
        snapshot::check_integrity(&staged_db)?;
        let cleared = secrets::clear_foreign_secrets(&staged_db)?;
        Ok((created_at, cleared))
    });
    let (created_at, cleared_secrets) = match staged {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_dir_all(&stage_dir);
            return Err(error);
        }
    };

    let safety_backup_path = if data_dir.join(layout::DATABASE_NAME).is_file() {
        let path = sibling_path(data_dir, "metadea-pre-restore").with_extension("7z");
        let phase = FixedPhase { inner: progress, phase: "safety_backup" };
        if let Err(error) = build_archive(data_dir, app_version, &path, None, None, &phase) {
            let _ = fs::remove_dir_all(&stage_dir);
            return Err(error);
        }
        Some(path.to_string_lossy().to_string())
    } else {
        None
    };

    let (mut saves_restored, mut saves_conflicts) = (0, 0);
    let staged_saves = stage_dir.join(crate::saves::backup::ARCHIVE_PREFIX);
    if staged_saves.is_dir() {
        match saves_target {
            Some((root, keep)) => match crate::saves::merge_restored_saves(&staged_saves, root, keep) {
                Ok(report) => {
                    saves_restored = report.restored;
                    saves_conflicts = report.conflicts;
                }
                Err(error) => log::warn!("Restoring game saves failed: {error}"),
            },
            None => log::warn!("Backup carries game saves but no saves folder is available"),
        }
    }

    let marker = PendingRestore {
        stage_dir: stage_dir.to_string_lossy().to_string(),
        backup_path: safety_backup_path.clone().unwrap_or_default(),
    };
    write_json_atomic(&data_dir.join(MARKER_NAME), &marker)?;
    progress.report("done", 100.0);
    Ok(RestorePrepared { safety_backup_path, cleared_secrets, created_at, saves_restored, saves_conflicts })
}

/// Extracts either format into `stage_dir`; returns the backup's date.
fn stage(archive_path: &Path, stage_dir: &Path, supported: i64, progress: &dyn ProgressSink) -> Result<String, String> {
    if stage_dir.exists() {
        fs::remove_dir_all(stage_dir).map_err(|e| e.to_string())?;
    }
    if archive::is_seven_zip(archive_path) {
        archive::extract_archive(archive_path, stage_dir, supported, progress).map(|m| m.created_at)
    } else if legacy_zip::is_zip(archive_path) {
        legacy_zip::extract_and_validate(archive_path, stage_dir, progress).map(|m| m.created_at)
    } else {
        Err(error_codes::BACKUP_NOT_METADEA.into())
    }
}

/// Applies a previously staged restore before the database is opened.
pub fn apply_pending_restore(data_dir: &Path) -> Result<(), String> {
    let marker_path = data_dir.join(MARKER_NAME);
    if !marker_path.exists() {
        return Ok(());
    }
    let marker: PendingRestore = serde_json::from_str(&fs::read_to_string(&marker_path).map_err(|e| e.to_string())?)
        .map_err(|e| error_codes::with_detail(error_codes::RESTORE_MARKER_INVALID, e))?;
    let stage_dir = PathBuf::from(marker.stage_dir);
    if !stage_dir.exists() || !stage_dir.is_dir() {
        return Err(error_codes::RESTORE_STAGE_MISSING.into());
    }

    let old_dir = sibling_path(data_dir, "metadea-pre-restore-data");
    fs::rename(data_dir, &old_dir).map_err(|e| error_codes::with_detail(error_codes::RESTORE_MOVE_CURRENT, e))?;
    if let Err(error) = fs::rename(&stage_dir, data_dir) {
        let _ = fs::rename(&old_dir, data_dir);
        return Err(error_codes::with_detail(error_codes::RESTORE_ACTIVATE, error));
    }
    carry_over(&old_dir, data_dir);
    let _ = fs::remove_dir_all(old_dir);
    Ok(())
}

/// Moves caches and machine-local state the backup does not carry from the
/// replaced install into the restored one (best effort: all of it is
/// regenerable or re-linkable).
fn carry_over(old_dir: &Path, data_dir: &Path) {
    for name in layout::CARRY_OVER_ON_RESTORE {
        let from = old_dir.join(name);
        let to = data_dir.join(name);
        if from.exists() && !to.exists() {
            let _ = fs::rename(&from, &to);
        }
    }
}

/// Drops a restore marker `apply_pending_restore` could not honour, so the
/// same broken restore is not retried (and does not block startup) on every
/// later launch. The staged directory, if any, is left for the user.
pub(crate) fn discard_pending_restore(data_dir: &Path) {
    let _ = fs::remove_file(data_dir.join(MARKER_NAME));
}

fn local_state_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOCAL_STATE_FILE_NAME)
}

async fn run_blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_backup(app_handle: tauri::AppHandle, destination_path: String) -> Result<ExportResult, String> {
    let guard = OperationGuard::acquire()?;
    let data_dir = app_data_dir(&app_handle)?;
    let version = app_version(&app_handle);
    let app = app_handle.clone();
    let saves_root = crate::saves::backup_root(&app_handle);
    let result = run_blocking(move || {
        let _guard = guard;
        let progress = EventProgress::new(&app, "export");
        let destination = export_destination(Path::new(&destination_path));
        let result = export_to(&data_dir, &version, &destination, saves_root.as_deref(), &progress)?;
        write_json_atomic(&local_state_path(&data_dir), &LocalBackupState { last_export: Some(result.clone()) })?;
        progress.report("done", 100.0);
        Ok(result)
    })
    .await?;
    Ok(result)
}

#[tauri::command]
pub async fn inspect_backup(backup_path: String) -> Result<BackupInfo, String> {
    run_blocking(move || inspect(Path::new(&backup_path))).await
}

#[tauri::command]
pub async fn prepare_restore(app_handle: tauri::AppHandle, backup_path: String) -> Result<RestorePrepared, String> {
    let guard = OperationGuard::acquire()?;
    let data_dir = app_data_dir(&app_handle)?;
    let version = app_version(&app_handle);
    let app = app_handle.clone();
    let saves_target = crate::saves::restore_target(&app_handle);
    run_blocking(move || {
        let _guard = guard;
        let progress = EventProgress::new(&app, "restore");
        let target = saves_target.as_ref().map(|(root, keep)| (root.as_path(), *keep));
        prepare_restore_from(&data_dir, &version, Path::new(&backup_path), target, &progress)
    })
    .await
}

#[tauri::command]
pub fn cancel_backup_operation() -> bool {
    progress::request_cancel()
}

#[tauri::command]
pub async fn get_local_backup_state(app_handle: tauri::AppHandle) -> Result<LocalBackupState, String> {
    let data_dir = app_data_dir(&app_handle)?;
    Ok(read_json_or_default(&local_state_path(&data_dir)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use layout::tempdir;
    use progress::NoProgress;
    use rusqlite::Connection;

    fn fake_install(dir: &Path) {
        fs::create_dir_all(dir.join("user_metadata/avatar")).unwrap();
        fs::create_dir_all(dir.join("metadata/covers")).unwrap();
        fs::write(dir.join("user_metadata/avatar/me.webp"), b"avatar").unwrap();
        fs::write(dir.join("metadata/covers/x.webp"), b"cache").unwrap();
        let conn = Connection::open(dir.join(layout::DATABASE_NAME)).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
             INSERT INTO schema_migrations VALUES (3);
             CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('hello');",
        )
        .unwrap();
    }

    #[test]
    fn export_then_restore_swaps_data_and_keeps_caches() {
        let root = tempdir("backup-e2e");
        let data = root.join("com.metadea.app");
        fake_install(&data);
        let archive = root.join("out").join("backup");
        let exported = export_to(&data, "0.6.0", &export_destination(&archive), None, &NoProgress).unwrap();
        assert!(exported.path.ends_with("backup.7z"));
        let manifest = archive::read_manifest(Path::new(&exported.path), 99).unwrap();
        assert!(manifest.files.iter().all(|f| !f.path.starts_with("metadata/")));
        assert!(manifest.excluded.iter().any(|e| e.starts_with("metadata/")));
        assert_eq!(manifest.schema_version, 3);

        // Local changes after the backup, then restore it.
        fs::write(data.join("user_metadata/avatar/me.webp"), b"changed").unwrap();
        let prepared = prepare_restore_from(&data, "0.6.0", Path::new(&exported.path), None, &NoProgress).unwrap();
        assert!(prepared.safety_backup_path.as_deref().is_some_and(|p| Path::new(p).is_file()));
        assert!(data.join(MARKER_NAME).is_file());

        apply_pending_restore(&data).unwrap();
        assert_eq!(fs::read(data.join("user_metadata/avatar/me.webp")).unwrap(), b"avatar");
        assert_eq!(fs::read(data.join("metadata/covers/x.webp")).unwrap(), b"cache");
        assert!(!data.join(MARKER_NAME).exists());
        let conn = Connection::open(data.join(layout::DATABASE_NAME)).unwrap();
        let body: String = conn.query_row("SELECT body FROM notes", [], |r| r.get(0)).unwrap();
        assert_eq!(body, "hello");
        drop(conn);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restores_an_old_zip_backup() {
        let root = tempdir("backup-legacy-e2e");
        let data = root.join("com.metadea.app");
        fake_install(&data);
        let staged_db = root.join("legacy.db");
        {
            let conn = Connection::open(&staged_db).unwrap();
            conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (2);").unwrap();
        }
        let db_bytes = fs::read(&staged_db).unwrap();
        let archive = root.join("old.zip");
        legacy_zip::tests::write_legacy_backup(&archive, &[("metadea.db", &db_bytes), ("user_metadata/avatar/me.webp", b"old")]);
        assert_eq!(inspect(&archive).unwrap().format, "zip");
        prepare_restore_from(&data, "0.6.0", &archive, None, &NoProgress).unwrap();
        apply_pending_restore(&data).unwrap();
        assert_eq!(fs::read(data.join("user_metadata/avatar/me.webp")).unwrap(), b"old");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn skip_if_unchanged_detects_no_changes() {
        let root = tempdir("backup-unchanged");
        let data = root.join("com.metadea.app");
        fake_install(&data);
        let first = build_archive(&data, "0.6.0", &root.join("a.7z"), None, None, &NoProgress).unwrap().unwrap();
        let fingerprint = first.manifest.fingerprint();
        assert!(build_archive(&data, "0.6.0", &root.join("b.7z"), Some(&fingerprint), None, &NoProgress).unwrap().is_none());
        fs::write(data.join("user_metadata/avatar/me.webp"), b"new").unwrap();
        assert!(build_archive(&data, "0.6.0", &root.join("c.7z"), Some(&fingerprint), None, &NoProgress).unwrap().is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backups_carry_game_saves_and_restores_merge_them() {
        use crate::saves::manifest::{write_manifest, GameManifest};
        let root = tempdir("backup-saves");
        let data = root.join("com.metadea.app");
        fake_install(&data);
        // App data never contributes its own "saves" folder or settings.
        fs::create_dir_all(data.join("saves")).unwrap();
        fs::write(data.join("saves/stray.txt"), b"x").unwrap();
        fs::write(data.join(crate::saves::SETTINGS_FILE), b"{}").unwrap();

        let saves = root.join("Saves");
        let game = saves.join("PS2").join("Final Fantasy X");
        write_manifest(&game, &GameManifest::new("ps2:id-slus20312", "Final Fantasy X", "ps2")).unwrap();
        fs::create_dir_all(game.join("battery")).unwrap();
        fs::write(game.join("battery/Mcd001.ps2"), b"card").unwrap();
        fs::create_dir_all(game.join("states")).unwrap();
        fs::write(game.join("states/s1.p2s"), b"state").unwrap();

        let exported = export_to(&data, "0.7.0", &root.join("out/b.7z"), Some(&saves), &NoProgress).unwrap();
        let manifest = archive::read_manifest(Path::new(&exported.path), 99).unwrap();
        let mut paths: Vec<&str> = manifest.files.iter().map(|f| f.path.as_str()).filter(|p| p.starts_with("saves")).collect();
        paths.sort();
        assert_eq!(paths, vec![
            "saves/.metadea-backup-index.json",
            "saves/PS2/Final Fantasy X/battery/Mcd001.ps2",
            "saves/PS2/Final Fantasy X/metadea-saves.json",
            "saves/PS2/Final Fantasy X/states/s1.p2s",
        ]);
        assert!(manifest.files.iter().all(|f| f.path != crate::saves::SETTINGS_FILE));
        let info = inspect(Path::new(&exported.path)).unwrap();
        assert_eq!(info.saves_count, Some(2));
        assert!(info.saves_size.is_some_and(|size| size >= 9));
        let without = export_to(&data, "0.7.0", &root.join("out/plain.7z"), None, &NoProgress).unwrap();
        assert_eq!(inspect(Path::new(&without.path)).unwrap().saves_count, None);

        // A new PC: empty saves folder. Restore puts them there.
        let new_saves = root.join("NewSaves");
        let prepared = prepare_restore_from(&data, "0.7.0", Path::new(&exported.path), Some((&new_saves, 5)), &NoProgress).unwrap();
        assert_eq!((prepared.saves_restored, prepared.saves_conflicts), (2, 0));
        assert_eq!(fs::read(new_saves.join("PS2/Final Fantasy X/battery/Mcd001.ps2")).unwrap(), b"card");
        apply_pending_restore(&data).unwrap();
        assert!(!data.join("saves").join("PS2").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn export_refuses_the_data_folder() {
        let root = tempdir("backup-inside");
        let data = root.join("com.metadea.app");
        fake_install(&data);
        let error = export_to(&data, "0.6.0", &data.join("x.7z"), None, &NoProgress).unwrap_err();
        assert_eq!(error, error_codes::BACKUP_INSIDE_DATA_DIR);
        let nested = data.join("new").join("folder").join("x.7z");
        assert_eq!(export_to(&data, "0.6.0", &nested, None, &NoProgress).unwrap_err(), error_codes::BACKUP_INSIDE_DATA_DIR);
        let _ = fs::remove_dir_all(root);
    }
}
