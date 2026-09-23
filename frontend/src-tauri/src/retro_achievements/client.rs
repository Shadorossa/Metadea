//! Typed RetroAchievements Web API client. Every request goes to the fixed
//! `retroachievements.org` host (nothing user-supplied ever becomes a URL —
//! ids and titles are query parameters), carries a timeout, and is spaced
//! by a process-wide limiter of one request per second, which is what RA
//! asks of third-party clients. Responses are parsed into the camelCase
//! structs the webview consumes; the raw PascalCase shapes stay private.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error_codes;

const API_BASE: &str = "https://retroachievements.org/API/";
const DOREQUEST_URL: &str = "https://retroachievements.org/dorequest.php";
const MEDIA_BASE: &str = "https://media.retroachievements.org";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MIN_REQUEST_GAP: Duration = Duration::from_secs(1);

pub fn badge_url(badge_name: &str, locked: bool) -> String {
    if locked {
        format!("{MEDIA_BASE}/Badge/{badge_name}_lock.png")
    } else {
        format!("{MEDIA_BASE}/Badge/{badge_name}.png")
    }
}

fn icon_url(image_icon: Option<&str>) -> Option<String> {
    image_icon.filter(|p| !p.is_empty()).map(|p| format!("{MEDIA_BASE}{p}"))
}

// ── Public (webview-facing) types ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaAchievement {
    pub id: u32,
    pub title: String,
    pub description: String,
    pub points: u32,
    pub true_ratio: u32,
    pub badge_name: String,
    pub badge_url: String,
    pub badge_locked_url: String,
    pub display_order: i64,
    /// "progression" | "win_condition" | "missable" | null
    pub kind: Option<String>,
    pub date_earned: Option<String>,
    pub date_earned_hardcore: Option<String>,
    pub unlocked: bool,
    pub unlocked_hardcore: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaGameProgress {
    pub game_id: u32,
    pub title: String,
    pub console_id: u32,
    pub console_name: String,
    pub icon_url: Option<String>,
    pub total: u32,
    pub unlocked: u32,
    pub unlocked_hardcore: u32,
    pub points_total: u32,
    pub points_unlocked: u32,
    pub completion_pct: Option<String>,
    pub completion_hardcore_pct: Option<String>,
    /// "mastered" | "completed" | "beaten-hardcore" | "beaten-softcore" | null
    pub highest_award_kind: Option<String>,
    pub highest_award_date: Option<String>,
    pub achievements: Vec<RaAchievement>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaProfileGame {
    pub game_id: u32,
    pub title: String,
    pub icon_url: Option<String>,
    pub console_id: u32,
    pub console_name: String,
    pub total: u32,
    pub unlocked: u32,
    pub unlocked_hardcore: u32,
    pub most_recent_awarded_date: Option<String>,
    pub highest_award_kind: Option<String>,
    pub highest_award_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaProfileProgress {
    pub count: u32,
    pub total: u32,
    pub games: Vec<RaProfileGame>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaRecentUnlock {
    pub date: String,
    pub hardcore: bool,
    pub achievement_id: u32,
    pub title: String,
    pub description: String,
    pub badge_name: String,
    pub badge_url: String,
    pub points: u32,
    pub game_id: u32,
    pub game_title: String,
    pub console_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaGameListEntry {
    pub id: u32,
    pub title: String,
    pub console_id: u32,
    pub icon_url: Option<String>,
    pub num_achievements: u32,
    pub points: u32,
    pub hashes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaConsole {
    pub id: u32,
    pub name: String,
    pub active: bool,
    pub is_game_system: bool,
}

// ── Raw API shapes ───────────────────────────────────────────────────────────

fn de_u32_lenient<'de, D: serde::Deserializer<'de>>(d: D) -> Result<u32, D::Error> {
    // RA serialises some counters as strings ("12") depending on the endpoint.
    let value = serde_json::Value::deserialize(d)?;
    Ok(match value {
        serde_json::Value::Number(n) => n.as_u64().unwrap_or(0) as u32,
        serde_json::Value::String(s) => s.trim().parse().unwrap_or(0),
        _ => 0,
    })
}

fn de_bool_lenient<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(match value {
        serde_json::Value::Bool(b) => b,
        serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        serde_json::Value::String(s) => matches!(s.as_str(), "1" | "true"),
        _ => false,
    })
}

#[derive(Deserialize)]
struct RawAchievement {
    #[serde(rename = "ID", deserialize_with = "de_u32_lenient")]
    id: u32,
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "Description", default)]
    description: String,
    #[serde(rename = "Points", default, deserialize_with = "de_u32_lenient")]
    points: u32,
    #[serde(rename = "TrueRatio", default, deserialize_with = "de_u32_lenient")]
    true_ratio: u32,
    #[serde(rename = "BadgeName", default)]
    badge_name: String,
    #[serde(rename = "DisplayOrder", default)]
    display_order: i64,
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(rename = "DateEarned", default)]
    date_earned: Option<String>,
    #[serde(rename = "DateEarnedHardcore", default)]
    date_earned_hardcore: Option<String>,
}

#[derive(Deserialize)]
struct RawGameProgress {
    #[serde(rename = "ID", deserialize_with = "de_u32_lenient")]
    id: u32,
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "ConsoleID", default, deserialize_with = "de_u32_lenient")]
    console_id: u32,
    #[serde(rename = "ConsoleName", default)]
    console_name: String,
    #[serde(rename = "ImageIcon", default)]
    image_icon: Option<String>,
    #[serde(rename = "NumAchievements", default, deserialize_with = "de_u32_lenient")]
    num_achievements: u32,
    #[serde(rename = "NumAwardedToUser", default, deserialize_with = "de_u32_lenient")]
    num_awarded: u32,
    #[serde(rename = "NumAwardedToUserHardcore", default, deserialize_with = "de_u32_lenient")]
    num_awarded_hardcore: u32,
    #[serde(rename = "UserCompletion", default)]
    user_completion: Option<String>,
    #[serde(rename = "UserCompletionHardcore", default)]
    user_completion_hardcore: Option<String>,
    #[serde(rename = "HighestAwardKind", default)]
    highest_award_kind: Option<String>,
    #[serde(rename = "HighestAwardDate", default)]
    highest_award_date: Option<String>,
    // PHP serialises an empty set as `[]`, a populated one as an object
    // keyed by achievement id — accept either.
    #[serde(rename = "Achievements", default)]
    achievements: serde_json::Value,
}

pub fn parse_game_progress(body: &str) -> Result<RaGameProgress, String> {
    let raw: RawGameProgress = serde_json::from_str(body).map_err(|e| error_codes::with_detail(error_codes::RA_API, e))?;
    let raw_achievements: Vec<RawAchievement> = match raw.achievements {
        serde_json::Value::Object(map) => map
            .into_values()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect(),
        serde_json::Value::Array(list) => list.into_iter().filter_map(|v| serde_json::from_value(v).ok()).collect(),
        _ => Vec::new(),
    };
    let mut achievements: Vec<RaAchievement> = raw_achievements
        .into_iter()
        .map(|a| {
            let unlocked_hardcore = a.date_earned_hardcore.as_deref().is_some_and(|d| !d.is_empty());
            let unlocked = unlocked_hardcore || a.date_earned.as_deref().is_some_and(|d| !d.is_empty());
            RaAchievement {
                badge_url: badge_url(&a.badge_name, false),
                badge_locked_url: badge_url(&a.badge_name, true),
                id: a.id,
                title: a.title,
                description: a.description,
                points: a.points,
                true_ratio: a.true_ratio,
                badge_name: a.badge_name,
                display_order: a.display_order,
                kind: a.kind.filter(|k| !k.is_empty()),
                date_earned: a.date_earned.filter(|d| !d.is_empty()),
                date_earned_hardcore: a.date_earned_hardcore.filter(|d| !d.is_empty()),
                unlocked,
                unlocked_hardcore,
            }
        })
        .collect();
    achievements.sort_by(|a, b| a.display_order.cmp(&b.display_order).then(a.id.cmp(&b.id)));
    let points_total = achievements.iter().map(|a| a.points).sum();
    let points_unlocked = achievements.iter().filter(|a| a.unlocked).map(|a| a.points).sum();
    let total = if raw.num_achievements > 0 { raw.num_achievements } else { achievements.len() as u32 };
    let unlocked_count = achievements.iter().filter(|a| a.unlocked).count() as u32;
    let unlocked_hardcore_count = achievements.iter().filter(|a| a.unlocked_hardcore).count() as u32;
    Ok(RaGameProgress {
        game_id: raw.id,
        title: raw.title,
        console_id: raw.console_id,
        console_name: raw.console_name,
        icon_url: icon_url(raw.image_icon.as_deref()),
        total,
        unlocked: raw.num_awarded.max(unlocked_count),
        unlocked_hardcore: raw.num_awarded_hardcore.max(unlocked_hardcore_count),
        points_total,
        points_unlocked,
        completion_pct: raw.user_completion,
        completion_hardcore_pct: raw.user_completion_hardcore,
        highest_award_kind: raw.highest_award_kind.filter(|k| !k.is_empty()),
        highest_award_date: raw.highest_award_date.filter(|d| !d.is_empty()),
        achievements,
    })
}

#[derive(Deserialize)]
struct RawProfileGame {
    #[serde(rename = "GameID", deserialize_with = "de_u32_lenient")]
    game_id: u32,
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "ImageIcon", default)]
    image_icon: Option<String>,
    #[serde(rename = "ConsoleID", default, deserialize_with = "de_u32_lenient")]
    console_id: u32,
    #[serde(rename = "ConsoleName", default)]
    console_name: String,
    #[serde(rename = "MaxPossible", default, deserialize_with = "de_u32_lenient")]
    max_possible: u32,
    #[serde(rename = "NumAwarded", default, deserialize_with = "de_u32_lenient")]
    num_awarded: u32,
    #[serde(rename = "NumAwardedHardcore", default, deserialize_with = "de_u32_lenient")]
    num_awarded_hardcore: u32,
    #[serde(rename = "MostRecentAwardedDate", default)]
    most_recent_awarded_date: Option<String>,
    #[serde(rename = "HighestAwardKind", default)]
    highest_award_kind: Option<String>,
    #[serde(rename = "HighestAwardDate", default)]
    highest_award_date: Option<String>,
}

#[derive(Deserialize)]
struct RawProfileProgress {
    #[serde(rename = "Count", default, deserialize_with = "de_u32_lenient")]
    count: u32,
    #[serde(rename = "Total", default, deserialize_with = "de_u32_lenient")]
    total: u32,
    #[serde(rename = "Results", default)]
    results: Vec<RawProfileGame>,
}

pub fn parse_profile_progress(body: &str) -> Result<RaProfileProgress, String> {
    let raw: RawProfileProgress = serde_json::from_str(body).map_err(|e| error_codes::with_detail(error_codes::RA_API, e))?;
    let games = raw
        .results
        .into_iter()
        .map(|g| RaProfileGame {
            game_id: g.game_id,
            title: g.title,
            icon_url: icon_url(g.image_icon.as_deref()),
            console_id: g.console_id,
            console_name: g.console_name,
            total: g.max_possible,
            unlocked: g.num_awarded,
            unlocked_hardcore: g.num_awarded_hardcore,
            most_recent_awarded_date: g.most_recent_awarded_date.filter(|d| !d.is_empty()),
            highest_award_kind: g.highest_award_kind.filter(|k| !k.is_empty()),
            highest_award_date: g.highest_award_date.filter(|d| !d.is_empty()),
        })
        .collect();
    Ok(RaProfileProgress { count: raw.count, total: raw.total, games })
}

#[derive(Deserialize)]
struct RawRecentUnlock {
    #[serde(rename = "Date", default)]
    date: String,
    #[serde(rename = "HardcoreMode", default, deserialize_with = "de_bool_lenient")]
    hardcore: bool,
    #[serde(rename = "AchievementID", deserialize_with = "de_u32_lenient")]
    achievement_id: u32,
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "Description", default)]
    description: String,
    #[serde(rename = "BadgeName", default)]
    badge_name: String,
    #[serde(rename = "Points", default, deserialize_with = "de_u32_lenient")]
    points: u32,
    #[serde(rename = "GameID", default, deserialize_with = "de_u32_lenient")]
    game_id: u32,
    #[serde(rename = "GameTitle", default)]
    game_title: String,
    #[serde(rename = "ConsoleName", default)]
    console_name: String,
}

pub fn parse_recent_unlocks(body: &str) -> Result<Vec<RaRecentUnlock>, String> {
    let raw: Vec<RawRecentUnlock> = serde_json::from_str(body).map_err(|e| error_codes::with_detail(error_codes::RA_API, e))?;
    Ok(raw
        .into_iter()
        .map(|u| RaRecentUnlock {
            badge_url: badge_url(&u.badge_name, false),
            date: u.date,
            hardcore: u.hardcore,
            achievement_id: u.achievement_id,
            title: u.title,
            description: u.description,
            badge_name: u.badge_name,
            points: u.points,
            game_id: u.game_id,
            game_title: u.game_title,
            console_name: u.console_name,
        })
        .collect())
}

#[derive(Deserialize)]
struct RawGameListEntry {
    #[serde(rename = "ID", deserialize_with = "de_u32_lenient")]
    id: u32,
    #[serde(rename = "Title", default)]
    title: String,
    #[serde(rename = "ConsoleID", default, deserialize_with = "de_u32_lenient")]
    console_id: u32,
    #[serde(rename = "ImageIcon", default)]
    image_icon: Option<String>,
    #[serde(rename = "NumAchievements", default, deserialize_with = "de_u32_lenient")]
    num_achievements: u32,
    #[serde(rename = "Points", default, deserialize_with = "de_u32_lenient")]
    points: u32,
    #[serde(rename = "Hashes", default)]
    hashes: Vec<String>,
}

pub fn parse_game_list(body: &str) -> Result<Vec<RaGameListEntry>, String> {
    let raw: Vec<RawGameListEntry> = serde_json::from_str(body).map_err(|e| error_codes::with_detail(error_codes::RA_API, e))?;
    Ok(raw
        .into_iter()
        .map(|g| RaGameListEntry {
            id: g.id,
            title: g.title,
            console_id: g.console_id,
            icon_url: icon_url(g.image_icon.as_deref()),
            num_achievements: g.num_achievements,
            points: g.points,
            hashes: g.hashes.into_iter().map(|h| h.to_lowercase()).collect(),
        })
        .collect())
}

#[derive(Deserialize)]
struct RawConsole {
    #[serde(rename = "ID", deserialize_with = "de_u32_lenient")]
    id: u32,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Active", default, deserialize_with = "de_bool_lenient")]
    active: bool,
    #[serde(rename = "IsGameSystem", default, deserialize_with = "de_bool_lenient")]
    is_game_system: bool,
}

pub fn parse_consoles(body: &str) -> Result<Vec<RaConsole>, String> {
    let raw: Vec<RawConsole> = serde_json::from_str(body).map_err(|e| error_codes::with_detail(error_codes::RA_API, e))?;
    Ok(raw
        .into_iter()
        .map(|c| RaConsole { id: c.id, name: c.name, active: c.active, is_game_system: c.is_game_system })
        .collect())
}

#[derive(Deserialize)]
struct RawHashLookup {
    #[serde(rename = "Success", default, deserialize_with = "de_bool_lenient")]
    success: bool,
    #[serde(rename = "GameID", default, deserialize_with = "de_u32_lenient")]
    game_id: u32,
}

/// `Some(game_id)` when RA knows the hash, `None` when it does not.
pub fn parse_hash_lookup(body: &str) -> Result<Option<u32>, String> {
    let raw: RawHashLookup = serde_json::from_str(body).map_err(|e| error_codes::with_detail(error_codes::RA_API, e))?;
    Ok(if raw.success && raw.game_id > 0 { Some(raw.game_id) } else { None })
}

// ── Transport ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct RaCredentials {
    pub username: String,
    pub api_key: String,
}

fn limiter() -> &'static tokio::sync::Mutex<Option<Instant>> {
    static LIMITER: OnceLock<tokio::sync::Mutex<Option<Instant>>> = OnceLock::new();
    LIMITER.get_or_init(|| tokio::sync::Mutex::new(None))
}

/// Waits until at least `MIN_REQUEST_GAP` has passed since the previous
/// request left, then records this one. Holding the lock across the sleep
/// serialises concurrent callers too.
async fn throttle() {
    let mut last = limiter().lock().await;
    if let Some(previous) = *last {
        let elapsed = previous.elapsed();
        if elapsed < MIN_REQUEST_GAP {
            tokio::time::sleep(MIN_REQUEST_GAP - elapsed).await;
        }
    }
    *last = Some(Instant::now());
}

async fn get_text(url: &str, query: &[(&str, String)]) -> Result<String, String> {
    throttle().await;
    let response = crate::http::http_client()
        .get(url)
        .query(query)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| error_codes::with_detail(error_codes::RA_NETWORK, e))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(error_codes::with_detail(error_codes::RA_UNAUTHORIZED, status));
    }
    if !status.is_success() {
        return Err(error_codes::with_detail(error_codes::RA_API, format!("HTTP {status}")));
    }
    response.text().await.map_err(|e| error_codes::with_detail(error_codes::RA_NETWORK, e))
}

fn endpoint(name: &str) -> String {
    format!("{API_BASE}{name}.php")
}

fn auth_query(creds: &RaCredentials) -> Vec<(&'static str, String)> {
    vec![("y", creds.api_key.clone()), ("u", creds.username.clone())]
}

/// Raw JSON of API_GetGameInfoAndUserProgress (`a=1` adds HighestAwardKind).
pub async fn fetch_game_progress_json(creds: &RaCredentials, game_id: u32) -> Result<String, String> {
    let mut query = auth_query(creds);
    query.push(("g", game_id.to_string()));
    query.push(("a", "1".to_string()));
    get_text(&endpoint("API_GetGameInfoAndUserProgress"), &query).await
}

/// Raw JSON of API_GetUserCompletionProgress for the configured user.
pub async fn fetch_profile_progress_json(creds: &RaCredentials) -> Result<String, String> {
    let mut query = auth_query(creds);
    query.push(("c", "500".to_string()));
    query.push(("o", "0".to_string()));
    get_text(&endpoint("API_GetUserCompletionProgress"), &query).await
}

pub async fn fetch_recent_unlocks_json(creds: &RaCredentials, minutes: u32) -> Result<String, String> {
    let mut query = auth_query(creds);
    query.push(("m", minutes.to_string()));
    get_text(&endpoint("API_GetUserRecentAchievements"), &query).await
}

/// API_GetGameList with hashes (`h=1`), only games that have achievements (`f=1`).
pub async fn fetch_game_list_json(creds: &RaCredentials, console_id: u32) -> Result<String, String> {
    let mut query = auth_query(creds);
    query.push(("i", console_id.to_string()));
    query.push(("h", "1".to_string()));
    query.push(("f", "1".to_string()));
    get_text(&endpoint("API_GetGameList"), &query).await
}

pub async fn fetch_consoles_json(creds: &RaCredentials) -> Result<String, String> {
    get_text(&endpoint("API_GetConsoleIDs"), &auth_query(creds)).await
}

/// Unauthenticated hash → game id lookup used by the emulators themselves.
pub async fn fetch_hash_lookup_json(hash: &str) -> Result<String, String> {
    let query = [("r", "gameid".to_string()), ("m", hash.to_lowercase())];
    get_text(DOREQUEST_URL, &query).await
}

/// Index of a cached game list by hash, for offline hash → id resolution.
pub fn hash_index(list: &[RaGameListEntry]) -> HashMap<&str, u32> {
    list.iter()
        .flat_map(|g| g.hashes.iter().map(move |h| (h.as_str(), g.id)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAME_PROGRESS: &str = include_str!("fixtures/game_progress.json");
    const PROFILE_PROGRESS: &str = include_str!("fixtures/profile_progress.json");
    const RECENT: &str = include_str!("fixtures/recent_unlocks.json");
    const GAME_LIST: &str = include_str!("fixtures/game_list.json");
    const CONSOLES: &str = include_str!("fixtures/consoles.json");

    #[test]
    fn game_progress_fixture_parses_with_counts_points_and_award() {
        let progress = parse_game_progress(GAME_PROGRESS).unwrap();
        assert_eq!(progress.game_id, 1446);
        assert_eq!(progress.console_id, 18);
        assert_eq!((progress.total, progress.unlocked, progress.unlocked_hardcore), (3, 2, 1));
        assert_eq!((progress.points_total, progress.points_unlocked), (30, 15));
        assert_eq!(progress.highest_award_kind.as_deref(), Some("beaten-softcore"));
        assert_eq!(progress.icon_url.as_deref(), Some("https://media.retroachievements.org/Images/000001.png"));
        // Sorted by DisplayOrder, not by the object's key order.
        let ids: Vec<u32> = progress.achievements.iter().map(|a| a.id).collect();
        assert_eq!(ids, vec![9001, 9002, 9003]);
        let first = &progress.achievements[0];
        assert!(first.unlocked && first.unlocked_hardcore);
        assert_eq!(first.badge_url, "https://media.retroachievements.org/Badge/12345.png");
        assert_eq!(first.badge_locked_url, "https://media.retroachievements.org/Badge/12345_lock.png");
        assert_eq!(first.kind.as_deref(), Some("progression"));
        let second = &progress.achievements[1];
        assert!(second.unlocked && !second.unlocked_hardcore);
        let third = &progress.achievements[2];
        assert!(!third.unlocked && third.date_earned.is_none() && third.kind.is_none());
    }

    #[test]
    fn an_empty_achievement_set_serialised_as_a_php_array_parses() {
        let body = r#"{"ID":"7","Title":"Empty","ConsoleID":"4","ConsoleName":"Game Boy","NumAchievements":0,"NumAwardedToUser":0,"NumAwardedToUserHardcore":0,"Achievements":[]}"#;
        let progress = parse_game_progress(body).unwrap();
        assert_eq!((progress.game_id, progress.total, progress.achievements.len()), (7, 0, 0));
        assert!(progress.highest_award_kind.is_none());
    }

    #[test]
    fn invalid_json_maps_to_the_api_error_code() {
        let err = parse_game_progress("<html>").unwrap_err();
        assert!(err.starts_with("E_RA_API: "), "{err}");
    }

    #[test]
    fn profile_progress_fixture_parses() {
        let profile = parse_profile_progress(PROFILE_PROGRESS).unwrap();
        assert_eq!((profile.count, profile.total, profile.games.len()), (2, 2, 2));
        let mastered = &profile.games[0];
        assert_eq!((mastered.game_id, mastered.total, mastered.unlocked), (1446, 3, 3));
        assert_eq!(mastered.highest_award_kind.as_deref(), Some("mastered"));
        assert!(profile.games[1].highest_award_kind.is_none());
    }

    #[test]
    fn recent_unlocks_fixture_parses_hardcore_flag_and_badge() {
        let recent = parse_recent_unlocks(RECENT).unwrap();
        assert_eq!(recent.len(), 2);
        assert!(recent[0].hardcore && !recent[1].hardcore);
        assert_eq!(recent[0].badge_url, "https://media.retroachievements.org/Badge/12345.png");
        assert_eq!(recent[1].game_id, 1446);
    }

    #[test]
    fn game_list_fixture_parses_lowercased_hashes_and_indexes_them() {
        let list = parse_game_list(GAME_LIST).unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].hashes, vec!["aabbccddeeff00112233445566778899".to_string()]);
        let index = hash_index(&list);
        assert_eq!(index.get("aabbccddeeff00112233445566778899"), Some(&1446));
        assert_eq!(index.get("ffffffffffffffffffffffffffffffff"), Some(&2000));
        assert_eq!(index.get("nope"), None);
    }

    #[test]
    fn consoles_fixture_parses_flags() {
        let consoles = parse_consoles(CONSOLES).unwrap();
        assert_eq!(consoles.len(), 3);
        assert_eq!((consoles[0].id, consoles[0].name.as_str()), (18, "Nintendo DS"));
        assert!(consoles[0].active && consoles[0].is_game_system);
        assert!(!consoles[2].is_game_system);
    }

    #[test]
    fn hash_lookup_maps_unknown_hashes_to_none() {
        assert_eq!(parse_hash_lookup(r#"{"Success":true,"GameID":1446}"#).unwrap(), Some(1446));
        assert_eq!(parse_hash_lookup(r#"{"Success":true,"GameID":0}"#).unwrap(), None);
        assert_eq!(parse_hash_lookup(r#"{"Success":false}"#).unwrap(), None);
    }

    #[test]
    fn badge_urls_follow_the_media_host_layout() {
        assert_eq!(badge_url("777", false), "https://media.retroachievements.org/Badge/777.png");
        assert_eq!(badge_url("777", true), "https://media.retroachievements.org/Badge/777_lock.png");
    }
}
