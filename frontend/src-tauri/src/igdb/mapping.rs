// Judgments over raw IGDB game JSON: category allowlists, edition-word
// detection, visual-novel detection and storefront link extraction.

pub(super) fn get_game_category(game: &serde_json::Value) -> u64 {
    game["category"]
        .as_u64()
        .or_else(|| game["game_type"].as_u64())
        .unwrap_or(0)
}

/// Whole-word match only — "Definitive Edition" is excluded, "Expedition 33"
/// is not (a substring `contains("edition")` check would wrongly catch it).
/// Category/game_type alone isn't reliable for catching these — IGDB very
/// often tags a remaster/expanded-edition/DLC entry as plain category=0
/// main_game with nothing in game_type either, so it'd otherwise slip past
/// the category-based EXCLUDED/allowlist checks in igdb_search entirely.
const NON_GAME_NAME_WORDS: &[&str] = &["edition", "remaster", "remastered", "dlc"];
pub(super) fn name_has_edition_word(name: &str) -> bool {
    name.split(|c: char| !c.is_alphanumeric())
        .any(|tok| NON_GAME_NAME_WORDS.iter().any(|w| tok.eq_ignore_ascii_case(w)))
}

pub(crate) fn is_non_game(game: &serde_json::Value) -> bool {
    // 0: main_game, 2: expansion, 3: bundle, 4: standalone, 7: season, 8: remake, 9: remaster, 10: expanded, 11: port, 13: pack, 14: update
    const ALLOWED: &[u64] = &[0, 2, 3, 4, 7, 8, 9, 10, 11, 13, 14];
    let category = get_game_category(game);
    !ALLOWED.contains(&category)
}

pub(crate) fn extract_cover_and_game(
    game: &serde_json::Value,
) -> (Option<String>, Option<u64>, serde_json::Value) {
    let cover = game["cover"]["image_id"].as_str().map(String::from);
    let game_id = game["id"].as_u64();
    (cover, game_id, game.clone())
}

// Derives {platform, url} store links from a raw IGDB external_games array,
// matching known storefront domains and dropping everything else.
pub(super) fn build_store_links(external_games: &serde_json::Value) -> Option<Vec<serde_json::Value>> {
    let arr = external_games.as_array()?;
    let links: Vec<serde_json::Value> = arr
        .iter()
        .filter_map(|e| {
            let url = e["url"].as_str().filter(|u| !u.is_empty())?;
            let platform = if url.contains("store.steampowered.com") {
                "steam"
            } else if url.contains("gog.com") {
                "gog"
            } else if url.contains("epicgames.com") {
                "epic"
            } else if url.contains("xbox.com") || url.contains("microsoft.com/store") {
                "xbox"
            } else if url.contains("playstation.com") {
                "playstation"
            // No Nintendo case here: IGDB's ExternalGameCategory enum has no
            // Nintendo eShop entry at all (steam/gog/microsoft/apple/
            // android/amazon/epic/oculus/itch/xbox/playstation/gamejolt/...
            // — verified against the community-maintained type defs,
            // https://api-docs.igdb.com/#external-game-enums), so
            // external_games never returns a Nintendo storefront url
            // regardless of how this match is written. See
            // MediaPage/GameDetailPanel's own Nintendo fallback (a
            // constructed eShop search link) for what actually shows the
            // "Ver en Nintendo" action instead.
            } else {
                return None;
            };
            Some(serde_json::json!({ "platform": platform, "url": url }))
        })
        .collect();
    if links.is_empty() { None } else { Some(links) }
}

// VN filter: genre 34 in top-3, not RPG (12) or Fighting (4), with parent inheritance
pub(super) fn detect_vn(game: &serde_json::Value) -> bool {
    let genres = game["genres"].as_array().cloned().unwrap_or_default();
    let top3: Vec<u64> = genres
        .iter()
        .take(3)
        .filter_map(|g| g["id"].as_u64())
        .collect();
    let all_ids: Vec<u64> = genres.iter().filter_map(|g| g["id"].as_u64()).collect();

    let has_vn = top3.contains(&34) && !all_ids.contains(&12) && !all_ids.contains(&4);
    if has_vn {
        return true;
    }

    for parent_key in &["version_parent", "parent_game"] {
        let parent = &game[parent_key];
        if parent.is_null() {
            continue;
        }
        let pg = parent["genres"].as_array().cloned().unwrap_or_default();
        let pt3: Vec<u64> = pg.iter().take(3).filter_map(|g| g["id"].as_u64()).collect();
        let pa: Vec<u64> = pg.iter().filter_map(|g| g["id"].as_u64()).collect();
        if pt3.contains(&34) && !pa.contains(&12) && !pa.contains(&4) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod name_has_edition_word_tests {
    use super::name_has_edition_word;

    #[test]
    fn matches_edition_as_a_whole_word() {
        assert!(name_has_edition_word("Skyrim Definitive Edition"));
        assert!(name_has_edition_word("Game of the Year Edition"));
        assert!(name_has_edition_word("EDITION"));
    }

    #[test]
    fn expedition_33_is_not_an_edition() {
        assert!(!name_has_edition_word("Clair Obscur: Expedition 33"));
        assert!(!name_has_edition_word("Expedition 33"));
    }

    #[test]
    fn matches_remaster_variants_and_dlc_case_insensitively() {
        assert!(name_has_edition_word("Dark Souls Remastered"));
        assert!(name_has_edition_word("Shadow of the Colossus remaster"));
        assert!(name_has_edition_word("Some Game - DLC"));
        assert!(name_has_edition_word("some game dlc"));
    }

    #[test]
    fn splits_on_any_non_alphanumeric_character() {
        assert!(name_has_edition_word("Game (Remastered)"));
        assert!(name_has_edition_word("Game/DLC"));
        assert!(name_has_edition_word("Game: Edition"));
    }

    #[test]
    fn does_not_match_partial_or_pluralised_tokens() {
        assert!(!name_has_edition_word("Editions"));
        assert!(!name_has_edition_word("edition2"));
        assert!(!name_has_edition_word("Re-master"));
        assert!(!name_has_edition_word("Remasters"));
    }

    #[test]
    fn other_edition_keywords_are_not_covered_by_this_check() {
        assert!(!name_has_edition_word("Game Deluxe"));
        assert!(!name_has_edition_word("Game GOTY"));
        assert!(!name_has_edition_word("Game Ultimate Bundle"));
    }

    #[test]
    fn ordinary_titles_are_not_flagged() {
        assert!(!name_has_edition_word("The Last of Us"));
        assert!(!name_has_edition_word(""));
    }

    #[test]
    fn non_ascii_lookalikes_do_not_match() {
        assert!(!name_has_edition_word("Jeu Édition"));
    }
}
