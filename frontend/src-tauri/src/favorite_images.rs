use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use crate::db::ToStringErr;
use crate::utils::base64_encode;

// Local-only cover override for the profile Favorites tab — see the table
// comment in db.rs. Applies equally to media (external_id like "anime:123")
// and characters ("character:456"); nothing here cares which.
//
// The actual image bytes live on disk at
// <app_data_dir>/user_metadata/custom_image/<list_name>/<file_name> — the DB
// only stores the pointer + crop percentages. `image_url` below is never
// persisted: it's filled in at read time as a base64 data: URL so existing
// frontend rendering code (which expects a ready-to-use `image_url`) needs
// no changes.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FavoriteCustomImage {
    pub external_id: String,
    pub list_name: String,
    pub file_name: String,
    #[serde(default)]
    pub image_url: String,
    pub bg_size: f64,
    pub pos_x: f64,
    pub pos_y: f64,
    pub updated_at: String,
}

struct ImageRow {
    external_id: String,
    list_name: String,
    file_name: String,
    bg_size: f64,
    pos_x: f64,
    pos_y: f64,
    updated_at: String,
}

const SELECT_IMAGE: &str =
    "SELECT external_id, list_name, file_name, bg_size, pos_x, pos_y, updated_at FROM favorite_custom_images";

fn row_to_image(row: &rusqlite::Row<'_>) -> rusqlite::Result<ImageRow> {
    Ok(ImageRow {
        external_id: row.get(0)?,
        list_name: row.get(1)?,
        file_name: row.get(2)?,
        bg_size: row.get(3)?,
        pos_x: row.get(4)?,
        pos_y: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn custom_image_root(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .str_err()?
        .join("user_metadata")
        .join("custom_image");
    Ok(dir)
}

// Derives the list_name bucket from an external_id like "anime:123" or
// "character:456" — mirrors the type prefix already used everywhere else to
// distinguish favorite categories.
fn list_name_for(external_id: &str) -> String {
    external_id.split(':').next().unwrap_or("misc").to_string()
}

fn sanitize_for_filename(external_id: &str) -> String {
    external_id.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

// Reads a row's file off disk and encodes it as a data: URL for the frontend.
fn load_image_data_url(root: &std::path::Path, row: &ImageRow) -> Option<String> {
    let path = root.join(&row.list_name).join(&row.file_name);
    let bytes = std::fs::read(&path).ok()?;
    Some(format!("data:image/png;base64,{}", base64_encode(&bytes)))
}

fn row_into_image(root: &std::path::Path, row: ImageRow) -> Option<FavoriteCustomImage> {
    let image_url = load_image_data_url(root, &row)?;
    Some(FavoriteCustomImage {
        external_id: row.external_id,
        list_name: row.list_name,
        file_name: row.file_name,
        image_url,
        bg_size: row.bg_size,
        pos_x: row.pos_x,
        pos_y: row.pos_y,
        updated_at: row.updated_at,
    })
}

// Resolves `source` (a remote http(s) URL, a data: URL, or a local file
// path) to raw image bytes.
async fn resolve_image_bytes(source: &str) -> Result<Vec<u8>, String> {
    if let Some(comma) = source.strip_prefix("data:").and_then(|s| s.find(',').map(|i| &s[i + 1..])) {
        return crate::utils::base64_decode(comma);
    }
    if source.starts_with("http://") || source.starts_with("https://") {
        let resp = reqwest::get(source).await.str_err()?;
        if !resp.status().is_success() {
            return Err(format!("Failed to download image: HTTP {}", resp.status()));
        }
        let bytes = resp.bytes().await.str_err()?;
        return Ok(bytes.to_vec());
    }
    std::fs::read(source).str_err()
}

#[tauri::command]
pub async fn save_favorite_custom_image(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    image_url: String,
    bg_size: f64,
    pos_x: f64,
    pos_y: f64,
) -> Result<FavoriteCustomImage, String> {
    let list_name = list_name_for(&external_id);
    let file_name = format!("{}.png", sanitize_for_filename(&external_id));

    let raw_bytes = resolve_image_bytes(&image_url).await?;
    // Normalize whatever format was fetched (jpeg/webp/png/...) to PNG so
    // the stored file extension is always accurate.
    let decoded = image::load_from_memory(&raw_bytes).str_err()?;
    let mut png_bytes: Vec<u8> = Vec::new();
    decoded
        .write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .str_err()?;

    let root = custom_image_root(&app_handle)?;
    let dir = root.join(&list_name);
    std::fs::create_dir_all(&dir).str_err()?;
    std::fs::write(dir.join(&file_name), &png_bytes).str_err()?;

    let conn = state.conn.lock().str_err()?;
    let updated_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO favorite_custom_images (external_id, list_name, file_name, bg_size, pos_x, pos_y, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![&external_id, &list_name, &file_name, bg_size, pos_x, pos_y, &updated_at],
    ).str_err()?;

    Ok(FavoriteCustomImage {
        external_id,
        list_name,
        file_name,
        image_url: format!("data:image/png;base64,{}", base64_encode(&png_bytes)),
        bg_size,
        pos_x,
        pos_y,
        updated_at,
    })
}

#[tauri::command]
pub async fn get_favorite_custom_image(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<FavoriteCustomImage>, String> {
    let row = {
        let conn = state.conn.lock().str_err()?;
        conn.query_row(
            &format!("{} WHERE external_id = ?1", SELECT_IMAGE),
            [&external_id],
            row_to_image,
        )
        .optional()
        .str_err()?
    };
    let root = custom_image_root(&app_handle)?;
    Ok(row.and_then(|r| row_into_image(&root, r)))
}

// Bulk fetch for the Favorites tab — one round trip instead of one per card.
#[tauri::command]
pub async fn get_all_favorite_custom_images(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<FavoriteCustomImage>, String> {
    let rows: Vec<ImageRow> = {
        let conn = state.conn.lock().str_err()?;
        let mut stmt = conn.prepare(SELECT_IMAGE).str_err()?;
        let mapped = stmt.query_map([], row_to_image).str_err()?;
        let collected: Vec<ImageRow> = mapped.filter_map(|r| r.ok()).collect();
        collected
    };
    let root = custom_image_root(&app_handle)?;
    Ok(rows.into_iter().filter_map(|r| row_into_image(&root, r)).collect())
}

#[tauri::command]
pub async fn delete_favorite_custom_image(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<(), String> {
    let row = {
        let conn = state.conn.lock().str_err()?;
        let row = conn.query_row(
            &format!("{} WHERE external_id = ?1", SELECT_IMAGE),
            [&external_id],
            row_to_image,
        )
        .optional()
        .str_err()?;
        conn.execute(
            "DELETE FROM favorite_custom_images WHERE external_id = ?1",
            [&external_id],
        ).str_err()?;
        row
    };
    if let Some(row) = row {
        let root = custom_image_root(&app_handle)?;
        let _ = std::fs::remove_file(root.join(&row.list_name).join(&row.file_name));
    }
    Ok(())
}
