// In-app reader for comics/manga/books — extracts an archive's pages once
// into a per-archive cache directory under <app_data_dir>/metadata/
// comic_cache/ (already inside the asset-protocol scope granted in
// tauri.conf.json, so the frontend can wrapAssetUrl() every page straight
// off disk instead of round-tripping each one through IPC as base64) and
// hands back the sorted list of page paths. Re-extraction is skipped once a
// ".extracted" marker file is present, the same "cache, don't redo" idea
// custom_image/metadata caching already uses elsewhere in this codebase.
//
// CBR (RAR) only for now — CBZ/PDF/EPUB are meant to reuse this same
// extract_comic_archive command, just adding a case to extract_by_format
// once those are actually implemented.
use crate::db::ToStringErr;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct ComicPages {
    pub pages: Vec<String>,
    pub cache_dir: String,
}

fn cache_root(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle.path().app_data_dir().str_err()?.join("metadata").join("comic_cache"))
}

// Stable, filesystem-safe directory name for one archive — hashed so the
// cache dir doesn't inherit the source file's own (possibly very long or
// Unicode-heavy) name/path.
fn archive_cache_key(path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

// Some archives wrap every page in one internal folder (release-group tag,
// etc.) instead of storing them flat — walks recursively rather than a
// single read_dir so those pages are still found.
fn collect_images(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            collect_images(&path, out)?;
        } else if is_image(&path) {
            out.push(path);
        }
    }
    Ok(())
}

// "page2.jpg" before "page10.jpg" — a plain string sort would put "10"
// before "2". Walks both strings in parallel, comparing runs of ASCII
// digits numerically and everything else character-by-character.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut ai, mut bi) = (a.chars().peekable(), b.chars().peekable());
    loop {
        return match (ai.peek(), bi.peek()) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Less,
            (Some(_), None) => Ordering::Greater,
            (Some(&ca), Some(&cb)) if ca.is_ascii_digit() && cb.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(&c) = ai.peek() { if c.is_ascii_digit() { na.push(c); ai.next(); } else { break; } }
                let mut nb = String::new();
                while let Some(&c) = bi.peek() { if c.is_ascii_digit() { nb.push(c); bi.next(); } else { break; } }
                let (va, vb): (u64, u64) = (na.parse().unwrap_or(0), nb.parse().unwrap_or(0));
                match va.cmp(&vb) { Ordering::Equal => continue, other => other }
            }
            (Some(&ca), Some(&cb)) => match ca.cmp(&cb) {
                Ordering::Equal => { ai.next(); bi.next(); continue; }
                other => other,
            },
        };
    }
}

fn extract_rar(src: &Path, dest: &Path) -> Result<(), String> {
    let mut archive = unrar::Archive::new(src)
        .open_for_processing()
        .map_err(|e| format!("No se pudo abrir el CBR: {e}"))?;

    while let Some(header) = archive
        .read_header()
        .map_err(|e| format!("Error leyendo el CBR: {e}"))?
    {
        let entry = header.entry();
        archive = if entry.is_file() && is_image(&entry.filename) {
            header
                .extract_with_base(dest)
                .map_err(|e| format!("Error extrayendo página: {e}"))?
        } else {
            header.skip().map_err(|e| format!("Error leyendo el CBR: {e}"))?
        };
    }
    Ok(())
}

fn extract_by_format(ext: &str, src: &Path, dest: &Path) -> Result<(), String> {
    match ext {
        "cbr" | "rar" => extract_rar(src, dest),
        other => Err(format!("Formato no soportado todavía: .{other}")),
    }
}

#[tauri::command]
pub async fn extract_comic_archive(app_handle: tauri::AppHandle, path: String) -> Result<ComicPages, String> {
    let src = PathBuf::from(&path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let dest = cache_root(&app_handle)?.join(archive_cache_key(&path));
    let marker = dest.join(".extracted");

    if !marker.exists() {
        std::fs::create_dir_all(&dest).str_err()?;
        extract_by_format(&ext, &src, &dest)?;
        std::fs::write(&marker, "").str_err()?;
    }

    let mut paths = Vec::new();
    collect_images(&dest, &mut paths).str_err()?;
    if paths.is_empty() {
        return Err("No se encontraron páginas (imágenes) en el archivo.".to_string());
    }

    let mut pages: Vec<String> = paths.into_iter().map(|p| p.to_string_lossy().to_string()).collect();
    pages.sort_by(|a, b| natural_cmp(a, b));

    Ok(ComicPages { pages, cache_dir: dest.to_string_lossy().to_string() })
}
