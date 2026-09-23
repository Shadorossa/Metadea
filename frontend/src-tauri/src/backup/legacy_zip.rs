//! Restore of the original `.zip` backups (format version 1): a copy of the
//! whole data folder plus `metadea-backup.json`. Still accepted so a backup
//! made with an older Metadea can always be restored; new backups are `.7z`
//! (see `archive.rs`).

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

use super::archive::{stage_relative_path, MAX_ENTRIES, MAX_TOTAL_BYTES};
use super::progress::ProgressSink;
use crate::error_codes::{self, with_detail};

pub const LEGACY_MANIFEST_NAME: &str = "metadea-backup.json";
pub const LEGACY_FORMAT_VERSION: u32 = 1;
/// First bytes of a ZIP local file header.
const ZIP_MAGIC: &[u8] = b"PK\x03\x04";

#[derive(Debug, Serialize, Deserialize)]
pub struct LegacyManifest {
    pub format_version: u32,
    pub created_at: String,
}

pub fn is_zip(path: &Path) -> bool {
    let mut magic = [0u8; 4];
    File::open(path).and_then(|mut f| f.read_exact(&mut magic)).is_ok() && magic == ZIP_MAGIC
}

fn open(archive_path: &Path) -> Result<ZipArchive<File>, String> {
    let file = File::open(archive_path).map_err(|e| with_detail(error_codes::BACKUP_ZIP_OPEN, e))?;
    ZipArchive::new(file).map_err(|e| with_detail(error_codes::BACKUP_ZIP_INVALID, e))
}

/// The manifest alone, for the confirmation dialog.
pub fn read_manifest(archive_path: &Path) -> Result<LegacyManifest, String> {
    let mut archive = open(archive_path)?;
    let mut entry = archive.by_name(LEGACY_MANIFEST_NAME).map_err(|_| error_codes::BACKUP_NOT_METADEA.to_string())?;
    let mut contents = String::new();
    entry.by_ref().take(1024 * 1024).read_to_string(&mut contents).map_err(|e| e.to_string())?;
    let manifest: LegacyManifest =
        serde_json::from_str(&contents).map_err(|_| error_codes::BACKUP_MANIFEST_INVALID.to_string())?;
    if manifest.format_version != LEGACY_FORMAT_VERSION {
        return Err(with_detail(error_codes::BACKUP_FORMAT_UNSUPPORTED, manifest.format_version));
    }
    Ok(manifest)
}

pub fn extract_and_validate(archive_path: &Path, stage_dir: &Path, progress: &dyn ProgressSink) -> Result<LegacyManifest, String> {
    let mut archive = open(archive_path)?;
    if archive.len() > MAX_ENTRIES {
        return Err(with_detail(error_codes::BACKUP_TOO_LARGE, format!("{} entries", archive.len())));
    }
    let mut manifest: Option<LegacyManifest> = None;
    let mut has_database = false;
    let mut total = 0u64;
    for index in 0..archive.len() {
        total = total.saturating_add(archive.by_index_raw(index).map_err(|e| e.to_string())?.size());
    }
    if total > MAX_TOTAL_BYTES {
        return Err(with_detail(error_codes::BACKUP_TOO_LARGE, total));
    }

    fs::create_dir_all(stage_dir).map_err(|e| e.to_string())?;
    let mut done = 0u64;
    for index in 0..archive.len() {
        progress.check_cancelled()?;
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let entry_name = entry.name().replace('\\', "/");
        if entry_name == LEGACY_MANIFEST_NAME {
            let mut contents = String::new();
            entry.by_ref().take(1024 * 1024).read_to_string(&mut contents).map_err(|e| e.to_string())?;
            manifest = Some(serde_json::from_str(&contents).map_err(|_| error_codes::BACKUP_MANIFEST_INVALID.to_string())?);
            continue;
        }
        let relative = stage_relative_path(&entry_name)?;
        if relative == Path::new(super::layout::DATABASE_NAME) {
            has_database = true;
        }
        let destination = stage_dir.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let declared = entry.size();
            let mut output = File::create(&destination).map_err(|e| e.to_string())?;
            // `take` caps a lying size header; the ZIP reader checks CRCs.
            let copied = std::io::copy(&mut entry.by_ref().take(declared), &mut output).map_err(|e| e.to_string())?;
            done += copied;
            progress.report("extract", done as f64 * 100.0 / total.max(1) as f64);
        }
    }

    let manifest = manifest.ok_or(error_codes::BACKUP_NOT_METADEA)?;
    if manifest.format_version != LEGACY_FORMAT_VERSION {
        return Err(with_detail(error_codes::BACKUP_FORMAT_UNSUPPORTED, manifest.format_version));
    }
    if !has_database {
        return Err(error_codes::BACKUP_NO_DATABASE.into());
    }
    Ok(manifest)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::backup::layout::tempdir;
    use crate::backup::progress::NoProgress;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /// A backup exactly as the ZIP-era `create_backup` wrote it.
    pub(crate) fn write_legacy_backup(path: &Path, files: &[(&str, &[u8])]) {
        let mut writer = ZipWriter::new(File::create(path).unwrap());
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        writer.start_file(LEGACY_MANIFEST_NAME, options).unwrap();
        writer.write_all(br#"{"format_version":1,"created_at":"2026-01-01T00:00:00Z"}"#).unwrap();
        for (name, bytes) in files {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn old_format_restore_still_works() {
        let dir = tempdir("legacy-restore");
        let archive = dir.join("old.zip");
        write_legacy_backup(&archive, &[("metadea.db", b"db"), ("user_metadata/avatar/me.webp", b"img")]);
        assert!(is_zip(&archive));
        assert_eq!(read_manifest(&archive).unwrap().format_version, 1);
        let stage = dir.join("stage");
        extract_and_validate(&archive, &stage, &NoProgress).unwrap();
        assert_eq!(fs::read(stage.join("user_metadata/avatar/me.webp")).unwrap(), b"img");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn old_format_rejects_traversal() {
        let dir = tempdir("legacy-traversal");
        let archive = dir.join("evil.zip");
        write_legacy_backup(&archive, &[("metadea.db", b"db"), ("../evil.txt", b"x")]);
        let error = extract_and_validate(&archive, &dir.join("stage"), &NoProgress).unwrap_err();
        assert_eq!(error, error_codes::BACKUP_ZIP_UNSAFE_PATH);
        let _ = fs::remove_dir_all(dir);
    }
}
