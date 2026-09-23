// Book-relative path arithmetic for the EPUB reader. Every href in an EPUB
// (OPF manifest items, NCX/nav targets, chapter `<img src>`s, CSS `url()`s)
// is relative to the file it appears in; this module turns them into
// normalised, forward-slash, root-relative paths and refuses anything that
// would climb above the extracted book directory — the same rule
// utils::safe_archive_path applies to archive entry names.

/// Splits `href` into (path, fragment). `#top` → ("", Some("top")).
pub fn split_fragment(href: &str) -> (&str, Option<&str>) {
    match href.split_once('#') {
        Some((path, frag)) => (path, Some(frag)),
        None => (href, None),
    }
}

pub fn has_scheme(href: &str) -> bool {
    let mut chars = href.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    for c in chars {
        if c == ':' {
            return true;
        }
        if !(c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.') {
            return false;
        }
    }
    false
}

pub fn scheme_of(href: &str) -> Option<String> {
    if !has_scheme(href) {
        return None;
    }
    href.split_once(':').map(|(s, _)| s.to_ascii_lowercase())
}

pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() && input.is_char_boundary(i + 1) && input.is_char_boundary(i + 3) {
            let hex = &input[i + 1..i + 3];
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Directory part of a root-relative path (`text/ch1.xhtml` → `text`,
/// `ch1.xhtml` → ``).
pub fn parent_dir(path: &str) -> &str {
    match path.rfind('/') {
        Some(idx) => &path[..idx],
        None => "",
    }
}

/// Resolves `href` (no fragment, no query) against `base_dir` and returns
/// a normalised root-relative path, or None when it has a scheme, is
/// absolute, or escapes the root.
pub fn resolve(base_dir: &str, href: &str) -> Option<String> {
    if href.is_empty() || has_scheme(href) {
        return None;
    }
    let decoded = percent_decode(href).replace('\\', "/");
    let (path, _) = split_fragment(&decoded);
    let path = path.split('?').next().unwrap_or("");
    if path.is_empty() {
        return None;
    }
    let mut segments: Vec<&str> = Vec::new();
    // A leading `/` is "from the book root", which is also what an empty
    // base dir means.
    let joined = if path.starts_with('/') || base_dir.is_empty() { path.to_string() } else { format!("{base_dir}/{path}") };
    for seg in joined.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            other => segments.push(other),
        }
    }
    if segments.is_empty() {
        return None;
    }
    Some(segments.join("/"))
}

/// Absolute filesystem path of a root-relative path inside the book dir.
pub fn absolute(root: &std::path::Path, rel: &str) -> std::path::PathBuf {
    let mut out = root.to_path_buf();
    for seg in rel.split('/') {
        out.push(seg);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_to_the_base_dir() {
        assert_eq!(resolve("OEBPS", "text/ch1.xhtml"), Some("OEBPS/text/ch1.xhtml".into()));
        assert_eq!(resolve("OEBPS/text", "../images/a.png"), Some("OEBPS/images/a.png".into()));
        assert_eq!(resolve("", "ch1.xhtml"), Some("ch1.xhtml".into()));
        assert_eq!(resolve("OEBPS/text", "./ch2.xhtml#sec"), Some("OEBPS/text/ch2.xhtml".into()));
    }

    #[test]
    fn rejects_escapes_schemes_and_empties() {
        assert_eq!(resolve("OEBPS", "../../etc/passwd"), None);
        assert_eq!(resolve("", ".."), None);
        assert_eq!(resolve("a", "http://x/y.png"), None);
        assert_eq!(resolve("a", "javascript:alert(1)"), None);
        assert_eq!(resolve("a", "#frag"), None);
        assert_eq!(resolve("a", ""), None);
    }

    #[test]
    fn decodes_percent_escapes_and_backslashes() {
        assert_eq!(resolve("", "my%20book/ch%C3%A9.xhtml"), Some("my book/ché.xhtml".into()));
        assert_eq!(resolve("a", r"..\..\evil"), None);
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn detects_schemes() {
        assert!(has_scheme("https://a"));
        assert!(has_scheme("mailto:x"));
        assert!(!has_scheme("text/ch1.xhtml"));
        assert_eq!(scheme_of("JavaScript:alert(1)"), Some("javascript".into()));
    }

    #[test]
    fn splits_fragments_and_parents() {
        assert_eq!(split_fragment("a.xhtml#top"), ("a.xhtml", Some("top")));
        assert_eq!(split_fragment("#top"), ("", Some("top")));
        assert_eq!(parent_dir("OEBPS/text/a.xhtml"), "OEBPS/text");
        assert_eq!(parent_dir("a.xhtml"), "");
    }
}
