// Name → Sakugabooru tag candidates, and the choice among confirmed tags.
//
// Nothing here guesses: candidates are only ever *looked up*. A tag is used
// when `tag.json` lists it with a candidate's exact name (artists: type 1,
// series: type 3), or, for artists with no exact hit, with a name that
// differs from a candidate only in how long vowels are written. Tag names are lowercase with `_` between words
// (`yutaka_nakamura`, `sousou_no_frieren_series`).
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SakugaTag {
    pub name: String,
    pub count: i64,
}

/// How a long vowel written with a macron (ō) or circumflex (ô) is spelled.
#[derive(Clone, Copy)]
enum LongVowel {
    /// ō → o (Hepburn without macrons: "Ohira")
    Single,
    /// ō → ou, ū → uu (wāpuro: "Yuusuke", "Sousou")
    Doubled,
    /// ō → oo ("Oohira")
    Repeated,
}

fn long_vowel(c: char, style: LongVowel) -> Option<&'static str> {
    let base = match c {
        'ā' | 'â' | 'Ā' | 'Â' => 'a',
        'ē' | 'ê' | 'Ē' | 'Ê' => 'e',
        'ī' | 'î' | 'Ī' | 'Î' => 'i',
        'ō' | 'ô' | 'Ō' | 'Ô' => 'o',
        'ū' | 'û' | 'Ū' | 'Û' => 'u',
        _ => return None,
    };
    Some(match (style, base) {
        (LongVowel::Single, 'a') => "a",
        (LongVowel::Single, 'e') => "e",
        (LongVowel::Single, 'i') => "i",
        (LongVowel::Single, 'o') => "o",
        (LongVowel::Single, _) => "u",
        (LongVowel::Doubled, 'a') => "aa",
        (LongVowel::Doubled, 'e') => "ei",
        (LongVowel::Doubled, 'i') => "ii",
        (LongVowel::Doubled, 'o') => "ou",
        (LongVowel::Doubled, _) => "uu",
        (LongVowel::Repeated, 'a') => "aa",
        (LongVowel::Repeated, 'e') => "ee",
        (LongVowel::Repeated, 'i') => "ii",
        (LongVowel::Repeated, 'o') => "oo",
        (LongVowel::Repeated, _) => "uu",
    })
}

fn has_long_vowel(text: &str) -> bool {
    text.chars().any(|c| long_vowel(c, LongVowel::Single).is_some())
}

/// Other Latin accents folded to ASCII (é → e); anything else that isn't a
/// letter or digit becomes a word break, apostrophes vanish ("Journey's" →
/// "journeys").
fn fold_char(c: char) -> Option<char> {
    let folded = match c {
        'á' | 'à' | 'ä' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ë' => 'e',
        'í' | 'ì' | 'ï' => 'i',
        'ó' | 'ò' | 'ö' | 'õ' | 'ø' => 'o',
        'ú' | 'ù' | 'ü' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        _ => c,
    };
    folded.is_ascii_alphanumeric().then_some(folded)
}

/// One spelling of `text` in tag form: lowercase ASCII words joined by `_`.
fn to_tag_form(text: &str, style: LongVowel) -> String {
    let mut out = String::new();
    let mut pending_break = false;
    for c in text.chars().flat_map(char::to_lowercase) {
        if c == '\'' || c == '’' {
            continue;
        }
        let piece: Option<String> = long_vowel(c, style)
            .map(str::to_string)
            .or_else(|| fold_char(c).map(|f| f.to_string()));
        match piece {
            Some(piece) => {
                if pending_break && !out.is_empty() {
                    out.push('_');
                }
                pending_break = false;
                out.push_str(&piece);
            }
            None => pending_break = true,
        }
    }
    out
}

/// Every spelling of `text` worth looking up, most likely first: macrons
/// dropped, then written as ou/uu, then as oo. Plain ASCII text has one.
pub(crate) fn spellings(text: &str) -> Vec<String> {
    let styles: &[LongVowel] = if has_long_vowel(text) {
        &[LongVowel::Single, LongVowel::Doubled, LongVowel::Repeated]
    } else {
        &[LongVowel::Single]
    };
    let mut out: Vec<String> = Vec::new();
    for style in styles {
        let form = to_tag_form(text, *style);
        if !form.is_empty() && !out.contains(&form) {
            out.push(form);
        }
    }
    out
}

/// Tag candidates for a person: every spelling, in the given order
/// ("Yutaka Nakamura" → `yutaka_nakamura`) and with family/given swapped
/// (`nakamura_yutaka`).
pub(crate) fn artist_candidates(name: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for spelling in spellings(name) {
        let words: Vec<&str> = spelling.split('_').collect();
        let mut forms = vec![spelling.clone()];
        if words.len() >= 2 {
            let mut swapped = words.clone();
            swapped.rotate_right(1);
            forms.push(swapped.join("_"));
            if words.len() > 2 {
                let mut reversed = words.clone();
                reversed.reverse();
                forms.push(reversed.join("_"));
            }
        }
        for form in forms {
            if !out.contains(&form) {
                out.push(form);
            }
        }
    }
    out
}

/// The `tag.json?name=` lookups for `name`, to be tried in order until one
/// confirms a tag: Moebooru matches `name` as a substring, so a query on one
/// word finds the full name in either order. Longest word first (the most
/// selective), each in all its spellings; the next word only matters when
/// the first is itself spelled differently on the site (Kota → kouta).
pub(crate) fn artist_lookup_terms(name: &str) -> Vec<String> {
    let mut words: Vec<&str> = name
        .split(|c: char| c.is_whitespace() || c == '-' || c == '.')
        .filter(|word| !word.is_empty())
        .collect();
    // Stable sort: equally long words keep their order, last name wins ties
    // after the reverse.
    words.reverse();
    words.sort_by_key(|word| std::cmp::Reverse(word.chars().count()));
    let mut out: Vec<String> = Vec::new();
    for word in words {
        for term in spellings(word) {
            if term.len() >= 2 && !out.contains(&term) {
                out.push(term);
            }
        }
    }
    out
}

/// Long vowels collapsed (ou/oo → o, uu → u, aa → a, ii → i), for matching
/// romanizations that differ only in how they write them ("Koki" /
/// "Kouki"). Applied to both sides, never used to build a request.
fn loose_form(tag: &str) -> String {
    let mut out = tag.to_string();
    for (long, short) in [("ou", "o"), ("oo", "o"), ("uu", "u"), ("aa", "a"), ("ii", "i")] {
        while out.contains(long) {
            out = out.replace(long, short);
        }
    }
    out
}

/// Among the listed artist tags, one whose name is exactly a candidate (the
/// most used when several are); failing that, one that differs from a
/// candidate only in long-vowel spelling. Tags with no posts don't count.
pub(crate) fn choose_artist_tag(candidates: &[String], listed: &[SakugaTag]) -> Option<SakugaTag> {
    let usable = || listed.iter().filter(|tag| tag.count > 0);
    let exact = usable().filter(|tag| candidates.iter().any(|c| c == &tag.name)).max_by_key(|tag| tag.count);
    if let Some(tag) = exact {
        return Some(tag.clone());
    }
    let loose: Vec<String> = candidates.iter().map(|c| loose_form(c)).collect();
    usable()
        .filter(|tag| loose.contains(&loose_form(&tag.name)))
        .max_by_key(|tag| tag.count)
        .cloned()
}

/// Lookup bases for a work: each title's spellings, in the order given
/// (the caller puts romaji first, then English, each with and without its
/// season suffix).
pub(crate) fn series_bases(titles: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for title in titles {
        for spelling in spellings(title) {
            if spelling.len() >= 2 && !out.contains(&spelling) {
                out.push(spelling);
            }
        }
    }
    out
}

/// The series tag for `base` among the listed copyright tags: the
/// all-seasons `<base>_series` when it exists, else `<base>` itself, else a
/// season-specific `<base>_…` (the most used).
pub(crate) fn choose_series_tag(base: &str, listed: &[SakugaTag]) -> Option<SakugaTag> {
    let usable = |tag: &&SakugaTag| tag.count > 0;
    let series_name = format!("{base}_series");
    if let Some(tag) = listed.iter().filter(usable).find(|tag| tag.name == series_name) {
        return Some(tag.clone());
    }
    if let Some(tag) = listed.iter().filter(usable).find(|tag| tag.name == base) {
        return Some(tag.clone());
    }
    let prefix = format!("{base}_");
    listed
        .iter()
        .filter(usable)
        .filter(|tag| tag.name.starts_with(&prefix))
        .max_by_key(|tag| tag.count)
        .cloned()
}

/// A tag name as the frontend may send it back: no whitespace, no control
/// characters, not a metatag we add ourselves, sensibly short.
pub(crate) fn is_valid_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 120
        && !tag.chars().any(|c| c.is_whitespace() || c.is_control())
        && !tag.starts_with("order:")
        && !tag.starts_with("rating:")
        && !tag.starts_with('-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(name: &str, count: i64) -> SakugaTag {
        SakugaTag { name: name.into(), count }
    }

    #[test]
    fn candidates_cover_both_name_orders() {
        assert_eq!(artist_candidates("Yutaka Nakamura"), vec!["yutaka_nakamura", "nakamura_yutaka"]);
        assert_eq!(artist_candidates("Sushio"), vec!["sushio"]);
    }

    #[test]
    fn macrons_are_stripped_and_spelled_out() {
        assert_eq!(
            artist_candidates("Shinya Ōhira"),
            vec!["shinya_ohira", "ohira_shinya", "shinya_ouhira", "ouhira_shinya", "shinya_oohira", "oohira_shinya"]
        );
        assert_eq!(spellings("Yūsuke Matsuo"), vec!["yusuke_matsuo", "yuusuke_matsuo"]);
        assert_eq!(spellings("Sōsō no Frieren"), vec!["soso_no_frieren", "sousou_no_frieren", "soosoo_no_frieren"]);
    }

    #[test]
    fn punctuation_and_accents_fold_into_tag_form() {
        assert_eq!(spellings("Frieren: Beyond Journey's End"), vec!["frieren_beyond_journeys_end"]);
        assert_eq!(spellings("  Mob Psycho 100 "), vec!["mob_psycho_100"]);
        assert_eq!(spellings("Pokémon"), vec!["pokemon"]);
        assert!(spellings("葬送のフリーレン").is_empty());
    }

    #[test]
    fn lookup_terms_start_with_the_longest_word() {
        assert_eq!(artist_lookup_terms("Yutaka Nakamura"), vec!["nakamura", "yutaka"]);
        assert_eq!(artist_lookup_terms("Kōta Ito"), vec!["kota", "kouta", "koota", "ito"]);
        assert_eq!(artist_lookup_terms("Kota Mori"), vec!["mori", "kota"], "ties: family name (last) first");
        assert!(artist_lookup_terms("").is_empty());
    }

    #[test]
    fn long_vowel_spellings_match_only_when_nothing_matches_exactly() {
        let listed = vec![tag("kouki_fujimoto", 26), tag("fujimoto_tatsuki", 3)];
        assert_eq!(choose_artist_tag(&artist_candidates("Koki Fujimoto"), &listed).unwrap().name, "kouki_fujimoto");
        let both = vec![tag("yuki_hayashi", 4), tag("yuuki_hayashi", 102)];
        assert_eq!(choose_artist_tag(&artist_candidates("Yuki Hayashi"), &both).unwrap().name, "yuki_hayashi");
        assert_eq!(choose_artist_tag(&artist_candidates("Yuuki Hayashi"), &both).unwrap().name, "yuuki_hayashi");
        // A different given name is still no match.
        assert_eq!(choose_artist_tag(&artist_candidates("Kaoru Fujimoto"), &listed), None);
    }

    #[test]
    fn only_an_exact_candidate_is_accepted_and_the_most_used_wins() {
        let listed = vec![tag("yutaka_nakamura_(2)", 900), tag("yutaka_nakamura", 368), tag("nakamura_yutaka", 2), tag("hayate_nakamura", 120)];
        let chosen = choose_artist_tag(&artist_candidates("Yutaka Nakamura"), &listed).unwrap();
        assert_eq!(chosen, tag("yutaka_nakamura", 368));
        // Substring hits never count.
        assert_eq!(choose_artist_tag(&artist_candidates("Aki Nakamura"), &listed), None);
        // A tag with no posts is not a match.
        assert_eq!(choose_artist_tag(&["ghost".into()], &[tag("ghost", 0)]), None);
    }

    #[test]
    fn series_prefers_the_aggregate_then_exact_then_a_season() {
        let frieren = vec![tag("sousou_no_frieren", 597), tag("sousou_no_frieren_season_2", 145), tag("sousou_no_frieren_series", 641)];
        assert_eq!(choose_series_tag("sousou_no_frieren", &frieren).unwrap().name, "sousou_no_frieren_series");
        let exact_only = vec![tag("cowboy_bebop", 300), tag("cowboy_bebop_the_movie", 40)];
        assert_eq!(choose_series_tag("cowboy_bebop", &exact_only).unwrap().name, "cowboy_bebop");
        let seasons_only = vec![tag("foo_season_1", 10), tag("foo_season_2", 30), tag("foobar", 99)];
        assert_eq!(choose_series_tag("foo", &seasons_only).unwrap().name, "foo_season_2");
        assert_eq!(choose_series_tag("bar", &seasons_only), None);
    }

    #[test]
    fn series_bases_keep_title_order_and_dedupe() {
        let titles = vec!["Sousou no Frieren".to_string(), "Frieren: Beyond Journey's End".into(), "sousou no frieren".into()];
        assert_eq!(series_bases(&titles), vec!["sousou_no_frieren", "frieren_beyond_journeys_end"]);
    }

    #[test]
    fn tags_from_the_frontend_are_validated() {
        assert!(is_valid_tag("fullmetal_alchemist_(2003)"));
        assert!(is_valid_tag("re:zero_kara_hajimeru_isekai_seikatsu"));
        assert!(!is_valid_tag("a b"));
        assert!(!is_valid_tag("order:random"));
        assert!(!is_valid_tag("rating:e"));
        assert!(!is_valid_tag("-animated"));
        assert!(!is_valid_tag(""));
    }
}
