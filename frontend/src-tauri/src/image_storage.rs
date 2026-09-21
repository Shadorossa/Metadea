//! File-backed storage for image data that belongs to the local profile or
//! the local catalog cache. The database stores compact, versioned pointers;
//! callers can resolve those pointers to data URLs where legacy consumers or
//! collaborative exports still expect inline image data.

use rusqlite::Connection;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

const REFERENCE_PREFIX: &str = "metadea-image:v1:";
const IMAGE_DIRECTORY: &str = "user_metadata/images";

fn parse_data_url(value: &str) -> Result<Option<(&str, Vec<u8>)>, String> {
    let Some(rest) = value.strip_prefix("data:") else { return Ok(None) };
    let (metadata, encoded) = rest.split_once(',').ok_or("Invalid image data URL")?;
    let mime = metadata
        .split(';')
        .next()
        .filter(|mime| mime.starts_with("image/"))
        .ok_or("Only image data URLs can be stored as image assets")?;
    if !metadata.split(';').any(|part| part.eq_ignore_ascii_case("base64")) {
        return Err("Image data URL must be base64 encoded".into());
    }
    Ok(Some((mime, crate::utils::base64_decode(encoded)?)))
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        _ => "img",
    }
}

fn hash_bytes(bytes: impl Iterator<Item = u8>) -> u64 {
    // Small stable FNV-1a hash: filenames only need collision resistance for
    // accidental duplicates, not cryptographic integrity.
    bytes.fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}

fn safe_component(value: &str) -> String {
    let safe: String = value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' })
        .take(48)
        .collect();
    if safe.is_empty() { "image".into() } else { safe }
}

fn relative_asset_path(namespace: &str, owner: &str, mime: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if namespace.is_empty() || !namespace.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
        return Err("Invalid image asset namespace".into());
    }
    let hash = hash_bytes(owner.bytes().chain(bytes.iter().copied()));
    Ok(Path::new(IMAGE_DIRECTORY)
        .join(namespace)
        .join(format!("{}-{hash:016x}.{}", safe_component(owner), extension_for_mime(mime))))
}

/// Writes a data URL before its database reference is committed. The
/// content-addressed filename makes retries safe and leaves replaced files
/// available to old backups or in-flight readers.
pub fn store_image_value(data_dir: &Path, namespace: &str, owner: &str, value: &str) -> Result<String, String> {
    let Some((mime, bytes)) = parse_data_url(value)? else { return Ok(value.to_string()) };
    let relative = relative_asset_path(namespace, owner, mime, &bytes)?;
    let path = data_dir.join(&relative);
    let parent = path.parent().ok_or("Invalid image storage path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    if !path.exists() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temp_path = parent.join(format!(".image-{nonce}.tmp"));
        let write_result = (|| -> Result<(), String> {
            let mut file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            fs::rename(&temp_path, &path).map_err(|e| e.to_string())?;
            Ok(())
        })();
        let _ = fs::remove_file(&temp_path);
        if let Err(error) = write_result {
            // A concurrent writer may have completed the same content-addressed
            // asset; the verification below decides whether it is safe to use.
            if !path.exists() { return Err(error); }
        }
    }

    let persisted = fs::read(&path).map_err(|e| e.to_string())?;
    if persisted != bytes {
        return Err("Image file verification failed".into());
    }

    let normalized = relative.to_string_lossy().replace('\\', "/");
    Ok(format!("{REFERENCE_PREFIX}{mime}:{normalized}"))
}

fn resolve_reference(data_dir: &Path, value: &str) -> Result<Option<String>, String> {
    let Some(reference) = value.strip_prefix(REFERENCE_PREFIX) else { return Ok(Some(value.to_string())) };
    let (mime, relative) = reference.split_once(':').ok_or("Invalid Metadea image reference")?;
    if !mime.starts_with("image/") {
        return Err("Invalid image MIME type in Metadea reference".into());
    }
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path.components().any(|component| !matches!(component, Component::Normal(_)))
        || !relative.replace('\\', "/").starts_with("user_metadata/images/")
    {
        return Err("Unsafe Metadea image reference".into());
    }

    let path = data_dir.join(relative_path);
    if !path.exists() { return Ok(None); }
    let canonical_root = data_dir.join(IMAGE_DIRECTORY).canonicalize().map_err(|e| e.to_string())?;
    let canonical_path = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Image reference escapes Metadea's image directory".into());
    }
    let bytes = fs::read(canonical_path).map_err(|e| e.to_string())?;
    Ok(Some(format!("data:{mime};base64,{}", crate::utils::base64_encode(&bytes))))
}

pub fn resolve_image_value(data_dir: &Path, value: Option<String>) -> Result<Option<String>, String> {
    value.map(|value| resolve_reference(data_dir, &value)).transpose().map(Option::flatten)
}

struct InlineImageRow {
    table: &'static str,
    key_column: &'static str,
    key: String,
    image_column: &'static str,
    value: String,
}

fn collect_inline_rows(
    conn: &Connection,
    table: &'static str,
    key_column: &'static str,
    image_column: &'static str,
) -> Result<Vec<InlineImageRow>, String> {
    let sql = format!(
        "SELECT {key_column}, {image_column} FROM {table} WHERE {image_column} LIKE 'data:image/%;base64,%'"
    );
    let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows
        .filter_map(Result::ok)
        .map(|(key, value)| InlineImageRow { table, key_column, key, image_column, value })
        .collect())
}

/// Idempotently migrates legacy base64 images out of SQLite. Each file is
/// written and verified first; only then is the exact old cell replaced.
/// If interrupted, untouched rows remain readable and already migrated rows
/// are skipped on the next launch.
pub fn migrate_inline_images(data_dir: &Path, conn: &Connection) -> Result<usize, String> {
    let mut rows = Vec::new();
    for (table, key, image) in [
        ("user_profile", "id", "avatar_data"),
        ("user_profile", "id", "banner_data"),
        ("user_profile", "id", "share_avatar_data"),
        ("story_arcs", "id", "image_base64"),
        ("characters", "external_id", "image_url"),
    ] {
        rows.extend(collect_inline_rows(conn, table, key, image)?);
    }

    let mut migrated = 0;
    for row in rows {
        let namespace = match row.table {
            "user_profile" => "profile",
            "story_arcs" => "story-arcs",
            "characters" => "characters",
            _ => continue,
        };
        let reference = store_image_value(data_dir, namespace, &row.key, &row.value)?;
        let sql = format!(
            "UPDATE {} SET {} = ?1 WHERE {} = ?2 AND {} = ?3",
            row.table, row.image_column, row.key_column, row.image_column
        );
        migrated += conn
            .execute(&sql, rusqlite::params![reference, row.key, row.value])
            .map_err(|e| e.to_string())?;
    }
    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_and_resolves_image_data_without_changing_the_render_contract() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metadea-image-storage-{unique}"));
        fs::create_dir_all(&root).unwrap();
        let data_url = format!("data:image/png;base64,{}", crate::utils::base64_encode(b"test-image"));
        let reference = store_image_value(&root, "characters", "character:test", &data_url).unwrap();
        assert!(reference.starts_with(REFERENCE_PREFIX));
        assert_eq!(resolve_reference(&root, &reference).unwrap().as_deref(), Some(data_url.as_str()));
        fs::remove_dir_all(root).unwrap();
    }
}
