//! Full application-data backup and restore.
//!
//! Restore is deliberately staged. The running process never replaces its
//! own database; it validates and extracts the archive, writes a marker, and
//! the next process startup swaps the staged directory into place.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const MANIFEST_NAME: &str = "metadea-backup.json";
const MARKER_NAME: &str = "metadea-pending-restore.json";
const BACKUP_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct BackupManifest {
    format_version: u32,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PendingRestore {
    stage_dir: String,
    backup_path: String,
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn sibling_path(data_dir: &Path, prefix: &str) -> PathBuf {
    let stamp = Utc::now().format("%Y%m%d-%H%M%S%.3f").to_string().replace('.', "-");
    data_dir
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{}-{}", prefix, stamp))
}

fn is_internal_name(name: &str) -> bool {
    name == MARKER_NAME || name.starts_with("metadea-restore-staging-")
}

fn write_directory_to_zip(
    root: &Path,
    current: &Path,
    writer: &mut ZipWriter<File>,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if current == root && is_internal_name(&name) {
            continue;
        }

        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
        let zip_name = relative.to_string_lossy().replace('\\', "/");
        if metadata.is_dir() {
            writer
                .add_directory(format!("{}/", zip_name.trim_end_matches('/')), options)
                .map_err(|e| e.to_string())?;
            write_directory_to_zip(root, &path, writer, options)?;
        } else if metadata.is_file() {
            writer.start_file(zip_name, options).map_err(|e| e.to_string())?;
            let mut input = File::open(&path).map_err(|e| e.to_string())?;
            std::io::copy(&mut input, writer).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn create_backup(data_dir: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() && destination.is_dir() {
        return Err(crate::error_codes::BACKUP_DEST_IS_DIR.into());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = File::create(destination).map_err(|e| e.to_string())?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let manifest = serde_json::to_vec_pretty(&BackupManifest {
        format_version: BACKUP_FORMAT_VERSION,
        created_at: Utc::now().to_rfc3339(),
    })
    .map_err(|e| e.to_string())?;
    writer.start_file(MANIFEST_NAME, options).map_err(|e| e.to_string())?;
    writer.write_all(&manifest).map_err(|e| e.to_string())?;
    write_directory_to_zip(data_dir, data_dir, &mut writer, options)?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn is_inside(path: &Path, directory: &Path) -> bool {
    path.canonicalize()
        .ok()
        .zip(directory.canonicalize().ok())
        .is_some_and(|(path, directory)| path.starts_with(directory))
}

fn safe_zip_path(name: &str) -> Result<PathBuf, String> {
    crate::utils::safe_archive_path(Path::new(name))
        .ok_or_else(|| crate::error_codes::BACKUP_ZIP_UNSAFE_PATH.to_string())
}

fn extract_and_validate(archive_path: &Path, stage_dir: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| crate::error_codes::with_detail(crate::error_codes::BACKUP_ZIP_OPEN, e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| crate::error_codes::with_detail(crate::error_codes::BACKUP_ZIP_INVALID, e))?;
    let mut manifest: Option<BackupManifest> = None;
    let mut has_database = false;

    fs::create_dir_all(stage_dir).map_err(|e| e.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let entry_name = entry.name().replace('\\', "/");
        if entry_name == MANIFEST_NAME {
            let mut contents = String::new();
            entry.read_to_string(&mut contents).map_err(|e| e.to_string())?;
            manifest = Some(serde_json::from_str(&contents).map_err(|_| crate::error_codes::BACKUP_MANIFEST_INVALID.to_string())?);
            continue;
        }
        let relative = safe_zip_path(&entry_name)?;
        if relative.components().next().is_some_and(|component| {
            matches!(component, Component::Normal(name) if name == MARKER_NAME)
        }) {
            return Err(crate::error_codes::BACKUP_ZIP_RESERVED_ENTRY.into());
        }
        if relative == Path::new("metadea.db") {
            has_database = true;
        }
        let destination = stage_dir.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut output = File::create(&destination).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
        }
    }

    let manifest = manifest.ok_or(crate::error_codes::BACKUP_NOT_METADEA)?;
    if manifest.format_version != BACKUP_FORMAT_VERSION {
        return Err(crate::error_codes::with_detail(crate::error_codes::BACKUP_FORMAT_UNSUPPORTED, manifest.format_version));
    }
    if !has_database {
        return Err(crate::error_codes::BACKUP_NO_DATABASE.into());
    }
    Ok(())
}

/// Applies a previously staged restore before the database is opened.
pub fn apply_pending_restore(data_dir: &Path) -> Result<(), String> {
    let marker_path = data_dir.join(MARKER_NAME);
    if !marker_path.exists() {
        return Ok(());
    }
    let marker: PendingRestore = serde_json::from_str(
        &fs::read_to_string(&marker_path).map_err(|e| e.to_string())?,
    )
    .map_err(|e| crate::error_codes::with_detail(crate::error_codes::RESTORE_MARKER_INVALID, e))?;
    let stage_dir = PathBuf::from(marker.stage_dir);
    if !stage_dir.exists() || !stage_dir.is_dir() {
        return Err(crate::error_codes::RESTORE_STAGE_MISSING.into());
    }

    let old_dir = sibling_path(data_dir, "metadea-pre-restore-data");
    fs::rename(data_dir, &old_dir).map_err(|e| crate::error_codes::with_detail(crate::error_codes::RESTORE_MOVE_CURRENT, e))?;
    if let Err(error) = fs::rename(&stage_dir, data_dir) {
        let _ = fs::rename(&old_dir, data_dir);
        return Err(crate::error_codes::with_detail(crate::error_codes::RESTORE_ACTIVATE, error));
    }
    let _ = fs::remove_dir_all(old_dir);
    Ok(())
}

/// Drops a restore marker `apply_pending_restore` could not honour, so the
/// same broken restore is not retried (and does not block startup) on every
/// later launch. The staged directory, if any, is left for the user.
pub(crate) fn discard_pending_restore(data_dir: &Path) {
    let _ = fs::remove_file(data_dir.join(MARKER_NAME));
}

#[tauri::command]
pub async fn export_backup(app_handle: tauri::AppHandle, destination_path: String) -> Result<String, String> {
    let data_dir = app_data_dir(&app_handle)?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let destination = PathBuf::from(destination_path);
    if is_inside(&destination, &data_dir) {
        return Err(crate::error_codes::BACKUP_INSIDE_DATA_DIR.into());
    }
    let destination = if destination.extension().is_none() {
        destination.with_extension("zip")
    } else {
        destination
    };
    create_backup(&data_dir, &destination)?;
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn prepare_restore(app_handle: tauri::AppHandle, backup_path: String) -> Result<String, String> {
    let data_dir = app_data_dir(&app_handle)?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let archive_path = PathBuf::from(backup_path);
    if !archive_path.is_file() {
        return Err(crate::error_codes::BACKUP_FILE_NOT_FOUND.into());
    }

    let automatic_backup = sibling_path(&data_dir, "metadea-pre-restore").with_extension("zip");
    create_backup(&data_dir, &automatic_backup)?;
    let stage_dir = sibling_path(&data_dir, "metadea-restore-staging");
    if stage_dir.exists() {
        fs::remove_dir_all(&stage_dir).map_err(|e| e.to_string())?;
    }
    if let Err(error) = extract_and_validate(&archive_path, &stage_dir) {
        let _ = fs::remove_dir_all(&stage_dir);
        return Err(error);
    }

    let marker = PendingRestore {
        stage_dir: stage_dir.to_string_lossy().to_string(),
        backup_path: automatic_backup.to_string_lossy().to_string(),
    };
    fs::write(data_dir.join(MARKER_NAME), serde_json::to_vec_pretty(&marker).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(automatic_backup.to_string_lossy().to_string())
}
