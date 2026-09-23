use base64::{engine::general_purpose::STANDARD, Engine};

pub fn base64_encode(input: &[u8]) -> String {
    STANDARD.encode(input)
}

pub fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    STANDARD.decode(input).map_err(|e| e.to_string())
}

// ─── Secret storage ───────────────────────────────────────────────────────────
// Every secret persisted in the local database (OAuth tokens, API keys)
// goes through Windows DPAPI in user scope and is stored as base64; on
// other platforms only the base64 layer applies.

#[cfg(target_os = "windows")]
fn protect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    windows_dpapi::encrypt_data(bytes, windows_dpapi::Scope::User)
        .map_err(|e| format!("Encryption failed: {:?}", e))
}

#[cfg(target_os = "windows")]
fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    windows_dpapi::decrypt_data(bytes, windows_dpapi::Scope::User)
        .map_err(|e| format!("Decryption failed: {:?}", e))
}

#[cfg(not(target_os = "windows"))]
fn protect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    Ok(bytes.to_vec())
}

#[cfg(not(target_os = "windows"))]
fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    Ok(bytes.to_vec())
}

pub(crate) fn encrypt_secret(secret: &str) -> Result<String, String> {
    Ok(base64_encode(&protect(secret.as_bytes())?))
}

pub(crate) fn decrypt_secret(stored: &str) -> Result<String, String> {
    let bytes = unprotect(&base64_decode(stored)?)?;
    String::from_utf8(bytes).map_err(|e| format!("Invalid UTF-8: {}", e))
}

/// Read side for values that existing installs wrote in plaintext before
/// they were routed through `encrypt_secret` (the app_auth token and the
/// app_env API keys): a stored value that does not decrypt is taken as-is.
/// Every write path encrypts, so such a row is upgraded the next time it is
/// saved. On Windows a plaintext value that happens to be valid base64 still
/// fails DPAPI's blob check, so it cannot be mistaken for an encrypted one.
pub(crate) fn decrypt_secret_or_plaintext(stored: &str) -> String {
    decrypt_secret(stored).unwrap_or_else(|_| stored.to_string())
}

/// Rebuilds an archive entry's path so it can only ever land inside the
/// destination directory: absolute paths, drive prefixes and `..` components
/// are rejected outright rather than normalised away.
///
/// Used by every archive extractor — the ZIP reader gets this for free from
/// `enclosed_name()`, but `unrar` hands back the raw stored name, so a `.cbr`
/// with an entry called `..\..\evil.png` would otherwise write outside the
/// cache directory.
pub fn safe_archive_path(name: &std::path::Path) -> Option<std::path::PathBuf> {
    use std::path::{Component, PathBuf};

    if name.is_absolute() {
        return None;
    }
    // Archives store whichever separator the writer's platform used, so a
    // `.cbr` written on Windows carries `..\..\evil.png`. On Unix that is a
    // single filename component and would pass a components-only check, so
    // normalise to `/` before inspecting.
    let normalised = name.to_string_lossy().replace('\\', "/");
    let name = std::path::Path::new(&normalised);
    if name.is_absolute() {
        return None;
    }
    let mut safe = PathBuf::new();
    for component in name.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if safe.as_os_str().is_empty() {
        None
    } else {
        Some(safe)
    }
}

#[cfg(test)]
mod safe_archive_path_tests {
    use super::safe_archive_path;
    use std::path::{Path, PathBuf};

    #[test]
    fn keeps_a_plain_relative_entry() {
        assert_eq!(
            safe_archive_path(Path::new("pages/001.jpg")),
            Some(PathBuf::from("pages").join("001.jpg"))
        );
    }

    #[test]
    fn drops_current_dir_components() {
        assert_eq!(
            safe_archive_path(Path::new("./pages/./001.jpg")),
            Some(PathBuf::from("pages").join("001.jpg"))
        );
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        assert_eq!(safe_archive_path(Path::new("../evil.png")), None);
        assert_eq!(safe_archive_path(Path::new("pages/../../evil.png")), None);
    }

    #[test]
    fn rejects_windows_style_traversal() {
        assert_eq!(safe_archive_path(Path::new(r"..\..\evil.png")), None);
    }

    #[test]
    fn rejects_absolute_paths() {
        assert_eq!(safe_archive_path(Path::new("/etc/passwd")), None);
        assert_eq!(safe_archive_path(Path::new(r"C:\Windows\System32\evil.dll")), None);
    }

    #[test]
    fn rejects_an_empty_entry() {
        assert_eq!(safe_archive_path(Path::new("")), None);
        assert_eq!(safe_archive_path(Path::new("./")), None);
    }
}
