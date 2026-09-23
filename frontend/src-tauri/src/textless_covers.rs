// "Prefer clean (textless) covers" (Settings > Preferences > Library): a
// display-only substitute for a work's cover without its title/logo text,
// only where the provider really has one. The catalog's stored cover_url is
// never touched; the frontend swaps the rendered src (lib/media/textless-covers.ts).
//
// - Films / series (TMDB, user's key): posters uploaded with no language
//   (`iso_639_1 = null`) are the textless ones — best voted, then widest.
// - Games / visual novels (IGDB, user's key): covers always carry the logo,
//   so the substitute is key art from `artworks`, marked `art` so cards crop
//   it to the cover box (object-fit: cover, centered). Only when one exists.
// - AniList anime/manga and every other provider: no textless posters exist,
//   so those ids are never resolved.
//
// Results (including "none") are cached in textless_cover_cache for 30 days,
// so a work is asked about once a month at most. Provider failures and
// missing keys are not cached: the next call simply tries again.
use std::collections::HashMap;

use futures::StreamExt;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

use crate::company_catalog::tmdb as tmdb_api;
use crate::company_catalog::FetchError;
use crate::igdb::{get_twitch_token, igdb_query, IGDB_API_MULTIQUERY};

pub const CACHE_TTL_SECS: i64 = 30 * 24 * 60 * 60;
/// Ids resolved per command call; the frontend batches per rendered page.
const MAX_IDS_PER_CALL: usize = 200;
const TMDB_POSTER_BASE: &str = "https://image.tmdb.org/t/p/w500";
const IGDB_ART_BASE: &str = "https://images.igdb.com/igdb/image/upload/t_720p";
/// Games per `artworks` sub-query and sub-queries per multiquery request.
const IGDB_GAMES_PER_QUERY: usize = 20;
const IGDB_QUERIES_PER_REQUEST: usize = 10;
/// TMDB requests in flight at once (the shared TMDB budget paces them).
const TMDB_CONCURRENCY: usize = 4;
/// The cover box every card uses (2:3 poster, 3:4 IGDB cover); art closest to
/// it loses the least when center-cropped.
const COVER_ASPECT: f64 = 2.0 / 3.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextlessKind {
    /// A real textless poster: same aspect as the cover.
    Poster,
    /// Key art, to be center-cropped to the cover box.
    Art,
}

impl TextlessKind {
    fn as_str(self) -> &'static str {
        match self {
            TextlessKind::Poster => "poster",
            TextlessKind::Art => "art",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "poster" => Some(TextlessKind::Poster),
            "art" => Some(TextlessKind::Art),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextlessPick {
    pub url: String,
    pub kind: TextlessKind,
}

/// One answer per requested id. `url: None` means "no textless version" (or
/// not resolvable right now) — the caller keeps the original cover.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TextlessCover {
    pub external_id: String,
    pub url: Option<String>,
    /// `poster` | `art`; None when `url` is None.
    pub kind: Option<String>,
}

impl TextlessCover {
    fn from_pick(external_id: &str, pick: Option<&TextlessPick>) -> Self {
        TextlessCover {
            external_id: external_id.to_string(),
            url: pick.map(|p| p.url.clone()),
            kind: pick.map(|p| p.kind.as_str().to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Provider {
    TmdbMovie(u64),
    TmdbTv(u64),
    Igdb(u64),
}

/// `movie:603`, `series:1396` (TMDB), `game:1942`, `vnovel:1942` (IGDB);
/// anything else has no textless source.
fn parse_external_id(external_id: &str) -> Option<Provider> {
    let (prefix, rest) = external_id.split_once(':')?;
    let id: u64 = rest.parse().ok().filter(|id| *id > 0)?;
    match prefix {
        "movie" => Some(Provider::TmdbMovie(id)),
        "series" => Some(Provider::TmdbTv(id)),
        "game" | "vnovel" => Some(Provider::Igdb(id)),
        _ => None,
    }
}

// -- Selection (pure) ------------------------------------------------------------

/// TMDB `/{movie|tv}/{id}/images?include_image_language=null` → the textless
/// poster: no language, highest `vote_average`, then widest.
pub fn pick_tmdb_poster(images: &Value) -> Option<String> {
    images["posters"]
        .as_array()?
        .iter()
        .filter(|p| p["iso_639_1"].is_null())
        // Owner rule: a clean cover is never wider than tall.
        .filter(|p| is_not_landscape(p["width"].as_f64(), p["height"].as_f64()))
        .filter_map(|p| {
            let path = p["file_path"].as_str().filter(|s| s.starts_with('/'))?;
            Some((path, p["vote_average"].as_f64().unwrap_or(0.0), p["width"].as_u64().unwrap_or(0)))
        })
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal).then(a.2.cmp(&b.2)))
        .map(|(path, _, _)| format!("{TMDB_POSTER_BASE}{path}"))
}

/// Unknown dimensions pass (TMDB posters are portrait by definition);
/// known ones must not be wider than tall.
fn is_not_landscape(width: Option<f64>, height: Option<f64>) -> bool {
    match (width, height) {
        (Some(w), Some(h)) if w > 0.0 && h > 0.0 => w <= h,
        _ => true,
    }
}

/// IGDB artwork type slugs that say the art carries the logo/title.
pub(crate) fn artwork_has_logo(slug: &str) -> bool {
    let slug = slug.to_ascii_lowercase();
    (slug.contains("logo") && !slug.contains("without") && !slug.contains("no-logo")) || slug.contains("with-logo")
}

pub(crate) fn artwork_is_textless_type(slug: &str) -> bool {
    let slug = slug.to_ascii_lowercase();
    slug.contains("without-logo") || slug.contains("no-logo") || slug.contains("textless")
}

/// One game's artworks → the best key art to crop into a cover: never a
/// transparent/animated one or one typed "with logo"; typed "without logo"
/// first, then the aspect closest to the cover box, then the largest.
pub fn pick_igdb_artwork(artworks: &[&Value]) -> Option<String> {
    artworks
        .iter()
        .filter(|a| !a["alpha_channel"].as_bool().unwrap_or(false) && !a["animated"].as_bool().unwrap_or(false))
        .filter(|a| !a["artwork_type"]["slug"].as_str().is_some_and(artwork_has_logo))
        .filter_map(|a| {
            let image_id = a["image_id"].as_str().filter(|s| !s.is_empty())?;
            let width = a["width"].as_f64().unwrap_or(0.0);
            let height = a["height"].as_f64().unwrap_or(0.0);
            if width < 300.0 || height < 300.0 {
                return None;
            }
            // Owner rule: a clean cover is never wider than tall — landscape
            // key art is skipped even if it could be cropped.
            if width > height {
                return None;
            }
            let textless_type = a["artwork_type"]["slug"].as_str().is_some_and(artwork_is_textless_type);
            let aspect_distance = ((width / height) - COVER_ASPECT).abs();
            Some((image_id, textless_type, aspect_distance, width * height))
        })
        .max_by(|a, b| {
            a.1.cmp(&b.1)
                .then(b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal))
                .then(a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
        })
        .map(|(image_id, _, _, _)| format!("{IGDB_ART_BASE}/{image_id}.jpg"))
}

/// Multiquery response → game id → picked art. Every game id in `requested`
/// gets an entry (None when it has no usable artwork).
fn parse_igdb_artworks(response: &Value, requested: &[u64]) -> HashMap<u64, Option<String>> {
    let mut by_game: HashMap<u64, Vec<&Value>> = HashMap::new();
    for query in response.as_array().into_iter().flatten() {
        for art in query["result"].as_array().into_iter().flatten() {
            if let Some(game) = art["game"].as_u64() {
                by_game.entry(game).or_default().push(art);
            }
        }
    }
    requested
        .iter()
        .map(|id| (*id, by_game.get(id).and_then(|arts| pick_igdb_artwork(arts))))
        .collect()
}

fn igdb_artworks_multiquery(game_ids: &[u64], with_type: bool) -> String {
    let fields = if with_type {
        "game,image_id,width,height,alpha_channel,animated,artwork_type.slug"
    } else {
        "game,image_id,width,height,alpha_channel,animated"
    };
    game_ids
        .chunks(IGDB_GAMES_PER_QUERY)
        .enumerate()
        .map(|(i, chunk)| {
            let ids = chunk.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
            format!("query artworks \"a{i}\" {{ fields {fields}; where game = ({ids}); limit 500; }};")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// -- Cache ------------------------------------------------------------------------

/// Suffix on the stored `kind` of rows written under the current selection
/// rules (portrait only). Rows without it predate the rule and are re-resolved.
const CACHE_RULES_TAG: &str = "@portrait";

fn tag_kind(kind: Option<&str>) -> String {
    format!("{}{CACHE_RULES_TAG}", kind.unwrap_or("none"))
}

fn untag_kind(stored: Option<&str>) -> Option<Option<&str>> {
    let base = stored?.strip_suffix(CACHE_RULES_TAG)?;
    Some(if base == "none" { None } else { Some(base) })
}

pub fn cache_is_fresh(fetched_at: i64, now: i64) -> bool {
    now - fetched_at < CACHE_TTL_SECS
}

/// Fresh cache rows for these ids: `Some(pick)` or `None` (known negative).
/// Ids with no fresh row are absent.
pub(crate) fn read_cached(
    conn: &Connection,
    external_ids: &[String],
    now: i64,
) -> rusqlite::Result<HashMap<String, Option<TextlessPick>>> {
    let mut stmt = conn.prepare_cached(
        "SELECT url, kind, fetched_at FROM textless_cover_cache WHERE external_id = ?1",
    )?;
    let mut out = HashMap::new();
    for id in external_ids {
        let row: Option<(Option<String>, Option<String>, i64)> = stmt
            .query_row([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .optional()?;
        let Some((url, kind, fetched_at)) = row else { continue };
        if !cache_is_fresh(fetched_at, now) {
            continue;
        }
        let Some(kind) = untag_kind(kind.as_deref()) else { continue };
        let pick = match (url, kind.and_then(TextlessKind::parse)) {
            (Some(url), Some(kind)) => Some(TextlessPick { url, kind }),
            _ => None,
        };
        out.insert(id.clone(), pick);
    }
    Ok(out)
}

pub(crate) fn write_cached(
    conn: &Connection,
    rows: &[(String, Option<TextlessPick>)],
    now: i64,
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO textless_cover_cache (external_id, url, kind, fetched_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(external_id) DO UPDATE SET url = excluded.url, kind = excluded.kind, fetched_at = excluded.fetched_at",
        )?;
        for (id, pick) in rows {
            stmt.execute(rusqlite::params![
                id,
                pick.as_ref().map(|p| p.url.as_str()),
                tag_kind(pick.as_ref().map(|p| p.kind.as_str())),
                now
            ])?;
        }
    }
    tx.commit()
}

// -- Providers --------------------------------------------------------------------

/// Resolved ids (Some = found / known none); ids missing from the map were
/// not resolvable now (no key, network error) and are not cached.
type Resolved = Vec<(String, Option<TextlessPick>)>;

async fn resolve_tmdb(app_handle: &tauri::AppHandle, ids: Vec<(String, Provider)>) -> Resolved {
    if ids.is_empty() {
        return Vec::new();
    }
    let auth = match tmdb_api::auth(app_handle) {
        Ok(auth) => auth,
        Err(error) => {
            log::debug!("textless covers: TMDB unavailable ({error:?})");
            return Vec::new();
        }
    };
    let auth = &auth;
    futures::stream::iter(ids.into_iter().map(|(external_id, provider)| async move {
        let path = match provider {
            Provider::TmdbMovie(id) => format!("/movie/{id}/images"),
            Provider::TmdbTv(id) => format!("/tv/{id}/images"),
            Provider::Igdb(_) => return None,
        };
        match tmdb_api::get(auth, &path, &[("include_image_language", "null".to_string())]).await {
            Ok(body) => {
                let pick = pick_tmdb_poster(&body).map(|url| TextlessPick { url, kind: TextlessKind::Poster });
                Some((external_id, pick))
            }
            Err(FetchError::NotFound) => Some((external_id, None)),
            Err(error) => {
                log::debug!("textless covers: TMDB {external_id} failed ({error:?})");
                None
            }
        }
    }))
    .buffer_unordered(TMDB_CONCURRENCY)
    .filter_map(|r| async move { r })
    .collect()
    .await
}

async fn resolve_igdb(app_handle: &tauri::AppHandle, ids: Vec<(String, Provider)>) -> Resolved {
    if ids.is_empty() {
        return Vec::new();
    }
    let Ok(cfg) = crate::igdb_env::load_env_config(app_handle) else { return Vec::new() };
    let (Some(client_id), Some(secret)) = (cfg.igdb_client_id, cfg.igdb_client_secret) else {
        return Vec::new();
    };
    let token = match get_twitch_token(&client_id, &secret).await {
        Ok(token) => token,
        Err(error) => {
            log::debug!("textless covers: IGDB auth failed ({error})");
            return Vec::new();
        }
    };

    // game id → every external id asking for it (game:/vnovel: share ids).
    let mut by_game: HashMap<u64, Vec<String>> = HashMap::new();
    for (external_id, provider) in ids {
        if let Provider::Igdb(id) = provider {
            by_game.entry(id).or_default().push(external_id);
        }
    }
    let mut game_ids: Vec<u64> = by_game.keys().copied().collect();
    game_ids.sort_unstable();

    let client = crate::http::http_client();
    let mut out = Vec::new();
    for batch in game_ids.chunks(IGDB_GAMES_PER_QUERY * IGDB_QUERIES_PER_REQUEST) {
        let typed = igdb_query(client, &client_id, &token, IGDB_API_MULTIQUERY, &igdb_artworks_multiquery(batch, true)).await;
        // `artwork_type` is a newer IGDB field; without it the typed filter
        // simply doesn't apply.
        let response = match typed {
            Ok(response) => Ok(response),
            Err(_) => igdb_query(client, &client_id, &token, IGDB_API_MULTIQUERY, &igdb_artworks_multiquery(batch, false)).await,
        };
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                log::debug!("textless covers: IGDB artworks failed ({error})");
                continue;
            }
        };
        for (game_id, url) in parse_igdb_artworks(&response, batch) {
            let pick = url.map(|url| TextlessPick { url, kind: TextlessKind::Art });
            for external_id in by_game.get(&game_id).into_iter().flatten() {
                out.push((external_id.clone(), pick.clone()));
            }
        }
    }
    out
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Batch resolve: cached answers at once, the rest from TMDB/IGDB (only ids
/// those providers can have a textless version for). Never fails — anything
/// unresolvable comes back as `url: None` and is retried on a later call.
#[tauri::command]
pub async fn resolve_textless_covers(app_handle: tauri::AppHandle, external_ids: Vec<String>) -> Vec<TextlessCover> {
    let mut requested: Vec<(String, Provider)> = Vec::new();
    for id in external_ids {
        if requested.len() >= MAX_IDS_PER_CALL {
            break;
        }
        if requested.iter().any(|(seen, _)| *seen == id) {
            continue;
        }
        if let Some(provider) = parse_external_id(&id) {
            requested.push((id, provider));
        }
    }
    if requested.is_empty() {
        return Vec::new();
    }
    let now = now_unix();
    let ids: Vec<String> = requested.iter().map(|(id, _)| id.clone()).collect();

    let cached = {
        let db = tauri::Manager::state::<crate::db::MetadeaDb>(&app_handle);
        let conn = db.conn.lock();
        match conn {
            Ok(conn) => read_cached(&conn, &ids, now).unwrap_or_else(|error| {
                log::warn!("textless covers: cache read failed ({error})");
                HashMap::new()
            }),
            Err(_) => HashMap::new(),
        }
    };

    let (tmdb, igdb): (Vec<_>, Vec<_>) = requested
        .iter()
        .filter(|(id, _)| !cached.contains_key(id))
        .cloned()
        .partition(|(_, provider)| !matches!(provider, Provider::Igdb(_)));
    let (tmdb_rows, igdb_rows) = futures::join!(resolve_tmdb(&app_handle, tmdb), resolve_igdb(&app_handle, igdb));
    let fresh: Resolved = tmdb_rows.into_iter().chain(igdb_rows).collect();

    if !fresh.is_empty() {
        let db = tauri::Manager::state::<crate::db::MetadeaDb>(&app_handle);
        if let Ok(conn) = db.conn.lock() {
            if let Err(error) = write_cached(&conn, &fresh, now) {
                log::warn!("textless covers: cache write failed ({error})");
            }
        };
    }

    let fresh: HashMap<String, Option<TextlessPick>> = fresh.into_iter().collect();
    ids.iter()
        .map(|id| {
            let pick = cached.get(id).or_else(|| fresh.get(id)).and_then(Option::as_ref);
            TextlessCover::from_pick(id, pick)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cache_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        crate::migrations::textless_cover_cache::migrate(&tx).unwrap();
        tx.commit().unwrap();
        conn
    }

    #[test]
    fn parses_only_providers_with_textless_sources() {
        assert_eq!(parse_external_id("movie:603"), Some(Provider::TmdbMovie(603)));
        assert_eq!(parse_external_id("series:1396"), Some(Provider::TmdbTv(1396)));
        assert_eq!(parse_external_id("game:1942"), Some(Provider::Igdb(1942)));
        assert_eq!(parse_external_id("vnovel:7"), Some(Provider::Igdb(7)));
        assert_eq!(parse_external_id("anime:21"), None);
        assert_eq!(parse_external_id("manga:30013"), None);
        assert_eq!(parse_external_id("series:1396:season:2"), None);
        assert_eq!(parse_external_id("movie:0"), None);
        assert_eq!(parse_external_id("book:OL1W"), None);
    }

    #[test]
    fn tmdb_picks_the_best_voted_language_free_poster() {
        let images = json!({ "posters": [
            { "file_path": "/en.jpg", "iso_639_1": "en", "vote_average": 9.9, "width": 2000 },
            { "file_path": "/low.jpg", "iso_639_1": null, "vote_average": 5.1, "width": 2000 },
            { "file_path": "/best.jpg", "iso_639_1": null, "vote_average": 5.4, "width": 1000 },
        ]});
        assert_eq!(pick_tmdb_poster(&images).as_deref(), Some("https://image.tmdb.org/t/p/w500/best.jpg"));
    }

    #[test]
    fn tmdb_breaks_vote_ties_by_width_and_treats_missing_votes_as_zero() {
        let images = json!({ "posters": [
            { "file_path": "/narrow.jpg", "iso_639_1": null, "vote_average": 5.0, "width": 500 },
            { "file_path": "/wide.jpg", "iso_639_1": null, "vote_average": 5.0, "width": 2000 },
            { "file_path": "/unvoted.jpg", "iso_639_1": null, "width": 4000 },
        ]});
        assert_eq!(pick_tmdb_poster(&images).as_deref(), Some("https://image.tmdb.org/t/p/w500/wide.jpg"));
        let only_unvoted = json!({ "posters": [{ "file_path": "/unvoted.jpg", "iso_639_1": null }] });
        assert_eq!(pick_tmdb_poster(&only_unvoted).as_deref(), Some("https://image.tmdb.org/t/p/w500/unvoted.jpg"));
    }

    #[test]
    fn tmdb_without_textless_posters_is_none() {
        assert_eq!(pick_tmdb_poster(&json!({ "posters": [] })), None);
        assert_eq!(pick_tmdb_poster(&json!({})), None);
        assert_eq!(pick_tmdb_poster(&json!({ "posters": [{ "file_path": "/x.jpg", "iso_639_1": "es" }] })), None);
        assert_eq!(pick_tmdb_poster(&json!({ "posters": [{ "file_path": null, "iso_639_1": null }] })), None);
    }

    #[test]
    fn igdb_prefers_typed_textless_art_then_cover_like_aspect_then_size() {
        let wide = json!({ "image_id": "wide", "width": 3840, "height": 2160 });
        let tall = json!({ "image_id": "tall", "width": 1200, "height": 1700 });
        assert_eq!(pick_igdb_artwork(&[&wide, &tall]).as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_720p/tall.jpg"));

        let typed = json!({ "image_id": "typed", "width": 1080, "height": 1920, "artwork_type": { "slug": "key-art-without-logo" } });
        assert_eq!(pick_igdb_artwork(&[&tall, &typed]).as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_720p/typed.jpg"));

        let small_same_aspect = json!({ "image_id": "small", "width": 720, "height": 1280 });
        let big_same_aspect = json!({ "image_id": "big", "width": 1440, "height": 2560 });
        assert_eq!(pick_igdb_artwork(&[&small_same_aspect, &big_same_aspect]).as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_720p/big.jpg"));
    }

    #[test]
    fn never_picks_art_or_posters_wider_than_tall() {
        let wide = json!({ "image_id": "wide", "width": 3840, "height": 2160, "artwork_type": { "slug": "key-art-without-logo" } });
        assert_eq!(pick_igdb_artwork(&[&wide]), None);
        let square = json!({ "image_id": "sq", "width": 1000, "height": 1000 });
        assert_eq!(pick_igdb_artwork(&[&wide, &square]).as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_720p/sq.jpg"));
        let posters = json!({ "posters": [{ "file_path": "/land.jpg", "iso_639_1": null, "vote_average": 9.0, "width": 2000, "height": 1000 }] });
        assert_eq!(pick_tmdb_poster(&posters), None);
    }

    #[test]
    fn cache_rows_from_before_the_portrait_rule_are_ignored() {
        assert_eq!(untag_kind(Some("art")), None);
        assert_eq!(untag_kind(Some("art@portrait")), Some(Some("art")));
        assert_eq!(untag_kind(Some("none@portrait")), Some(None));
        assert_eq!(tag_kind(None), "none@portrait");
    }

    #[test]
    fn igdb_skips_logo_transparent_animated_and_tiny_art() {
        let logo = json!({ "image_id": "logo", "width": 1200, "height": 1700, "artwork_type": { "slug": "key-art-with-logo" } });
        let alpha = json!({ "image_id": "alpha", "width": 1200, "height": 1700, "alpha_channel": true });
        let animated = json!({ "image_id": "anim", "width": 1200, "height": 1700, "animated": true });
        let tiny = json!({ "image_id": "tiny", "width": 120, "height": 170 });
        assert_eq!(pick_igdb_artwork(&[&logo, &alpha, &animated, &tiny]), None);
        assert_eq!(pick_igdb_artwork(&[]), None);
    }

    #[test]
    fn igdb_multiquery_groups_art_by_game_and_reports_games_without_art() {
        let response = json!([
            { "name": "a0", "result": [
                { "game": 1, "image_id": "one", "width": 1080, "height": 1920 },
                { "game": 1, "image_id": "one_logo", "width": 1200, "height": 1700, "artwork_type": { "slug": "key-art-with-logo" } },
            ]},
            { "name": "a1", "result": [
                { "game": 3, "image_id": "three", "width": 1080, "height": 1920 },
                // Landscape art never becomes a clean cover.
                { "game": 3, "image_id": "three_wide", "width": 3840, "height": 2160 },
            ]},
            { "name": "a2", "result": [{ "game": 4, "image_id": "four_wide", "width": 1920, "height": 1080 }] },
        ]);
        let picked = parse_igdb_artworks(&response, &[1, 2, 3, 4]);
        assert_eq!(picked[&1].as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_720p/one.jpg"));
        assert_eq!(picked[&2], None);
        assert_eq!(picked[&3].as_deref(), Some("https://images.igdb.com/igdb/image/upload/t_720p/three.jpg"));
        assert_eq!(picked[&4], None);
    }

    #[test]
    fn igdb_multiquery_body_splits_ids_into_sub_queries() {
        let ids: Vec<u64> = (1..=45).collect();
        let body = igdb_artworks_multiquery(&ids, true);
        assert_eq!(body.matches("query artworks").count(), 3);
        assert!(body.contains("artwork_type.slug"));
        assert!(!igdb_artworks_multiquery(&ids, false).contains("artwork_type"));
    }

    #[test]
    fn cache_ttl_is_thirty_days() {
        let now = 1_700_000_000;
        assert!(cache_is_fresh(now - CACHE_TTL_SECS + 1, now));
        assert!(!cache_is_fresh(now - CACHE_TTL_SECS, now));
    }

    #[test]
    fn cache_round_trips_hits_and_negatives_and_drops_stale_rows() {
        let conn = cache_conn();
        let now = 1_700_000_000;
        let hit = TextlessPick { url: "https://image.tmdb.org/t/p/w500/a.jpg".into(), kind: TextlessKind::Poster };
        write_cached(&conn, &[("movie:1".into(), Some(hit.clone())), ("game:2".into(), None)], now).unwrap();
        write_cached(&conn, &[("series:3".into(), None)], now - CACHE_TTL_SECS - 1).unwrap();

        let ids = vec!["movie:1".to_string(), "game:2".to_string(), "series:3".to_string(), "movie:4".to_string()];
        let cached = read_cached(&conn, &ids, now).unwrap();
        assert_eq!(cached.get("movie:1"), Some(&Some(hit)));
        // A negative answer is remembered too…
        assert_eq!(cached.get("game:2"), Some(&None));
        // …but only for 30 days, and unknown ids are simply absent.
        assert!(!cached.contains_key("series:3"));
        assert!(!cached.contains_key("movie:4"));
    }

    #[test]
    fn cache_rewrite_replaces_the_previous_answer() {
        let conn = cache_conn();
        write_cached(&conn, &[("game:2".into(), None)], 100).unwrap();
        let art = TextlessPick { url: "https://images.igdb.com/igdb/image/upload/t_720p/x.jpg".into(), kind: TextlessKind::Art };
        write_cached(&conn, &[("game:2".into(), Some(art.clone()))], 200).unwrap();
        assert_eq!(read_cached(&conn, &["game:2".to_string()], 200).unwrap().get("game:2"), Some(&Some(art)));
    }
}
