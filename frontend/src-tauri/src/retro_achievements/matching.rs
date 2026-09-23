//! Title matching against a console's RA game list. Mirrors the shape of
//! lib/local/folder-match.ts's `normalizeForMatch` (lowercase, strip
//! diacritics, non-alphanumerics to single spaces) plus what RA titles
//! need: `~Hack~`/`~Homebrew~` prefixes, region/dump tags in brackets, the
//! "Title, The" ordering and leading articles are all ignored.

use super::client::RaGameListEntry;

fn fold_char(c: char) -> Option<char> {
    let folded = match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => 'a',
        'è' | 'é' | 'ê' | 'ë' | 'ē' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' => 'i',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        'ß' => 's',
        'ý' | 'ÿ' => 'y',
        other => other,
    };
    if folded.is_ascii_alphanumeric() {
        Some(folded)
    } else {
        None
    }
}

/// Removes `~Tag~` prefixes and every `(...)` / `[...]` group.
fn strip_tags(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut depth_round = 0usize;
    let mut depth_square = 0usize;
    for c in title.chars() {
        match c {
            '(' => depth_round += 1,
            ')' => depth_round = depth_round.saturating_sub(1),
            '[' => depth_square += 1,
            ']' => depth_square = depth_square.saturating_sub(1),
            _ if depth_round == 0 && depth_square == 0 => out.push(c),
            _ => {}
        }
    }
    let mut rest = out.trim_start();
    while let Some(after) = rest.strip_prefix('~') {
        match after.find('~') {
            Some(end) => rest = after[end + 1..].trim_start(),
            None => break,
        }
    }
    rest.to_string()
}

const ARTICLES: &[&str] = &["the", "a", "an"];

/// Word list a title reduces to for comparison.
pub fn normalize_title(title: &str) -> Vec<String> {
    let stripped = strip_tags(title);
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();
    for c in stripped.to_lowercase().chars() {
        match fold_char(c) {
            Some(f) => current.push(f),
            None => {
                if !current.is_empty() {
                    words.push(std::mem::take(&mut current));
                }
            }
        }
    }
    if !current.is_empty() {
        words.push(current);
    }
    words.retain(|w| !ARTICLES.contains(&w.as_str()));
    words
}

pub fn normalized_key(title: &str) -> String {
    normalize_title(title).join(" ")
}

fn is_tagged(entry: &RaGameListEntry) -> bool {
    entry.title.trim_start().starts_with('~')
}

/// The entry whose title matches `title`, preferring untagged (non-hack)
/// sets. Exact normalised equality first; then, when exactly one candidate
/// remains, equality after dropping a `: subtitle` from either side.
pub fn best_match<'a>(title: &str, list: &'a [RaGameListEntry]) -> Option<&'a RaGameListEntry> {
    let wanted = normalized_key(title);
    if wanted.is_empty() {
        return None;
    }
    let exact: Vec<&RaGameListEntry> = list.iter().filter(|g| normalized_key(&g.title) == wanted).collect();
    if let Some(found) = exact.iter().find(|g| !is_tagged(g)).or(exact.first()) {
        return Some(found);
    }
    let wanted_main = normalized_key(main_title(title));
    let loose: Vec<&RaGameListEntry> = list
        .iter()
        .filter(|g| !is_tagged(g))
        .filter(|g| {
            let key = normalized_key(&g.title);
            key == wanted_main || normalized_key(main_title(&g.title)) == wanted
        })
        .collect();
    if loose.len() == 1 {
        return Some(loose[0]);
    }
    None
}

fn main_title(title: &str) -> &str {
    let stripped = title.trim();
    match stripped.find(':') {
        Some(idx) => stripped[..idx].trim_end(),
        None => stripped,
    }
}

/// Case/diacritic-insensitive substring search for the manual picker.
pub fn search<'a>(query: &str, list: &'a [RaGameListEntry], limit: usize) -> Vec<&'a RaGameListEntry> {
    let needle = normalized_key(query);
    if needle.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<(&RaGameListEntry, usize)> = list
        .iter()
        .filter_map(|g| {
            let key = normalized_key(&g.title);
            key.find(&needle).map(|pos| (g, pos + usize::from(is_tagged(g)) * 1000))
        })
        .collect();
    hits.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.title.cmp(&b.0.title)));
    hits.into_iter().take(limit).map(|(g, _)| g).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u32, title: &str) -> RaGameListEntry {
        RaGameListEntry {
            id,
            title: title.to_string(),
            console_id: 18,
            icon_url: None,
            num_achievements: 1,
            points: 1,
            hashes: vec![],
        }
    }

    #[test]
    fn normalisation_drops_tags_brackets_articles_and_diacritics() {
        assert_eq!(normalized_key("The Legend of Zelda: Ocarina of Time (USA) [!]"), "legend of zelda ocarina of time");
        assert_eq!(normalized_key("Legend of Zelda, The: Ocarina of Time"), "legend of zelda ocarina of time");
        assert_eq!(normalized_key("~Hack~ Pokémon Émeraude"), "pokemon emeraude");
        assert_eq!(normalized_key("Ōkami"), "okami");
        assert_eq!(normalized_key("   "), "");
    }

    #[test]
    fn exact_match_prefers_the_untagged_set() {
        let list = vec![entry(1, "~Hack~ Metadea Test Quest"), entry(2, "Metadea Test Quest"), entry(3, "Other")];
        assert_eq!(best_match("metadea test quest (Europe)", &list).map(|g| g.id), Some(2));
        let hacks_only = vec![entry(1, "~Hack~ Metadea Test Quest")];
        assert_eq!(best_match("Metadea Test Quest", &hacks_only).map(|g| g.id), Some(1));
    }

    #[test]
    fn a_unique_subtitle_less_match_is_accepted_but_an_ambiguous_one_is_not() {
        let list = vec![entry(1, "Legend of Cubes, The: Adventure"), entry(2, "Cube Racer")];
        assert_eq!(best_match("The Legend of Cubes", &list).map(|g| g.id), Some(1));
        let ambiguous = vec![entry(1, "Legend of Cubes, The: Adventure"), entry(2, "Legend of Cubes, The: Return")];
        assert_eq!(best_match("The Legend of Cubes", &ambiguous), None);
        assert_eq!(best_match("Nothing Here", &list), None);
    }

    #[test]
    fn search_is_substring_based_and_ranks_untagged_first() {
        let list = vec![entry(1, "~Hack~ Cube Quest"), entry(2, "Cube Quest"), entry(3, "Super Cube Quest II"), entry(4, "Unrelated")];
        let ids: Vec<u32> = search("cube quest", &list, 10).into_iter().map(|g| g.id).collect();
        assert_eq!(ids, vec![2, 3, 1]);
        assert!(search("", &list, 10).is_empty());
        assert_eq!(search("cube", &list, 1).len(), 1);
    }
}
