// Local cache of OTHER users' downloaded profile data (library, activity,
// monthly history, custom lists) — never your own. Keeps a visited profile's
// server snapshot in the same relational shape your own data lives in
// (mirrors user_library/user_activity/monthly_history/user_lists/
// user_list_items) instead of re-parsing a raw JSON blob on every render,
// so it can reuse the same card/list rendering as your own library.
//
// hydrate_social_profile does a full replace (DELETE + re-INSERT) scoped to
// one social_user_id every time it's called — the caller (profile-sync.ts's
// UserProfileView flow) gates how often that happens (once a day per
// visited profile), not this module. The library rows carry the owner's
// real time spent, second rating, re-runs and chosen cover when their app
// synced them (None otherwise), and the activity rows every journey kind
// (start / progress / complete + occurrence), not only completions.
//
// Every read here resolves title/cover/type via a LEFT JOIN against YOUR
// OWN media_catalog/characters — that's the single source of truth for
// what a title looks like, same as user_lists.rs's get_list_items_full_light.
// An entry you don't have locally still comes back (rating/dates/notes are
// still real, useful data), just with title/cover as None — the frontend
// falls back to the bare external_id ("anime:12345") until your own catalog
// catches up (a resync, or you add that title yourself), at which point the
// exact same cached row resolves correctly next render — no re-fetch needed.
use crate::db::ToStringErr;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Deserialize)]
pub struct SocialLibraryInput {
    pub external_id: String,
    pub rating: Option<f64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub notes: Option<String>,
    // Matches LibraryEntry.tags (frontend/src/lib/tauri/library.ts) — a real
    // JS string[], not a flat string. This used to be typed Option<String>,
    // which made Tauri's argument deserialization fail outright (silently,
    // via hydrateIfStale's own .catch) for any profile whose synced library
    // had real tags on any item — the whole hydrate_social_profile call
    // never ran, leaving social_user_list empty for that profile.
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub progress: Option<f64>,
    // Synced by apps with the profile-parity sync; absent (None) for a
    // profile an older app uploaded — the frontend keeps its estimates then.
    #[serde(default)]
    pub rating_2: Option<f64>,
    #[serde(default)]
    pub progress_2: Option<f64>,
    #[serde(default)]
    pub minutes_spent: Option<f64>,
    #[serde(default)]
    pub reconsumption_count: Option<i64>,
    #[serde(default)]
    pub reconsuming: Option<i64>,
    /// The owner's chosen cover for this work (their cover preference).
    #[serde(default)]
    pub preferred_cover: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SocialActivityInput {
    #[serde(rename = "externalId")]
    pub external_id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(rename = "mediaType")]
    pub media_type: Option<String>,
    pub date: Option<String>,
    pub timestamp: String,
    #[serde(rename = "progressStart")]
    pub progress_start: Option<i64>,
    #[serde(rename = "progressEnd")]
    pub progress_end: Option<i64>,
    /// Which completion a 'complete' event is (1 = first, 2 = first re-run...).
    #[serde(default)]
    pub occurrence: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct SocialListInput {
    pub key: String,
    pub name: String,
    pub description: String,
    pub is_fav: bool,
    pub items: Vec<String>, // ordered external_ids
}

#[derive(Debug, Serialize)]
pub struct SocialLibraryItem {
    pub external_id: String,
    pub rating: Option<f64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<String>,
    pub progress: Option<f64>,
    pub rating_2: Option<f64>,
    pub progress_2: Option<f64>,
    pub minutes_spent: Option<f64>,
    pub reconsumption_count: Option<i64>,
    pub reconsuming: Option<i64>,
    pub preferred_cover: Option<String>,
    pub title_main: Option<String>,
    pub cover_url: Option<String>,
    pub media_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SocialActivityItem {
    pub external_id: String,
    pub event_type: String,
    pub media_type: Option<String>,
    pub date: Option<String>,
    pub timestamp: String,
    pub progress_start: Option<i64>,
    pub progress_end: Option<i64>,
    pub occurrence: Option<i64>,
    pub title_main: Option<String>,
    pub cover_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SocialMediaRef {
    pub external_id: String,
    pub title_main: Option<String>,
    pub cover_url: Option<String>,
    pub media_type: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SocialMonthGroup {
    pub month: String,
    pub items: Vec<SocialMediaRef>,
}

#[derive(Debug, Serialize)]
pub struct SocialListInfo {
    pub key: String,
    pub name: String,
    pub description: String,
    pub is_fav: bool,
    pub item_count: i64,
}

// Arity is dictated by the frontend `invoke("hydrate_social_profile", …)` contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn hydrate_social_profile(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
    library: Vec<SocialLibraryInput>,
    activity: Vec<SocialActivityInput>,
    monthly_history: std::collections::HashMap<String, Vec<String>>,
    lists: Vec<SocialListInput>,
    // Their like / interest / dislike character lists; None = not shared.
    character_reactions: Option<crate::character_reactions::SocialCharacterReactionsInput>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    hydrate(&mut conn, &social_user_id, &library, &activity, &monthly_history, &lists)?;
    crate::character_reactions::hydrate_social(&mut conn, &social_user_id, character_reactions.as_ref())
}

pub(crate) fn hydrate(
    conn: &mut rusqlite::Connection,
    social_user_id: &str,
    library: &[SocialLibraryInput],
    activity: &[SocialActivityInput],
    monthly_history: &std::collections::HashMap<String, Vec<String>>,
    lists: &[SocialListInput],
) -> Result<(), String> {
    let tx = conn.transaction().str_err()?;

    tx.execute("DELETE FROM social_user_list WHERE social_user_id = ?1", [social_user_id]).str_err()?;
    for item in library {
        // JSON-encoded, matching user_library.rs's own tags column — this is
        // a Vec<String>, not a flat string.
        let tags_json = item.tags.as_ref().map(|t| serde_json::to_string(t).unwrap_or_default());
        tx.execute(
            "INSERT OR IGNORE INTO social_user_list
             (social_user_id, external_id, rating, started_at, finished_at, notes, tags, status, progress,
              rating_2, progress_2, minutes_spent, reconsumption_count, reconsuming, preferred_cover)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            rusqlite::params![
                social_user_id, item.external_id, item.rating,
                item.started_at, item.finished_at, item.notes, tags_json,
                item.status, item.progress,
                item.rating_2, item.progress_2, item.minutes_spent,
                item.reconsumption_count, item.reconsuming, item.preferred_cover,
            ],
        ).str_err()?;
    }

    tx.execute("DELETE FROM social_user_activity WHERE social_user_id = ?1", [social_user_id]).str_err()?;
    for event in activity {
        tx.execute(
            "INSERT OR IGNORE INTO social_user_activity
             (social_user_id, external_id, media_type, event_type, progress_start, progress_end, date, timestamp, occurrence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                social_user_id, event.external_id, event.media_type, event.event_type,
                event.progress_start, event.progress_end, event.date, event.timestamp, event.occurrence,
            ],
        ).str_err()?;
    }

    tx.execute("DELETE FROM social_monthly_history WHERE social_user_id = ?1", [social_user_id]).str_err()?;
    for (month, ids) in monthly_history {
        for (pos, id) in ids.iter().enumerate() {
            tx.execute(
                "INSERT OR IGNORE INTO social_monthly_history (social_user_id, external_id, month, position)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![social_user_id, id, month, pos as i64],
            ).str_err()?;
        }
    }

    tx.execute("DELETE FROM social_user_list_items WHERE social_user_id = ?1", [social_user_id]).str_err()?;
    tx.execute("DELETE FROM social_user_lists WHERE social_user_id = ?1", [social_user_id]).str_err()?;
    for list in lists {
        tx.execute(
            "INSERT OR IGNORE INTO social_user_lists (social_user_id, key, name, description, is_fav)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![social_user_id, list.key, list.name, list.description, list.is_fav as i64],
        ).str_err()?;
        for (pos, id) in list.items.iter().enumerate() {
            tx.execute(
                "INSERT OR IGNORE INTO social_user_list_items (social_user_id, list_key, external_id, position)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![social_user_id, list.key, id, pos as i64],
            ).str_err()?;
        }
    }

    tx.commit().str_err()
}

// Every `_light` read below returns a character portrait's file path in
// cover_url (wrap with wrapAssetUrl on the frontend — see
// image_storage::resolve_reference_path), never its bytes as a base64 data
// URL. Media covers are remote URLs and come back untouched.
fn app_data_dir(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app_handle.path().app_data_dir().str_err()
}

#[tauri::command]
pub async fn get_social_library_light(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
) -> Result<Vec<SocialLibraryItem>, String> {
    let mut items = {
        let conn = state.conn.lock().str_err()?;
        load_social_library(&conn, &social_user_id)?
    };
    let data_dir = app_data_dir(&app_handle)?;
    for item in &mut items {
        item.cover_url = crate::image_storage::resolve_image_path_value(&data_dir, item.cover_url.take())?;
    }
    Ok(items)
}

pub(crate) fn load_social_library(
    conn: &rusqlite::Connection,
    social_user_id: &str,
) -> Result<Vec<SocialLibraryItem>, String> {
    let mut stmt = conn.prepare(
        "SELECT sl.external_id, sl.rating, sl.started_at, sl.finished_at, sl.notes, sl.tags,
                sl.status, sl.progress,
                COALESCE(mc.title_main, c.name), COALESCE(mc.cover_url, c.image_url), mc.type,
                sl.rating_2, sl.progress_2, sl.minutes_spent, sl.reconsumption_count, sl.reconsuming,
                sl.preferred_cover
         FROM social_user_list sl
         LEFT JOIN media_catalog mc ON mc.external_id = sl.external_id
         LEFT JOIN characters c ON c.external_id = sl.external_id
         WHERE sl.social_user_id = ?1
           AND sl.external_id NOT IN (SELECT external_id FROM blocked_media_catalog)
         ORDER BY sl.finished_at DESC"
    ).str_err()?;

    let collected = stmt.query_map([social_user_id], |r| {
        let tags_json: Option<String> = r.get(5)?;
        Ok(SocialLibraryItem {
            external_id: r.get(0)?,
            rating:      r.get(1)?,
            started_at:  r.get(2)?,
            finished_at: r.get(3)?,
            notes:       r.get(4)?,
            tags:        tags_json.as_deref().and_then(|s| serde_json::from_str(s).ok()),
            status:      r.get(6)?,
            progress:    r.get(7)?,
            title_main:  r.get(8)?,
            cover_url:   r.get(9)?,
            media_type:  r.get(10)?,
            rating_2:            r.get(11)?,
            progress_2:          r.get(12)?,
            minutes_spent:       r.get(13)?,
            reconsumption_count: r.get(14)?,
            reconsuming:         r.get(15)?,
            preferred_cover:     r.get(16)?,
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();
    Ok(collected)
}

#[tauri::command]
pub async fn get_social_activity_light(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
) -> Result<Vec<SocialActivityItem>, String> {
    let mut items = {
        let conn = state.conn.lock().str_err()?;
        load_social_activity(&conn, &social_user_id)?
    };
    let data_dir = app_data_dir(&app_handle)?;
    for item in &mut items {
        item.cover_url = crate::image_storage::resolve_image_path_value(&data_dir, item.cover_url.take())?;
    }
    Ok(items)
}

pub(crate) fn load_social_activity(
    conn: &rusqlite::Connection,
    social_user_id: &str,
) -> Result<Vec<SocialActivityItem>, String> {
    let mut stmt = conn.prepare(
        "SELECT sa.external_id, sa.event_type, sa.media_type, sa.date, sa.timestamp,
                sa.progress_start, sa.progress_end,
                COALESCE(mc.title_main, c.name), COALESCE(mc.cover_url, c.image_url), sa.occurrence
         FROM social_user_activity sa
         LEFT JOIN media_catalog mc ON mc.external_id = sa.external_id
         LEFT JOIN characters c ON c.external_id = sa.external_id
         WHERE sa.social_user_id = ?1
           AND sa.external_id NOT IN (SELECT external_id FROM blocked_media_catalog)
         ORDER BY sa.timestamp DESC"
    ).str_err()?;

    let collected = stmt.query_map([social_user_id], |r| {
        Ok(SocialActivityItem {
            external_id:    r.get(0)?,
            event_type:     r.get(1)?,
            media_type:     r.get(2)?,
            date:           r.get(3)?,
            timestamp:      r.get(4)?,
            progress_start: r.get(5)?,
            progress_end:   r.get(6)?,
            title_main:     r.get(7)?,
            cover_url:      r.get(8)?,
            occurrence:     r.get(9)?,
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();
    Ok(collected)
}

#[tauri::command]
pub async fn get_social_monthly_history_light(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
) -> Result<Vec<SocialMonthGroup>, String> {
    let mut result = {
        let conn = state.conn.lock().str_err()?;
        load_social_monthly_history(&conn, &social_user_id)?
    };
    let data_dir = app_data_dir(&app_handle)?;
    for group in &mut result {
        for item in &mut group.items {
            item.cover_url = crate::image_storage::resolve_image_path_value(&data_dir, item.cover_url.take())?;
        }
    }
    Ok(result)
}

pub(crate) fn load_social_monthly_history(
    conn: &rusqlite::Connection,
    social_user_id: &str,
) -> Result<Vec<SocialMonthGroup>, String> {
    struct Row { month: String, item: SocialMediaRef }
    let rows: Vec<Row> = {
    let mut stmt = conn.prepare(
        "SELECT smh.month, smh.external_id,
                COALESCE(mc.title_main, c.name), COALESCE(mc.cover_url, c.image_url), mc.type
         FROM social_monthly_history smh
         LEFT JOIN media_catalog mc ON mc.external_id = smh.external_id
         LEFT JOIN characters c ON c.external_id = smh.external_id
         WHERE smh.social_user_id = ?1
           AND smh.external_id NOT IN (SELECT external_id FROM blocked_media_catalog)
         ORDER BY smh.month DESC, smh.position"
    ).str_err()?;

    let collected = stmt.query_map([social_user_id], |r| Ok(Row {
        month: r.get(0)?,
        item: SocialMediaRef {
            external_id: r.get(1)?,
            title_main:  r.get(2)?,
            cover_url:   r.get(3)?,
            media_type:  r.get(4)?,
        },
    })).str_err()?.filter_map(|r| r.ok()).collect();
    collected
    };

    let mut result: Vec<SocialMonthGroup> = Vec::new();
    for row in rows {
        if let Some(last) = result.last_mut() {
            if last.month == row.month { last.items.push(row.item); continue; }
        }
        result.push(SocialMonthGroup { month: row.month, items: vec![row.item] });
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_social_lists(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
) -> Result<Vec<SocialListInfo>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT sul.key, sul.name, sul.description, sul.is_fav,
                (SELECT COUNT(*) FROM social_user_list_items sli
                 WHERE sli.social_user_id = sul.social_user_id AND sli.list_key = sul.key
                   AND sli.external_id NOT IN (SELECT external_id FROM blocked_media_catalog))
         FROM social_user_lists sul
         WHERE sul.social_user_id = ?1
         ORDER BY sul.is_fav DESC, sul.key"
    ).str_err()?;

    let items: Vec<SocialListInfo> = stmt.query_map([&social_user_id], |r| {
        Ok(SocialListInfo {
            key:         r.get(0)?,
            name:        r.get(1)?,
            description: r.get(2)?,
            is_fav:      r.get::<_, i64>(3)? != 0,
            item_count:  r.get(4)?,
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();

    Ok(items)
}

#[tauri::command]
pub async fn get_social_list_items_light(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
    list_key: String,
) -> Result<Vec<SocialMediaRef>, String> {
    let mut items = {
        let conn = state.conn.lock().str_err()?;
        load_social_list_items(&conn, &social_user_id, &list_key)?
    };
    let data_dir = app_data_dir(&app_handle)?;
    for item in &mut items {
        item.cover_url = crate::image_storage::resolve_image_path_value(&data_dir, item.cover_url.take())?;
    }
    Ok(items)
}

pub(crate) fn load_social_list_items(
    conn: &rusqlite::Connection,
    social_user_id: &str,
    list_key: &str,
) -> Result<Vec<SocialMediaRef>, String> {
    let mut stmt = conn.prepare(
        "SELECT sli.external_id,
                COALESCE(mc.title_main, c.name), COALESCE(mc.cover_url, c.image_url), mc.type
         FROM social_user_list_items sli
         LEFT JOIN media_catalog mc ON mc.external_id = sli.external_id
         LEFT JOIN characters c ON c.external_id = sli.external_id
         WHERE sli.social_user_id = ?1 AND sli.list_key = ?2
           AND sli.external_id NOT IN (SELECT external_id FROM blocked_media_catalog)
         ORDER BY sli.position"
    ).str_err()?;

    let collected = stmt.query_map(rusqlite::params![social_user_id, list_key], |r| {
        Ok(SocialMediaRef {
            external_id: r.get(0)?,
            title_main:  r.get(1)?,
            cover_url:   r.get(2)?,
            media_type:  r.get(3)?,
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();
    Ok(collected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn library_input(json: &str) -> SocialLibraryInput {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn hydrate_round_trips_the_parity_fields() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();
        let library = vec![
            library_input(
                r#"{"external_id":"game:1","rating":8,"started_at":null,"finished_at":"2026-09-01","notes":null,
                    "tags":["rpg"],"status":"completed","progress":12,"rating_2":7.5,"progress_2":0,
                    "minutes_spent":750,"reconsumption_count":1,"reconsuming":0,
                    "preferred_cover":"https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg"}"#,
            ),
            // What an older app's profile carries: none of the new keys.
            library_input(
                r#"{"external_id":"anime:5","rating":null,"started_at":null,"finished_at":null,"notes":null,
                    "tags":null,"status":"watching","progress":3}"#,
            ),
        ];
        let activity: Vec<SocialActivityInput> = serde_json::from_str(
            r#"[
                {"externalId":"game:1","type":"start","mediaType":"game","date":"2026-09-01","timestamp":"2026-09-01T10:00:00Z"},
                {"externalId":"game:1","type":"complete","mediaType":"game","date":"2026-09-01","timestamp":"2026-09-01T10:00:00Z","occurrence":2},
                {"externalId":"anime:5","type":"progress","mediaType":"anime","date":"2026-09-03","timestamp":"2026-09-03T20:00:00Z","progressStart":1,"progressEnd":3}
            ]"#,
        ).unwrap();

        hydrate(&mut conn, "alice", &library, &activity, &HashMap::new(), &[]).unwrap();

        let mut items = load_social_library(&conn, "alice").unwrap();
        items.sort_by(|a, b| a.external_id.cmp(&b.external_id));
        let game = &items[1];
        assert_eq!(game.external_id, "game:1");
        assert_eq!(game.minutes_spent, Some(750.0));
        assert_eq!(game.rating_2, Some(7.5));
        assert_eq!(game.reconsumption_count, Some(1));
        assert_eq!(game.reconsuming, Some(0));
        assert_eq!(game.tags.as_deref(), Some(&["rpg".to_string()][..]));
        assert_eq!(
            game.preferred_cover.as_deref(),
            Some("https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg"),
        );
        let anime = &items[0];
        assert_eq!((anime.minutes_spent, anime.rating_2, anime.preferred_cover.as_deref()), (None, None, None));

        // A start and a completion logged in the same second both survive.
        let events = load_social_activity(&conn, "alice").unwrap();
        let mut kinds: Vec<(&str, Option<i64>)> = events.iter().map(|e| (e.event_type.as_str(), e.occurrence)).collect();
        kinds.sort();
        assert_eq!(kinds, vec![("complete", Some(2)), ("progress", None), ("start", None)]);

        // A re-hydrate fully replaces this profile's rows.
        hydrate(&mut conn, "alice", &library[1..], &[], &HashMap::new(), &[]).unwrap();
        assert_eq!(load_social_library(&conn, "alice").unwrap().len(), 1);
        assert!(load_social_activity(&conn, "alice").unwrap().is_empty());
    }
}
