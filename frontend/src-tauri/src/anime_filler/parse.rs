// HTML → data for AnimeFillerList.com (no API, no HTML parser crate in the
// graph). The site's markup is stable and shallow, so a tiny tag scanner that
// finds elements by id/class and returns their inner HTML is enough; nothing
// here tries to be a general HTML parser. Every function is total: garbage in
// yields an empty result (or `None`), which the caller treats as "parse
// failure → back off", never a panic.

use std::collections::BTreeMap;

/// AnimeFillerList's four episode categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum FillerKind {
    MangaCanon,
    AnimeCanon,
    Filler,
    Mixed,
}

impl FillerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FillerKind::MangaCanon => "manga_canon",
            FillerKind::AnimeCanon => "anime_canon",
            FillerKind::Filler => "filler",
            FillerKind::Mixed => "mixed",
        }
    }

    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "manga_canon" => Some(FillerKind::MangaCanon),
            "anime_canon" => Some(FillerKind::AnimeCanon),
            "filler" => Some(FillerKind::Filler),
            "mixed" => Some(FillerKind::Mixed),
            _ => None,
        }
    }

    /// The `td.Type` label of the episode table ("Manga Canon", "Mixed
    /// Canon/Filler", "Filler", "Anime Canon").
    fn from_label(label: &str) -> Option<Self> {
        let label = label.to_ascii_lowercase();
        if label.contains("mixed") {
            Some(FillerKind::Mixed)
        } else if label.contains("filler") {
            Some(FillerKind::Filler)
        } else if label.contains("anime canon") {
            Some(FillerKind::AnimeCanon)
        } else if label.contains("canon") {
            Some(FillerKind::MangaCanon)
        } else {
            None
        }
    }

    /// A `#Condensed` child block's class token.
    fn from_condensed_class(token: &str) -> Option<Self> {
        match token.to_ascii_lowercase().as_str() {
            "manga_canon" => Some(FillerKind::MangaCanon),
            "anime_canon" => Some(FillerKind::AnimeCanon),
            "filler" => Some(FillerKind::Filler),
            "mixed_canon/filler" | "mixed_canon" | "mixed" => Some(FillerKind::Mixed),
            _ => None,
        }
    }
}

/// Upper bound on an episode number and on a single range's length, so a
/// malformed "1-9999999" cannot allocate millions of rows.
pub const MAX_EPISODE: i64 = 5000;

// ── Range text ──────────────────────────────────────────────────────────────

/// `"1-6, 8, 10-13"` → `[1..=6, 8, 10..=13]`. Accepts hyphen, en/em dash and
/// "to" separators, commas or semicolons between items and any spacing;
/// ignores anything that isn't a number or a range. Sorted, deduplicated.
pub fn parse_episode_ranges(text: &str) -> Vec<i64> {
    let normalized = decode_entities(text)
        .replace(['\u{2013}', '\u{2014}', '\u{2012}', '\u{2212}'], "-")
        .replace(" to ", "-");
    let mut out: Vec<i64> = Vec::new();
    for item in normalized.split([',', ';', '\n']) {
        let item: String = item.chars().filter(|c| !c.is_whitespace()).collect();
        if item.is_empty() {
            continue;
        }
        let mut parts = item.splitn(2, '-');
        let start = parts.next().and_then(parse_number);
        let end = parts.next().map(parse_number);
        match (start, end) {
            (Some(start), None) if (1..=MAX_EPISODE).contains(&start) => out.push(start),
            (Some(start), Some(Some(end))) if start >= 1 && end >= start && end <= MAX_EPISODE => {
                out.extend(start..=end);
            }
            _ => {}
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn parse_number(text: &str) -> Option<i64> {
    if text.is_empty() || !text.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

// ── Tiny tag scanner ────────────────────────────────────────────────────────

#[derive(Debug)]
struct Tag<'a> {
    /// Lowercase tag name, without the `/` of a closing tag.
    name: String,
    attrs: &'a str,
    /// Byte offset of `<` and one past `>`.
    start: usize,
    end: usize,
    closing: bool,
}

/// The next tag at or after `from`. Comments, doctype/processing
/// instructions and the bodies of `<script>` / `<style>` are skipped.
fn next_tag(html: &str, mut from: usize) -> Option<Tag<'_>> {
    let bytes = html.as_bytes();
    loop {
        let start = from + html.get(from..)?.find('<')?;
        let rest = &html[start..];
        if let Some(comment) = rest.strip_prefix("<!--") {
            from = start + 4 + comment.find("-->").map(|i| i + 3)?;
            continue;
        }
        if rest.starts_with("<!") || rest.starts_with("<?") {
            from = start + rest.find('>')? + 1;
            continue;
        }
        let closing = rest.as_bytes().get(1) == Some(&b'/');
        let name_start = start + if closing { 2 } else { 1 };
        let name_len = html[name_start..]
            .bytes()
            .take_while(|b| b.is_ascii_alphanumeric())
            .count();
        if name_len == 0 {
            from = start + 1;
            continue;
        }
        // End of the tag: the first '>' outside a quoted attribute value.
        let mut quote: Option<u8> = None;
        let mut end = None;
        for (offset, &b) in bytes[name_start + name_len..].iter().enumerate() {
            match quote {
                Some(q) if b == q => quote = None,
                Some(_) => {}
                None if b == b'"' || b == b'\'' => quote = Some(b),
                None if b == b'>' => {
                    end = Some(name_start + name_len + offset + 1);
                    break;
                }
                None => {}
            }
        }
        let end = end?;
        let name = html[name_start..name_start + name_len].to_ascii_lowercase();
        let attrs = &html[name_start + name_len..end - 1];
        if !closing && (name == "script" || name == "style") {
            let close = format!("</{name}");
            let lower_rest = html[end..].to_ascii_lowercase();
            from = end + lower_rest.find(&close).unwrap_or(lower_rest.len());
            continue;
        }
        return Some(Tag { name, attrs, start, end, closing });
    }
}

/// An attribute's value (quoted or bare), entities decoded.
fn attr(attrs: &str, wanted: &str) -> Option<String> {
    let bytes = attrs.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
            i += 1;
        }
        let name_start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'=' && bytes[i] != b'/' {
            i += 1;
        }
        let name = &attrs[name_start..i];
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        let mut value = "";
        if i < bytes.len() && bytes[i] == b'=' {
            i += 1;
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
                let quote = bytes[i];
                let value_start = i + 1;
                i = value_start;
                while i < bytes.len() && bytes[i] != quote {
                    i += 1;
                }
                value = &attrs[value_start..i.min(bytes.len())];
                i += 1;
            } else {
                let value_start = i;
                while i < bytes.len() && !bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                value = &attrs[value_start..i];
            }
        }
        if name.is_empty() {
            i += 1;
            continue;
        }
        if name.eq_ignore_ascii_case(wanted) {
            return Some(decode_entities(value));
        }
    }
    None
}

fn class_tokens(attrs: &str) -> Vec<String> {
    attr(attrs, "class")
        .map(|value| value.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default()
}

fn has_class(attrs: &str, class: &str) -> bool {
    class_tokens(attrs).iter().any(|token| token.eq_ignore_ascii_case(class))
}

/// One element found by the scanner: its opening tag's attributes and its
/// inner HTML (between the opening tag and the matching close).
struct Element<'a> {
    attrs: &'a str,
    inner: &'a str,
    /// One past the element's closing tag (or the end of the input when it
    /// was never closed).
    end: usize,
}

/// The element whose opening tag starts at `open` — its inner HTML runs to
/// the matching `</name>`, counting nested same-name tags. An unclosed
/// element runs to the end of the input.
fn element_at<'a>(html: &'a str, open: &Tag<'a>) -> Element<'a> {
    let mut depth = 1usize;
    let mut cursor = open.end;
    while let Some(tag) = next_tag(html, cursor) {
        cursor = tag.end;
        if tag.name != open.name {
            continue;
        }
        if tag.closing {
            depth -= 1;
            if depth == 0 {
                return Element { attrs: open.attrs, inner: &html[open.end..tag.start], end: tag.end };
            }
        } else if !tag.attrs.trim_end().ends_with('/') {
            depth += 1;
        }
    }
    Element { attrs: open.attrs, inner: &html[open.end..], end: html.len() }
}

/// Every element (in document order, not descending into a match) whose
/// opening tag satisfies `matches`.
fn find_elements<'a>(html: &'a str, tag_name: Option<&str>, matches: impl Fn(&str) -> bool) -> Vec<Element<'a>> {
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(tag) = next_tag(html, cursor) {
        cursor = tag.end;
        if tag.closing || tag_name.is_some_and(|name| name != tag.name) || !matches(tag.attrs) {
            continue;
        }
        let element = element_at(html, &tag);
        cursor = element.end;
        out.push(element);
    }
    out
}

fn find_first<'a>(html: &'a str, tag_name: Option<&str>, matches: impl Fn(&str) -> bool) -> Option<Element<'a>> {
    find_elements(html, tag_name, matches).into_iter().next()
}

/// Visible text of an HTML fragment: tags dropped, entities decoded,
/// whitespace collapsed.
pub fn text_of(fragment: &str) -> String {
    let mut out = String::with_capacity(fragment.len());
    let mut cursor = 0;
    while let Some(tag) = next_tag(fragment, cursor) {
        out.push_str(&fragment[cursor..tag.start]);
        out.push(' ');
        cursor = tag.end;
    }
    out.push_str(fragment.get(cursor..).unwrap_or(""));
    decode_entities(&out).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The handful of entities AnimeFillerList's markup actually uses, plus
/// numeric references. Unknown named entities are left as written.
pub fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 1..];
        let Some(semi) = after.find(';').filter(|&i| i <= 10) else {
            out.push('&');
            rest = after;
            continue;
        };
        let name = &after[..semi];
        let decoded = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "ndash" => Some('\u{2013}'),
            "mdash" => Some('\u{2014}'),
            "hellip" => Some('\u{2026}'),
            "rsquo" | "lsquo" => Some('\''),
            "rdquo" | "ldquo" => Some('"'),
            _ => name
                .strip_prefix("#x")
                .or_else(|| name.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| name.strip_prefix('#').and_then(|dec| dec.parse::<u32>().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &after[semi + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

// ── Pages ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct IndexShow {
    pub slug: String,
    pub title: String,
}

/// A show slug from a link to `/shows/<slug>` (relative or absolute) —
/// exactly one path segment, lowercase letters, digits and dashes, plus
/// percent-escapes for the few slugs with non-ASCII letters
/// (`sh%C5%8Dnan-pure-love-gang`).
fn slug_from_href(href: &str) -> Option<String> {
    let path = href
        .trim()
        .trim_start_matches("https://www.animefillerlist.com")
        .trim_start_matches("http://www.animefillerlist.com")
        .trim_start_matches("https://animefillerlist.com");
    let slug = path.strip_prefix("/shows/")?.trim_end_matches('/');
    let valid = !slug.is_empty() && slug.len() <= 120 && is_slug(slug.as_bytes());
    valid.then(|| slug.to_string())
}

fn is_slug(bytes: &[u8]) -> bool {
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'a'..=b'z' | b'0'..=b'9' | b'-' => i += 1,
            b'%' if bytes.len() >= i + 3 && bytes[i + 1].is_ascii_hexdigit() && bytes[i + 2].is_ascii_hexdigit() => i += 3,
            _ => return false,
        }
    }
    true
}

/// `/shows` → every show link. Scoped to `#ShowList` when the page has it
/// (so navigation links elsewhere are ignored); deduplicated by slug.
pub fn parse_show_index(html: &str) -> Vec<IndexShow> {
    let scope = find_first(html, None, |attrs| attr(attrs, "id").as_deref() == Some("ShowList"))
        .map(|element| element.inner)
        .unwrap_or(html);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for link in find_elements(scope, Some("a"), |attrs| attr(attrs, "href").is_some()) {
        let Some(slug) = attr(link.attrs, "href").as_deref().and_then(slug_from_href) else { continue };
        let title = text_of(link.inner);
        if title.is_empty() || !seen.insert(slug.clone()) {
            continue;
        }
        out.push(IndexShow { slug, title });
    }
    out
}

fn insert_kind(map: &mut BTreeMap<i64, FillerKind>, episode: i64, kind: FillerKind) {
    // An episode listed under two categories keeps the one that hides the
    // least: mixed wins over filler, which wins over either canon.
    let entry = map.entry(episode).or_insert(kind);
    if kind > *entry {
        *entry = kind;
    }
}

/// The `#Condensed` summary: one block per category, each with a
/// `.Episodes` span holding range text (usually as links).
pub fn parse_condensed(html: &str) -> BTreeMap<i64, FillerKind> {
    let mut map = BTreeMap::new();
    let Some(condensed) = find_first(html, None, |attrs| attr(attrs, "id").as_deref() == Some("Condensed")) else {
        return map;
    };
    let blocks = find_elements(condensed.inner, None, |attrs| {
        class_tokens(attrs).iter().any(|token| FillerKind::from_condensed_class(token).is_some())
    });
    for block in blocks {
        let Some(kind) = class_tokens(block.attrs).iter().find_map(|token| FillerKind::from_condensed_class(token)) else {
            continue;
        };
        let Some(episodes) = find_first(block.inner, None, |attrs| has_class(attrs, "Episodes")) else { continue };
        for episode in parse_episode_ranges(&text_of(episodes.inner)) {
            insert_kind(&mut map, episode, kind);
        }
    }
    map
}

/// The full `table.EpisodeList`: one row per episode with `td.Number` and
/// `td.Type`. Header cells (`th`) are ignored.
pub fn parse_episode_table(html: &str) -> BTreeMap<i64, FillerKind> {
    let mut map = BTreeMap::new();
    for table in find_elements(html, Some("table"), |attrs| has_class(attrs, "EpisodeList")) {
        for row in find_elements(table.inner, Some("tr"), |_| true) {
            let cell = |class: &str| {
                find_first(row.inner, Some("td"), |attrs| has_class(attrs, class)).map(|c| text_of(c.inner))
            };
            let number = cell("Number").and_then(|text| parse_number(text.trim()));
            let kind = cell("Type").and_then(|text| FillerKind::from_label(&text));
            if let (Some(number), Some(kind)) = (number, kind) {
                if (1..=MAX_EPISODE).contains(&number) {
                    insert_kind(&mut map, number, kind);
                }
            }
        }
    }
    map
}

/// A show page → absolute episode number → category. `#Condensed` first,
/// the episode table when the summary is missing or empty. `None` when
/// neither yields a single episode (the page changed shape, or it is not a
/// show page at all).
pub fn parse_show_page(html: &str) -> Option<BTreeMap<i64, FillerKind>> {
    let condensed = parse_condensed(html);
    if !condensed.is_empty() {
        return Some(condensed);
    }
    let table = parse_episode_table(html);
    (!table.is_empty()).then_some(table)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONDENSED: &str = include_str!("../fixtures/animefillerlist/naruto_condensed.html");
    const TABLE: &str = include_str!("../fixtures/animefillerlist/bleach_table.html");
    const INDEX: &str = include_str!("../fixtures/animefillerlist/shows_index.html");

    fn of_kind(map: &BTreeMap<i64, FillerKind>, kind: FillerKind) -> Vec<i64> {
        map.iter().filter(|(_, k)| **k == kind).map(|(n, _)| *n).collect()
    }

    #[test]
    fn ranges_parse_with_commas_spaces_and_dashes() {
        assert_eq!(parse_episode_ranges("1-6, 8, 10-13"), vec![1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13]);
        assert_eq!(parse_episode_ranges(" 1 - 3 ,5,  7 -8 "), vec![1, 2, 3, 5, 7, 8]);
        assert_eq!(parse_episode_ranges("26, 97\u{2013}99"), vec![26, 97, 98, 99]);
        assert_eq!(parse_episode_ranges("4&ndash;6, 9"), vec![4, 5, 6, 9]);
        assert_eq!(parse_episode_ranges("12\u{2014}13; 2"), vec![2, 12, 13]);
    }

    #[test]
    fn ranges_ignore_garbage_inverted_and_huge_spans() {
        assert_eq!(parse_episode_ranges(""), Vec::<i64>::new());
        assert_eq!(parse_episode_ranges("abc, 5-3, 0, -2, 7"), vec![7]);
        assert_eq!(parse_episode_ranges("1-99999999"), Vec::<i64>::new());
        assert_eq!(parse_episode_ranges("3, 3, 2-4"), vec![2, 3, 4]);
    }

    #[test]
    fn entities_decode_named_and_numeric() {
        assert_eq!(decode_entities("Tom &amp; Jerry&#039;s &#x2013; &nbsp;x"), "Tom & Jerry's \u{2013}  x");
        assert_eq!(decode_entities("a & b &unknown; c"), "a & b &unknown; c");
    }

    #[test]
    fn condensed_block_parses_every_category() {
        let map = parse_condensed(CONDENSED);
        assert_eq!(of_kind(&map, FillerKind::Filler)[..4], [26, 97, 101, 102]);
        assert!(of_kind(&map, FillerKind::Filler).contains(&220));
        assert_eq!(of_kind(&map, FillerKind::Mixed), vec![7, 9, 14, 19, 45, 68, 71, 96, 100]);
        assert_eq!(of_kind(&map, FillerKind::AnimeCanon), vec![5, 13]);
        assert_eq!(map.get(&1), Some(&FillerKind::MangaCanon));
        assert_eq!(map.keys().last(), Some(&220));
        // Via parse_show_page too, which prefers the summary.
        assert_eq!(parse_show_page(CONDENSED).unwrap(), map);
    }

    #[test]
    fn episode_table_is_the_fallback() {
        assert!(parse_condensed(TABLE).is_empty());
        let map = parse_show_page(TABLE).unwrap();
        assert_eq!(map.len(), 8);
        assert_eq!(map.get(&1), Some(&FillerKind::MangaCanon));
        assert_eq!(map.get(&33), Some(&FillerKind::Filler));
        assert_eq!(map.get(&64), Some(&FillerKind::AnimeCanon));
        assert_eq!(map.get(&50), Some(&FillerKind::Mixed));
        assert_eq!(of_kind(&map, FillerKind::Filler), vec![33, 34, 366]);
    }

    #[test]
    fn index_links_become_slugs_and_titles() {
        let shows = parse_show_index(INDEX);
        let slugs: Vec<&str> = shows.iter().map(|s| s.slug.as_str()).collect();
        assert_eq!(
            slugs,
            vec!["attack-titan", "black-clover", "bleach", "boruto-naruto-next-generations", "detective-conan", "dragon-ball-z", "fairy-tail", "naruto", "naruto-shippuden", "one-piece"]
        );
        let conan = shows.iter().find(|s| s.slug == "detective-conan").unwrap();
        assert_eq!(conan.title, "Detective Conan");
        let boruto = shows.iter().find(|s| s.slug == "boruto-naruto-next-generations").unwrap();
        assert_eq!(boruto.title, "Boruto: Naruto Next Generations");
    }

    #[test]
    fn non_show_pages_and_garbage_parse_to_nothing() {
        assert_eq!(parse_show_page("<html><body><p>Not found</p></body></html>"), None);
        assert_eq!(parse_show_page("<div id=\"Condensed\"><div class=\"filler\"><span class=\"Episodes\">"), None);
        assert!(parse_show_index("<<<>>>").is_empty());
        assert!(parse_episode_table("<table class=\"EpisodeList\"><tr><td class=\"Number\">x</td></tr>").is_empty());
    }

    #[test]
    fn scanner_skips_scripts_comments_and_quoted_angle_brackets() {
        let html = r#"<script>var s = "<div id='Condensed'>";</script><!-- <div id="Condensed"> -->
            <div id="Condensed" data-x="a>b"><div class="filler"><span class="Episodes">3-4</span></div></div>"#;
        let map = parse_condensed(html);
        assert_eq!(map.keys().copied().collect::<Vec<_>>(), vec![3, 4]);
    }

    #[test]
    fn slugs_must_be_a_single_path_segment() {
        assert_eq!(slug_from_href("/shows/naruto"), Some("naruto".into()));
        assert_eq!(slug_from_href("https://www.animefillerlist.com/shows/one-piece/"), Some("one-piece".into()));
        assert_eq!(slug_from_href("/shows/naruto/episodes/1"), None);
        assert_eq!(slug_from_href("/shows"), None);
        assert_eq!(slug_from_href("/shows/Naruto"), None);
        assert_eq!(slug_from_href("https://example.com/shows/x"), None);
        assert_eq!(slug_from_href("/shows/sh%C5%8Dnan-pure-love-gang").as_deref(), Some("sh%C5%8Dnan-pure-love-gang"));
        assert_eq!(slug_from_href("/shows/bad%2"), None);
        assert_eq!(slug_from_href("/shows/a%zz"), None);
    }

    // Real markup (trimmed pages fetched from the live site), so a parser
    // that only matches the hand-written fixtures above can't slip through.
    const NARUTO_REAL: &str = include_str!("../fixtures/animefillerlist/naruto_real.html");
    const INDEX_REAL: &str = include_str!("../fixtures/animefillerlist/shows_index_real.html");

    #[test]
    fn parses_the_real_naruto_page() {
        let condensed = parse_condensed(NARUTO_REAL);
        assert_eq!(condensed.len(), 220);
        assert_eq!(condensed.get(&1), Some(&FillerKind::MangaCanon));
        assert_eq!(condensed.get(&7), Some(&FillerKind::Mixed));
        assert_eq!(condensed.get(&26), Some(&FillerKind::Filler));
        assert_eq!(condensed.get(&220), Some(&FillerKind::Mixed));
        let filler = of_kind(&condensed, FillerKind::Filler);
        assert_eq!(filler.len(), 1 + 1 + 6 + 5 + 77);
        assert!(filler.contains(&143) && filler.contains(&219) && !filler.contains(&141));

        // The table fallback agrees with the summary on every episode.
        let table = parse_episode_table(NARUTO_REAL);
        assert_eq!(table, condensed);
        assert_eq!(parse_show_page(NARUTO_REAL), Some(condensed));
    }

    #[test]
    fn parses_the_real_show_index() {
        let shows = parse_show_index(INDEX_REAL);
        let find = |slug: &str| shows.iter().find(|s| s.slug == slug).map(|s| s.title.as_str());
        assert_eq!(find("naruto"), Some("Naruto"));
        assert_eq!(find("naruto-shippuden"), Some("Naruto Shippuden"));
        assert!(shows.len() >= 8);
    }
}
