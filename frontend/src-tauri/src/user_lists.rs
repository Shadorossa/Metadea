use serde::{Deserialize, Serialize};

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
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
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
    ).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    for row in rows.flatten() {
        let type_name = fav_key_to_type(&row.0);
        let arr = result.entry(type_name).or_insert_with(|| serde_json::json!([]));
        if let Some(a) = arr.as_array_mut() {
            a.push(serde_json::Value::String(row.1));
        }
    }

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_user_favorites(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    content: String,
) -> Result<(), String> {
    let favs: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let obj = favs.as_object().ok_or("Expected JSON object")?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    for (type_name, ids_val) in obj {
        let fav_key = type_to_fav_key(type_name);
        let ids: Vec<String> = ids_val
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        conn.execute("DELETE FROM user_list_items WHERE list_key = ?1", [&fav_key])
            .map_err(|e| e.to_string())?;

        for (pos, id) in ids.iter().enumerate() {
            conn.execute(
                "INSERT OR IGNORE INTO user_list_items (list_key, external_id, position, added_at)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![fav_key, id, pos as i64, now],
            ).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

// ── Custom lists ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_all_user_lists(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<ListInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT l.key, l.name, l.description, l.is_fav,
                COUNT(i.external_id) AS item_count
         FROM user_lists l
         LEFT JOIN user_list_items i ON i.list_key = l.key
         GROUP BY l.key
         ORDER BY l.is_fav DESC, l.created_at ASC",
    ).map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, String, bool, i64)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)? != 0,
                r.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::new();
    for (key, name, description, is_fav, item_count) in rows {
        let mut prev_stmt = conn.prepare(
            "SELECT external_id FROM user_list_items WHERE list_key = ?1 ORDER BY position LIMIT 4",
        ).map_err(|e| e.to_string())?;
        let preview_ids: Vec<String> = prev_stmt
            .query_map([&key], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        result.push(ListInfo { key, name, description, is_fav, item_count, preview_ids });
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_list_items_full(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
) -> Result<Vec<ListItemFull>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    // Single SQL JOIN — everything is in metadea.db
    let mut stmt = conn.prepare(
        "SELECT
            li.external_id, li.position,
            ul.id, ul.status, ul.rating,
            COALESCE(ul.progress, 0.0), COALESCE(ul.progress_2, 0.0),
            COALESCE(ul.is_favorite, 0), COALESCE(ul.is_platinum, 0),
            mc.title_main, mc.cover_url, mc.type, mc.format
         FROM user_list_items li
         LEFT JOIN user_library ul ON ul.external_id = li.external_id
         LEFT JOIN media_catalog mc ON mc.external_id = li.external_id
         WHERE li.list_key = ?1
         ORDER BY li.position"
    ).map_err(|e| e.to_string())?;

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
    }).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();

    Ok(items)
}

#[tauri::command]
pub async fn get_list_items(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
) -> Result<Vec<String>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT external_id FROM user_list_items WHERE list_key = ?1 ORDER BY position",
    ).map_err(|e| e.to_string())?;
    let items: Vec<String> = stmt
        .query_map([&list_key], |r| r.get(0))
        .map_err(|e| e.to_string())?
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
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
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
    ).map_err(|e| e.to_string())?;

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
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE user_lists SET name = ?1, description = ?2, updated_at = ?3 WHERE key = ?4",
        rusqlite::params![name, description, now, key],
    ).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_user_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    key: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM user_list_items WHERE list_key = ?1", [&key])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM user_lists WHERE key = ?1 AND is_fav = 0", [&key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn add_item_to_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
    external_id: String,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
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
    ).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_item_from_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM user_list_items WHERE list_key = ?1 AND external_id = ?2",
        rusqlite::params![list_key, external_id],
    ).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reorder_list_items(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    list_key: String,
    external_ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    for (pos, id) in external_ids.iter().enumerate() {
        conn.execute(
            "UPDATE user_list_items SET position = ?1 WHERE list_key = ?2 AND external_id = ?3",
            rusqlite::params![pos as i64, list_key, id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}
