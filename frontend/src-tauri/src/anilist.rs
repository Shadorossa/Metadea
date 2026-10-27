use serde_json::Value;
use crate::db::ToStringErr;

const ANILIST_API: &str = "https://graphql.anilist.co";

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn save_anilist_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    token: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    crate::sessions::save_session_token(&conn, "anilist", &token, None)
}

#[tauri::command]
pub fn get_anilist_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Option<String>, String> {
    let conn = state.conn.lock().str_err()?;
    Ok(crate::sessions::load_session_token(&conn, "anilist")?.map(|(token, _)| token))
}

#[tauri::command]
pub fn delete_anilist_token(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    crate::sessions::delete_session_token(&conn, "anilist")
}

#[tauri::command]
pub async fn get_anilist_user_profile(token: String) -> Result<Value, String> {
    let client = crate::http::http_client();
    let query = r#"query { Viewer { name avatar { large } } }"#;
    let res = client
        .post(ANILIST_API)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": query }))
        .send()
        .await
        .str_err()?;

    if !res.status().is_success() {
        return Err(format!("Failed to load AniList profile: {}", res.status()));
    }
    res.json().await.str_err()
}
