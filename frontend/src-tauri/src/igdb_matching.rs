// Resolves a Steam app_id to an IGDB entry: Steam-ID lookup -> normalized
// name -> fuzzy similarity (see resolve_igdb_game). Split out of igdb.rs.
use chrono::Datelike;

use crate::igdb::{
    extract_cover_and_game, igdb_query, is_non_game, EDITION_KEYWORDS, IGDB_API_EXTERNAL_GAMES,
    IGDB_API_GAMES, IGDB_GAME_FIELDS,
};

type IgdbGameMatch = (String, Option<u64>, serde_json::Value);

fn normalize_name(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{2122}' | '\u{00AE}' | '\u{00A9}' => ' ', // ™ ® ©
            ':' | ';' | '_' | '-' | '\'' | '\u{2019}' | '"' | '+' | '.' => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

// Get release date timestamp, or i64::MIN if missing (sorts oldest first)
fn get_release_timestamp(game: &serde_json::Value) -> i64 {
    game["first_release_date"].as_i64().unwrap_or(i64::MIN)
}

fn score_candidate(query_norm: &str, candidate_raw: &str) -> f64 {
    let q = query_norm;
    let c = {
        let tmp = candidate_raw
            .chars()
            .map(|ch| match ch {
                '\u{2122}' | '\u{00AE}' | '\u{00A9}' => ' ',
                ':' | '_' | '-' | '\'' | '\u{2019}' => ' ',
                ch => ch,
            })
            .collect::<String>();
        tmp.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };

    let q_tokens: Vec<&str> = q.split_whitespace().collect();
    if q_tokens.is_empty() {
        return 0.0;
    }

    let matched = q_tokens.iter().filter(|t| c.contains(**t)).count();
    let mut score = matched as f64 / q_tokens.len() as f64;

    let edition_penalty: f64 = EDITION_KEYWORDS
        .iter()
        .filter(|&&w| c.contains(w) && !q.contains(w))
        .count() as f64
        * 0.25;
    score -= edition_penalty;

    let len_ratio = q.len() as f64 / c.len().max(1) as f64;
    score += (1.0 - (len_ratio - 1.0).abs().min(1.0)) * 0.1;

    score
}

// Release year from Steam's store API; None on error or unparseable date.
async fn steam_release_year(client: &reqwest::Client, app_id: &str) -> Option<i32> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&filters=basic",
        app_id
    );
    let resp = client.get(&url).send().await.ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    let date_str = json[app_id]["data"]["release_date"]["date"].as_str()?;

    // Formats: "17 Mar, 2017", "2002", "Q4 2023", "Mar 2002" — take the 4-digit token.
    let year = date_str
        .split_whitespace()
        .filter_map(|token| {
            let t = token.trim_matches(',');
            if t.len() == 4 {
                t.parse::<i32>().ok()
            } else {
                None
            }
        })
        .find(|&y| y > 1990 && y < 2100);

    eprintln!(
        "[IGDB] Steam release year for app_id={}: {:?} (raw: {:?})",
        app_id, year, date_str
    );
    year
}

// Pick the IGDB candidate whose release year is closest to the Steam release year
fn pick_by_year<'a>(
    candidates: &[&'a serde_json::Value],
    steam_year: i32,
) -> Option<&'a serde_json::Value> {
    candidates
        .iter()
        .min_by_key(|g| {
            let igdb_year = chrono::DateTime::from_timestamp(get_release_timestamp(g), 0)
                .map(|dt| dt.year())
                .unwrap_or(0);
            (igdb_year - steam_year).abs()
        })
        .copied()
}

// Stage 1: Steam's own external-game link (category=1 = Steam in IGDB) — an
// explicit id mapping, most reliable when it hits.
async fn try_steam_id_match(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    app_id: &str,
) -> Option<IgdbGameMatch> {
    let ext = igdb_query(
        client,
        client_id,
        token,
        IGDB_API_EXTERNAL_GAMES,
        &format!("fields game; where uid = \"{app_id}\" & category = 1; limit 1;"),
    )
    .await
    .ok()?;

    let igdb_id = ext.as_array().and_then(|a| a.first()).and_then(|r| r["game"].as_u64());
    let Some(igdb_id) = igdb_id else {
        eprintln!("[IGDB] Steam ID miss for app_id={}", app_id);
        return None;
    };
    eprintln!("[IGDB] Steam ID hit: igdb_id={}", igdb_id);

    let games = igdb_query(
        client,
        client_id,
        token,
        IGDB_API_GAMES,
        &format!("fields {IGDB_GAME_FIELDS}; where id = {} & cover != null; limit 1;", igdb_id),
    )
    .await
    .ok()?;

    let entry = games
        .as_array()
        .and_then(|a| a.iter().find(|g| !is_non_game(g)))
        .unwrap_or(&serde_json::json!(null));
    let (cover_id, game_id, igdb_game) = extract_cover_and_game(entry);
    let id = cover_id?;
    eprintln!("[IGDB] Steam ID resolved cover={}", id);
    Some((id, game_id, igdb_game))
}

// Stage 2: an exact normalized-name match among fuzzy results beats raw
// search relevance; Steam's release year breaks ties between duplicates.
fn try_normalized_match(arr: &[serde_json::Value], name_norm: &str, steam_year: Option<i32>) -> Option<IgdbGameMatch> {
    let norm_matches: Vec<_> = arr
        .iter()
        .filter(|r| !is_non_game(r))
        .filter(|r| r["name"].as_str().map(|n| normalize_name(n) == name_norm).unwrap_or(false))
        .collect();

    if norm_matches.is_empty() {
        return None;
    }
    let game = if norm_matches.len() == 1 {
        norm_matches[0]
    } else if let Some(year) = steam_year {
        pick_by_year(&norm_matches, year).unwrap_or(norm_matches[0])
    } else {
        norm_matches[0]
    };

    let (cover_id, igdb_game_id, igdb_game) = extract_cover_and_game(game);
    eprintln!("[IGDB] Normalized match: {:?} date={}", game["name"].as_str(), get_release_timestamp(game));
    let id = cover_id?;
    Some((id, igdb_game_id, igdb_game))
}

// Stage 3, last resort: fuzzy string similarity, with a Steam-year bonus,
// only accepted above a minimum confidence threshold.
fn try_similarity_match(arr: &[serde_json::Value], name_norm: &str, steam_year: Option<i32>) -> Option<IgdbGameMatch> {
    let best = arr
        .iter()
        .filter_map(|r| {
            let n = r["name"].as_str()?;
            let mut score = score_candidate(name_norm, n);
            if let Some(year) = steam_year {
                let igdb_year = chrono::DateTime::from_timestamp(get_release_timestamp(r), 0)
                    .map(|dt| dt.year())
                    .unwrap_or(0);
                let diff = (igdb_year - year).abs();
                if diff == 0 {
                    score += 0.3;
                } else if diff <= 1 {
                    score += 0.1;
                }
            }
            eprintln!("[IGDB]   candidate {:?} score={:.2} date={}", n, score, get_release_timestamp(r));
            if score > 0.5 { Some((score, r)) } else { None }
        })
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))?;

    let (score, game) = best;
    let (cover_id, igdb_game_id, igdb_game) = extract_cover_and_game(game);
    eprintln!("[IGDB] Score match: {:?} score={:.2}", game["name"].as_str(), score);
    let id = cover_id?;
    Some((id, igdb_game_id, igdb_game))
}

pub(crate) async fn resolve_igdb_game(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    app_id: &str,
    game_name: &str,
) -> Result<IgdbGameMatch, String> {
    // "NieR:Automata™" → "NieR Automata", "STEINS;GATE" → "STEINS GATE"
    let search_query = game_name
        .chars()
        .map(|c| match c {
            '\u{2122}' | '\u{00AE}' | '\u{00A9}' => ' ', // ™ ® ©
            ':' | ';' | '_' | '\'' | '\u{2019}' | '"' => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let name_norm = normalize_name(game_name);
    let steam_year = steam_release_year(client, app_id).await;

    eprintln!(
        "[IGDB] Resolving: {:?} (app_id={}, year={:?}, norm={:?})",
        game_name, app_id, steam_year, name_norm
    );

    if let Some(m) = try_steam_id_match(client, client_id, token, app_id).await {
        return Ok(m);
    }

    // Fallback: fuzzy search with cleaned query
    let fuzzy = igdb_query(
        client,
        client_id,
        token,
        IGDB_API_GAMES,
        &format!(
            "fields {IGDB_GAME_FIELDS}; search \"{search_query}\"; where cover != null; limit 10;"
        ),
    )
    .await?;

    if let Some(arr) = fuzzy.as_array() {
        eprintln!(
            "[IGDB] Fuzzy results: {:?}",
            arr.iter().filter_map(|r| r["name"].as_str()).collect::<Vec<_>>()
        );

        if let Some(m) = try_normalized_match(arr, &name_norm, steam_year) {
            return Ok(m);
        }
        if let Some(m) = try_similarity_match(arr, &name_norm, steam_year) {
            return Ok(m);
        }
    }

    eprintln!("[IGDB] No match found for {:?}", game_name);
    Err(format!("No match found for {:?}", game_name))
}
