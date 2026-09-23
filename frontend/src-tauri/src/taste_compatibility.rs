// Taste compatibility between the viewer and a visited profile — computed
// entirely over local tables, never the network: your own user_library /
// user_lists(+items) against the social_user_list cache that
// hydrate_social_profile (social_profile.rs) wrote for that profile.
//
// Rust only does the join and the counting; the score itself (weights,
// confidence, highlights) is lib/social/taste-compatibility.ts, which is
// pure and tested. Both sides store ratings on the same DB 0-10 scale (the
// rating system — stars, /10, emoji — is display-only, see
// lib/media/rating-utils.ts), so they are normalised to 0-1 here; 0 or NULL
// is "unrated".
//
// The other user's favourites are not in the social_* tables (profile-sync
// only uploads custom lists there; per-type favourites travel in the
// profile's own `favorites` map), so the caller passes those ids in.
use crate::db::ToStringErr;
use serde::Serialize;
use std::collections::HashSet;

/// Pairs sent for scoring, most relevant first — enough for any real
/// overlap, bounded so a pathological library can't bloat the IPC payload.
const MAX_RATING_PAIRS: usize = 1000;
/// Largest disagreements always included, even past the relevance cap, so
/// the "biggest disagreement" highlight is exact.
const MAX_DISAGREEMENT_PAIRS: usize = 10;
const MAX_SHARED_FAVORITES: usize = 24;
const CHARACTER_FAV_KEY: &str = "character_fav";

#[derive(Debug, Serialize, PartialEq)]
pub struct RatingPair {
    pub external_id: String,
    /// Viewer's rating, 0-1.
    pub own: f64,
    /// Visited user's rating, 0-1.
    pub their: f64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct TasteCompatibilityData {
    /// Your works that are completed or rated.
    pub own_engaged: i64,
    /// Their works that are completed or rated.
    pub their_engaged: i64,
    /// Works in both libraries, any status.
    pub shared_works: i64,
    pub shared_completed: i64,
    /// Works completed-or-rated on both sides (the overlap numerator).
    pub shared_engaged: i64,
    pub both_rated: i64,
    /// Mean |own - their| over every both-rated work, 0-1.
    pub mean_abs_diff: Option<f64>,
    pub rating_pairs: Vec<RatingPair>,
    /// Works in both users' favourites, in your own favourites order.
    pub shared_favorites: Vec<String>,
    pub shared_favorites_total: i64,
}

#[tauri::command]
pub async fn get_taste_compatibility(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
    their_favorite_ids: Vec<String>,
) -> Result<TasteCompatibilityData, String> {
    let conn = state.conn.lock().str_err()?;
    load_taste_compatibility(&conn, &social_user_id, &their_favorite_ids)
}

const ENGAGED_OWN: &str = "(ul.status = 'completed' OR ul.rating > 0)";
const ENGAGED_THEIR: &str = "(sl.status = 'completed' OR sl.rating > 0)";
const NOT_BLOCKED: &str = "NOT IN (SELECT external_id FROM blocked_media_catalog)";

pub(crate) fn load_taste_compatibility(
    conn: &rusqlite::Connection,
    social_user_id: &str,
    their_favorite_ids: &[String],
) -> Result<TasteCompatibilityData, String> {
    let own_engaged: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM user_library ul WHERE {ENGAGED_OWN} AND ul.external_id {NOT_BLOCKED}"),
        [], |r| r.get(0),
    ).str_err()?;
    let their_engaged: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM social_user_list sl
                  WHERE sl.social_user_id = ?1 AND {ENGAGED_THEIR} AND sl.external_id {NOT_BLOCKED}"),
        [social_user_id], |r| r.get(0),
    ).str_err()?;

    let join = format!(
        "FROM user_library ul
         JOIN social_user_list sl ON sl.external_id = ul.external_id AND sl.social_user_id = ?1
         WHERE ul.external_id {NOT_BLOCKED}"
    );
    let (shared_works, shared_completed, shared_engaged, both_rated, mean_abs_diff) = conn.query_row(
        &format!(
            "SELECT COUNT(*),
                    COALESCE(SUM(ul.status = 'completed' AND sl.status = 'completed'), 0),
                    COALESCE(SUM({ENGAGED_OWN} AND {ENGAGED_THEIR}), 0),
                    COALESCE(SUM(ul.rating > 0 AND sl.rating > 0), 0),
                    AVG(CASE WHEN ul.rating > 0 AND sl.rating > 0
                             THEN ABS(MIN(ul.rating, 10.0) - MIN(sl.rating, 10.0)) / 10.0 END)
             {join}"
        ),
        [social_user_id],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, Option<f64>>(4)?)),
    ).str_err()?;

    // Relevance: works both rated highly first (they drive the "both loved"
    // row and weigh most in the score), then the biggest disagreements.
    let pair_query = |order: &str, limit: usize| -> Result<Vec<RatingPair>, String> {
        let mut stmt = conn.prepare(&format!(
            "SELECT ul.external_id, MIN(ul.rating, 10.0) / 10.0, MIN(sl.rating, 10.0) / 10.0
             {join} AND ul.rating > 0 AND sl.rating > 0
             ORDER BY {order}, ul.external_id
             LIMIT {limit}"
        )).str_err()?;
        let rows = stmt.query_map([social_user_id], |r| Ok(RatingPair {
            external_id: r.get(0)?,
            own: r.get(1)?,
            their: r.get(2)?,
        })).str_err()?.filter_map(|r| r.ok()).collect();
        Ok(rows)
    };
    let mut rating_pairs = pair_query("(ul.rating + sl.rating) DESC", MAX_RATING_PAIRS)?;
    let mut seen: HashSet<String> = rating_pairs.iter().map(|p| p.external_id.clone()).collect();
    for pair in pair_query("ABS(ul.rating - sl.rating) DESC", MAX_DISAGREEMENT_PAIRS)? {
        if seen.insert(pair.external_id.clone()) {
            rating_pairs.push(pair);
        }
    }

    let theirs: HashSet<&str> = their_favorite_ids.iter().map(String::as_str).collect();
    let mut stmt = conn.prepare(&format!(
        "SELECT uli.external_id
         FROM user_list_items uli
         JOIN user_lists l ON l.key = uli.list_key
         WHERE l.is_fav = 1 AND uli.list_key <> ?1 AND uli.external_id {NOT_BLOCKED}
         ORDER BY uli.list_key, uli.position"
    )).str_err()?;
    let own_favorites: Vec<String> = stmt.query_map([CHARACTER_FAV_KEY], |r| r.get(0))
        .str_err()?.filter_map(|r| r.ok()).collect();
    let mut fav_seen: HashSet<&str> = HashSet::new();
    let shared_all: Vec<String> = own_favorites.iter()
        .filter(|id| theirs.contains(id.as_str()) && fav_seen.insert(id.as_str()))
        .cloned()
        .collect();
    let shared_favorites_total = shared_all.len() as i64;
    let shared_favorites = shared_all.into_iter().take(MAX_SHARED_FAVORITES).collect();

    Ok(TasteCompatibilityData {
        own_engaged,
        their_engaged,
        shared_works,
        shared_completed,
        shared_engaged,
        both_rated,
        mean_abs_diff,
        rating_pairs,
        shared_favorites,
        shared_favorites_total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(conn: &rusqlite::Connection) {
        // Own library: (id, status, rating)
        for (id, status, rating) in [
            ("anime:1", "completed", Some(9.0)),
            ("anime:2", "completed", Some(4.0)),
            ("anime:3", "planning", None),
            ("anime:4", "watching", Some(10.0)),
            ("anime:5", "completed", None),
            ("anime:9", "completed", Some(8.0)), // blocked below
            ("manga:1", "completed", Some(7.0)), // only yours
        ] {
            conn.execute(
                "INSERT INTO user_library (external_id, status, rating, type, user_id) VALUES (?1, ?2, ?3, 'anime', 'me')",
                rusqlite::params![id, status, rating],
            ).unwrap();
        }
        // Theirs (plus another visited user whose rows must never leak in).
        for (user, id, status, rating) in [
            ("u1", "anime:1", "completed", Some(10.0)),
            ("u1", "anime:2", "completed", Some(10.0)),
            ("u1", "anime:3", "completed", Some(6.0)),
            ("u1", "anime:4", "watching", Some(0.0)), // 0 = unrated
            ("u1", "anime:5", "completed", None),
            ("u1", "anime:9", "completed", Some(8.0)),
            ("u1", "movie:1", "completed", Some(5.0)), // only theirs
            ("u2", "anime:4", "completed", Some(1.0)),
        ] {
            conn.execute(
                "INSERT INTO social_user_list (social_user_id, external_id, status, rating) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![user, id, status, rating],
            ).unwrap();
        }
        conn.execute(
            "INSERT INTO media_catalog (id, external_id, type, title_main, blocked_at) VALUES ('anime:9', 'anime:9', 'anime', 'Blocked', '2026-01-01')",
            [],
        ).unwrap();
        for key in ["anime_fav", "multimedia_fav", "character_fav"] {
            conn.execute("INSERT OR IGNORE INTO user_lists (key, is_fav) VALUES (?1, 1)", [key]).unwrap();
        }
        conn.execute("INSERT INTO user_lists (key, is_fav) VALUES ('custom', 0)", []).unwrap();
        for (key, id, pos) in [
            ("anime_fav", "anime:2", 0),
            ("anime_fav", "anime:1", 1),
            ("multimedia_fav", "anime:1", 0), // same work in two fav lists
            ("character_fav", "character:7", 0),
            ("custom", "anime:5", 0),
        ] {
            conn.execute(
                "INSERT INTO user_list_items (list_key, external_id, position) VALUES (?1, ?2, ?3)",
                rusqlite::params![key, id, pos],
            ).unwrap();
        }
    }

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn counts_join_on_external_id_scoped_to_one_user() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        let data = load_taste_compatibility(&conn, "u1", &[]).unwrap();

        assert_eq!(data.own_engaged, 5); // anime:1,2,4,5 + manga:1 (anime:9 blocked)
        assert_eq!(data.their_engaged, 5); // anime:1,2,3,5 + movie:1
        assert_eq!(data.shared_works, 5); // anime:1..5
        assert_eq!(data.shared_completed, 3); // anime:1,2,5
        assert_eq!(data.shared_engaged, 3); // anime:1,2,5 (anime:3 planning+unrated for you, anime:4 unrated for them)
        assert_eq!(data.both_rated, 2); // anime:1, anime:2
        let diff = data.mean_abs_diff.unwrap();
        assert!((diff - 0.35).abs() < 1e-9, "{diff}"); // (0.1 + 0.6) / 2

        assert_eq!(data.rating_pairs, vec![
            RatingPair { external_id: "anime:1".into(), own: 0.9, their: 1.0 },
            RatingPair { external_id: "anime:2".into(), own: 0.4, their: 1.0 },
        ]);
    }

    #[test]
    fn shared_favorites_skip_characters_and_duplicates() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        let theirs = ids(&["anime:1", "character:7", "anime:5", "anime:2"]);
        let data = load_taste_compatibility(&conn, "u1", &theirs).unwrap();
        assert_eq!(data.shared_favorites, ids(&["anime:2", "anime:1"]));
        assert_eq!(data.shared_favorites_total, 2);
    }

    #[test]
    fn unknown_user_yields_zero_overlap() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        seed(&conn);
        let data = load_taste_compatibility(&conn, "nobody", &[]).unwrap();
        assert_eq!((data.their_engaged, data.shared_works, data.both_rated), (0, 0, 0));
        assert_eq!(data.mean_abs_diff, None);
        assert!(data.rating_pairs.is_empty() && data.shared_favorites.is_empty());
    }

    #[test]
    fn disagreements_survive_the_relevance_cap() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        for i in 0..(MAX_RATING_PAIRS + 5) {
            let id = format!("anime:{i}");
            conn.execute("INSERT INTO user_library (external_id, status, rating, type, user_id) VALUES (?1, 'completed', 9, 'anime', 'me')", [&id]).unwrap();
            conn.execute("INSERT INTO social_user_list (social_user_id, external_id, status, rating) VALUES ('u1', ?1, 'completed', 9)", [&id]).unwrap();
        }
        conn.execute("INSERT INTO user_library (external_id, status, rating, type, user_id) VALUES ('game:1', 'completed', 10, 'game', 'me')", []).unwrap();
        conn.execute("INSERT INTO social_user_list (social_user_id, external_id, status, rating) VALUES ('u1', 'game:1', 'completed', 1)", []).unwrap();

        let data = load_taste_compatibility(&conn, "u1", &[]).unwrap();
        assert_eq!(data.both_rated, MAX_RATING_PAIRS as i64 + 6);
        assert!(data.rating_pairs.iter().any(|p| p.external_id == "game:1"));
        assert!(data.rating_pairs.len() <= MAX_RATING_PAIRS + MAX_DISAGREEMENT_PAIRS);
    }
}
