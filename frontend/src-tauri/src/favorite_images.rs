use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;

// Local-only cover override for the profile Favorites tab — see the table
// comment in db.rs. Applies equally to media (external_id like "anime:123")
// and characters ("character:456"); nothing here cares which.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FavoriteCustomImage {
    pub external_id: String,
    pub image_url: String,
    pub bg_size: f64,
    pub pos_x: f64,
    pub pos_y: f64,
    pub updated_at: String,
}

const SELECT_IMAGE: &str =
    "SELECT external_id, image_url, bg_size, pos_x, pos_y, updated_at FROM favorite_custom_images";

fn row_to_image(row: &rusqlite::Row<'_>) -> rusqlite::Result<FavoriteCustomImage> {
    Ok(FavoriteCustomImage {
        external_id: row.get(0)?,
        image_url: row.get(1)?,
        bg_size: row.get(2)?,
        pos_x: row.get(3)?,
        pos_y: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

#[tauri::command]
pub async fn save_favorite_custom_image(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    image_url: String,
    bg_size: f64,
    pos_x: f64,
    pos_y: f64,
) -> Result<FavoriteCustomImage, String> {
    let conn = state.conn.lock().str_err()?;
    let updated_at = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO favorite_custom_images (external_id, image_url, bg_size, pos_x, pos_y, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![&external_id, &image_url, bg_size, pos_x, pos_y, &updated_at],
    ).str_err()?;

    Ok(FavoriteCustomImage { external_id, image_url, bg_size, pos_x, pos_y, updated_at })
}

#[tauri::command]
pub async fn get_favorite_custom_image(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<FavoriteCustomImage>, String> {
    let conn = state.conn.lock().str_err()?;
    conn.query_row(
        &format!("{} WHERE external_id = ?1", SELECT_IMAGE),
        [&external_id],
        row_to_image,
    )
    .optional()
    .str_err()
}

// Bulk fetch for the Favorites tab — one round trip instead of one per card.
#[tauri::command]
pub async fn get_all_favorite_custom_images(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<FavoriteCustomImage>, String> {
    let conn = state.conn.lock().str_err()?;
    let mut stmt = conn.prepare(SELECT_IMAGE).str_err()?;
    let rows = stmt
        .query_map([], row_to_image)
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[tauri::command]
pub async fn delete_favorite_custom_image(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "DELETE FROM favorite_custom_images WHERE external_id = ?1",
        [&external_id],
    ).str_err()?;
    Ok(())
}
