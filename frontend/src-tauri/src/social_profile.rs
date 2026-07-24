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
// visited profile), not this module.
//
// Every read here resolves title/cover/type via a LEFT JOIN against YOUR
// OWN media_catalog/characters — that's the single source of truth for
// what a title looks like, same as user_lists.rs's get_list_items_full.
// An entry you don't have locally still comes back (rating/dates/notes are
// still real, useful data), just with title/cover as None — the frontend
// falls back to the bare external_id ("anime:12345") until your own catalog
// catches up (a resync, or you add that title yourself), at which point the
// exact same cached row resolves correctly next render — no re-fetch needed.
use crate::db::ToStringErr;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct SocialLibraryInput {
    pub external_id: String,
    pub rating: Option<f64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<String>,
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
    pub tags: Option<String>,
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

#[tauri::command]
pub async fn hydrate_social_profile(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
    library: Vec<SocialLibraryInput>,
    activity: Vec<SocialActivityInput>,
    monthly_history: std::collections::HashMap<String, Vec<String>>,
    lists: Vec<SocialListInput>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;

    tx.execute("DELETE FROM social_user_list WHERE social_user_id = ?1", [&social_user_id]).str_err()?;
    for item in &library {
        tx.execute(
            "INSERT OR IGNORE INTO social_user_list
             (social_user_id, external_id, rating, started_at, finished_at, notes, tags)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                social_user_id, item.external_id, item.rating,
                item.started_at, item.finished_at, item.notes, item.tags,
            ],
        ).str_err()?;
    }

    tx.execute("DELETE FROM social_user_activity WHERE social_user_id = ?1", [&social_user_id]).str_err()?;
    for event in &activity {
        tx.execute(
            "INSERT OR IGNORE INTO social_user_activity
             (social_user_id, external_id, media_type, event_type, progress_start, progress_end, date, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                social_user_id, event.external_id, event.media_type, event.event_type,
                event.progress_start, event.progress_end, event.date, event.timestamp,
            ],
        ).str_err()?;
    }

    tx.execute("DELETE FROM social_monthly_history WHERE social_user_id = ?1", [&social_user_id]).str_err()?;
    for (month, ids) in &monthly_history {
        for (pos, id) in ids.iter().enumerate() {
            tx.execute(
                "INSERT OR IGNORE INTO social_monthly_history (social_user_id, external_id, month, position)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![social_user_id, id, month, pos as i64],
            ).str_err()?;
        }
    }

    tx.execute("DELETE FROM social_user_list_items WHERE social_user_id = ?1", [&social_user_id]).str_err()?;
    tx.execute("DELETE FROM social_user_lists WHERE social_user_id = ?1", [&social_user_id]).str_err()?;
    for list in &lists {
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

#[tauri::command]
pub async fn get_social_library(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
) -> Result<Vec<SocialLibraryItem>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT sl.external_id, sl.rating, sl.started_at, sl.finished_at, sl.notes, sl.tags,
                COALESCE(mc.title_main, c.name), COALESCE(mc.cover_url, c.image_url), mc.type
         FROM social_user_list sl
         LEFT JOIN media_catalog mc ON mc.external_id = sl.external_id
         LEFT JOIN characters c ON c.external_id = sl.external_id
         WHERE sl.social_user_id = ?1
         ORDER BY sl.finished_at DESC"
    ).str_err()?;

    let items: Vec<SocialLibraryItem> = stmt.query_map([&social_user_id], |r| {
        Ok(SocialLibraryItem {
            external_id: r.get(0)?,
            rating:      r.get(1)?,
            started_at:  r.get(2)?,
            finished_at: r.get(3)?,
            notes:       r.get(4)?,
            tags:        r.get(5)?,
            title_main:  r.get(6)?,
            cover_url:   r.get(7)?,
            media_type:  r.get(8)?,
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();

    Ok(items)
}

#[tauri::command]
pub async fn get_social_activity(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
) -> Result<Vec<SocialActivityItem>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT sa.external_id, sa.event_type, sa.media_type, sa.date, sa.timestamp,
                sa.progress_start, sa.progress_end,
                COALESCE(mc.title_main, c.name), COALESCE(mc.cover_url, c.image_url)
         FROM social_user_activity sa
         LEFT JOIN media_catalog mc ON mc.external_id = sa.external_id
         LEFT JOIN characters c ON c.external_id = sa.external_id
         WHERE sa.social_user_id = ?1
         ORDER BY sa.timestamp DESC"
    ).str_err()?;

    let items: Vec<SocialActivityItem> = stmt.query_map([&social_user_id], |r| {
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
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();

    Ok(items)
}

#[tauri::command]
pub async fn get_social_monthly_history(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
) -> Result<Vec<SocialMonthGroup>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT smh.month, smh.external_id,
                COALESCE(mc.title_main, c.name), COALESCE(mc.cover_url, c.image_url), mc.type
         FROM social_monthly_history smh
         LEFT JOIN media_catalog mc ON mc.external_id = smh.external_id
         LEFT JOIN characters c ON c.external_id = smh.external_id
         WHERE smh.social_user_id = ?1
         ORDER BY smh.month DESC, smh.position"
    ).str_err()?;

    struct Row { month: String, item: SocialMediaRef }
    let rows: Vec<Row> = stmt.query_map([&social_user_id], |r| Ok(Row {
        month: r.get(0)?,
        item: SocialMediaRef {
            external_id: r.get(1)?,
            title_main:  r.get(2)?,
            cover_url:   r.get(3)?,
            media_type:  r.get(4)?,
        },
    })).str_err()?.filter_map(|r| r.ok()).collect();

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
                 WHERE sli.social_user_id = sul.social_user_id AND sli.list_key = sul.key)
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
pub async fn get_social_list_items(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
    list_key: String,
) -> Result<Vec<SocialMediaRef>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT sli.external_id,
                COALESCE(mc.title_main, c.name), COALESCE(mc.cover_url, c.image_url), mc.type
         FROM social_user_list_items sli
         LEFT JOIN media_catalog mc ON mc.external_id = sli.external_id
         LEFT JOIN characters c ON c.external_id = sli.external_id
         WHERE sli.social_user_id = ?1 AND sli.list_key = ?2
         ORDER BY sli.position"
    ).str_err()?;

    let items: Vec<SocialMediaRef> = stmt.query_map(rusqlite::params![social_user_id, list_key], |r| {
        Ok(SocialMediaRef {
            external_id: r.get(0)?,
            title_main:  r.get(1)?,
            cover_url:   r.get(2)?,
            media_type:  r.get(3)?,
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();

    Ok(items)
}
