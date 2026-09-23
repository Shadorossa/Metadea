//! The `.7z` backup format (format version 2): LZMA2, one stream per file,
//! and a `manifest.json` entry written last that lists every file with its
//! size and SHA-256 plus what was deliberately left out.
//!
//! Reading never trusts the archive: every entry must be in the manifest
//! with the same size, every path must stay inside the staging folder, the
//! hashes are checked while extracting, and sizes are capped before anything
//! is decompressed.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sevenz_rust2::{ArchiveEntry, ArchiveReader, ArchiveWriter, Password};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use super::layout::SourceFile;
use super::progress::ProgressSink;
use crate::error_codes::{self, with_detail};

pub const MANIFEST_NAME: &str = "manifest.json";
pub const FORMAT_NAME: &str = "metadea-backup";
pub const FORMAT_VERSION: u32 = 2;
/// First bytes of every 7z archive.
pub const SEVEN_ZIP_MAGIC: &[u8] = &[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];

/// Refuse archives beyond these before decompressing anything.
pub const MAX_ENTRIES: usize = 500_000;
pub const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub app_version: String,
    pub schema_version: i64,
    pub created_at: String,
    pub files: Vec<ManifestFile>,
    #[serde(default)]
    pub excluded: Vec<String>,
}

impl Manifest {
    pub fn total_size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }

    /// Identity of the backed-up content, independent of when it was taken:
    /// the scheduled Drive upload compares it with the last uploaded one.
    pub fn fingerprint(&self) -> String {
        fingerprint(self.files.iter().map(|f| (f.path.as_str(), f.sha256.as_str())))
    }
}

pub fn fingerprint<'a>(files: impl Iterator<Item = (&'a str, &'a str)>) -> String {
    let mut pairs: Vec<(&str, &str)> = files.collect();
    pairs.sort();
    let mut hasher = Sha256::new();
    for (path, sha) in pairs {
        hasher.update(path.as_bytes());
        hasher.update(b"\0");
        hasher.update(sha.as_bytes());
        hasher.update(b"\n");
    }
    hex(&hasher.finalize())
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

/// Hashes the sources without compressing them (the scheduled upload's
/// "did anything change?" check), reporting progress as `hashing`.
pub fn hash_sources(sources: &[SourceFile], progress: &dyn ProgressSink) -> Result<Vec<ManifestFile>, String> {
    let total: u64 = sources.iter().map(|s| s.size).sum::<u64>().max(1);
    let mut done = 0u64;
    let mut out = Vec::with_capacity(sources.len());
    for source in sources {
        progress.check_cancelled()?;
        let sha256 = sha256_file(&source.disk_path)?;
        done += source.size;
        progress.report("hashing", done as f64 * 100.0 / total as f64);
        out.push(ManifestFile { path: source.archive_path.clone(), size: source.size, sha256 });
    }
    Ok(out)
}

/// Reader that hashes and counts what the 7z encoder pulls through it.
struct HashingReader<'a, R: Read> {
    inner: R,
    hasher: Sha256,
    bytes: u64,
    on_bytes: &'a dyn Fn(u64) -> bool,
}

impl<R: Read> Read for HashingReader<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let read = self.inner.read(buf)?;
        self.hasher.update(&buf[..read]);
        self.bytes += read as u64;
        if !(self.on_bytes)(read as u64) {
            return Err(std::io::Error::other("cancelled"));
        }
        Ok(read)
    }
}

pub struct ArchiveMeta<'a> {
    pub app_version: &'a str,
    pub schema_version: i64,
    pub excluded: Vec<String>,
}

/// Writes `sources` into a new `.7z` at `destination` and returns the
/// manifest it appended. The caller writes to a temporary path and renames
/// on success, so a cancelled export never leaves a half archive behind
/// under the final name.
pub fn write_archive(
    sources: &[SourceFile],
    destination: &Path,
    meta: ArchiveMeta<'_>,
    progress: &dyn ProgressSink,
) -> Result<Manifest, String> {
    let total: u64 = sources.iter().map(|s| s.size).sum::<u64>().max(1);
    let done = std::cell::Cell::new(0u64);
    let on_bytes = |read: u64| {
        done.set(done.get() + read);
        progress.report("compress", done.get() as f64 * 100.0 / total as f64);
        !progress.cancelled()
    };

    let mut writer = ArchiveWriter::create(destination).map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_WRITE, e))?;
    let mut files = Vec::with_capacity(sources.len());
    for source in sources {
        progress.check_cancelled()?;
        let input = File::open(&source.disk_path).map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_WRITE, e))?;
        let mut reader = HashingReader { inner: input, hasher: Sha256::new(), bytes: 0, on_bytes: &on_bytes };
        let entry = ArchiveEntry::from_path(&source.disk_path, source.archive_path.clone());
        let pushed = writer.push_archive_entry(entry, Some(&mut reader));
        progress.check_cancelled()?;
        pushed.map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_WRITE, e))?;
        files.push(ManifestFile {
            path: source.archive_path.clone(),
            size: reader.bytes,
            sha256: hex(&reader.hasher.finalize()),
        });
    }

    let manifest = Manifest {
        format: FORMAT_NAME.into(),
        format_version: FORMAT_VERSION,
        app_version: meta.app_version.into(),
        schema_version: meta.schema_version,
        created_at: chrono::Utc::now().to_rfc3339(),
        files,
        excluded: meta.excluded,
    };
    let manifest_json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    writer
        .push_archive_entry(ArchiveEntry::new_file(MANIFEST_NAME), Some(manifest_json.as_slice()))
        .map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_WRITE, e))?;
    let mut output = writer.finish().map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_WRITE, e))?;
    output.flush().map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_WRITE, e))?;
    output.sync_all().map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_WRITE, e))?;
    Ok(manifest)
}

pub fn is_seven_zip(path: &Path) -> bool {
    let mut magic = [0u8; 6];
    File::open(path).and_then(|mut f| f.read_exact(&mut magic)).is_ok() && magic == SEVEN_ZIP_MAGIC
}

fn open_reader(path: &Path) -> Result<ArchiveReader<File>, String> {
    ArchiveReader::open(path, Password::empty()).map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_INVALID, e))
}

/// Reads and checks the manifest and the archive listing against each other
/// without extracting anything: format, schema, sizes, limits, paths.
pub fn read_manifest(path: &Path, supported_schema: i64) -> Result<Manifest, String> {
    let mut reader = open_reader(path)?;
    let entries: Vec<ArchiveEntry> = reader.archive().files.clone();
    if entries.len() > MAX_ENTRIES {
        return Err(with_detail(error_codes::BACKUP_TOO_LARGE, format!("{} entries", entries.len())));
    }
    let manifest_entry = entries
        .iter()
        .find(|e| !e.is_directory() && e.name() == MANIFEST_NAME)
        .ok_or(error_codes::BACKUP_NOT_METADEA)?;
    if manifest_entry.size() > MAX_MANIFEST_BYTES {
        return Err(with_detail(error_codes::BACKUP_TOO_LARGE, "manifest"));
    }
    let bytes = reader.read_file(MANIFEST_NAME).map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_INVALID, e))?;
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| error_codes::BACKUP_MANIFEST_INVALID.to_string())?;
    validate_manifest(&manifest, &entries, supported_schema)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &Manifest, entries: &[ArchiveEntry], supported_schema: i64) -> Result<(), String> {
    if manifest.format != FORMAT_NAME {
        return Err(error_codes::BACKUP_NOT_METADEA.into());
    }
    if manifest.format_version != FORMAT_VERSION {
        return Err(with_detail(error_codes::BACKUP_FORMAT_UNSUPPORTED, manifest.format_version));
    }
    if manifest.schema_version > supported_schema {
        return Err(with_detail(
            error_codes::BACKUP_SCHEMA_NEWER,
            format!("backup schema {} > supported {}", manifest.schema_version, supported_schema),
        ));
    }
    if manifest.total_size() > MAX_TOTAL_BYTES {
        return Err(with_detail(error_codes::BACKUP_TOO_LARGE, manifest.total_size()));
    }
    let mut expected: HashMap<&str, u64> = HashMap::with_capacity(manifest.files.len());
    for file in &manifest.files {
        stage_relative_path(&file.path)?;
        if file.sha256.len() != 64 || expected.insert(file.path.as_str(), file.size).is_some() {
            return Err(error_codes::BACKUP_MANIFEST_INVALID.into());
        }
    }
    if !expected.contains_key(super::layout::DATABASE_NAME) {
        return Err(error_codes::BACKUP_NO_DATABASE.into());
    }
    let mut seen = 0usize;
    for entry in entries.iter().filter(|e| !e.is_directory() && e.name() != MANIFEST_NAME) {
        match expected.get(entry.name()) {
            Some(size) if *size == entry.size() => seen += 1,
            Some(_) => return Err(with_detail(error_codes::BACKUP_HASH_MISMATCH, entry.name())),
            None => return Err(with_detail(error_codes::BACKUP_MANIFEST_INVALID, format!("unlisted entry {}", entry.name()))),
        }
    }
    if seen != expected.len() {
        return Err(with_detail(error_codes::BACKUP_MANIFEST_INVALID, "missing entries"));
    }
    Ok(())
}

/// Where an archive path may land inside the staging folder: no absolute
/// paths, no `..`, and never one of the internal marker names.
pub fn stage_relative_path(name: &str) -> Result<PathBuf, String> {
    let relative = crate::utils::safe_archive_path(Path::new(name))
        .ok_or_else(|| error_codes::BACKUP_ZIP_UNSAFE_PATH.to_string())?;
    if relative.components().next().is_some_and(|c| matches!(c, Component::Normal(n) if n == super::MARKER_NAME)) {
        return Err(error_codes::BACKUP_ZIP_RESERVED_ENTRY.into());
    }
    Ok(relative)
}

/// Validates `archive` and extracts it into `stage_dir`, checking every
/// file's size and SHA-256 against the manifest as it is written.
pub fn extract_archive(
    archive: &Path,
    stage_dir: &Path,
    supported_schema: i64,
    progress: &dyn ProgressSink,
) -> Result<Manifest, String> {
    let manifest = read_manifest(archive, supported_schema)?;
    let expected: HashMap<String, &ManifestFile> = manifest.files.iter().map(|f| (f.path.clone(), f)).collect();
    let total = manifest.total_size().max(1);
    fs::create_dir_all(stage_dir).map_err(|e| e.to_string())?;

    let mut reader = open_reader(archive)?;
    let mut failure: Option<String> = None;
    let mut done = 0u64;
    let mut written = 0usize;
    let result = reader.for_each_entries(|entry, data| {
        if entry.is_directory() || entry.name() == MANIFEST_NAME {
            return Ok(true);
        }
        let outcome = extract_entry(entry.name(), data, stage_dir, &expected, &mut |read| {
            done += read;
            progress.report("extract", done as f64 * 100.0 / total as f64);
            !progress.cancelled()
        });
        match outcome {
            Ok(()) => {
                written += 1;
                Ok(true)
            }
            Err(error) => {
                failure = Some(error);
                Ok(false)
            }
        }
    });
    if let Some(error) = failure {
        return Err(error);
    }
    progress.check_cancelled()?;
    result.map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_INVALID, e))?;
    if written != expected.len() {
        return Err(with_detail(error_codes::BACKUP_MANIFEST_INVALID, "missing entries"));
    }
    Ok(manifest)
}

fn extract_entry(
    name: &str,
    data: &mut dyn Read,
    stage_dir: &Path,
    expected: &HashMap<String, &ManifestFile>,
    on_bytes: &mut dyn FnMut(u64) -> bool,
) -> Result<(), String> {
    let relative = stage_relative_path(name)?;
    let listed = expected
        .get(name)
        .ok_or_else(|| with_detail(error_codes::BACKUP_MANIFEST_INVALID, format!("unlisted entry {name}")))?;
    let destination = stage_dir.join(relative);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut output = File::create(&destination).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let read = data.read(&mut buffer).map_err(|e| with_detail(error_codes::BACKUP_ARCHIVE_INVALID, e))?;
        if read == 0 {
            break;
        }
        size += read as u64;
        // Never write more than the manifest promised.
        if size > listed.size {
            return Err(with_detail(error_codes::BACKUP_HASH_MISMATCH, name));
        }
        hasher.update(&buffer[..read]);
        output.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
        if !on_bytes(read as u64) {
            return Err(error_codes::BACKUP_CANCELLED.into());
        }
    }
    if size != listed.size || hex(&hasher.finalize()) != listed.sha256 {
        return Err(with_detail(error_codes::BACKUP_HASH_MISMATCH, name));
    }
    output.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::layout::tempdir;
    use crate::backup::progress::NoProgress;

    fn sources(dir: &Path) -> Vec<SourceFile> {
        let files = [("metadea.db", b"database bytes".as_slice()), ("user_metadata/avatar/me.webp", b"avatar"), ("ui_themes/t/theme.json", b"{}"), ("ui_themes/t/empty.css", b"")];
        files
            .iter()
            .map(|(name, bytes)| {
                let path = dir.join(name);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(&path, bytes).unwrap();
                SourceFile { archive_path: name.to_string(), disk_path: path, size: bytes.len() as u64 }
            })
            .collect()
    }

    fn meta(schema_version: i64) -> ArchiveMeta<'static> {
        ArchiveMeta { app_version: "0.6.0", schema_version, excluded: vec!["metadata/ (regenerable cache)".into()] }
    }

    #[test]
    fn round_trip_create_validate_extract() {
        let dir = tempdir("archive-roundtrip");
        let src = sources(&dir.join("src"));
        let archive = dir.join("backup.7z");
        let written = write_archive(&src, &archive, meta(5), &NoProgress).unwrap();
        assert!(is_seven_zip(&archive));
        assert_eq!(written.files.len(), 4);
        assert_eq!(written.files[0].sha256, hex(&Sha256::digest(b"database bytes")));

        let read = read_manifest(&archive, 5).unwrap();
        assert_eq!(read, written);
        let stage = dir.join("stage");
        extract_archive(&archive, &stage, 5, &NoProgress).unwrap();
        assert_eq!(fs::read(stage.join("user_metadata/avatar/me.webp")).unwrap(), b"avatar");
        assert_eq!(fs::read(stage.join("metadea.db")).unwrap(), b"database bytes");
        assert_eq!(fs::read(stage.join("ui_themes/t/empty.css")).unwrap(), b"");
        assert!(!stage.join(MANIFEST_NAME).exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn refuses_a_newer_schema() {
        let dir = tempdir("archive-schema");
        let src = sources(&dir.join("src"));
        let archive = dir.join("backup.7z");
        write_archive(&src, &archive, meta(99), &NoProgress).unwrap();
        let error = read_manifest(&archive, 81).unwrap_err();
        assert!(error.starts_with(error_codes::BACKUP_SCHEMA_NEWER), "{error}");
        let _ = fs::remove_dir_all(dir);
    }

    /// Builds an archive whose manifest is supplied by the test.
    fn archive_with_manifest(path: &Path, files: &[(&str, &[u8])], manifest: &Manifest) {
        let mut writer = ArchiveWriter::create(path).unwrap();
        for (name, bytes) in files {
            writer.push_archive_entry(ArchiveEntry::new_file(name), Some(*bytes)).unwrap();
        }
        let json = serde_json::to_vec(manifest).unwrap();
        writer.push_archive_entry(ArchiveEntry::new_file(MANIFEST_NAME), Some(json.as_slice())).unwrap();
        writer.finish().unwrap();
    }

    fn manifest_for(files: &[(&str, &[u8])]) -> Manifest {
        Manifest {
            format: FORMAT_NAME.into(),
            format_version: FORMAT_VERSION,
            app_version: "0.6.0".into(),
            schema_version: 1,
            created_at: "2026-09-23T00:00:00Z".into(),
            files: files
                .iter()
                .map(|(name, bytes)| ManifestFile { path: name.to_string(), size: bytes.len() as u64, sha256: hex(&Sha256::digest(bytes)) })
                .collect(),
            excluded: vec![],
        }
    }

    #[test]
    fn rejects_a_hash_mismatch() {
        let dir = tempdir("archive-hash");
        let files: [(&str, &[u8]); 2] = [("metadea.db", b"db"), ("user_metadata/a.png", b"real")];
        let mut manifest = manifest_for(&files);
        manifest.files[1].sha256 = hex(&Sha256::digest(b"fake"));
        let archive = dir.join("tampered.7z");
        archive_with_manifest(&archive, &files, &manifest);
        let error = extract_archive(&archive, &dir.join("stage"), 81, &NoProgress).unwrap_err();
        assert!(error.starts_with(error_codes::BACKUP_HASH_MISMATCH), "{error}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_path_traversal() {
        let dir = tempdir("archive-traversal");
        let files: [(&str, &[u8]); 2] = [("metadea.db", b"db"), ("../evil.txt", b"x")];
        let archive = dir.join("evil.7z");
        archive_with_manifest(&archive, &files, &manifest_for(&files));
        let error = extract_archive(&archive, &dir.join("stage"), 81, &NoProgress).unwrap_err();
        assert_eq!(error, error_codes::BACKUP_ZIP_UNSAFE_PATH);
        assert!(!dir.join("evil.txt").exists());
        assert!(stage_relative_path("C:/Windows/evil.dll").is_err());
        assert!(stage_relative_path("/etc/passwd").is_err());
        assert_eq!(stage_relative_path(super::super::MARKER_NAME).unwrap_err(), error_codes::BACKUP_ZIP_RESERVED_ENTRY);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_unlisted_entries_and_a_missing_database() {
        let dir = tempdir("archive-unlisted");
        let files: [(&str, &[u8]); 2] = [("metadea.db", b"db"), ("extra.bin", b"x")];
        let mut manifest = manifest_for(&files);
        manifest.files.pop();
        let archive = dir.join("unlisted.7z");
        archive_with_manifest(&archive, &files, &manifest);
        assert!(read_manifest(&archive, 81).unwrap_err().starts_with(error_codes::BACKUP_MANIFEST_INVALID));

        let files: [(&str, &[u8]); 1] = [("notes.txt", b"x")];
        let archive = dir.join("nodb.7z");
        archive_with_manifest(&archive, &files, &manifest_for(&files));
        assert_eq!(read_manifest(&archive, 81).unwrap_err(), error_codes::BACKUP_NO_DATABASE);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fingerprint_ignores_order_and_time() {
        let a = fingerprint([("b", "2"), ("a", "1")].into_iter());
        let b = fingerprint([("a", "1"), ("b", "2")].into_iter());
        assert_eq!(a, b);
        assert_ne!(a, fingerprint([("a", "1"), ("b", "3")].into_iter()));
    }
}
