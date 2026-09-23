// EPUB package parsing: META-INF/container.xml → the OPF → spine order,
// manifest hrefs, Dublin Core metadata and the table of contents (EPUB3
// `nav` document first, EPUB2 `toc.ncx` as fallback). Every href comes back
// root-relative (see paths.rs) so the caller only ever joins onto the
// extracted book directory.
use super::paths;
use super::xml_tree::{self, XmlNode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChapterInfo {
    pub index: usize,
    /// Root-relative path of the spine item's XHTML file.
    pub href: String,
    pub title: Option<String>,
    /// File size; the frontend weights read-percentage by it.
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TocEntry {
    pub title: String,
    /// Root-relative path, fragment kept (`text/ch2.xhtml#sec3`).
    pub href: String,
    pub depth: u32,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Package {
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    /// Spine hrefs, root-relative, in reading order.
    pub spine: Vec<String>,
    pub toc: Vec<TocEntry>,
    /// Root-relative path of the cover image, if declared.
    pub cover: Option<String>,
}

#[derive(Debug, Clone)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: String,
}

/// Root-relative path of the OPF named by container.xml.
pub fn opf_path(container_xml: &str) -> Option<String> {
    let root = xml_tree::parse(container_xml);
    let rootfile = root.find("rootfile")?;
    let full_path = rootfile.attr("full-path")?;
    paths::resolve("", full_path)
}

fn dc_text(metadata: &XmlNode, name: &str) -> Option<String> {
    metadata.elements(name).map(|e| e.text()).find(|t| !t.is_empty())
}

fn manifest_items(package: &XmlNode, opf_dir: &str) -> Vec<ManifestItem> {
    let Some(manifest) = package.find("manifest") else { return Vec::new() };
    manifest
        .elements("item")
        .filter_map(|item| {
            let href = paths::resolve(opf_dir, item.attr("href")?)?;
            Some(ManifestItem {
                id: item.attr("id").unwrap_or("").to_string(),
                href,
                media_type: item.attr("media-type").unwrap_or("").to_ascii_lowercase(),
                properties: item.attr("properties").unwrap_or("").to_ascii_lowercase(),
            })
        })
        .collect()
}

/// Parses the OPF. `read_file` fetches another root-relative file of the
/// book (the nav document or NCX) so this stays free of filesystem code.
pub fn parse_package(opf_xml: &str, opf_rel_path: &str, read_file: &dyn Fn(&str) -> Option<String>) -> Package {
    let opf_dir = paths::parent_dir(opf_rel_path).to_string();
    let root = xml_tree::parse(opf_xml);
    let package = root.find("package").cloned().unwrap_or(root);
    let items = manifest_items(&package, &opf_dir);

    let mut out = Package::default();
    if let Some(metadata) = package.find("metadata") {
        out.title = dc_text(metadata, "title").unwrap_or_default();
        out.author = dc_text(metadata, "creator");
        out.language = dc_text(metadata, "language");
        // EPUB2 cover convention: <meta name="cover" content="item-id"/>.
        let cover_id = metadata
            .elements("meta")
            .find(|m| m.attr("name").is_some_and(|n| n.eq_ignore_ascii_case("cover")))
            .and_then(|m| m.attr("content").map(str::to_string));
        if let Some(id) = cover_id {
            out.cover = items.iter().find(|i| i.id == id).map(|i| i.href.clone());
        }
    }
    if out.cover.is_none() {
        out.cover = items
            .iter()
            .find(|i| i.properties.split_whitespace().any(|p| p == "cover-image"))
            .map(|i| i.href.clone());
    }

    let mut ncx_id: Option<String> = None;
    if let Some(spine) = package.find("spine") {
        ncx_id = spine.attr("toc").map(str::to_string);
        for itemref in spine.elements("itemref") {
            if itemref.attr("linear").is_some_and(|l| l.eq_ignore_ascii_case("no")) {
                continue;
            }
            let Some(idref) = itemref.attr("idref") else { continue };
            if let Some(item) = items.iter().find(|i| i.id == idref) {
                if !out.spine.contains(&item.href) {
                    out.spine.push(item.href.clone());
                }
            }
        }
    }

    let nav = items
        .iter()
        .find(|i| i.properties.split_whitespace().any(|p| p == "nav"))
        .and_then(|i| read_file(&i.href).map(|xml| parse_nav(&xml, &i.href)));
    out.toc = match nav {
        Some(entries) if !entries.is_empty() => entries,
        _ => {
            let ncx = items
                .iter()
                .find(|i| ncx_id.as_deref() == Some(i.id.as_str()))
                .or_else(|| items.iter().find(|i| i.media_type == "application/x-dtbncx+xml"));
            ncx.and_then(|i| read_file(&i.href).map(|xml| parse_ncx(&xml, &i.href))).unwrap_or_default()
        }
    };
    out
}

fn toc_href(base_dir: &str, raw: &str) -> Option<String> {
    let (path, fragment) = paths::split_fragment(raw);
    let resolved = if path.is_empty() { String::new() } else { paths::resolve(base_dir, path)? };
    if resolved.is_empty() && fragment.is_none() {
        return None;
    }
    Some(match fragment {
        Some(f) => format!("{resolved}#{f}"),
        None => resolved,
    })
}

fn walk_nav_list(list: &XmlNode, base_dir: &str, depth: u32, out: &mut Vec<TocEntry>) {
    for li in list.elements("li") {
        let link = li.child("a").or_else(|| li.child("span"));
        if let Some(link) = link {
            let title = link.text();
            let href = link.attr("href").and_then(|h| toc_href(base_dir, h));
            if let Some(href) = href {
                if !title.is_empty() {
                    out.push(TocEntry { title, href, depth });
                }
            }
        }
        for nested in li.elements("ol") {
            walk_nav_list(nested, base_dir, depth + 1, out);
        }
    }
}

/// EPUB3 navigation document: the `<nav epub:type="toc">` list.
pub fn parse_nav(nav_xml: &str, nav_rel_path: &str) -> Vec<TocEntry> {
    let base_dir = paths::parent_dir(nav_rel_path);
    let root = xml_tree::parse(nav_xml);
    let mut navs: Vec<&XmlNode> = Vec::new();
    collect_named(&root, "nav", &mut navs);
    let toc_nav = navs
        .iter()
        .find(|n| n.attr("epub:type").is_some_and(|t| t.split_whitespace().any(|p| p == "toc")))
        .or(navs.first());
    let mut out = Vec::new();
    if let Some(nav) = toc_nav {
        if let Some(list) = nav.child("ol") {
            walk_nav_list(list, base_dir, 0, &mut out);
        }
    }
    out
}

fn collect_named<'a>(node: &'a XmlNode, name: &str, out: &mut Vec<&'a XmlNode>) {
    for child in &node.children {
        if let super::xml_tree::XmlChild::Element(e) = child {
            if e.name == name {
                out.push(e);
            }
            collect_named(e, name, out);
        }
    }
}

fn walk_nav_points(parent: &XmlNode, base_dir: &str, depth: u32, out: &mut Vec<TocEntry>) {
    for point in parent.elements("navpoint") {
        let title = point.child("navlabel").map(|l| l.text()).unwrap_or_default();
        let href = point.child("content").and_then(|c| c.attr("src")).and_then(|s| toc_href(base_dir, s));
        if let Some(href) = href {
            if !title.is_empty() {
                out.push(TocEntry { title, href, depth });
            }
        }
        walk_nav_points(point, base_dir, depth + 1, out);
    }
}

/// EPUB2 NCX: nested navMap/navPoint.
pub fn parse_ncx(ncx_xml: &str, ncx_rel_path: &str) -> Vec<TocEntry> {
    let base_dir = paths::parent_dir(ncx_rel_path);
    let root = xml_tree::parse(ncx_xml);
    let mut out = Vec::new();
    if let Some(map) = root.find("navmap") {
        walk_nav_points(map, base_dir, 0, &mut out);
    }
    out
}

/// Chapter title = the first TOC entry pointing at that file.
pub fn chapter_title(toc: &[TocEntry], href: &str) -> Option<String> {
    toc.iter()
        .find(|e| paths::split_fragment(&e.href).0 == href)
        .map(|e| e.title.clone())
}
