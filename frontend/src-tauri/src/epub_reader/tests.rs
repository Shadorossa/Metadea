// End-to-end tests over a synthetic EPUB built in a temp dir: zip →
// extract_all → build_manifest → load_chapter. One EPUB3 book (nav.xhtml)
// and one EPUB2 book (toc.ncx), both with the OPF inside a subfolder so
// href resolution relative to the OPF dir is exercised for real.
use super::*;
use std::io::Write;

struct TempBook {
    dir: PathBuf,
}

impl Drop for TempBook {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("metadea-epub-test-{tag}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_zip(path: &Path, entries: &[(&str, &str)]) {
    let file = std::fs::File::create(path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, content) in entries {
        zip.start_file(*name, options).unwrap();
        zip.write_all(content.as_bytes()).unwrap();
    }
    zip.finish().unwrap();
}

const CONTAINER: &str = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;

const OPF3: &str = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Synthetic Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="css/style.css" media-type="text/css"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="c1" href="text/ch%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="hidden" href="text/hidden.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="hidden" linear="no"/>
    <itemref idref="c2"/>
    <itemref idref="missing"/>
  </spine>
</package>"#;

const NAV: &str = r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="landmarks"><ol><li><a href="text/ch2.xhtml">Start</a></li></ol></nav>
<nav epub:type="toc"><ol>
  <li><a href="text/ch%201.xhtml">Chapter One</a>
    <ol><li><a href="text/ch%201.xhtml#part2">Part Two</a></li></ol>
  </li>
  <li><a href="text/ch2.xhtml">Chapter Two</a></li>
</ol></nav></body></html>"#;

const CH1: &str = r#"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head>
<link rel="stylesheet" type="text/css" href="../css/style.css"/>
<script src="evil.js"></script></head>
<body><h1 onclick="x()">One</h1><p>Hello&nbsp;world <a href="ch2.xhtml#x">next</a> <a href="https://example.com">out</a></p>
<img src="../images/cover.png" alt="cover"/><img src="http://remote/x.png" alt="remote"/></body></html>"#;

const CH2: &str = r#"<html><body><p>Two</p><style>body { color: red; background: url("../images/cover.png") }</style></body></html>"#;

const CSS: &str = "@import url(other.css); body { font-family: serif } p { background: url(../images/cover.png) }";

fn epub3_entries() -> Vec<(&'static str, &'static str)> {
    vec![
        ("mimetype", "application/epub+zip"),
        ("META-INF/container.xml", CONTAINER),
        ("OEBPS/content.opf", OPF3),
        ("OEBPS/nav.xhtml", NAV),
        ("OEBPS/css/style.css", CSS),
        ("OEBPS/images/cover.png", "notreallyapng"),
        ("OEBPS/text/ch 1.xhtml", CH1),
        ("OEBPS/text/ch2.xhtml", CH2),
        ("OEBPS/text/hidden.xhtml", "<html><body>hidden</body></html>"),
        ("../escape.txt", "must not be written"),
    ]
}

fn open_synthetic(tag: &str, entries: &[(&str, &str)]) -> (TempBook, EpubBook) {
    let dir = temp_dir(tag);
    let epub = dir.join("book.epub");
    write_zip(&epub, entries);
    let root = dir.join("extracted");
    std::fs::create_dir_all(&root).unwrap();
    extract_all(&epub, &root).unwrap();
    let book = build_manifest(&root, "0123456789abcdef").unwrap();
    (TempBook { dir }, book)
}

#[test]
fn epub3_manifest_spine_toc_and_cover() {
    let (tmp, book) = open_synthetic("epub3", &epub3_entries());
    assert_eq!(book.title, "Synthetic Book");
    assert_eq!(book.author.as_deref(), Some("Test Author"));
    assert_eq!(book.language.as_deref(), Some("es"));
    let hrefs: Vec<&str> = book.chapters.iter().map(|c| c.href.as_str()).collect();
    assert_eq!(hrefs, vec!["OEBPS/text/ch 1.xhtml", "OEBPS/text/ch2.xhtml"]);
    assert_eq!(book.chapters[0].index, 0);
    assert_eq!(book.chapters[0].title.as_deref(), Some("Chapter One"));
    assert_eq!(book.chapters[0].bytes, CH1.len() as u64);
    let toc: Vec<(String, String, u32)> = book.toc.iter().map(|e| (e.title.clone(), e.href.clone(), e.depth)).collect();
    assert_eq!(
        toc,
        vec![
            ("Chapter One".into(), "OEBPS/text/ch 1.xhtml".into(), 0),
            ("Part Two".into(), "OEBPS/text/ch 1.xhtml#part2".into(), 1),
            ("Chapter Two".into(), "OEBPS/text/ch2.xhtml".into(), 0),
        ]
    );
    assert!(book.cover_path.as_deref().unwrap().ends_with("cover.png"));
    assert!(!tmp.dir.join("escape.txt").exists());
    assert!(!tmp.dir.parent().unwrap().join("escape.txt").exists());
}

#[test]
fn chapter_is_sanitised_and_css_collected() {
    let (tmp, book) = open_synthetic("chapter", &epub3_entries());
    let root = tmp.dir.join("extracted");
    let ch1 = load_chapter(&root, &book, 0).unwrap();
    assert!(!ch1.html.contains("script") && !ch1.html.contains("onclick"));
    assert!(ch1.html.contains("<h1>One</h1>"));
    assert!(ch1.html.contains("Hello\u{a0}world"));
    assert!(ch1.html.contains(r#"data-epub-href="OEBPS/text/ch2.xhtml#x""#));
    assert!(ch1.html.contains(r#"data-external-href="https://example.com""#));
    assert!(ch1.html.contains("data-epub-src=") && ch1.html.contains("cover.png"));
    assert!(!ch1.html.contains("remote/x.png"));
    assert_eq!(ch1.css.len(), 1);
    assert!(!ch1.css[0].contains("@import"));
    assert!(ch1.css[0].contains(".epub-chapter { font-family: serif }"));
    assert!(ch1.css[0].contains("epub-asset:"));

    let ch2 = load_chapter(&root, &book, 1).unwrap();
    assert_eq!(ch2.html.trim(), "<p>Two</p>");
    assert_eq!(ch2.css.len(), 1);
    assert!(ch2.css[0].contains(".epub-chapter { color: red;"));
    assert!(ch2.css[0].contains("epub-asset:"));

    assert!(load_chapter(&root, &book, 5).is_err());
}

#[test]
fn oversized_chapters_are_refused() {
    let big = format!("<html><body><p>{}</p></body></html>", "x".repeat((MAX_CHAPTER_BYTES + 1) as usize));
    let mut entries = epub3_entries();
    entries.retain(|(name, _)| *name != "OEBPS/text/ch2.xhtml");
    entries.push(("OEBPS/text/ch2.xhtml", big.as_str()));
    let (tmp, book) = open_synthetic("big", &entries);
    let err = load_chapter(&tmp.dir.join("extracted"), &book, 1).unwrap_err();
    assert!(err.starts_with(error_codes::EPUB_CHAPTER_TOO_LARGE), "{err}");
}

const OPF2: &str = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Old Book</dc:title>
    <meta name="cover" content="cov"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cov" href="cover.jpg" media-type="image/jpeg"/>
    <item id="a" href="a.html" media-type="application/xhtml+xml"/>
    <item id="b" href="sub/b.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="a"/><itemref idref="b"/></spine>
</package>"#;

const NCX: &str = r#"<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>A</text></navLabel><content src="a.html"/>
      <navPoint id="n2" playOrder="2"><navLabel><text>B</text></navLabel><content src="sub/b.html#top"/></navPoint>
    </navPoint>
  </navMap>
</ncx>"#;

#[test]
fn epub2_ncx_toc_and_meta_cover() {
    let entries = vec![
        ("META-INF/container.xml", CONTAINER),
        ("OEBPS/content.opf", OPF2),
        ("OEBPS/toc.ncx", NCX),
        ("OEBPS/cover.jpg", "jpg"),
        ("OEBPS/a.html", "<html><body><p>A</p></body></html>"),
        ("OEBPS/sub/b.html", "<html><body><p>B</p></body></html>"),
    ];
    let (_tmp, book) = open_synthetic("epub2", &entries);
    assert_eq!(book.title, "Old Book");
    assert_eq!(book.author, None);
    let hrefs: Vec<&str> = book.chapters.iter().map(|c| c.href.as_str()).collect();
    assert_eq!(hrefs, vec!["OEBPS/a.html", "OEBPS/sub/b.html"]);
    assert_eq!(book.chapters[1].title.as_deref(), Some("B"));
    let toc: Vec<(String, String, u32)> = book.toc.iter().map(|e| (e.title.clone(), e.href.clone(), e.depth)).collect();
    assert_eq!(toc, vec![("A".into(), "OEBPS/a.html".into(), 0), ("B".into(), "OEBPS/sub/b.html#top".into(), 1)]);
    assert!(book.cover_path.as_deref().unwrap().ends_with("cover.jpg"));
}

#[test]
fn a_zip_without_container_is_invalid() {
    let dir = temp_dir("invalid");
    let tmp = TempBook { dir: dir.clone() };
    let epub = dir.join("x.epub");
    write_zip(&epub, &[("mimetype", "application/epub+zip")]);
    let root = dir.join("extracted");
    std::fs::create_dir_all(&root).unwrap();
    extract_all(&epub, &root).unwrap();
    let err = build_manifest(&root, "0123456789abcdef").unwrap_err();
    assert!(err.starts_with(error_codes::EPUB_INVALID), "{err}");
    drop(tmp);
}
