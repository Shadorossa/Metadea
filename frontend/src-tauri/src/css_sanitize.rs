// CSS sanitiser shared by UI themes (ui_themes.rs) and EPUB publisher
// stylesheets (epub_reader/css.rs): both load CSS the user did not write into
// the app's own webview, so both need the same defences. Each caller only
// supplies which at-rules to drop and how a `url()` target resolves to a
// local asset; everything else (comments, escapes, script vectors) is one
// implementation, so a hardening added for one reaches the other.
// `docs/THEMING.md` → "Sanitisation" mirrors these rules.

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b'_'
}

/// Case-insensitive `find` on ASCII needles.
fn find_ci(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&i| hay[i..i + needle.len()].eq_ignore_ascii_case(needle))
}

fn replace_ci(input: &str, needle: &str, replacement: &str) -> String {
    let hay = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(at) = find_ci(hay, needle.as_bytes(), cursor) {
        out.push_str(&input[cursor..at]);
        out.push_str(replacement);
        cursor = at + needle.len();
    }
    out.push_str(&input[cursor..]);
    out
}

/// Removes `/* … */` comments so nothing below can be hidden inside one.
fn strip_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// CSS escapes can spell any identifier (`\75rl(` is `url(`). ASCII letters,
/// digits and the few punctuation marks the scanner keys on never need
/// escaping in legitimate CSS, so they are decoded before scanning; every
/// other escape (`\201C`, `\e900` icon glyphs…) is left untouched.
fn decode_ascii_escapes(css: &str) -> String {
    let bytes = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut i = 0;
    while i < css.len() {
        if bytes[i] != b'\\' || i + 1 >= css.len() {
            let ch = css[i..].chars().next().unwrap_or('\\');
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        let mut j = i + 1;
        while j < css.len() && j - (i + 1) < 6 && bytes[j].is_ascii_hexdigit() {
            j += 1;
        }
        let decoded = if j > i + 1 {
            let code = u32::from_str_radix(&css[i + 1..j], 16).ok().and_then(char::from_u32);
            // One optional whitespace terminates a hex escape.
            if j < css.len() && (bytes[j] == b' ' || bytes[j] == b'\t' || bytes[j] == b'\n') {
                j += 1;
            }
            code
        } else {
            let ch = css[i + 1..].chars().next();
            j = i + 1 + ch.map_or(0, char::len_utf8);
            ch
        };
        match decoded {
            Some(ch) if ch.is_ascii_alphanumeric() || matches!(ch, '(' | ':' | '@' | '-' | '/' | '<') => {
                out.push(ch);
                i = j;
            }
            _ => {
                out.push_str(&css[i..j]);
                i = j;
            }
        }
    }
    out
}

/// Drops every `<at-rule> …;` statement for the given at-rules
/// (case-insensitive), e.g. `@import`.
fn strip_at_statements(css: &str, at_rules: &[&str]) -> String {
    let hay = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut cursor = 0;
    loop {
        let next = at_rules.iter().filter_map(|rule| find_ci(hay, rule.as_bytes(), cursor)).min();
        let Some(at) = next else { break };
        out.push_str(&css[cursor..at]);
        cursor = match css[at..].find(';') {
            Some(end) => at + end + 1,
            None => css.len(),
        };
    }
    out.push_str(&css[cursor..]);
    out
}

/// Rewrites every `url(...)` / `src(...)`: in-folder files become asset URLs
/// (through `resolve`), everything else becomes `none`.
fn rewrite_url_functions(css: &str, resolve: &dyn Fn(&str) -> Option<String>) -> String {
    let hay = css.as_bytes();
    let mut out = String::with_capacity(css.len());
    let mut cursor = 0;
    let mut i = 0;
    while i + 4 <= hay.len() {
        let token = &hay[i..i + 4];
        let is_fn = token.eq_ignore_ascii_case(b"url(") || token.eq_ignore_ascii_case(b"src(");
        if !is_fn || (i > 0 && is_ident_byte(hay[i - 1])) {
            i += 1;
            continue;
        }
        // Find the closing paren, honouring quotes.
        let mut j = i + 4;
        let mut quote: Option<u8> = None;
        let mut close = None;
        while j < hay.len() {
            let b = hay[j];
            match quote {
                Some(q) if b == q => quote = None,
                Some(_) => {}
                None if b == b'"' || b == b'\'' => quote = Some(b),
                None if b == b')' => {
                    close = Some(j);
                    break;
                }
                None => {}
            }
            j += 1;
        }
        let Some(close) = close else {
            // Unterminated: drop the rest of the sheet rather than guess.
            out.push_str(&css[cursor..i]);
            return out;
        };
        let raw = css[i + 4..close].trim();
        let unquoted = raw
            .strip_prefix('"')
            .and_then(|s| s.strip_suffix('"'))
            .or_else(|| raw.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
            .unwrap_or(raw);
        out.push_str(&css[cursor..i]);
        match resolve(unquoted) {
            Some(url) => {
                let name = std::str::from_utf8(&hay[i..i + 3]).unwrap_or("url").to_ascii_lowercase();
                out.push_str(&format!("{name}(\"{}\")", url.replace('"', "%22")));
            }
            None => out.push_str("none"),
        }
        cursor = close + 1;
        i = close + 1;
    }
    out.push_str(&css[cursor..]);
    out
}

/// Legacy script-in-CSS vectors (IE `expression()`/`behavior`, Gecko XBL
/// bindings, script URLs) and a way out of an inline `<style>` element.
const SCRIPT_VECTORS: &[(&str, &str)] = &[
    ("expression(", "blocked("),
    ("-moz-binding", "-blocked-binding"),
    ("behavior:", "-blocked-behavior-:"),
    ("behaviour:", "-blocked-behaviour-:"),
    ("javascript:", "blocked:"),
    ("vbscript:", "blocked:"),
    ("</style", ""),
];

/// Comments out, escapes decoded, `at_rules` statements dropped, every
/// `url()`/`src()` rewritten through `resolve` (None → `none`), script
/// vectors neutralised.
pub(crate) fn sanitize(css: &str, at_rules: &[&str], resolve: &dyn Fn(&str) -> Option<String>) -> String {
    let stripped = strip_comments(css);
    let decoded = decode_ascii_escapes(&stripped);
    let without_at_rules = strip_at_statements(&decoded, at_rules);
    let mut out = rewrite_url_functions(&without_at_rules, resolve);
    for (needle, replacement) in SCRIPT_VECTORS {
        out = replace_ci(&out, needle, replacement);
    }
    out
}
