use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

const FAV_MAP: &[(&str, &str)] = &[
    ("anime",      "anime_fav"),
    ("manga",      "manga_fav"),
    ("multimedia", "multimedia_fav"),
    ("game",       "game_fav"),
    ("vnovel",     "vnovel_fav"),
    ("novel",      "lnovel_fav"),
    ("series",     "series_fav"),
    ("movie",      "movie_fav"),
    ("book",       "book_fav"),
    ("character",  "character_fav"),
];

pub fn type_to_fav_key(t: &str) -> String {
    FAV_MAP.iter().find(|(k, _)| *k == t)
        .map(|(_, v)| v.to_string())
        .unwrap_or_else(|| format!("{}_fav", t))
}

fn fav_key_to_type(k: &str) -> String {
    FAV_MAP.iter().find(|(_, v)| *v == k)
        .map(|(t, _)| t.to_string())
        .unwrap_or_else(|| k.strip_suffix("_fav").unwrap_or(k).to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListInfo {
    pub key:         String,
    pub name:        String,
    pub description: String,
    pub is_fav:      bool,
    pub item_count:  i64,
    pub preview_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListItemFull {
    pub external_id: String,
    pub position:    i64,
    pub library_id:  Option<String>,
    pub status:      Option<String>,
    pub rating:      Option<f64>,
    pub progress:    f64,
    pub progress_2:  f64,
    pub is_favorite: bool,
    pub is_platinum: bool,
    pub title_main:  Option<String>,
    pub cover_url:   Option<String>,
    pub media_type:  Option<String>,
    pub format:      Option<String>,
}

// ── Favorites ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn read_user_favorites(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<String, String> {
    let conn = state.conn.lock().str_err()?;
    let mut result = serde_json::Map::new();

    // Initialize all known types with empty arrays
    for (type_name, _) in FAV_MAP {
        result.insert(type_name.to_string(), serde_json::json!([]));
    }

    let mut stmt = conn.prepare(
        "SELECT l.key, i.external_id
         FROM user_lists l
         JOIN user_list_items i ON i.list_key = l.key
         WHERE l.is_fav = 1
         ORDER BY l.key, i.position",
    ).str_err()?;

    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .str_err()?;

    for row in rows.flatten() {
        let type_name = fav_key_to_type(&row.0);
        let arr = result.entry(type_name).or_insert_with(|| serde_json::json!([]));
        if let Some(a) = arr.as_array_mut() {
            a.push(serde_json::Value::String(row.1));
        }
    }

    serde_json::to_string(&result).str_err()
}

#[tauri::command]
pub async fn write_user_favorites(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    content: String,
) -> Result<(), String> {
    let favs: serde_json::Value = serde_json::from_str(&content).str_err()?;
    let obj = favs.as_object().ok_or("Expected JSON object")?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;

    for (type_name, ids_val) in obj {
        let fav_key = type_to_fav_key(type_name);
        let ids: Vec<String> = ids_val
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        conn.execute("DELETE FROM user_list_items WHERE list_key = ?1", [&fav_key])
            .str_err()?;

        for (pos, id) in ids.iter().enumerate() {
            conn.execute(
                "INSERT OR IGNORE INTO user_list_items (list_key, external_id, position, added_at)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![fav_key, id, pos as i64, now],
            ).str_err()?;
        }
    }

    Ok(())
}

// ── Custom lists ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_all_user_lists(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<ListInfo>, String> {
    let conn = state.conn.lock().str_err()?;

    // Both the count and the top-4 preview are correlated subqueries instead
    // of a second prepared statement per list (was N+1 — one extra
    // roundtrip through Rust/SQLite per list on every Lists-tab load).
    // idx_user_list_items_list_key_position (db.rs) makes both an index
    // range scan instead of a full-table scan per row.
    let mut stmt = conn.prepare(
        "SELECT l.key, l.name, l.description, l.is_fav,
                (SELECT COUNT(*) FROM user_list_items i WHERE i.list_key = l.key) AS item_count,
                (SELECT GROUP_CONCAT(external_id, ',') FROM (
                    SELECT external_id FROM user_list_items
                    WHERE list_key = l.key ORDER BY position LIMIT 4
                 )) AS preview_csv
         FROM user_lists l
         ORDER BY l.is_fav DESC, l.created_at ASC",
    ).str_err()?;

    let rows: Vec<(String, String, String, bool, i64, Option<String>)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)? != 0,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();

    let result = rows
        .into_iter()
        .map(|(key, name, description, is_fav, item_count, preview_csv)| {
            let preview_ids = preview_csv
                .map(|csv| csv.split(',').map(String::from).collect())
                .unwrap_or_default();
            ListInfo { key, name, description, is_fav, item_count, preview_ids }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_list_items_full(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
) -> Result<Vec<ListItemFull>, String> {
    let conn = state.conn.lock().str_err()?;
    // Single SQL JOIN — everything is in metadea.db. Characters never have a
    // media_catalog row (that table is media only — see save_character), so
    // their title/cover are resolved from the characters table instead via
    // COALESCE; media_type/format stay null for them either way since
    // "character" isn't a media type.
    let mut stmt = conn.prepare(
        "SELECT
            li.external_id, li.position,
            ul.id, ul.status, ul.rating,
            COALESCE(ul.progress, 0.0), COALESCE(ul.progress_2, 0.0),
            COALESCE(ul.is_favorite, 0), COALESCE(ul.is_platinum, 0),
            COALESCE(mc.title_main, c.name), COALESCE(mc.cover_url, c.image_url),
            mc.type, mc.format
         FROM user_list_items li
         LEFT JOIN user_library ul ON ul.external_id = li.external_id
         LEFT JOIN media_catalog mc ON mc.external_id = li.external_id
         LEFT JOIN characters c ON c.external_id = li.external_id
         WHERE li.list_key = ?1
         ORDER BY li.position"
    ).str_err()?;

    let items: Vec<ListItemFull> = stmt.query_map([&list_key], |r| {
        Ok(ListItemFull {
            external_id: r.get(0)?,
            position:    r.get(1)?,
            library_id:  r.get(2)?,
            status:      r.get(3)?,
            rating:      r.get(4)?,
            progress:    r.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
            progress_2:  r.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
            is_favorite: r.get::<_, i64>(7)? != 0,
            is_platinum: r.get::<_, i64>(8)? != 0,
            title_main:  r.get(9)?,
            cover_url:   r.get(10)?,
            media_type:  r.get(11)?,
            format:      r.get(12)?,
        })
    }).str_err()?.filter_map(|r| r.ok()).collect();

    Ok(items)
}

#[tauri::command]
pub async fn get_list_items(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT external_id FROM user_list_items WHERE list_key = ?1 ORDER BY position",
    ).str_err()?;
    let items: Vec<String> = stmt
        .query_map([&list_key], |r| r.get(0))
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

#[tauri::command]
pub async fn create_user_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    username: String,
    name: String,
    description: String,
) -> Result<String, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    let prefix = format!("{}_", username.to_lowercase());
    let prefix_like = format!("{}%", prefix);

    let max_n: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(CAST(SUBSTR(key, ?1) AS INTEGER)), 0)
             FROM user_lists WHERE key LIKE ?2 AND is_fav = 0",
            rusqlite::params![prefix.len() as i64 + 1, prefix_like],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let key = format!("{}{}", prefix, max_n + 1);

    conn.execute(
        "INSERT INTO user_lists (key, name, description, is_fav, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        rusqlite::params![key, name, description, now],
    ).str_err()?;

    Ok(key)
}

#[tauri::command]
pub async fn update_user_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    key: String,
    name: String,
    description: String,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "UPDATE user_lists SET name = ?1, description = ?2, updated_at = ?3 WHERE key = ?4",
        rusqlite::params![name, description, now, key],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub async fn delete_user_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    key: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute("DELETE FROM user_list_items WHERE list_key = ?1", [&key])
        .str_err()?;
    conn.execute("DELETE FROM user_lists WHERE key = ?1 AND is_fav = 0", [&key])
        .str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn add_item_to_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
    external_id: String,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    // Ensure the fav list row exists
    if list_key.ends_with("_fav") {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO user_lists (key, name, is_fav) VALUES (?1, ?1, 1)",
            [&list_key],
        );
    }
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM user_list_items WHERE list_key = ?1",
            [&list_key],
            |r| r.get(0),
        )
        .unwrap_or(-1);
    conn.execute(
        "INSERT OR IGNORE INTO user_list_items (list_key, external_id, position, added_at)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![list_key, external_id, max_pos + 1, now],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub async fn remove_item_from_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "DELETE FROM user_list_items WHERE list_key = ?1 AND external_id = ?2",
        rusqlite::params![list_key, external_id],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub async fn reorder_list_items(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
    external_ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    for (pos, id) in external_ids.iter().enumerate() {
        conn.execute(
            "UPDATE user_list_items SET position = ?1 WHERE list_key = ?2 AND external_id = ?3",
            rusqlite::params![pos as i64, list_key, id],
        ).str_err()?;
    }
    Ok(())
}
