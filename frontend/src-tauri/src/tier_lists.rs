use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

const DEFAULT_TIERS_JSON: &str = r##"[{"id":"s","label":"S","color":"#ff7f7f"},{"id":"a","label":"A","color":"#ffbf7f"},{"id":"b","label":"B","color":"#ffdf7f"},{"id":"c","label":"C","color":"#7fff7f"},{"id":"d","label":"D","color":"#7fbfff"},{"id":"f","label":"F","color":"#bf7fff"}]"##;

#[derive(Debug, Serialize, Deserialize)]
pub struct TierDef {
    pub id:    String,
    pub label: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierListInfo {
    pub id:          String,
    pub name:        String,
    pub list_type:   String,
    pub item_count:  i64,
    pub preview_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierListItemFull {
    pub external_id: String,
    pub tier_key:    String,
    pub position:    i64,
    pub title_main:  Option<String>,
    pub cover_url:   Option<String>,
    pub media_type:  Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierListDetail {
    pub id:        String,
    pub name:      String,
    pub list_type: String,
    pub tiers:     Vec<TierDef>,
    pub items:     Vec<TierListItemFull>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierItemPlacement {
    pub external_id: String,
    pub tier_key:    String,
    pub position:    i64,
}

#[tauri::command]
pub async fn create_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    name: String,
    list_type: String,
) -> Result<String, String> {
    let id = crate::db::generate_id();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO tier_lists (id, name, list_type, tiers, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, name, list_type, DEFAULT_TIERS_JSON, now],
    ).str_err()?;
    Ok(id)
}

#[tauri::command]
pub async fn get_all_tier_lists(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<TierListInfo>, String> {
    let conn = state.conn.lock().str_err()?;

    let mut stmt = conn.prepare(
        "SELECT tl.id, tl.name, tl.list_type, COUNT(ti.external_id) AS item_count
         FROM tier_lists tl
         LEFT JOIN tier_list_items ti ON ti.tier_list_id = tl.id
         GROUP BY tl.id
         ORDER BY tl.created_at DESC",
    ).str_err()?;

    let rows: Vec<(String, String, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::new();
    for (id, name, list_type, item_count) in rows {
        let mut prev_stmt = conn.prepare(
            "SELECT external_id FROM tier_list_items
             WHERE tier_list_id = ?1 AND tier_key != 'pool'
             ORDER BY tier_key, position LIMIT 4",
        ).str_err()?;
        let preview_ids: Vec<String> = prev_stmt
            .query_map([&id], |r| r.get(0))
            .str_err()?
            .filter_map(|r| r.ok())
            .collect();
        result.push(TierListInfo { id, name, list_type, item_count, preview_ids });
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    id: String,
) -> Result<TierListDetail, String> {
    let conn = state.conn.lock().str_err()?;

    let (name, list_type, tiers_json): (String, String, String) = conn.query_row(
        "SELECT name, list_type, tiers FROM tier_lists WHERE id = ?1",
        [&id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).str_err()?;

    let tiers: Vec<TierDef> = serde_json::from_str(&tiers_json).unwrap_or_default();

    let mut stmt = conn.prepare(
        "SELECT ti.external_id, ti.tier_key, ti.position, mc.title_main, mc.cover_url, mc.type
         FROM tier_list_items ti
         LEFT JOIN media_catalog mc ON mc.external_id = ti.external_id
         WHERE ti.tier_list_id = ?1
         ORDER BY ti.tier_key, ti.position",
    ).str_err()?;

    let items: Vec<TierListItemFull> = stmt.query_map([&id], |r| {
        Ok(TierListItemFull {
            external_id: r.get(0)?,
            tier_key:    r.get(1)?,
            position:    r.get(2)?,
            title_main:  r.get(3)?,
            cover_url:   r.get(4)?,
            media_type:  r.get(5)?,
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();

    Ok(TierListDetail { id, name, list_type, tiers, items })
}

#[tauri::command]
pub async fn delete_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM tier_list_items WHERE tier_list_id = ?1", [&id])
        .str_err()?;
    conn.execute("DELETE FROM tier_lists WHERE id = ?1", [&id])
        .str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn update_tier_list_tiers(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    id: String,
    tiers: Vec<TierDef>,
) -> Result<(), String> {
    let tiers_json = serde_json::to_string(&tiers).str_err()?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "UPDATE tier_lists SET tiers = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![tiers_json, now, id],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub async fn add_item_to_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    tier_list_id: String,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    let max_pos: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) FROM tier_list_items WHERE tier_list_id = ?1 AND tier_key = 'pool'",
        [&tier_list_id],
        |r| r.get(0),
    ).unwrap_or(-1);
    conn.execute(
        "INSERT OR IGNORE INTO tier_list_items (tier_list_id, external_id, tier_key, position)
         VALUES (?1, ?2, 'pool', ?3)",
        rusqlite::params![tier_list_id, external_id, max_pos + 1],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub async fn remove_item_from_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    tier_list_id: String,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "DELETE FROM tier_list_items WHERE tier_list_id = ?1 AND external_id = ?2",
        rusqlite::params![tier_list_id, external_id],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub async fn set_tier_list_placements(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    tier_list_id: String,
    placements: Vec<TierItemPlacement>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    for p in placements {
        conn.execute(
            "UPDATE tier_list_items SET tier_key = ?1, position = ?2 WHERE tier_list_id = ?3 AND external_id = ?4",
            rusqlite::params![p.tier_key, p.position, tier_list_id, p.external_id],
        ).str_err()?;
    }
    Ok(())
}
