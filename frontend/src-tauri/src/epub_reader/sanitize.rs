// Allowlist sanitiser for chapter XHTML. An EPUB is third-party content
// rendered inside a webview that can reach the filesystem, so the chapter
// is rebuilt from a parsed tree rather than filtered as text: only known
// tags and attributes survive, every URL is classified, and nothing that
// can run script or load a remote resource gets through.
//
// URL contract with the frontend (lib/reader/epub-chapter-dom.ts):
//   - images:  `data-epub-src="<absolute path inside the book dir>"`; the
//     frontend turns it into an asset:// URL. External images are dropped.
//   - links:   `data-epub-href="<root-relative path>[#fragment]"` for
//     in-book targets, `data-external-href` for http(s)/mailto; every other
//     scheme (javascript:, data:, file:, ...) is removed.
use super::paths;
use super::xml_tree::{self, XmlChild, XmlNode};
use std::path::Path;

pub struct SanitizedChapter {
    pub html: String,
    /// Root-relative hrefs of `<link rel="stylesheet">`s, in document order.
    pub stylesheet_hrefs: Vec<String>,
    /// Raw text of `<style>` blocks (css.rs sanitises them).
    pub inline_styles: Vec<String>,
}

const KEEP: &[&str] = &[
    "p", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "a", "img", "br", "hr", "em", "strong",
    "b", "i", "u", "s", "small", "sub", "sup", "ul", "ol", "li", "dl", "dt", "dd", "blockquote",
    "pre", "code", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
    "section", "article", "aside", "header", "footer", "nav", "figure", "figcaption", "cite", "q",
    "abbr", "ruby", "rt", "rp", "mark", "del", "ins", "kbd", "samp", "var", "time", "wbr", "main",
    "address", "big", "tt", "center",
    // SVG subset — covers "image wrapped in svg" covers and simple decorations.
    "svg", "g", "image", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text",
    "tspan", "title", "desc", "defs", "clippath", "lineargradient", "radialgradient", "stop",
];

const DROP: &[&str] = &[
    "script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea",
    "video", "audio", "source", "track", "link", "meta", "head", "base", "noscript", "template",
    "use", "foreignobject", "applet", "frame", "frameset", "canvas", "dialog", "portal", "epub:switch",
];

const VOID: &[&str] = &["img", "br", "hr", "wbr", "col", "image", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "stop"];

const GLOBAL_ATTRS: &[&str] = &["class", "id", "title", "lang", "dir", "style", "alt", "width", "height", "colspan", "rowspan", "epub:type", "role"];

const SVG_ATTRS: &[&str] = &[
    "viewbox", "preserveaspectratio", "d", "x", "y", "cx", "cy", "r", "rx", "ry", "fill", "stroke",
    "stroke-width", "stroke-linecap", "stroke-linejoin", "points", "transform", "x1", "y1", "x2",
    "y2", "font-size", "font-family", "text-anchor", "opacity", "fill-opacity", "offset", "stop-color",
    "clip-path", "xmlns", "xmlns:xlink", "version",
];

struct Context<'a> {
    chapter_dir: &'a str,
    book_root: &'a Path,
}

fn escape_text(text: &str, out: &mut String) {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            other => out.push(other),
        }
    }
}

fn escape_attr(text: &str, out: &mut String) {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            other => out.push(other),
        }
    }
}

fn style_is_safe(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    !(lower.contains("url(")
        || lower.contains("expression(")
        || lower.contains("behavior")
        || lower.contains("-moz-binding")
        || lower.contains("@import")
        || lower.contains("javascript"))
}

/// Classifies one URL attribute into the output attribute it becomes.
fn rewrite_url(ctx: &Context<'_>, tag: &str, raw: &str) -> Option<(String, String)> {
    let value = raw.trim();
    if value.is_empty() {
        return None;
    }
    let is_link = tag == "a";
    if let Some(scheme) = paths::scheme_of(value) {
        return match scheme.as_str() {
            "http" | "https" | "mailto" if is_link => Some(("data-external-href".into(), value.to_string())),
            _ => None,
        };
    }
    if value.starts_with("//") {
        return None;
    }
    let (path, fragment) = paths::split_fragment(value);
    if is_link {
        if path.is_empty() {
            return fragment.map(|f| ("data-epub-href".into(), format!("#{f}")));
        }
        let resolved = paths::resolve(ctx.chapter_dir, path)?;
        let target = match fragment {
            Some(f) => format!("{resolved}#{f}"),
            None => resolved,
        };
        return Some(("data-epub-href".into(), target));
    }
    let resolved = paths::resolve(ctx.chapter_dir, path)?;
    let abs = paths::absolute(ctx.book_root, &resolved);
    Some(("data-epub-src".into(), abs.to_string_lossy().into_owned()))
}

fn write_attrs(ctx: &Context<'_>, node: &XmlNode, out: &mut String) {
    for (key, value) in &node.attrs {
        if key.starts_with("on") || (key.starts_with("xmlns:") && key != "xmlns:xlink") {
            continue;
        }
        let rewritten: Option<(String, String)> = match (node.name.as_str(), key.as_str()) {
            ("img", "src") | ("image", "href") | ("image", "xlink:href") | ("a", "href") => {
                rewrite_url(ctx, &node.name, value)
            }
            (_, "src") | (_, "href") | (_, "xlink:href") | (_, "srcset") | (_, "poster") | (_, "action")
            | (_, "formaction") | (_, "data") | (_, "background") => None,
            (_, "style") => style_is_safe(value).then(|| (key.clone(), value.clone())),
            (_, k) if GLOBAL_ATTRS.contains(&k) || SVG_ATTRS.contains(&k) => Some((key.clone(), value.clone())),
            _ => None,
        };
        if let Some((k, v)) = rewritten {
            out.push(' ');
            out.push_str(&k);
            out.push_str("=\"");
            escape_attr(&v, out);
            out.push('"');
        }
    }
}

fn write_children(ctx: &Context<'_>, node: &XmlNode, out: &mut String, result: &mut SanitizedChapter) {
    for child in &node.children {
        match child {
            XmlChild::Text(t) => escape_text(t, out),
            XmlChild::Element(e) => write_element(ctx, e, out, result),
        }
    }
}

fn write_element(ctx: &Context<'_>, node: &XmlNode, out: &mut String, result: &mut SanitizedChapter) {
    let name = node.name.as_str();
    if name == "style" {
        result.inline_styles.push(node.text_raw());
        return;
    }
    if name == "link" {
        let is_css = node.attr("rel").is_some_and(|r| r.split_whitespace().any(|p| p.eq_ignore_ascii_case("stylesheet")))
            || node.attr("type").is_some_and(|t| t.eq_ignore_ascii_case("text/css"));
        if is_css {
            if let Some(href) = node.attr("href").and_then(|h| paths::resolve(ctx.chapter_dir, h)) {
                result.stylesheet_hrefs.push(href);
            }
        }
        return;
    }
    if DROP.contains(&name) {
        return;
    }
    if !KEEP.contains(&name) {
        // Unknown tag: keep its content, lose the wrapper.
        write_children(ctx, node, out, result);
        return;
    }
    // An <img>/<image> whose source was rejected would render as a broken
    // image; drop it and keep its alt text (if any) instead.
    if name == "img" || name == "image" {
        let src_ok = node
            .attrs
            .iter()
            .any(|(k, v)| matches!(k.as_str(), "src" | "href" | "xlink:href") && rewrite_url(ctx, name, v).is_some());
        if !src_ok {
            if let Some(alt) = node.attr("alt") {
                escape_text(alt, out);
            }
            return;
        }
    }
    out.push('<');
    out.push_str(name);
    write_attrs(ctx, node, out);
    if VOID.contains(&name) {
        out.push_str("/>");
        return;
    }
    out.push('>');
    write_children(ctx, node, out, result);
    out.push_str("</");
    out.push_str(name);
    out.push('>');
}

impl XmlNode {
    fn text_raw(&self) -> String {
        let mut out = String::new();
        for c in &self.children {
            match c {
                XmlChild::Text(t) => out.push_str(t),
                XmlChild::Element(e) => out.push_str(&e.text_raw()),
            }
        }
        out
    }
}

/// `chapter_rel` is the chapter's root-relative path; `book_root` the
/// extracted book directory (absolute).
pub fn sanitize_chapter(xhtml: &str, chapter_rel: &str, book_root: &Path) -> SanitizedChapter {
    let ctx = Context { chapter_dir: paths::parent_dir(chapter_rel), book_root };
    let root = xml_tree::parse(xhtml);
    let mut result = SanitizedChapter { html: String::new(), stylesheet_hrefs: Vec::new(), inline_styles: Vec::new() };
    let mut html = String::new();
    // <head> styles/links are collected even though the head itself is dropped.
    if let Some(head) = root.find("head") {
        for child in &head.children {
            if let XmlChild::Element(e) = child {
                if e.name == "style" || e.name == "link" {
                    let mut scratch = String::new();
                    write_element(&ctx, e, &mut scratch, &mut result);
                }
            }
        }
    }
    match root.find("body") {
        Some(body) => write_children(&ctx, body, &mut html, &mut result),
        None => write_children(&ctx, &root, &mut html, &mut result),
    }
    result.html = html;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(xhtml: &str) -> SanitizedChapter {
        sanitize_chapter(xhtml, "OEBPS/text/ch1.xhtml", Path::new("/book"))
    }

    #[test]
    fn strips_scripts_event_handlers_and_javascript_links() {
        let out = run(r#"<html><head><script>alert(1)</script></head><body>
            <p onload="x()" onclick="y()">Hi<script>evil()</script></p>
            <a href="javascript:alert(1)">bad</a>
            <a href="data:text/html,x">bad2</a>
            <iframe src="http://x"></iframe><form><input/></form>
        </body></html>"#);
        assert!(!out.html.contains("script"));
        assert!(!out.html.contains("onload") && !out.html.contains("onclick"));
        assert!(!out.html.contains("javascript:") && !out.html.contains("data:"));
        assert!(!out.html.contains("iframe") && !out.html.contains("form") && !out.html.contains("input"));
        assert!(out.html.contains("<a>bad</a>"));
        assert!(out.html.contains("<p>Hi</p>"));
    }

    #[test]
    fn rewrites_relative_images_and_drops_external_ones() {
        let out = run(r#"<body><img src="../images/a.png" alt="A"/><img src="https://evil/x.png" alt="ext"/><img src="../../../etc/x.png" alt="esc"/></body>"#);
        let expected = Path::new("/book").join("OEBPS").join("images").join("a.png").to_string_lossy().into_owned();
        assert!(out.html.contains(&format!(r#"<img data-epub-src="{expected}" alt="A"/>"#)), "{}", out.html);
        assert!(!out.html.contains("evil") && !out.html.contains("etc"));
        assert!(out.html.contains("ext") && out.html.contains("esc"));
    }

    #[test]
    fn classifies_links() {
        let out = run(r##"<body><a href="ch2.xhtml#s1">next</a><a href="#top">top</a><a href="https://example.com/x">ext</a><a href="mailto:a@b">m</a></body>"##);
        assert!(out.html.contains(r#"<a data-epub-href="OEBPS/text/ch2.xhtml#s1">next</a>"#));
        assert!(out.html.contains(r##"<a data-epub-href="#top">top</a>"##));
        assert!(out.html.contains(r#"<a data-external-href="https://example.com/x">ext</a>"#));
        assert!(out.html.contains(r#"<a data-external-href="mailto:a@b">m</a>"#));
    }

    #[test]
    fn collects_styles_and_stylesheets_from_head_and_body() {
        let out = run(r#"<html><head><link rel="stylesheet" href="../css/a.css"/><style>p{color:red}</style></head><body><style>b{}</style><p>x</p></body></html>"#);
        assert_eq!(out.stylesheet_hrefs, vec!["OEBPS/css/a.css".to_string()]);
        assert_eq!(out.inline_styles, vec!["p{color:red}".to_string(), "b{}".to_string()]);
        assert_eq!(out.html.trim(), "<p>x</p>");
    }

    #[test]
    fn unwraps_unknown_tags_and_filters_style_attributes() {
        let out = run(r#"<body><custom><p style="color:red">a</p><p style="background:url(x)">b</p></custom></body>"#);
        assert_eq!(out.html, r#"<p style="color:red">a</p><p>b</p>"#);
    }

    #[test]
    fn escapes_text_and_attribute_values() {
        let out = run(r#"<body><p title="a&quot;&lt;b">1 &lt; 2 &amp; 3</p></body>"#);
        assert_eq!(out.html, r#"<p title="a&quot;&lt;b">1 &lt; 2 &amp; 3</p>"#);
    }

    #[test]
    fn keeps_svg_images_with_xlink_href() {
        let out = run(r##"<body><svg viewBox="0 0 1 1"><image xlink:href="cover.jpg" width="1"/><use xlink:href="#x"/></svg></body>"##);
        assert!(out.html.contains(r#"<svg viewbox="0 0 1 1">"#));
        assert!(out.html.contains("data-epub-src="));
        assert!(!out.html.contains("<use"));
    }
}
