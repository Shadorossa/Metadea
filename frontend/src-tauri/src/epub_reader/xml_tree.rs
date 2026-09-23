// Lenient XML → tree for the EPUB reader. container.xml, the OPF, the NCX,
// the EPUB3 nav document and the chapter XHTML files all go through this so
// the OPF parser and the sanitiser walk one shape instead of each driving
// quick-xml's event stream. "Lenient" because real EPUBs ship unclosed
// `<br>`s, mismatched end tags and HTML named entities without a DTD; a
// strict parser would refuse half the books people actually own.
use quick_xml::escape::resolve_html5_entity;
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

#[derive(Debug, Clone, PartialEq)]
pub enum XmlChild {
    Element(XmlNode),
    Text(String),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct XmlNode {
    /// Local name (prefix stripped), lowercased.
    pub name: String,
    /// Attribute names keep their prefix (`xlink:href`) but are lowercased.
    pub attrs: Vec<(String, String)>,
    pub children: Vec<XmlChild>,
}

impl XmlNode {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    /// Direct element children with this local name.
    pub fn elements<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a XmlNode> + 'a {
        self.children.iter().filter_map(move |c| match c {
            XmlChild::Element(e) if e.name == name => Some(e),
            _ => None,
        })
    }

    pub fn child(&self, name: &str) -> Option<&XmlNode> {
        self.children.iter().find_map(|c| match c {
            XmlChild::Element(e) if e.name == name => Some(e),
            _ => None,
        })
    }

    /// First element anywhere below this node with the given local name.
    pub fn find(&self, name: &str) -> Option<&XmlNode> {
        for c in &self.children {
            if let XmlChild::Element(e) = c {
                if e.name == name {
                    return Some(e);
                }
                if let Some(found) = e.find(name) {
                    return Some(found);
                }
            }
        }
        None
    }

    /// Concatenated text of this subtree, whitespace collapsed.
    pub fn text(&self) -> String {
        let mut out = String::new();
        self.collect_text(&mut out);
        out.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    fn collect_text(&self, out: &mut String) {
        for c in &self.children {
            match c {
                XmlChild::Text(t) => out.push_str(t),
                XmlChild::Element(e) => e.collect_text(out),
            }
        }
    }
}

// HTML void elements: an unclosed `<br>` in a sloppy XHTML file would
// otherwise swallow the rest of the chapter as its children.
const VOID_ELEMENTS: &[&str] = &["br", "hr", "img", "meta", "link", "input", "wbr", "col", "base", "source", "area"];

fn local_lower(raw: &[u8]) -> String {
    let full = String::from_utf8_lossy(raw);
    let local = full.rsplit(':').next().unwrap_or(&full);
    local.to_ascii_lowercase()
}

fn resolve_entity(name: &str) -> Option<String> {
    if let Some(num) = name.strip_prefix('#') {
        let code = if let Some(hex) = num.strip_prefix('x').or_else(|| num.strip_prefix('X')) {
            u32::from_str_radix(hex, 16).ok()?
        } else {
            num.parse::<u32>().ok()?
        };
        return char::from_u32(code).map(|c| c.to_string());
    }
    resolve_html5_entity(name).map(|s| s.to_string())
}

fn node_from_start(start: &BytesStart<'_>) -> XmlNode {
    let mut attrs = Vec::new();
    for attr in start.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.as_ref()).to_ascii_lowercase();
        let value = attr
            .unescape_value_with(resolve_html5_entity)
            .map(|v| v.into_owned())
            .unwrap_or_else(|_| String::from_utf8_lossy(&attr.value).into_owned());
        attrs.push((key, value));
    }
    XmlNode { name: local_lower(start.name().as_ref()), attrs, children: Vec::new() }
}

fn push_text(node: &mut XmlNode, text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(XmlChild::Text(last)) = node.children.last_mut() {
        last.push_str(text);
    } else {
        node.children.push(XmlChild::Text(text.to_string()));
    }
}

/// Parses a document into a synthetic root node whose children are the
/// top-level elements. Never fails: malformed input yields whatever tree
/// could be recovered up to the first unreadable byte.
pub fn parse(source: &str) -> XmlNode {
    let mut reader = Reader::from_str(source);
    let config = reader.config_mut();
    config.check_end_names = false;
    config.allow_unmatched_ends = true;
    config.allow_dangling_amp = true;
    config.check_comments = false;
    config.trim_text_start = false;
    config.trim_text_end = false;

    let mut stack: Vec<XmlNode> = vec![XmlNode { name: String::new(), attrs: Vec::new(), children: Vec::new() }];

    while let Ok(event) = reader.read_event() {
        match event {
            Event::Start(start) => {
                let node = node_from_start(&start);
                if VOID_ELEMENTS.contains(&node.name.as_str()) {
                    stack.last_mut().expect("root").children.push(XmlChild::Element(node));
                } else {
                    stack.push(node);
                }
            }
            Event::Empty(start) => {
                let node = node_from_start(&start);
                stack.last_mut().expect("root").children.push(XmlChild::Element(node));
            }
            Event::End(end) => {
                let name = local_lower(end.name().as_ref());
                // Close the nearest open element with this name; an end tag
                // that matches nothing open is ignored (stray `</br>` etc.).
                if let Some(pos) = stack.iter().rposition(|n| n.name == name) {
                    if pos == 0 {
                        continue;
                    }
                    while stack.len() > pos {
                        let node = stack.pop().expect("stack");
                        stack.last_mut().expect("parent").children.push(XmlChild::Element(node));
                    }
                }
            }
            Event::Text(text) => {
                let content = text.xml_content().map(|c| c.into_owned()).unwrap_or_default();
                push_text(stack.last_mut().expect("root"), &content);
            }
            Event::CData(cdata) => {
                let content = String::from_utf8_lossy(&cdata).into_owned();
                push_text(stack.last_mut().expect("root"), &content);
            }
            Event::GeneralRef(reference) => {
                let name = reference.decode().map(|c| c.into_owned()).unwrap_or_default();
                let resolved = resolve_entity(&name).unwrap_or_else(|| format!("&{name};"));
                push_text(stack.last_mut().expect("root"), &resolved);
            }
            Event::Eof => break,
            Event::Comment(_) | Event::Decl(_) | Event::PI(_) | Event::DocType(_) => {}
        }
    }

    // Unclosed elements at EOF are still part of the document.
    while stack.len() > 1 {
        let node = stack.pop().expect("stack");
        stack.last_mut().expect("parent").children.push(XmlChild::Element(node));
    }
    stack.pop().expect("root")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_nested_elements_with_prefixes_stripped() {
        let root = parse(r#"<?xml version="1.0"?><dc:root xmlns:dc="x"><dc:title id="t">Hello</dc:title></dc:root>"#);
        let title = root.find("title").unwrap();
        assert_eq!(title.attr("id"), Some("t"));
        assert_eq!(title.text(), "Hello");
    }

    #[test]
    fn resolves_html_and_numeric_entities() {
        let root = parse("<p>a&nbsp;b &#169; &#xe9; &amp; &unknown;</p>");
        // text() collapses whitespace (U+00A0 counts as such); the raw text
        // child keeps the nbsp itself.
        let p = root.find("p").unwrap();
        assert_eq!(p.text(), "a b © é & &unknown;");
        assert_eq!(p.children, vec![XmlChild::Text("a\u{a0}b © é & &unknown;".into())]);
    }

    #[test]
    fn tolerates_unclosed_void_tags_and_stray_end_tags() {
        let root = parse("<body><p>one<br>two</p></br><p>three</p></body>");
        let body = root.find("body").unwrap();
        assert_eq!(body.elements("p").count(), 2);
        assert_eq!(body.text(), "onetwothree");
    }

    #[test]
    fn keeps_attribute_prefixes_lowercased() {
        let root = parse(r#"<svg><image xlink:HREF="a.png"/></svg>"#);
        assert_eq!(root.find("image").unwrap().attr("xlink:href"), Some("a.png"));
    }

    #[test]
    fn closes_everything_at_eof() {
        let root = parse("<html><body><p>truncated");
        assert_eq!(root.find("p").unwrap().text(), "truncated");
    }
}
