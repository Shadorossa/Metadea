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

fn extract_zip(src: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(src)
        .map_err(|e| format!("No se pudo abrir el archivo ZIP/CBZ: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Error leyendo ZIP/CBZ: {e}"))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Error leyendo entrada ZIP: {e}"))?;
        let outpath = match file.enclosed_name() {
            Some(path) => dest.join(path),
            None => continue,
        };
        if file.is_dir() {
            let _ = std::fs::create_dir_all(&outpath);
        } else if is_image(&outpath) {
            if let Some(p) = outpath.parent() {
                let _ = std::fs::create_dir_all(p);
            }
            let mut outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("Error creando archivo: {e}"))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Error extrayendo imagen: {e}"))?;
        }
    }
    Ok(())
}

fn extract_by_format(ext: &str, src: &Path, dest: &Path) -> Result<(), String> {
    match ext {
        "cbr" | "rar" => extract_rar(src, dest),
        "cbz" | "zip" => extract_zip(src, dest),
        other => Err(format!("Formato no soportado todavía: .{other}")),
    }
}

#[tauri::command]
pub async fn read_comic_binary_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
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

#[tauri::command]
pub async fn save_comic_page_as_png(
    app_handle: tauri::AppHandle,
    source_page_path: String,
    title: String,
    page_number: i64,
) -> Result<String, String> {
    let pic_dir = app_handle
        .path()
        .picture_dir()
        .map_err(|e| format!("No se pudo obtener la carpeta de imágenes: {e}"))?;

    let metadea_pics = pic_dir.join("Metadea");
    if !metadea_pics.exists() {
        let _ = std::fs::create_dir_all(&metadea_pics);
    }
    let target_dir = if metadea_pics.exists() { metadea_pics } else { pic_dir };

    let clean_title: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let clean_title = clean_title.trim();
    let clean_title = if clean_title.is_empty() { "comic" } else { clean_title };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let filename = format!("{clean_title}_pag_{page_number}_{timestamp}.png");
    let dest_path = target_dir.join(filename);

    if source_page_path.starts_with("data:") {
        use base64::Engine;
        let b64 = source_page_path
            .split_once("base64,")
            .map(|(_, rest)| rest)
            .unwrap_or(&source_page_path);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("Error decodificando imagen base64: {e}"))?;
        std::fs::write(&dest_path, &bytes)
            .map_err(|e| format!("Error guardando archivo PNG: {e}"))?;
    } else {
        let img = image::open(&source_page_path)
            .map_err(|e| format!("Error abriendo la imagen de página: {e}"))?;
        img.save_with_format(&dest_path, image::ImageFormat::Png)
            .map_err(|e| format!("Error guardando la página como PNG: {e}"))?;
    }

    Ok(dest_path.to_string_lossy().to_string())
}

