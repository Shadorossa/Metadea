// Search-style commands: catalog search, the unfiltered admin search, the
// release calendar and the manual-pick candidate list, plus the `where`
// clause helpers they share.

use chrono::Datelike;
use crate::igdb_env::load_env_config;
use super::auth::get_twitch_token;
use super::client::{igdb_query, EDITION_KEYWORDS, IGDB_API_GAMES, IGDB_IMAGE_COVER_BIG};
use super::mapping::{detect_vn, get_game_category, is_non_game, name_has_edition_word};

// Games releasing in [start_unix, end_unix] — single request, used by the
// Home calendar's "General" view. Uses a broader category allowlist than
// igdb_search's is_non_game (which is tuned for "is this the same game as
// my library entry" matching): a release calendar should also surface
// DLC/expansions, remasters, expanded editions and ports actually shipping
// that month, not just brand-new main games — those are real "this comes
// out this month" events players look for.
const CALENDAR_ALLOWED_CATEGORIES: &[u64] = &[0, 1, 2, 4, 8, 9, 10, 11, 14];
// main_game, dlc_addon, expansion, standalone_expansion, remake, remaster,
// expanded_game, port, update

// Number of equal date sub-ranges to split [start_unix, end_unix] into.
// Sorting the *whole* range by date ascending with one limit meant a busy
// first half of the month (indie/mobile titles releasing daily) could fill
// the entire cap before the query ever reached later dates — reported as
// "no games after the 14th". Each chunk gets its own request + its own
// slice of the limit. Same "split the range into N chunks" pattern as
// upcoming-general.ts's CHUNKS on the AniList side (not shared code — one's
// a GraphQL alias set, this is plain concurrent REST calls — but check that
// file too if this partitioning approach needs to change).
// igdb_query already retries on 429 with backoff, so firing this many
// concurrent requests is safe even if it briefly exceeds IGDB's ~4 req/s.
const IGDB_DATE_CHUNKS: i64 = 8;
const IGDB_CHUNK_LIMIT: u32 = 200; // 8 × 200 = 1600 games/month capacity

fn is_calendar_release(g: &serde_json::Value) -> bool {
    let category = get_game_category(g);
    if !CALENDAR_ALLOWED_CATEGORIES.contains(&category) {
        return false;
    }
    // Same edition-dedup rule as igdb_search: a main_game (0) with a
    // version_parent/version_title is itself a special edition of some
    // base entry, not a standalone release.
    category != 0 || (g["version_parent"].is_null() && g["version_title"].is_null())
}

#[tauri::command]
pub async fn igdb_upcoming_releases(
    app_handle: tauri::AppHandle,
    start_unix: i64,
    end_unix: i64,
) -> Result<serde_json::Value, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = crate::http::http_client();

    let span = (end_unix - start_unix).max(1);
    let chunk_size = span / IGDB_DATE_CHUNKS;
    let queries = (0..IGDB_DATE_CHUNKS).map(|i| {
        let chunk_start = start_unix + i * chunk_size;
        let chunk_end = if i == IGDB_DATE_CHUNKS - 1 { end_unix } else { chunk_start + chunk_size };
        let client_id = client_id.clone();
        let token = token.clone();
        async move {
            let body = format!(
                "fields id,name,cover.image_id,first_release_date,category,game_type,\
                 version_parent.id,version_title,hypes; \
                 where first_release_date >= {} & first_release_date <= {}; \
                 sort first_release_date asc; limit {};",
                chunk_start, chunk_end, IGDB_CHUNK_LIMIT
            );
            igdb_query(client, &client_id, &token, IGDB_API_GAMES, &body).await
        }
    });

    let chunk_results = futures::future::join_all(queries).await;
    let mut raw_games: Vec<serde_json::Value> = Vec::new();
    for chunk in chunk_results {
        if let Ok(serde_json::Value::Array(arr)) = chunk {
            raw_games.extend(arr);
        }
    }

    let games: Vec<serde_json::Value> = raw_games.into_iter().filter(is_calendar_release).collect();

    Ok(serde_json::Value::Array(games))
}

// Calendar-quarter (season) + year -> the half-open unix timestamp range
// IGDB's first_release_date (also unix) needs for a `where` clause. Season
// alone (no year) has no fixed year to anchor a range to, so returns None.
fn unix_range_from_filters(year: Option<i64>, season: Option<&str>) -> Option<(i64, i64)> {
    let year = year?;
    let (from_month, to_month): (u32, u32) = match season {
        Some("WINTER") => (1, 3),
        Some("SPRING") => (4, 6),
        Some("SUMMER") => (7, 9),
        Some("FALL") => (10, 12),
        _ => (1, 12),
    };
    let start = chrono::NaiveDate::from_ymd_opt(year as i32, from_month, 1)?
        .and_hms_opt(0, 0, 0)?.and_utc().timestamp();
    let (next_year, next_month) = if to_month == 12 { (year as i32 + 1, 1) } else { (year as i32, to_month + 1) };
    let end = chrono::NaiveDate::from_ymd_opt(next_year, next_month, 1)?
        .and_hms_opt(0, 0, 0)?.and_utc().timestamp();
    Some((start, end))
}

// IGDB's genre taxonomy is a small, stable, publicly documented set of ids
// (https://api-docs.igdb.com/#genre) that's barely changed in years — a
// dedicated request just to resolve names to ids for this filter would be
// wasted traffic for values this stable. Only names IGDB's own genres.name
// field can actually return are listed.
fn igdb_genre_id(name: &str) -> Option<u32> {
    match name {
        "Point-and-click" => Some(2),
        "Fighting" => Some(4),
        "Shooter" => Some(5),
        "Music" => Some(7),
        "Platform" => Some(8),
        "Puzzle" => Some(9),
        "Racing" => Some(10),
        "Real Time Strategy (RTS)" => Some(11),
        "Role-playing (RPG)" => Some(12),
        "Simulator" => Some(13),
        "Sport" => Some(14),
        "Strategy" => Some(15),
        "Turn-based strategy (TBS)" => Some(16),
        "Tactical" => Some(24),
        "Hack and slash/Beat 'em up" => Some(25),
        "Quiz/Trivia" => Some(26),
        "Pinball" => Some(30),
        "Adventure" => Some(31),
        "Indie" => Some(32),
        "Arcade" => Some(33),
        "Visual Novel" => Some(34),
        "Card & Board Game" => Some(35),
        "MOBA" => Some(36),
        _ => None,
    }
}

// Extra `where` clause fragments (each starting with `&`) for the optional
// year/season/genre filters — empty string when none apply.
fn build_filter_conditions(filter_year: Option<i64>, filter_season: Option<&str>, filter_genres: Option<&[String]>) -> String {
    let mut conditions = String::new();
    if let Some((start, end)) = unix_range_from_filters(filter_year, filter_season) {
        conditions.push_str(&format!(" & first_release_date >= {start} & first_release_date < {end}"));
    }
    if let Some(genres) = filter_genres {
        let ids: Vec<String> = genres.iter().filter_map(|g| igdb_genre_id(g)).map(|id| id.to_string()).collect();
        if !ids.is_empty() {
            conditions.push_str(&format!(" & genres = ({})", ids.join(",")));
        }
    }
    conditions
}

// Arity is dictated by the frontend `invoke("igdb_search", …)` contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn igdb_search(
    app_handle: tauri::AppHandle,
    query: String,
    is_visual_novel: bool,
    page: Option<u32>,
    // Restricts results to exactly these IGDB category/game_type values
    // instead of the normal main_game/standalone_expansion/season/remake
    // allowlist below — used by relation pickers (Bundled In: category 3
    // bundles; Contains: category 10 expanded editions) that need exactly
    // the categories plain search deliberately excludes. `None` keeps the
    // normal behavior.
    only_categories: Option<Vec<u64>>,
    // Real server-side narrowing (a fresh page matching these criteria),
    // not a client-side filter over whatever page was already fetched.
    filter_year: Option<i64>,
    filter_season: Option<String>,
    filter_genres: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = crate::http::http_client();
    let safe_query = query.replace('"', "");

    // One request per page — this used to loop fetching every page IGDB had
    // (100 at a time) before returning anything at all, which for a broad
    // query could be dozens of sequential requests and was the main reason
    // game search felt so much slower than every other provider. `page` is
    // our own 1-based, 100-results-per-page unit (matching the other
    // providers), independent of IGDB's own `limit`/`offset` query syntax.
    const PAGE_SIZE: usize = 100;
    // The category/edition-word/VN-vs-game filtering below rejects a real
    // chunk of whatever IGDB returns (bundles, remasters, sequels tagged as
    // their own main_game, non-matching genre, ...) — fetching exactly
    // PAGE_SIZE raw candidates and filtering those left far fewer than
    // PAGE_SIZE actually displayed (e.g. only ~50-55 games out of a 100-item
    // raw page). Fetches a wider raw batch per logical page instead, so
    // filtering has enough headroom to still land near PAGE_SIZE.
    const RAW_MULTIPLIER: usize = 3;
    let raw_limit = PAGE_SIZE * RAW_MULTIPLIER;
    let page = page.unwrap_or(1).max(1) as usize;
    let offset = (page - 1) * raw_limit;

    let mut filter_conditions = build_filter_conditions(filter_year, filter_season.as_deref(), filter_genres.as_deref());
    // Visual novels are such a small slice of IGDB's catalog that a plain
    // "top N by rating" (or even a broad text search) rarely turns up more
    // than a couple by chance — detect_vn's stricter check below still runs
    // either way, but without this, the 100-result fetch itself was mostly
    // non-VN games that detect_vn then had to reject, leaving almost
    // nothing to show. Narrows the fetch itself to genre-tagged candidates
    // first (genre 34 = Visual Novel), same id detect_vn already checks for.
    if is_visual_novel {
        filter_conditions.push_str(" & genres = (34)");
    }

    // An empty query still shows something (the top 100 by rating) instead
    // of a blank tab until you type — IGDB has no `search` term to rank by
    // relevance in that case, so this sorts by rating instead. `search`
    // and `sort` are mutually exclusive in APIcalypse (a sort alongside a
    // search term is ignored), hence the two separate query shapes — but
    // `search`/`sort` and `where` aren't, so filter_conditions applies to
    // both branches.
    let filter_clause = format!(
        "fields id,name,cover.image_id,rating,first_release_date,status,\
         genres.id,genres.name,category,game_type,\
         version_parent.id,version_parent.genres.id,\
         parent_game.id,parent_game.genres.id; {} limit {}; offset {};",
        if safe_query.is_empty() {
            // rating alone is IGDB's average of however many user ratings a
            // game happens to have — with no floor on that count, a title
            // with a single 100 rating outranks a genuinely popular game
            // sitting at 85 from thousands of ratings. rating_count >= 50
            // keeps "top rated" meaning "well-regarded by a real audience",
            // not "the few obscure titles that got lucky with 1-2 raters" —
            // but visual novels get nowhere near mainstream games' rating
            // volume even when well-known, so that same floor left barely
            // more than a dozen VNs passing it at all. 10 keeps the same
            // "not just 1-2 lucky raters" intent without gutting an already
            // niche genre's own candidate pool a second time.
            let min_rating_count = if is_visual_novel { 10 } else { 50 };
            format!("where cover != null & rating != null & rating_count >= {min_rating_count}{filter_conditions}; sort rating desc;")
        } else {
            format!("search \"{}\"; where cover != null{filter_conditions};", safe_query)
        },
        raw_limit, offset
    );

    let raw = igdb_query(client, &client_id, &token, IGDB_API_GAMES, &filter_clause).await?;

    let items = raw.as_array().cloned().unwrap_or_default();
    // A full raw batch doesn't guarantee there's a next one (the last batch
    // can happen to be exactly raw_limit long), but it's the only signal
    // available without a second request — worst case, one "Load more"
    // click comes back empty and the UI just stops offering it.
    let raw_batch_was_full = items.len() == raw_limit;
    // signal available without a second request — worst case, one "Load
    // more" click comes back empty and the UI just stops offering it.

    let mut games: Vec<serde_json::Value> = Vec::new();
    for item in items {
        // Cancelled status is 6 in IGDB API
        if item["status"].as_i64() == Some(6) {
            continue;
        }

        // Used only by relation pickers (Bundled In: category 3 bundles;
        // Contains: category 10 expanded editions), which need exactly the
        // categories plain search deliberately excludes below — every other
        // filter (edition-word names, version_parent dedup) doesn't apply
        // to these.
        if let Some(cats) = &only_categories {
            if !cats.contains(&get_game_category(&item)) {
                continue;
            }
            let vn = detect_vn(&item);
            if is_visual_novel == vn {
                games.push(item);
            }
            continue;
        }

        // Bundles (3), remasters (9), updates (14), and expanded editions
        // (10) never belong in plain search results (bundles aren't a
        // playable title on their own; remasters/updates/expanded editions
        // should only ever surface as a relation on the original game's
        // page, not as their own separate search hit) — checked against
        // both fields independently since get_game_category's
        // category-then-game_type fallback can mask one flagging it when
        // the other is simply absent from this particular record (e.g. an
        // expanded edition IGDB tagged category=main_game but game_type=10).
        const EXCLUDED: &[u64] = &[3, 9, 10, 14];
        if item["category"].as_u64().is_some_and(|c| EXCLUDED.contains(&c))
            || item["game_type"].as_u64().is_some_and(|c| EXCLUDED.contains(&c)) {
            continue;
        }

        // 0 main_game, 4 standalone_expansion, 7 season, 8 remake.
        let category = get_game_category(&item);
        if !matches!(category, 0 | 4 | 7 | 8) {
            continue;
        }

        // Si es main_game (0) y tiene parent o version_title, lo saltamos para evitar duplicados de fichas base
        if category == 0 && (!item["version_parent"].is_null() || !item["version_title"].is_null()) {
            continue;
        }

        // A main_game (0) whose own name is literally "... Edition" is
        // almost always a re-released bundle/version IGDB miscategorized as
        // its own main game rather than as a proper edition/remaster
        // relation — word-boundary checked so "Expedition 33" isn't caught.
        if category == 0 && name_has_edition_word(item["name"].as_str().unwrap_or("")) {
            continue;
        }

        let vn = detect_vn(&item);
        if is_visual_novel == vn {
            games.push(item);
        }
    }

    // More filtered games survived this widened raw batch than one logical
    // page needs, or the raw batch itself maxed out (more raw candidates
    // likely exist beyond it, even if fewer than PAGE_SIZE survived
    // filtering here) — either way, there's reason to expect a next page
    // would turn up more. Neither holding means filtering has already
    // exhausted everything IGDB actually had to offer.
    let has_more = games.len() > PAGE_SIZE || raw_batch_was_full;
    games.truncate(PAGE_SIZE);

    Ok(serde_json::json!({ "games": games, "hasMore": has_more }))
}

// Raw IGDB search with zero filtering — no cover requirement, no category
// allowlist, no VN/game split — used by the admin panel's "Add work" search
// so any title in IGDB can be found regardless of how it's classified.
#[tauri::command]
pub async fn igdb_search_unfiltered(
    app_handle: tauri::AppHandle,
    query: String,
    page: Option<u32>,
) -> Result<serde_json::Value, String> {
    if query.is_empty() {
        return Ok(serde_json::json!({ "games": [], "hasMore": false }));
    }

    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = crate::http::http_client();
    let safe_query = query.replace('"', "");

    const PAGE_SIZE: usize = 100;
    let page = page.unwrap_or(1).max(1) as usize;
    let offset = (page - 1) * PAGE_SIZE;

    let raw = igdb_query(
        client,
        &client_id,
        &token,
        IGDB_API_GAMES,
        &format!(
            "fields id,name,cover.image_id,rating,first_release_date,genres.id,genres.name,category,game_type; \
             search \"{}\"; limit {}; offset {};",
            safe_query, PAGE_SIZE, offset
        ),
    )
    .await?;

    let mut items = raw.as_array().cloned().unwrap_or_default();
    let has_more = items.len() == PAGE_SIZE;

    // Unlike igdb_search (which splits results into two buckets via the
    // is_visual_novel parameter), this command returns one mixed list — tag
    // each item with is_vn directly so the frontend can pick "vnovel:" vs
    // "game:" for the id prefix, same convention as every other place this
    // gets tagged (see detect_vn's other call sites in this file).
    for item in items.iter_mut() {
        let is_vn = detect_vn(item);
        if let Some(obj) = item.as_object_mut() {
            obj.insert("is_vn".to_string(), serde_json::Value::Bool(is_vn));
        }
    }

    Ok(serde_json::json!({ "games": items, "hasMore": has_more }))
}

// Search IGDB candidates for manual override — returns lightweight list for picker UI
#[tauri::command]
pub async fn igdb_search_candidates(
    app_handle: tauri::AppHandle,
    game_name: String,
) -> Result<Vec<serde_json::Value>, String> {
    let cfg = load_env_config(&app_handle)?;
    let client_id = cfg.igdb_client_id.ok_or("Missing IGDB client_id")?;
    let client_secret = cfg.igdb_client_secret.ok_or("Missing IGDB client_secret")?;
    let token = get_twitch_token(&client_id, &client_secret).await?;
    let client = crate::http::http_client();

    // Clean the name and strip edition/version keywords so the search casts
    // a wider net — "Batman: Arkham City GOTY Edition" → "Batman Arkham City"
    let tokens: Vec<String> = game_name
        .chars()
        .map(|c| match c {
            '\u{2122}' | '\u{00AE}' | '\u{00A9}' => ' ',
            ':' | ';' | '_' | '\'' | '\u{2019}' | '"' | '+' | '.' => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .filter(|t| {
            let tl = t.to_lowercase();
            // Remove pure edition/version/qualifier tokens
            !EDITION_KEYWORDS.contains(&tl.as_str())
                && !matches!(tl.as_str(), "the" | "a" | "an" | "of" | "in" | "on" | "for")
        })
        .map(String::from)
        .collect();

    let search_query = if tokens.is_empty() {
        game_name.trim().to_string()
    } else {
        tokens.join(" ")
    };
    let escaped_query = search_query.replace('\\', "\\\\").replace('"', "\\\"");

    let results = igdb_query(
        client,
        &client_id,
        &token,
        IGDB_API_GAMES,
        &format!(
            "fields id,name,cover.image_id,first_release_date,category,game_type; \
             search \"{}\"; where cover != null; limit 20;",
            escaped_query
        ),
    )
    .await?;

    let games: Vec<serde_json::Value> = results
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|g| !is_non_game(g))
        .collect();

    let ids: Vec<String> = games
        .iter()
        .filter_map(|g| g["id"].as_u64().map(|id| id.to_string()))
        .collect();

    let dev_map: std::collections::HashMap<u64, String> = if !ids.is_empty() {
        let id_list = ids.join(",");
        let dev_results = igdb_query(
            client,
            &client_id,
            &token,
            IGDB_API_GAMES,
            &format!(
                "fields id,involved_companies.company.name,involved_companies.developer; \
                 where id = ({}) & cover != null; limit 20;",
                id_list
            ),
        )
        .await
        .unwrap_or(serde_json::json!([]));

        dev_results
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|g| {
                let id = g["id"].as_u64()?;
                let dev = g["involved_companies"]
                    .as_array()?
                    .iter()
                    .find(|c| c["developer"].as_bool().unwrap_or(false))?["company"]["name"]
                    .as_str()
                    .map(String::from)?;
                Some((id, dev))
            })
            .collect()
    } else {
        std::collections::HashMap::new()
    };

    let candidates = games
        .into_iter()
        .filter_map(|game| {
            let id = game["id"].as_u64()?;
            let year = chrono::DateTime::from_timestamp(
                game["first_release_date"].as_i64().unwrap_or(0),
                0,
            )
            .map(|dt| dt.year())
            .unwrap_or(0);
            let cover_url = game["cover"]["image_id"]
                .as_str()
                .map(|img_id| format!("{}/{}.jpg", IGDB_IMAGE_COVER_BIG, img_id))?;
            let developer = dev_map.get(&id).cloned().unwrap_or_default();
            let category = game["category"].as_u64();
            Some(serde_json::json!({
                "id":        id,
                "name":      game["name"],
                "year":      year,
                "cover_url": cover_url,
                "developer": developer,
                "category":  category,
            }))
        })
        .collect();

    Ok(candidates)
}
