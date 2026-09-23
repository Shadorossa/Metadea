// In-app EPUB reader backend. `epub_open` extracts the book (a zip) once
// into the same per-archive cache directory comic_reader.rs uses for
// CBZ/CBR (<app_data>/metadata/comic_cache/<fnv1a(path)>/, inside the
// asset-protocol scope), parses container.xml → OPF → spine/TOC and writes
// the result next to the files as epub_manifest.json so `epub_chapter` can
// serve any chapter later without re-parsing. Chapter XHTML goes through
// sanitize.rs and the book's CSS through css.rs before leaving Rust: the
// frontend never sees the publisher's raw markup.
mod css;
mod opf;
mod paths;
mod sanitize;
#[cfg(test)]
mod tests;
mod xml_tree;

use crate::db::ToStringErr;
use crate::error_codes::{self, with_detail};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub use opf::{ChapterInfo, TocEntry};

/// Chapters above this are refused rather than handed to the webview.
const MAX_CHAPTER_BYTES: u64 = 5 * 1024 * 1024;
/// Per stylesheet; a chapter may link several.
const MAX_CSS_BYTES: u64 = 1024 * 1024;
/// Zip entries above this are skipped at extraction time.
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MANIFEST_FILE: &str = "epub_manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EpubBook {
    pub book_id: String,
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub chapters: Vec<ChapterInfo>,
    pub toc: Vec<TocEntry>,
    /// Absolute path of the cover image inside the cache dir.
    pub cover_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EpubChapterContent {
    pub html: String,
    /// Sanitised publisher CSS: linked stylesheets first, then inline
    /// `<style>` blocks, in document order.
    pub css: Vec<String>,
}

fn read_rel(root: &Path, rel: &str) -> Option<String> {
    std::fs::read_to_string(paths::absolute(root, rel)).ok()
}

/// Extracts every entry (not just images, unlike comic_reader's) under
/// `dest`, keeping only names that resolve inside it.
fn extract_all(src: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(src).map_err(|e| with_detail(error_codes::COMIC_OPEN_CBZ, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| with_detail(error_codes::COMIC_READ_CBZ, e))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| with_detail(error_codes::COMIC_READ_CBZ, e))?;
        let Some(rel) = entry.enclosed_name() else { continue };
        if crate::utils::safe_archive_path(&rel).is_none() || entry.size() > MAX_ENTRY_BYTES {
            continue;
        }
        let outpath = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&outpath).map_err(|e| with_detail(error_codes::COMIC_CREATE_FILE, e))?;
            continue;
        }
        if let Some(parent) = outpath.parent() {
            std::fs::create_dir_all(parent).map_err(|e| with_detail(error_codes::COMIC_CREATE_FILE, e))?;
        }
        let mut out = std::fs::File::create(&outpath).map_err(|e| with_detail(error_codes::COMIC_CREATE_FILE, e))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| with_detail(error_codes::COMIC_EXTRACT_PAGE, e))?;
    }
    Ok(())
}

/// Parses an already-extracted book directory into its manifest.
pub(crate) fn build_manifest(root: &Path, book_id: &str) -> Result<EpubBook, String> {
    let container = read_rel(root, "META-INF/container.xml")
        .ok_or_else(|| with_detail(error_codes::EPUB_INVALID, "META-INF/container.xml missing"))?;
    let opf_rel = opf::opf_path(&container).ok_or_else(|| with_detail(error_codes::EPUB_INVALID, "no rootfile in container.xml"))?;
    let opf_xml = read_rel(root, &opf_rel).ok_or_else(|| with_detail(error_codes::EPUB_INVALID, format!("{opf_rel} missing")))?;
    let package = opf::parse_package(&opf_xml, &opf_rel, &|rel| read_rel(root, rel));
    if package.spine.is_empty() {
        return Err(with_detail(error_codes::EPUB_INVALID, "empty spine"));
    }
    let chapters = package
        .spine
        .iter()
        .enumerate()
        .map(|(index, href)| ChapterInfo {
            index,
            bytes: std::fs::metadata(paths::absolute(root, href)).map(|m| m.len()).unwrap_or(0),
            title: opf::chapter_title(&package.toc, href),
            href: href.clone(),
        })
        .collect();
    let title = if package.title.is_empty() { book_id.to_string() } else { package.title };
    Ok(EpubBook {
        book_id: book_id.to_string(),
        title,
        author: package.author,
        language: package.language,
        chapters,
        toc: package.toc,
        cover_path: package
            .cover
            .map(|rel| paths::absolute(root, &rel))
            .filter(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned()),
    })
}

fn book_dir(app_handle: &tauri::AppHandle, book_id: &str) -> Result<PathBuf, String> {
    // book_id is the fnv1a hex key comic_reader hands out; anything else
    // could be a path and must not be joined onto the cache dir.
    if book_id.len() != 16 || !book_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(error_codes::EPUB_NOT_OPEN.to_string());
    }
    Ok(crate::comic_reader::cache_root(app_handle)?.join(book_id))
}

#[tauri::command]
pub async fn epub_open(app_handle: tauri::AppHandle, path: String) -> Result<EpubBook, String> {
    let book_id = crate::comic_reader::archive_cache_key(&path);
    let dest = book_dir(&app_handle, &book_id)?;
    let marker = dest.join(".extracted");
    if !marker.exists() {
        std::fs::create_dir_all(&dest).str_err()?;
        extract_all(Path::new(&path), &dest)?;
        std::fs::write(&marker, "").str_err()?;
    }
    let manifest_path = dest.join(MANIFEST_FILE);
    if let Some(book) = std::fs::read_to_string(&manifest_path).ok().and_then(|s| serde_json::from_str::<EpubBook>(&s).ok()) {
        return Ok(book);
    }
    let book = build_manifest(&dest, &book_id)?;
    std::fs::write(&manifest_path, serde_json::to_string(&book).str_err()?).str_err()?;
    Ok(book)
}

/// Sanitised chapter HTML plus its CSS, for an already-opened book.
pub(crate) fn load_chapter(root: &Path, book: &EpubBook, index: usize) -> Result<EpubChapterContent, String> {
    let chapter = book.chapters.get(index).ok_or_else(|| error_codes::EPUB_NOT_OPEN.to_string())?;
    let file = paths::absolute(root, &chapter.href);
    let size = std::fs::metadata(&file).map_err(|e| with_detail(error_codes::COMIC_READ_FILE, e))?.len();
    if size > MAX_CHAPTER_BYTES {
        return Err(with_detail(error_codes::EPUB_CHAPTER_TOO_LARGE, format!("{size} bytes")));
    }
    let xhtml = std::fs::read_to_string(&file).map_err(|e| with_detail(error_codes::COMIC_READ_FILE, e))?;
    let sanitized = sanitize::sanitize_chapter(&xhtml, &chapter.href, root);
    let mut css = Vec::new();
    for href in &sanitized.stylesheet_hrefs {
        let path = paths::absolute(root, href);
        let too_big = std::fs::metadata(&path).map(|m| m.len() > MAX_CSS_BYTES).unwrap_or(true);
        if too_big {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&path) {
            css.push(css::sanitize_css(&text, paths::parent_dir(href), root));
        }
    }
    let chapter_dir = paths::parent_dir(&chapter.href);
    for inline in &sanitized.inline_styles {
        css.push(css::sanitize_css(inline, chapter_dir, root));
    }
    Ok(EpubChapterContent { html: sanitized.html, css })
}

#[tauri::command]
pub async fn epub_chapter(app_handle: tauri::AppHandle, book_id: String, index: usize) -> Result<EpubChapterContent, String> {
    let root = book_dir(&app_handle, &book_id)?;
    let manifest = std::fs::read_to_string(root.join(MANIFEST_FILE)).map_err(|_| error_codes::EPUB_NOT_OPEN.to_string())?;
    let book: EpubBook = serde_json::from_str(&manifest).map_err(|_| error_codes::EPUB_NOT_OPEN.to_string())?;
    load_chapter(&root, &book, index)
}
