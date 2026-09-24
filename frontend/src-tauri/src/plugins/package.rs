//! Reading a plugin package (a `.zip` or a folder) into a staging folder.
//! Everything in a package is untrusted: entry names must be relative paths
//! that stay inside the destination (no `..`, absolute paths, drive prefixes
//! or symlinks), and the entry count, each file and the total are capped —
//! on the bytes actually decompressed, not on the sizes the archive claims.
//! A package may wrap everything in one top-level folder (what zipping a
//! folder usually produces); that folder is stripped.
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};

use crate::error_codes::{self, with_detail};

use super::manifest::MANIFEST_FILE;

pub const MAX_ENTRIES: usize = 2_000;
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;
/// A downloaded (compressed) package.
pub const MAX_ARCHIVE_BYTES: u64 = 25 * 1024 * 1024;

fn invalid(detail: impl std::fmt::Display) -> String {
    with_detail(error_codes::PLUGIN_PACKAGE_INVALID, detail)
}

fn too_large(detail: impl std::fmt::Display) -> String {
    with_detail(error_codes::PLUGIN_PACKAGE_TOO_LARGE, detail)
}

fn io(detail: impl std::fmt::Display) -> String {
    with_detail(error_codes::PLUGIN_IO, detail)
}

/// Normalised (`/`-separated) relative path, or an error for anything that
/// could leave the destination.
fn safe_relative(name: &str) -> Result<PathBuf, String> {
    if name.contains('\0') {
        return Err(invalid(format!("entry \"{}\" has a NUL byte", name.replace('\0', "?"))));
    }
    // A colon is a drive prefix or an NTFS alternate data stream on Windows
    // and never needed in a package, on any platform.
    if name.contains(':') {
        return Err(invalid(format!("unsafe path \"{name}\"")));
    }
    crate::utils::safe_archive_path(Path::new(name)).ok_or_else(|| invalid(format!("unsafe path \"{name}\"")))
}

/// First component shared by every entry, when the manifest is not at the
/// root but inside that single folder.
fn wrapper_prefix(files: &[PathBuf]) -> Option<PathBuf> {
    if files.iter().any(|f| f == Path::new(MANIFEST_FILE)) {
        return None;
    }
    let first = files.first()?.components().next()?.as_os_str().to_owned();
    let all_inside = files.iter().all(|f| f.components().count() > 1 && f.components().next().is_some_and(|c| c.as_os_str() == first));
    let prefix = PathBuf::from(first);
    (all_inside && files.iter().any(|f| f == &prefix.join(MANIFEST_FILE))).then_some(prefix)
}

struct Budget {
    entries: usize,
    total: u64,
}

impl Budget {
    fn new() -> Self {
        Self { entries: 0, total: 0 }
    }

    fn add_entry(&mut self) -> Result<(), String> {
        self.entries += 1;
        if self.entries > MAX_ENTRIES {
            return Err(too_large(format!("more than {MAX_ENTRIES} entries")));
        }
        Ok(())
    }

    fn add_bytes(&mut self, bytes: u64) -> Result<(), String> {
        self.total += bytes;
        if self.total > MAX_TOTAL_BYTES {
            return Err(too_large(format!("more than {} MB uncompressed", MAX_TOTAL_BYTES / 1024 / 1024)));
        }
        Ok(())
    }
}

/// Copies at most MAX_FILE_BYTES from `reader` into `dest`, failing when
/// the source holds more.
fn copy_capped(reader: &mut dyn Read, dest: &Path, name: &Path, budget: &mut Budget) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(io)?;
    }
    let mut out = std::fs::File::create(dest).map_err(io)?;
    let written = std::io::copy(&mut reader.take(MAX_FILE_BYTES + 1), &mut out).map_err(invalid)?;
    if written > MAX_FILE_BYTES {
        return Err(too_large(format!("{} is larger than {} MB", name.display(), MAX_FILE_BYTES / 1024 / 1024)));
    }
    budget.add_bytes(written)
}

const S_IFMT: u32 = 0o170_000;
const S_IFLNK: u32 = 0o120_000;

/// Extracts a zip archive into `dest` (which must exist and be empty).
pub fn extract_zip<R: Read + Seek>(reader: R, dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(reader).map_err(invalid)?;
    if archive.len() > MAX_ENTRIES {
        return Err(too_large(format!("more than {MAX_ENTRIES} entries")));
    }
    // First pass: names only, so the wrapper folder is known before writing.
    let mut files = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(invalid)?;
        let name = entry.name().to_string();
        let relative = safe_relative(&name)?;
        if entry.unix_mode().is_some_and(|mode| mode & S_IFMT == S_IFLNK) {
            return Err(invalid(format!("\"{name}\" is a symbolic link")));
        }
        if !entry.is_dir() {
            files.push((index, relative));
        }
    }
    let names: Vec<PathBuf> = files.iter().map(|(_, rel)| rel.clone()).collect();
    let prefix = wrapper_prefix(&names);
    let mut budget = Budget::new();
    for (index, relative) in files {
        budget.add_entry()?;
        let relative = match &prefix {
            Some(prefix) => relative.strip_prefix(prefix).map(Path::to_path_buf).unwrap_or(relative),
            None => relative,
        };
        let mut entry = archive.by_index(index).map_err(invalid)?;
        copy_capped(&mut entry, &dest.join(&relative), &relative, &mut budget)?;
    }
    Ok(())
}

fn walk_folder(root: &Path, dir: &Path, out: &mut Vec<PathBuf>, budget: &mut Budget) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(io)? {
        let entry = entry.map_err(io)?;
        let file_type = entry.file_type().map_err(io)?;
        let path = entry.path();
        if file_type.is_symlink() {
            return Err(invalid(format!("{} is a symbolic link", path.display())));
        }
        if file_type.is_dir() {
            walk_folder(root, &path, out, budget)?;
        } else if file_type.is_file() {
            budget.add_entry()?;
            let relative = path.strip_prefix(root).map_err(invalid)?.to_path_buf();
            out.push(relative);
        }
    }
    Ok(())
}

/// Copies a package folder into `dest`, with the same limits as a zip.
pub fn copy_folder(source: &Path, dest: &Path) -> Result<(), String> {
    let mut files = Vec::new();
    walk_folder(source, source, &mut files, &mut Budget::new())?;
    let prefix = wrapper_prefix(&files);
    let mut budget = Budget::new();
    for relative in files {
        let target = match &prefix {
            Some(prefix) => relative.strip_prefix(prefix).map(Path::to_path_buf).unwrap_or_else(|_| relative.clone()),
            None => relative.clone(),
        };
        let mut file = std::fs::File::open(source.join(&relative)).map_err(io)?;
        copy_capped(&mut file, &dest.join(&target), &target, &mut budget)?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    pub(crate) fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "metadea-plugin-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub(crate) fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            for (name, data) in entries {
                writer.start_file(*name, SimpleFileOptions::default()).unwrap();
                writer.write_all(data).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer.into_inner()
    }

    #[test]
    fn extracts_a_flat_package() {
        let dest = temp_dir("flat");
        extract_zip(Cursor::new(zip_of(&[("manifest.json", b"{}"), ("main.js", b"x"), ("img/icon.png", b"p")])), &dest).unwrap();
        assert!(dest.join("manifest.json").is_file());
        assert!(dest.join("img").join("icon.png").is_file());
        std::fs::remove_dir_all(dest).ok();
    }

    #[test]
    fn strips_a_single_wrapper_folder() {
        let dest = temp_dir("wrapped");
        extract_zip(Cursor::new(zip_of(&[("my-plugin/manifest.json", b"{}"), ("my-plugin/main.js", b"x")])), &dest).unwrap();
        assert!(dest.join("manifest.json").is_file());
        assert!(dest.join("main.js").is_file());
        std::fs::remove_dir_all(dest).ok();
    }

    #[test]
    fn rejects_path_traversal_and_absolute_entries() {
        for evil in ["../evil.js", "a/../../evil.js", "/etc/evil.js", "..\\..\\evil.js", "C:/evil.js", "C:\\evil.js"] {
            let dest = temp_dir("evil");
            let result = extract_zip(Cursor::new(zip_of(&[("manifest.json", b"{}"), (evil, b"x")])), &dest);
            let error = result.expect_err(evil);
            assert!(error.starts_with(error_codes::PLUGIN_PACKAGE_INVALID), "{evil}: {error}");
            assert!(!dest.parent().unwrap().join("evil.js").exists());
            std::fs::remove_dir_all(dest).ok();
        }
    }

    #[test]
    fn caps_decompressed_size() {
        let dest = temp_dir("big");
        let big = vec![0u8; (MAX_FILE_BYTES + 1) as usize];
        let error = extract_zip(Cursor::new(zip_of(&[("manifest.json", b"{}"), ("big.bin", &big)])), &dest).unwrap_err();
        assert!(error.starts_with(error_codes::PLUGIN_PACKAGE_TOO_LARGE), "{error}");
        std::fs::remove_dir_all(dest).ok();
    }

    #[test]
    fn rejects_garbage() {
        let dest = temp_dir("garbage");
        assert!(extract_zip(Cursor::new(b"not a zip".to_vec()), &dest).is_err());
        std::fs::remove_dir_all(dest).ok();
    }

    #[test]
    fn copies_a_folder() {
        let source = temp_dir("src");
        std::fs::create_dir_all(source.join("inner")).unwrap();
        std::fs::write(source.join("inner").join("manifest.json"), "{}").unwrap();
        std::fs::write(source.join("inner").join("main.js"), "x").unwrap();
        let dest = temp_dir("dst");
        copy_folder(&source, &dest).unwrap();
        assert!(dest.join("manifest.json").is_file());
        std::fs::remove_dir_all(source).ok();
        std::fs::remove_dir_all(dest).ok();
    }
}
