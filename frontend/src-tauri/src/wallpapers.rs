// Ambient TV mode (frontend lib/ambient/): one landscape wallpaper per work —
// never a portrait cover. Wider than tall and at least MIN_WIDTH wide,
// ideally HD_WIDTH or more.
//
// - Films / series (TMDB, user's key): `images` backdrops. Language-free
//   (textless) first, then HD, then best voted, then widest; `original` size.
// - Games / visual novels (IGDB, user's key): landscape `artworks` (never one
//   typed "with logo", transparent or animated), then `screenshots`; `t_1080p`.
// - AniList anime / manga: TMDB backdrops of the show the app already mapped
//   the entry to (the curator's `episode_source_id`, or the TMDB episode list
//   it matched — `media_episode.source_key` `tmdb:<id>:…`). Otherwise the
//   AniList banner stored in the catalog, marked `banner` (≈1900×400: the
//   screensaver centre-crops it and vignettes the edges).
// - Books, comics and everything else: no wallpaper.
//
// Results are cached in wallpaper_cache: hits 30 days, "none" 7 days.
// Provider failures and missing keys are not cached: the next call retries.
use std::collections::HashMap;

use futures::StreamExt;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

use crate::company_catalog::tmdb as tmdb_api;
use crate::company_catalog::FetchError;
use crate::igdb::{get_twitch_token, igdb_query, IGDB_API_MULTIQUERY};
use crate::textless_covers::{artwork_has_logo, artwork_is_textless_type};

pub const HIT_TTL_SECS: i64 = 30 * 24 * 60 * 60;
pub const MISS_TTL_SECS: i64 = 7 * 24 * 60 * 60;
/// Narrower than this looks soft on a TV.
pub const MIN_WIDTH: u64 = 1280;
/// Preferred width: full HD.
const HD_WIDTH: u64 = 1920;
const MAX_IDS_PER_CALL: usize = 200;
const TMDB_ORIGINAL_BASE: &str = "https://image.tmdb.org/t/p/original";
const IGDB_1080P_BASE: &str = "https://images.igdb.com/igdb/image/upload/t_1080p";
/// Games per sub-query; each chunk of games costs two sub-queries
/// (artworks + screenshots) of the ten a multiquery request allows.
const IGDB_GAMES_PER_QUERY: usize = 20;
const IGDB_CHUNKS_PER_REQUEST: usize = 5;
const TMDB_CONCURRENCY: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WallpaperKind {
    /// TMDB backdrop.
    Backdrop,
    /// IGDB key art.
    Artwork,
    /// IGDB in-game screenshot.
    Screenshot,
    /// AniList banner: very wide and short, centre-cropped by the UI.
    Banner,
}

impl WallpaperKind {
    fn as_str(self) -> &'static str {
        match self {
            WallpaperKind::Backdrop => "backdrop",
            WallpaperKind::Artwork => "artwork",
            WallpaperKind::Screenshot => "screenshot",
            WallpaperKind::Banner => "banner",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "backdrop" => Some(WallpaperKind::Backdrop),
            "artwork" => Some(WallpaperKind::Artwork),
            "screenshot" => Some(WallpaperKind::Screenshot),
            "banner" => Some(WallpaperKind::Banner),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WallpaperPick {
    pub url: String,
    pub kind: WallpaperKind,
}

/// One answer per requested id; `url: None` = no wallpaper (or not
/// resolvable right now).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Wallpaper {
    pub external_id: String,
    pub url: Option<String>,
    pub kind: Option<String>,
}

impl Wallpaper {
    fn from_pick(external_id: &str, pick: Option<&WallpaperPick>) -> Self {
        Wallpaper {
            external_id: external_id.to_string(),
            url: pick.map(|p| p.url.clone()),
            kind: pick.map(|p| p.kind.as_str().to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    TmdbMovie(u64),
    TmdbTv(u64),
    Igdb(u64),
    AniList,
}

fn parse_external_id(external_id: &str) -> Option<Source> {
    let (prefix, rest) = external_id.split_once(':')?;
    let id: u64 = rest.parse().ok().filter(|id| *id > 0)?;
    match prefix {
        "movie" => Some(Source::TmdbMovie(id)),
        "series" => Some(Source::TmdbTv(id)),
        "game" | "vnovel" => Some(Source::Igdb(id)),
        "anime" | "manga" => Some(Source::AniList),
        _ => None,
    }
}

// -- Selection (pure) ------------------------------------------------------------

/// Wider than tall and at least MIN_WIDTH wide. Unknown sizes fail.
pub fn is_landscape_wallpaper(width: Option<u64>, height: Option<u64>) -> bool {
    matches!((width, height), (Some(w), Some(h)) if h > 0 && w > h && w >= MIN_WIDTH)
}

fn dims(image: &Value) -> Option<(u64, u64)> {
    let width = image["width"].as_u64()?;
    let height = image["height"].as_u64()?;
    is_landscape_wallpaper(Some(width), Some(height)).then_some((width, height))
}

fn cmp_f64(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal)
}

/// TMDB `/{movie|tv}/{id}/images` → the best backdrop: language-free
/// (textless) first, then ≥ HD_WIDTH, then best voted, then widest.
pub fn pick_tmdb_backdrop(images: &Value) -> Option<String> {
    images["backdrops"]
        .as_array()?
        .iter()
        .filter_map(|b| {
            let path = b["file_path"].as_str().filter(|s| s.starts_with('/'))?;
            let (width, _) = dims(b)?;
            let textless = b["iso_639_1"].is_null();
            Some((path, textless, width >= HD_WIDTH, b["vote_average"].as_f64().unwrap_or(0.0), width))
        })
        .max_by(|a, b| a.1.cmp(&b.1).then(a.2.cmp(&b.2)).then(cmp_f64(a.3, b.3)).then(a.4.cmp(&b.4)))
        .map(|(path, ..)| format!("{TMDB_ORIGINAL_BASE}{path}"))
}

/// One game's artworks → landscape key art without a logo: typed "without
/// logo" first, then ≥ HD_WIDTH, then the largest.
pub fn pick_igdb_artwork(artworks: &[&Value]) -> Option<String> {
    artworks
        .iter()
        .filter(|a| !a["alpha_channel"].as_bool().unwrap_or(false) && !a["animated"].as_bool().unwrap_or(false))
        .filter(|a| !a["artwork_type"]["slug"].as_str().is_some_and(artwork_has_logo))
        .filter_map(|a| {
            let image_id = a["image_id"].as_str().filter(|s| !s.is_empty())?;
            let (width, height) = dims(a)?;
            let textless = a["artwork_type"]["slug"].as_str().is_some_and(artwork_is_textless_type);
            Some((image_id, textless, width >= HD_WIDTH, width * height))
        })
        .max_by(|a, b| a.1.cmp(&b.1).then(a.2.cmp(&b.2)).then(a.3.cmp(&b.3)))
        .map(|(image_id, ..)| format!("{IGDB_1080P_BASE}/{image_id}.jpg"))
}

/// One game's screenshots → the largest landscape one.
pub fn pick_igdb_screenshot(screenshots: &[&Value]) -> Option<String> {
    screenshots
        .iter()
        .filter_map(|s| {
            let image_id = s["image_id"].as_str().filter(|id| !id.is_empty())?;
            let (width, height) = dims(s)?;
            Some((image_id, width * height))
        })
        .max_by_key(|(_, area)| *area)
        .map(|(image_id, _)| format!("{IGDB_1080P_BASE}/{image_id}.jpg"))
}

/// Multiquery response (sub-queries `a<i>` artworks, `s<i>` screenshots) →
/// game id → wallpaper: key art first, a screenshot otherwise. Every id in
/// `requested` gets an entry (None when it has neither).
fn parse_igdb_wallpapers(response: &Value, requested: &[u64]) -> HashMap<u64, Option<WallpaperPick>> {
    let mut artworks: HashMap<u64, Vec<&Value>> = HashMap::new();
    let mut screenshots: HashMap<u64, Vec<&Value>> = HashMap::new();
    for query in response.as_array().into_iter().flatten() {
        let target = if query["name"].as_str().is_some_and(|n| n.starts_with('s')) { &mut screenshots } else { &mut artworks };
        for image in query["result"].as_array().into_iter().flatten() {
            if let Some(game) = image["game"].as_u64() {
                target.entry(game).or_default().push(image);
            }
        }
    }
    requested
        .iter()
        .map(|id| {
            let art = artworks.get(id).and_then(|a| pick_igdb_artwork(a)).map(|url| WallpaperPick { url, kind: WallpaperKind::Artwork });
            let pick = art.or_else(|| {
                screenshots.get(id).and_then(|s| pick_igdb_screenshot(s)).map(|url| WallpaperPick { url, kind: WallpaperKind::Screenshot })
            });
            (*id, pick)
        })
        .collect()
}

fn igdb_wallpaper_multiquery(game_ids: &[u64], with_type: bool) -> String {
    let art_fields = if with_type {
        "game,image_id,width,height,alpha_channel,animated,artwork_type.slug"
    } else {
        "game,image_id,width,height,alpha_channel,animated"
    };
    game_ids
        .chunks(IGDB_GAMES_PER_QUERY)
        .enumerate()
        .map(|(i, chunk)| {
            let ids = chunk.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
            format!(
                "query artworks \"a{i}\" {{ fields {art_fields}; where game = ({ids}); limit 500; }};\n\
                 query screenshots \"s{i}\" {{ fields game,image_id,width,height; where game = ({ids}); limit 500; }};"
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// -- AniList → TMDB (local catalog) ----------------------------------------------

/// What the local catalog knows about an AniList entry's wallpaper sources.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct AniListInfo {
    tmdb_tv: Option<u64>,
    banner: Option<String>,
}

/// `tmdb:1396:season:1:episode:2` → 1396.
fn parse_tmdb_source_key(key: &str) -> Option<u64> {
    let rest = key.strip_prefix("tmdb:")?;
    rest.split(':').next()?.parse().ok().filter(|id| *id > 0)
}

fn first_csv_url(csv: Option<&str>) -> Option<String> {
    csv?.split(',').next().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn read_anilist_info(conn: &Connection, external_ids: &[String]) -> rusqlite::Result<HashMap<String, AniListInfo>> {
    let mut stmt = conn.prepare_cached(
        "SELECT c.banners_csv, c.episode_source_id,
                (SELECT e.source_key FROM media_episode e
                  WHERE e.external_id = c.external_id AND e.source_key LIKE 'tmdb:%' LIMIT 1)
           FROM media_catalog c WHERE c.external_id = ?1 LIMIT 1",
    )?;
    let mut out = HashMap::new();
    for id in external_ids {
        let row: Option<(Option<String>, Option<String>, Option<String>)> =
            stmt.query_row([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional()?;
        let Some((banners, episode_source, source_key)) = row else { continue };
        let curated = episode_source.as_deref().and_then(|s| s.trim().parse::<u64>().ok()).filter(|id| *id > 0);
        let tmdb_tv = curated.or_else(|| source_key.as_deref().and_then(parse_tmdb_source_key));
        out.insert(id.clone(), AniListInfo { tmdb_tv, banner: first_csv_url(banners.as_deref()) });
    }
    Ok(out)
}

fn banner_pick(info: Option<&AniListInfo>) -> Option<WallpaperPick> {
    info?.banner.clone().map(|url| WallpaperPick { url, kind: WallpaperKind::Banner })
}

// -- Cache ------------------------------------------------------------------------

pub fn cache_is_fresh(is_hit: bool, fetched_at: i64, now: i64) -> bool {
    now - fetched_at < if is_hit { HIT_TTL_SECS } else { MISS_TTL_SECS }
}

/// Fresh rows: `Some(pick)` or `None` (known negative). Others are absent.
fn read_cached(conn: &Connection, external_ids: &[String], now: i64) -> rusqlite::Result<HashMap<String, Option<WallpaperPick>>> {
    let mut stmt = conn.prepare_cached("SELECT url, kind, fetched_at FROM wallpaper_cache WHERE external_id = ?1")?;
    let mut out = HashMap::new();
    for id in external_ids {
        let row: Option<(Option<String>, Option<String>, i64)> =
            stmt.query_row([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional()?;
        let Some((url, kind, fetched_at)) = row else { continue };
        let pick = match (url, kind.as_deref().and_then(WallpaperKind::parse)) {
            (Some(url), Some(kind)) => Some(WallpaperPick { url, kind }),
            _ => None,
        };
        if cache_is_fresh(pick.is_some(), fetched_at, now) {
            out.insert(id.clone(), pick);
        }
    }
    Ok(out)
}

fn write_cached(conn: &Connection, rows: &[(String, Option<WallpaperPick>)], now: i64) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO wallpaper_cache (external_id, url, kind, fetched_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(external_id) DO UPDATE SET url = excluded.url, kind = excluded.kind, fetched_at = excluded.fetched_at",
        )?;
        for (id, pick) in rows {
            stmt.execute(rusqlite::params![
                id,
                pick.as_ref().map(|p| p.url.as_str()),
                pick.as_ref().map(|p| p.kind.as_str()),
                now
            ])?;
        }
    }
    tx.commit()
}

// -- Providers --------------------------------------------------------------------

/// Resolved answers; ids missing were not resolvable now and are not cached.
type Resolved = Vec<(String, Option<WallpaperPick>)>;

#[derive(Debug, Clone, Copy)]
enum TmdbPath {
    Movie(u64),
    Tv(u64),
}

async fn resolve_tmdb(app_handle: &tauri::AppHandle, ids: Vec<(String, TmdbPath)>) -> Resolved {
    if ids.is_empty() {
        return Vec::new();
    }
    let auth = match tmdb_api::auth(app_handle) {
        Ok(auth) => auth,
        Err(error) => {
            log::debug!("wallpapers: TMDB unavailable ({error:?})");
            return Vec::new();
        }
    };
    let auth = &auth;
    futures::stream::iter(ids.into_iter().map(|(external_id, path)| async move {
        let path = match path {
            TmdbPath::Movie(id) => format!("/movie/{id}/images"),
            TmdbPath::Tv(id) => format!("/tv/{id}/images"),
        };
        match tmdb_api::get(auth, &path, &[]).await {
            Ok(body) => Some((external_id, pick_tmdb_backdrop(&body).map(|url| WallpaperPick { url, kind: WallpaperKind::Backdrop }))),
            Err(FetchError::NotFound) => Some((external_id, None)),
            Err(error) => {
                log::debug!("wallpapers: TMDB {external_id} failed ({error:?})");
                None
            }
        }
    }))
    .buffer_unordered(TMDB_CONCURRENCY)
    .filter_map(|r| async move { r })
    .collect()
    .await
}

async fn resolve_igdb(app_handle: &tauri::AppHandle, ids: Vec<(String, u64)>) -> Resolved {
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
            log::debug!("wallpapers: IGDB auth failed ({error})");
            return Vec::new();
        }
    };

    // game id → every external id asking for it (game:/vnovel: share ids).
    let mut by_game: HashMap<u64, Vec<String>> = HashMap::new();
    for (external_id, game) in ids {
        by_game.entry(game).or_default().push(external_id);
    }
    let mut game_ids: Vec<u64> = by_game.keys().copied().collect();
    game_ids.sort_unstable();

    let client = crate::http::http_client();
    let mut out = Vec::new();
    for batch in game_ids.chunks(IGDB_GAMES_PER_QUERY * IGDB_CHUNKS_PER_REQUEST) {
        // `artwork_type` is a newer IGDB field; retry without it on refusal.
        let response = match igdb_query(client, &client_id, &token, IGDB_API_MULTIQUERY, &igdb_wallpaper_multiquery(batch, true)).await {
            Ok(response) => Ok(response),
            Err(_) => igdb_query(client, &client_id, &token, IGDB_API_MULTIQUERY, &igdb_wallpaper_multiquery(batch, false)).await,
        };
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                log::debug!("wallpapers: IGDB images failed ({error})");
                continue;
            }
        };
        for (game_id, pick) in parse_igdb_wallpapers(&response, batch) {
            for external_id in by_game.get(&game_id).into_iter().flatten() {
                out.push((external_id.clone(), pick.clone()));
            }
        }
    }
    out
}

/// AniList ids: the matched TMDB show's backdrop when there is one, else the
/// catalog banner. A TMDB answer that could not be fetched still shows the
/// banner, but uncached, so the backdrop is tried again next time.
fn settle_anilist(
    ids: &[String],
    info: &HashMap<String, AniListInfo>,
    tmdb: &HashMap<String, Option<WallpaperPick>>,
) -> (Resolved, Resolved) {
    let mut cacheable = Vec::new();
    let mut transient = Vec::new();
    for id in ids {
        let entry = info.get(id);
        match (entry.and_then(|i| i.tmdb_tv), tmdb.get(id)) {
            (Some(_), Some(Some(backdrop))) => cacheable.push((id.clone(), Some(backdrop.clone()))),
            (Some(_), None) => transient.push((id.clone(), banner_pick(entry))),
            _ => cacheable.push((id.clone(), banner_pick(entry))),
        }
    }
    (cacheable, transient)
}

fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Batch resolve: cached answers at once, the rest from TMDB / IGDB / the
/// local catalog. Never fails — anything unresolvable comes back `url: None`.
#[tauri::command]
pub async fn resolve_wallpapers(app_handle: tauri::AppHandle, external_ids: Vec<String>) -> Vec<Wallpaper> {
    let mut requested: Vec<(String, Source)> = Vec::new();
    for id in external_ids {
        if requested.len() >= MAX_IDS_PER_CALL {
            break;
        }
        if requested.iter().any(|(seen, _)| *seen == id) {
            continue;
        }
        if let Some(source) = parse_external_id(&id) {
            requested.push((id, source));
        }
    }
    if requested.is_empty() {
        return Vec::new();
    }
    let now = now_unix();
    let ids: Vec<String> = requested.iter().map(|(id, _)| id.clone()).collect();

    let (cached, anilist_info) = {
        let db = tauri::Manager::state::<crate::db::MetadeaDb>(&app_handle);
        let read = match db.conn.lock() {
            Ok(conn) => {
                let cached = read_cached(&conn, &ids, now).unwrap_or_else(|error| {
                    log::warn!("wallpapers: cache read failed ({error})");
                    HashMap::new()
                });
                let anilist: Vec<String> = requested
                    .iter()
                    .filter(|(id, source)| *source == Source::AniList && !cached.contains_key(id))
                    .map(|(id, _)| id.clone())
                    .collect();
                let info = read_anilist_info(&conn, &anilist).unwrap_or_else(|error| {
                    log::warn!("wallpapers: catalog read failed ({error})");
                    HashMap::new()
                });
                (cached, info)
            }
            Err(_) => (HashMap::new(), HashMap::new()),
        };
        read
    };

    let mut tmdb_ids = Vec::new();
    let mut igdb_ids = Vec::new();
    let mut anilist_ids = Vec::new();
    for (id, source) in requested.iter().filter(|(id, _)| !cached.contains_key(id)) {
        match *source {
            Source::TmdbMovie(tmdb) => tmdb_ids.push((id.clone(), TmdbPath::Movie(tmdb))),
            Source::TmdbTv(tmdb) => tmdb_ids.push((id.clone(), TmdbPath::Tv(tmdb))),
            Source::Igdb(game) => igdb_ids.push((id.clone(), game)),
            Source::AniList => {
                if let Some(tmdb) = anilist_info.get(id).and_then(|i| i.tmdb_tv) {
                    tmdb_ids.push((id.clone(), TmdbPath::Tv(tmdb)));
                }
                anilist_ids.push(id.clone());
            }
        }
    }
    let (tmdb_rows, igdb_rows) = futures::join!(resolve_tmdb(&app_handle, tmdb_ids), resolve_igdb(&app_handle, igdb_ids));
    let tmdb_rows: HashMap<String, Option<WallpaperPick>> = tmdb_rows.into_iter().collect();
    let (anilist_rows, transient) = settle_anilist(&anilist_ids, &anilist_info, &tmdb_rows);

    // AniList ids' TMDB answers are already folded into `anilist_rows`.
    let mut fresh: Resolved = tmdb_rows.into_iter().filter(|(id, _)| !anilist_ids.contains(id)).collect();
    fresh.extend(igdb_rows);
    fresh.extend(anilist_rows);

    if !fresh.is_empty() {
        let db = tauri::Manager::state::<crate::db::MetadeaDb>(&app_handle);
        if let Ok(conn) = db.conn.lock() {
            if let Err(error) = write_cached(&conn, &fresh, now) {
                log::warn!("wallpapers: cache write failed ({error})");
            }
        };
    }

    let fresh: HashMap<String, Option<WallpaperPick>> = fresh.into_iter().chain(transient).collect();
    ids.iter()
        .map(|id| {
            let pick = cached.get(id).or_else(|| fresh.get(id)).and_then(Option::as_ref);
            Wallpaper::from_pick(id, pick)
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
        crate::migrations::wallpaper_cache::migrate(&tx).unwrap();
        tx.commit().unwrap();
        conn
    }

    const TMDB: &str = "https://image.tmdb.org/t/p/original";
    const IGDB: &str = "https://images.igdb.com/igdb/image/upload/t_1080p";

    #[test]
    fn parses_every_provider_with_a_wallpaper_source() {
        assert_eq!(parse_external_id("movie:603"), Some(Source::TmdbMovie(603)));
        assert_eq!(parse_external_id("series:1396"), Some(Source::TmdbTv(1396)));
        assert_eq!(parse_external_id("game:1942"), Some(Source::Igdb(1942)));
        assert_eq!(parse_external_id("vnovel:7"), Some(Source::Igdb(7)));
        assert_eq!(parse_external_id("anime:21"), Some(Source::AniList));
        assert_eq!(parse_external_id("manga:30013"), Some(Source::AniList));
        assert_eq!(parse_external_id("book:OL1W"), None);
        assert_eq!(parse_external_id("comic:4050"), None);
        assert_eq!(parse_external_id("movie:0"), None);
    }

    #[test]
    fn landscape_filter_needs_a_wide_image_of_at_least_1280() {
        assert!(is_landscape_wallpaper(Some(1920), Some(1080)));
        assert!(is_landscape_wallpaper(Some(1280), Some(720)));
        assert!(!is_landscape_wallpaper(Some(1279), Some(720)));
        assert!(!is_landscape_wallpaper(Some(2000), Some(3000)));
        assert!(!is_landscape_wallpaper(Some(1500), Some(1500)));
        assert!(!is_landscape_wallpaper(None, Some(1080)));
        assert!(!is_landscape_wallpaper(Some(1920), Some(0)));
    }

    #[test]
    fn tmdb_prefers_textless_then_hd_then_votes_then_width() {
        let images = json!({ "backdrops": [
            { "file_path": "/logo.jpg", "iso_639_1": "en", "vote_average": 9.9, "width": 3840, "height": 2160 },
            { "file_path": "/small.jpg", "iso_639_1": null, "vote_average": 9.0, "width": 1280, "height": 720 },
            { "file_path": "/hd_low.jpg", "iso_639_1": null, "vote_average": 5.0, "width": 1920, "height": 1080 },
            { "file_path": "/hd_best.jpg", "iso_639_1": null, "vote_average": 5.6, "width": 1920, "height": 1080 },
            { "file_path": "/hd_best_4k.jpg", "iso_639_1": null, "vote_average": 5.6, "width": 3840, "height": 2160 },
        ]});
        assert_eq!(pick_tmdb_backdrop(&images), Some(format!("{TMDB}/hd_best_4k.jpg")));
    }

    #[test]
    fn tmdb_falls_back_to_a_language_backdrop_and_drops_small_or_portrait_ones() {
        let images = json!({ "backdrops": [
            { "file_path": "/tiny.jpg", "iso_639_1": null, "width": 780, "height": 439 },
            { "file_path": "/tall.jpg", "iso_639_1": null, "width": 2000, "height": 3000 },
            { "file_path": "/nodims.jpg", "iso_639_1": null },
            { "file_path": "/ja.jpg", "iso_639_1": "ja", "width": 1920, "height": 1080 },
        ]});
        assert_eq!(pick_tmdb_backdrop(&images), Some(format!("{TMDB}/ja.jpg")));
        assert_eq!(pick_tmdb_backdrop(&json!({ "backdrops": [] })), None);
        assert_eq!(pick_tmdb_backdrop(&json!({ "posters": [] })), None);
    }

    #[test]
    fn igdb_artwork_is_landscape_logo_free_typed_textless_first_then_hd_then_largest() {
        let portrait = json!({ "image_id": "tall", "width": 1200, "height": 1700 });
        let logo = json!({ "image_id": "logo", "width": 3840, "height": 2160, "artwork_type": { "slug": "key-art-with-logo" } });
        let alpha = json!({ "image_id": "alpha", "width": 3840, "height": 2160, "alpha_channel": true });
        let small = json!({ "image_id": "small", "width": 1024, "height": 576 });
        assert_eq!(pick_igdb_artwork(&[&portrait, &logo, &alpha, &small]), None);

        let hd = json!({ "image_id": "hd", "width": 1920, "height": 1080 });
        let big = json!({ "image_id": "big", "width": 3840, "height": 2160 });
        let mid = json!({ "image_id": "mid", "width": 1600, "height": 900 });
        assert_eq!(pick_igdb_artwork(&[&mid, &hd, &big]), Some(format!("{IGDB}/big.jpg")));
        let typed = json!({ "image_id": "typed", "width": 1600, "height": 900, "artwork_type": { "slug": "key-art-without-logo" } });
        assert_eq!(pick_igdb_artwork(&[&big, &typed]), Some(format!("{IGDB}/typed.jpg")));
    }

    #[test]
    fn igdb_uses_screenshots_only_without_usable_art() {
        let response = json!([
            { "name": "a0", "result": [
                { "game": 1, "image_id": "art1", "width": 1920, "height": 1080 },
                { "game": 2, "image_id": "art2_tall", "width": 1080, "height": 1920 },
            ]},
            { "name": "s0", "result": [
                { "game": 1, "image_id": "shot1", "width": 1920, "height": 1080 },
                { "game": 2, "image_id": "shot2_small", "width": 640, "height": 480 },
                { "game": 2, "image_id": "shot2", "width": 1280, "height": 720 },
                { "game": 3, "image_id": "shot3_small", "width": 800, "height": 600 },
            ]},
        ]);
        let picked = parse_igdb_wallpapers(&response, &[1, 2, 3, 4]);
        assert_eq!(picked[&1], Some(WallpaperPick { url: format!("{IGDB}/art1.jpg"), kind: WallpaperKind::Artwork }));
        assert_eq!(picked[&2], Some(WallpaperPick { url: format!("{IGDB}/shot2.jpg"), kind: WallpaperKind::Screenshot }));
        assert_eq!(picked[&3], None);
        assert_eq!(picked[&4], None);
    }

    #[test]
    fn igdb_multiquery_pairs_artwork_and_screenshot_sub_queries() {
        let ids: Vec<u64> = (1..=45).collect();
        let body = igdb_wallpaper_multiquery(&ids, true);
        assert_eq!(body.matches("query artworks").count(), 3);
        assert_eq!(body.matches("query screenshots").count(), 3);
        assert!(body.contains("artwork_type.slug"));
        assert!(!igdb_wallpaper_multiquery(&ids, false).contains("artwork_type"));
        // A full request stays within IGDB's ten sub-queries.
        let full: Vec<u64> = (1..=(IGDB_GAMES_PER_QUERY * IGDB_CHUNKS_PER_REQUEST) as u64).collect();
        assert_eq!(igdb_wallpaper_multiquery(&full, true).matches("query ").count(), 10);
    }

    #[test]
    fn tmdb_source_keys_give_the_matched_show() {
        assert_eq!(parse_tmdb_source_key("tmdb:1429:season:1:episode:3"), Some(1429));
        assert_eq!(parse_tmdb_source_key("anilist:21:episode:3"), None);
        assert_eq!(parse_tmdb_source_key("tmdb:x:season:1"), None);
    }

    #[test]
    fn anilist_info_reads_the_curated_or_matched_tmdb_show_and_the_banner() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE media_catalog (external_id TEXT, banners_csv TEXT, episode_source_id TEXT);
             CREATE TABLE media_episode (external_id TEXT, source_key TEXT);
             INSERT INTO media_catalog VALUES ('anime:1', 'https://b/1.jpg, https://b/1b.jpg', '777');
             INSERT INTO media_catalog VALUES ('anime:2', NULL, NULL);
             INSERT INTO media_episode VALUES ('anime:2', 'anilist:2:episode:1');
             INSERT INTO media_episode VALUES ('anime:2', 'tmdb:1429:season:1:episode:1');
             INSERT INTO media_catalog VALUES ('manga:3', 'https://b/3.jpg', NULL);",
        )
        .unwrap();
        let ids = ["anime:1", "anime:2", "manga:3", "anime:9"].map(String::from);
        let info = read_anilist_info(&conn, &ids).unwrap();
        assert_eq!(info["anime:1"], AniListInfo { tmdb_tv: Some(777), banner: Some("https://b/1.jpg".into()) });
        assert_eq!(info["anime:2"], AniListInfo { tmdb_tv: Some(1429), banner: None });
        assert_eq!(info["manga:3"], AniListInfo { tmdb_tv: None, banner: Some("https://b/3.jpg".into()) });
        assert!(!info.contains_key("anime:9"));
    }

    #[test]
    fn anilist_prefers_the_tmdb_backdrop_then_the_banner() {
        let backdrop = WallpaperPick { url: format!("{TMDB}/x.jpg"), kind: WallpaperKind::Backdrop };
        let banner = |url: &str| Some(WallpaperPick { url: url.into(), kind: WallpaperKind::Banner });
        let info: HashMap<String, AniListInfo> = [
            ("anime:1", AniListInfo { tmdb_tv: Some(1), banner: Some("b1".into()) }),
            ("anime:2", AniListInfo { tmdb_tv: Some(2), banner: Some("b2".into()) }),
            ("anime:3", AniListInfo { tmdb_tv: Some(3), banner: Some("b3".into()) }),
            ("anime:4", AniListInfo { tmdb_tv: None, banner: Some("b4".into()) }),
            ("anime:5", AniListInfo::default()),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
        // anime:1 got a backdrop, anime:2 a known "none", anime:3 failed.
        let tmdb: HashMap<String, Option<WallpaperPick>> =
            [("anime:1".to_string(), Some(backdrop.clone())), ("anime:2".to_string(), None)].into_iter().collect();
        let ids = ["anime:1", "anime:2", "anime:3", "anime:4", "anime:5", "anime:6"].map(String::from);
        let (cacheable, transient) = settle_anilist(&ids, &info, &tmdb);
        let cacheable: HashMap<_, _> = cacheable.into_iter().collect();
        assert_eq!(cacheable["anime:1"], Some(backdrop));
        assert_eq!(cacheable["anime:2"], banner("b2"));
        assert_eq!(cacheable["anime:4"], banner("b4"));
        assert_eq!(cacheable["anime:5"], None);
        assert_eq!(cacheable["anime:6"], None);
        assert_eq!(transient, vec![("anime:3".to_string(), banner("b3"))]);
    }

    #[test]
    fn cache_keeps_hits_thirty_days_and_misses_seven() {
        let now = 1_700_000_000;
        assert!(cache_is_fresh(true, now - HIT_TTL_SECS + 1, now));
        assert!(!cache_is_fresh(true, now - HIT_TTL_SECS, now));
        assert!(cache_is_fresh(false, now - MISS_TTL_SECS + 1, now));
        assert!(!cache_is_fresh(false, now - MISS_TTL_SECS, now));

        let conn = cache_conn();
        let hit = WallpaperPick { url: format!("{TMDB}/a.jpg"), kind: WallpaperKind::Backdrop };
        let banner = WallpaperPick { url: "https://b/x.jpg".into(), kind: WallpaperKind::Banner };
        let eight_days = now - 8 * 24 * 60 * 60;
        write_cached(&conn, &[("movie:1".into(), Some(hit.clone())), ("game:2".into(), None)], now).unwrap();
        write_cached(&conn, &[("anime:3".into(), Some(banner.clone())), ("series:4".into(), None)], eight_days).unwrap();

        let ids = ["movie:1", "game:2", "anime:3", "series:4", "movie:5"].map(String::from);
        let cached = read_cached(&conn, &ids, now).unwrap();
        assert_eq!(cached.get("movie:1"), Some(&Some(hit)));
        assert_eq!(cached.get("game:2"), Some(&None));
        // An 8-day-old hit is still good; an 8-day-old miss is asked again.
        assert_eq!(cached.get("anime:3"), Some(&Some(banner)));
        assert!(!cached.contains_key("series:4"));
        assert!(!cached.contains_key("movie:5"));
    }
}
