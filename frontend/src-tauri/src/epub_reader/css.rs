// Publisher stylesheet sanitiser. Keeps typography/layout rules, drops
// anything that reaches outside the book (`@import`, external `url()`),
// neuters the script-in-CSS vectors and rewrites relative `url()`s to
// `epub-asset:<absolute path>` placeholders the frontend converts to
// asset:// URLs — all through the sanitiser UI themes use too
// (css_sanitize.rs). `html`/`body` selectors are retargeted at
// `.epub-chapter` because the chapter is rendered inside a shadow root,
// where neither element exists.
use super::paths;
use std::path::Path;

// Whole-word replacement of `body`/`html` in selector text (not inside
// declaration blocks, so `font-family: body` style values are untouched).
fn retarget_root_selectors(css: &str) -> String {
    const GROUP_AT_RULES: &[&str] = &["@media", "@supports", "@layer", "@container", "@document"];
    let chars: Vec<char> = css.chars().collect();
    let mut out = String::with_capacity(css.len());
    // One entry per open block: true when its content is selectors (the
    // top level and conditional group rules), false inside a declaration
    // block (`p { ... }`, `@font-face { ... }`).
    let mut stack: Vec<bool> = Vec::new();
    let mut prelude = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let in_selector = stack.last().copied().unwrap_or(true);
        match c {
            '{' => {
                let p = prelude.trim_start().to_ascii_lowercase();
                stack.push(GROUP_AT_RULES.iter().any(|rule| p.starts_with(rule)));
                prelude.clear();
                out.push(c);
                i += 1;
                continue;
            }
            '}' => {
                stack.pop();
                prelude.clear();
                out.push(c);
                i += 1;
                continue;
            }
            ';' => prelude.clear(),
            _ => {}
        }
        if in_selector && c.is_ascii_alphabetic() {
            let word_end = chars[i..]
                .iter()
                .position(|ch| !(ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_'))
                .map(|p| i + p)
                .unwrap_or(chars.len());
            let word: String = chars[i..word_end].iter().collect();
            let prev = if i > 0 { chars[i - 1] } else { ' ' };
            let boundary_before = !(prev.is_ascii_alphanumeric() || prev == '-' || prev == '_' || prev == '.' || prev == '#' || prev == '@');
            if boundary_before && (word == "body" || word == "html") {
                out.push_str(".epub-chapter");
            } else {
                out.push_str(&word);
            }
            prelude.push_str(&word);
            i = word_end;
            continue;
        }
        prelude.push(c);
        out.push(c);
        i += 1;
    }
    out
}

/// `chapter_dir` is the root-relative directory of the file the CSS belongs
/// to (the stylesheet's own dir for linked sheets, the chapter's for
/// inline `<style>` blocks).
pub fn sanitize_css(css: &str, chapter_dir: &str, book_root: &Path) -> String {
    let resolve = |target: &str| {
        paths::resolve(chapter_dir, target).map(|rel| {
            let abs = paths::absolute(book_root, &rel).to_string_lossy().replace('\\', "/");
            format!("epub-asset:{abs}")
        })
    };
    let sanitized = crate::css_sanitize::sanitize(css, &["@import", "@charset", "@namespace"], &resolve);
    retarget_root_selectors(&sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(css: &str) -> String {
        sanitize_css(css, "OEBPS/css", Path::new("/book"))
    }

    #[test]
    fn drops_imports_and_comments() {
        let out = run("@import url(\"x.css\"); /* c */ @charset \"utf-8\"; p { color: red; }");
        assert!(!out.contains("@import") && !out.contains("@charset") && !out.contains("/*"));
        assert!(out.contains("p { color: red; }"));
    }

    #[test]
    fn rewrites_relative_urls_and_removes_external_ones() {
        let out = run("@font-face { src: url('../fonts/a.ttf'); } p { background: url(https://x/y.png); } q { background: url(data:image/png;base64,AAAA) }");
        let expected = Path::new("/book").join("OEBPS").join("fonts").join("a.ttf").to_string_lossy().replace('\\', "/");
        assert!(out.contains(&format!("url(\"epub-asset:{expected}\")")), "{out}");
        assert!(!out.contains("https://") && !out.contains("data:"));
        assert!(out.contains("background: none"));
    }

    #[test]
    fn retargets_body_and_html_selectors_only() {
        let out = run("html, body { margin: 0 } tbody td { x: y } .body { a: b } @media print { body { c: d } } p { font-family: body }");
        assert!(out.starts_with(".epub-chapter, .epub-chapter { margin: 0 }"), "{out}");
        assert!(out.contains("tbody td") && out.contains(".body { a: b }"));
        assert!(out.contains("@media print { .epub-chapter { c: d } }"), "{out}");
        assert!(out.contains("font-family: body"));
    }

    #[test]
    fn neuters_expression_and_binding_vectors() {
        let out = run("p { width: expression(alert(1)); -moz-binding: url(x); behavior: url(y); behaviour: url(z) }");
        let lower = out.to_ascii_lowercase();
        assert!(!lower.contains("expression(") && !lower.contains("-moz-binding"), "{out}");
        assert!(!lower.contains("behavior:") && !lower.contains("behaviour:"), "{out}");
        assert!(!out.contains("url(x)") && !out.contains("url(y)"));
    }

    // The hardening UI themes had and EPUB stylesheets used to miss: escaped
    // spellings, vbscript:, src(), quoted parens and breaking out of <style>.
    #[test]
    fn shares_the_ui_theme_hardening() {
        let out = run(r"a { background: \75rl(https://evil/x.png) } b { x: VBScript:msgbox } @font-face { src: src(https://evil/f.woff) } c { background: url('a).png') } d { content: '</style><script>' }");
        let lower = out.to_ascii_lowercase();
        assert!(!lower.contains("evil"), "{out}");
        assert!(!lower.contains("vbscript:"), "{out}");
        assert!(!lower.contains("</style"), "{out}");
        // A quoted `)` stays inside its url() instead of ending it early.
        let quoted = Path::new("/book").join("OEBPS").join("css").join("a).png").to_string_lossy().replace('\\', "/");
        assert!(out.contains(&format!("url(\"epub-asset:{quoted}\")")), "{out}");
    }
}
