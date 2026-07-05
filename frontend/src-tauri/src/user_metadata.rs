use rusqlite::OptionalExtension;
use crate::db::ToStringErr;

fn upsert_profile_row(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO user_profile (id) VALUES (1)",
        [],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn save_user_image(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    key: String,
    data_url: String,
) -> Result<(), String> {
    let col = match key.as_str() {
        "avatar" => "avatar_data",
        "banner" => "banner_data",
        _ => return Err(format!("Invalid key: {}", key)),
    };
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    upsert_profile_row(&conn).str_err()?;
    conn.execute(
        &format!("UPDATE user_profile SET {} = ?1, updated_at = ?2 WHERE id = 1", col),
        rusqlite::params![data_url, now],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub async fn get_user_image(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    key: String,
) -> Result<Option<String>, String> {
    let col = match key.as_str() {
        "avatar" => "avatar_data",
        "banner" => "banner_data",
        _ => return Err(format!("Invalid key: {}", key)),
    };
    let conn = state.conn.lock().str_err()?;
    let val: Option<String> = conn
        .query_row(
            &format!("SELECT {} FROM user_profile WHERE id = 1", col),
            [],
            |row| row.get(0),
        )
        .optional()
        .str_err()?;
    Ok(val.filter(|s| !s.is_empty()))
}

#[tauri::command]
pub async fn remove_user_image(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    key: String,
) -> Result<(), String> {
    let col = match key.as_str() {
        "avatar" => "avatar_data",
        "banner" => "banner_data",
        _ => return Err(format!("Invalid key: {}", key)),
    };
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        &format!("UPDATE user_profile SET {} = '', updated_at = ?1 WHERE id = 1", col),
        rusqlite::params![now],
    ).map(|_| ()).str_err()
}

#[tauri::command]
pub async fn save_user_info(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    info: serde_json::Value,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    upsert_profile_row(&conn).str_err()?;

    let obj = info.as_object().ok_or("Expected JSON object")?;
    let allowed = [
        "bio", "custom_color", "display_name", "dynamic_theme", "font",
        "language", "rating_system", "source_avatar_url", "source_name",
        "source_username", "theme",
    ];
    for (k, v) in obj {
        if !allowed.contains(&k.as_str()) {
            continue;
        }
        let sql = format!("UPDATE user_profile SET {} = ?1, updated_at = ?2 WHERE id = 1", k);
        match v {
            serde_json::Value::Bool(b) => {
                conn.execute(&sql, rusqlite::params![*b as i64, now])
                    .str_err()?;
            }
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    conn.execute(&sql, rusqlite::params![i, now])
                        .str_err()?;
                }
            }
            serde_json::Value::String(s) => {
                conn.execute(&sql, rusqlite::params![s, now])
                    .str_err()?;
            }
            _ => {}
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_user_info(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<serde_json::Value, String> {
    let conn = state.conn.lock().str_err()?;
    let row: Option<serde_json::Value> = conn
        .query_row(
            "SELECT bio, custom_color, display_name, dynamic_theme, font, language,
                    rating_system, source_avatar_url, source_name, source_username, theme
             FROM user_profile WHERE id = 1",
            [],
            |r| {
                Ok(serde_json::json!({
                    "bio":               r.get::<_, String>(0).unwrap_or_default(),
                    "custom_color":      r.get::<_, String>(1).unwrap_or("#c084fc".into()),
                    "display_name":      r.get::<_, String>(2).unwrap_or_default(),
                    "dynamic_theme":     r.get::<_, i64>(3).unwrap_or(0) != 0,
                    "font":              r.get::<_, String>(4).unwrap_or_default(),
                    "language":          r.get::<_, String>(5).unwrap_or("es".into()),
                    "rating_system":     r.get::<_, String>(6).unwrap_or("5-star".into()),
                    "source_avatar_url": r.get::<_, String>(7).unwrap_or_default(),
                    "source_name":       r.get::<_, String>(8).unwrap_or_default(),
                    "source_username":   r.get::<_, String>(9).unwrap_or_default(),
                    "theme":             r.get::<_, String>(10).unwrap_or("nebula".into()),
                }))
            },
        )
        .optional()
        .str_err()?;
    Ok(row.unwrap_or(serde_json::json!({})))
}
