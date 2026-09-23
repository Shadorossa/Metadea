// In-app reader for comics/manga/books — extracts an archive's pages once
// into a per-archive cache directory under <app_data_dir>/metadata/
// comic_cache/ (already inside the asset-protocol scope granted in
// tauri.conf.json, so the frontend can wrapAssetUrl() every page straight
// off disk instead of round-tripping each one through IPC as base64) and
// hands back the sorted list of page paths. Re-extraction is skipped once a
// ".extracted" marker file is present, the same "cache, don't redo" idea
// custom_image/metadata caching already uses elsewhere in this codebase.
//
// extract_by_format below handles CBR (RAR) and CBZ (ZIP) — an EPUB case
// would slot in the same way if that's ever added. PDF doesn't go through
// here at all: ReaderModal reads it directly via read_comic_binary_file
// and renders pages client-side with pdfjs-dist, no extraction step needed.
use crate::db::ToStringErr;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct ComicPages {
    pub pages: Vec<String>,
    pub cache_dir: String,
}

pub(crate) fn cache_root(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_handle.path().app_data_dir().str_err()?.join("metadata").join("comic_cache"))
}

// Stable, filesystem-safe directory name for one archive — hashed so the
// cache dir doesn't inherit the source file's own (possibly very long or
// Unicode-heavy) name/path. FNV-1a (64-bit) is spelled out here because
// std's DefaultHasher is not stable across Rust releases: a toolchain bump
// would silently re-key every cache dir. Switching to it re-keyed existing
// caches exactly once (they are just re-extracted on the next open).
pub(crate) fn archive_cache_key(path: &str) -> String {
    const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
    let hash = path.bytes().fold(FNV_OFFSET_BASIS, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME)
    });
    format!("{hash:016x}")
}

#[cfg(test)]
mod archive_cache_key_tests {
    use super::archive_cache_key;

    #[test]
    fn matches_the_published_fnv1a_64_vectors() {
        assert_eq!(archive_cache_key(""), "cbf29ce484222325");
        assert_eq!(archive_cache_key("a"), "af63dc4c8601ec8c");
        assert_eq!(archive_cache_key("foobar"), "85944171f73967e8");
    }

    #[test]
    fn distinct_paths_get_distinct_keys() {
        assert_ne!(archive_cache_key(r"C:\comics\a.cbz"), archive_cache_key(r"C:\comics\b.cbz"));
    }
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

#[cfg(test)]
mod natural_cmp_tests {
    use super::natural_cmp;
    use std::cmp::Ordering;

    #[test]
    fn compares_digit_runs_numerically() {
        assert_eq!(natural_cmp("page2.jpg", "page10.jpg"), Ordering::Less);
        assert_eq!(natural_cmp("page10.jpg", "page2.jpg"), Ordering::Greater);
    }

    #[test]
    fn identical_strings_are_equal() {
        assert_eq!(natural_cmp("page7.jpg", "page7.jpg"), Ordering::Equal);
        assert_eq!(natural_cmp("", ""), Ordering::Equal);
    }

    #[test]
    fn a_strict_prefix_sorts_first() {
        assert_eq!(natural_cmp("page", "page1"), Ordering::Less);
        assert_eq!(natural_cmp("page1", "page"), Ordering::Greater);
        assert_eq!(natural_cmp("", "a"), Ordering::Less);
    }

    #[test]
    fn leading_zeros_do_not_affect_numeric_equality() {
        assert_eq!(natural_cmp("page007", "page7"), Ordering::Equal);
        assert_eq!(natural_cmp("page02.jpg", "page2.jpg"), Ordering::Equal);
    }

    #[test]
    fn handles_multiple_numeric_runs() {
        assert_eq!(natural_cmp("v1.9", "v1.10"), Ordering::Less);
        assert_eq!(natural_cmp("ch2-p10", "ch2-p9"), Ordering::Greater);
        assert_eq!(natural_cmp("ch10-p1", "ch2-p9"), Ordering::Greater);
    }

    #[test]
    fn falls_back_to_char_order_after_equal_numbers() {
        assert_eq!(natural_cmp("1a", "1b"), Ordering::Less);
        assert_eq!(natural_cmp("1b", "1a"), Ordering::Greater);
    }

    #[test]
    fn digit_versus_letter_uses_plain_char_order() {
        assert_eq!(natural_cmp("2", "a"), Ordering::Less);
        assert_eq!(natural_cmp("A", "a"), Ordering::Less);
    }

    #[test]
    fn non_ascii_characters_compare_by_code_point() {
        assert_eq!(natural_cmp("é", "z"), Ordering::Greater);
        assert_eq!(natural_cmp("página2", "página10"), Ordering::Less);
        // Fullwidth digits are not ASCII digits, so they compare as chars.
        assert_eq!(natural_cmp("２", "１０"), Ordering::Greater);
    }

    #[test]
    fn numbers_that_overflow_u64_are_treated_as_zero() {
        assert_eq!(natural_cmp("99999999999999999999999", "1"), Ordering::Less);
        assert_eq!(natural_cmp("99999999999999999999999", "0"), Ordering::Equal);
    }
}

fn extract_rar(src: &Path, dest: &Path) -> Result<(), String> {
    let mut archive = unrar::Archive::new(src)
        .open_for_processing()
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_OPEN_CBR, e))?;

    while let Some(header) = archive
        .read_header()
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_READ_CBR, e))?
    {
        let entry = header.entry();
        // `extract_with_base` joins the entry's stored name onto `dest`, so a
        // name containing `..` would escape the cache directory. Skip anything
        // that does not resolve to a plain path inside it.
        let safe_name = crate::utils::safe_archive_path(&entry.filename);
        archive = if entry.is_file() && is_image(&entry.filename) && safe_name.is_some() {
            header
                .extract_with_base(dest)
                .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_EXTRACT_PAGE, e))?
        } else {
            header.skip().map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_READ_CBR, e))?
        };
    }
    Ok(())
}

fn extract_zip(src: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(src)
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_OPEN_CBZ, e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_READ_CBZ, e))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_READ_CBZ, e))?;
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
                .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_CREATE_FILE, e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_EXTRACT_PAGE, e))?;
        }
    }
    Ok(())
}

fn extract_by_format(ext: &str, src: &Path, dest: &Path) -> Result<(), String> {
    match ext {
        "cbr" | "rar" => extract_rar(src, dest),
        "cbz" | "zip" => extract_zip(src, dest),
        other => Err(crate::error_codes::with_detail(crate::error_codes::COMIC_FORMAT_UNSUPPORTED, format!(".{other}"))),
    }
}

#[tauri::command]
pub async fn read_comic_binary_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_READ_FILE, e))?;
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
        return Err(crate::error_codes::COMIC_NO_PAGES.to_string());
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
        .map_err(|e| crate::error_codes::with_detail(crate::error_codes::PICTURES_DIR_LOCATE, e))?;

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
            .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_DECODE_BASE64, e))?;
        std::fs::write(&dest_path, &bytes)
            .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_SAVE_PNG, e))?;
    } else {
        let img = image::open(&source_page_path)
            .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_OPEN_PAGE_IMAGE, e))?;
        img.save_with_format(&dest_path, image::ImageFormat::Png)
            .map_err(|e| crate::error_codes::with_detail(crate::error_codes::COMIC_SAVE_PNG, e))?;
    }

    Ok(dest_path.to_string_lossy().to_string())
}

