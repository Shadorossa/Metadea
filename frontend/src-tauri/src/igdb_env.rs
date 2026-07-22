// Env/API-key config (IGDB, Steam, TMDB, AniList, Comic Vine credentials) —
// split out of igdb.rs, which re-exports these so `crate::igdb::X` paths
// elsewhere (comicvine.rs, lib.rs's generate_handler!) don't need to change.
use serde::{Deserialize, Serialize};
use tauri::Manager;
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize)]
pub struct EnvConfig {
    pub igdb_client_id: Option<String>,
    pub igdb_client_secret: Option<String>,
    pub steam_api_key: Option<String>,
    pub tmdb_access_token: Option<String>,
    pub tmdb_api_key: Option<String>,
    pub anilist_client_id: Option<String>,
    pub comicvine_api_key: Option<String>,
}

fn env_from_db(db: &crate::db::MetadeaDb) -> Result<EnvConfig, String> {
    let conn = db.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT name, value FROM app_env WHERE name IN (
            'anilist_client_id','igdb_client_id','igdb_client_secret',
            'steam_api_key','tmdb_access_token','tmdb_api_key','comicvine_api_key'
         )"
    ).str_err()?;
    let mut cfg = EnvConfig {
        anilist_client_id: None, igdb_client_id: None, igdb_client_secret: None,
        steam_api_key: None, tmdb_access_token: None, tmdb_api_key: None,
        comicvine_api_key: None,
    };
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    for (name, value) in rows {
        let opt = if value.is_empty() { None } else { Some(value) };
        match name.as_str() {
            "anilist_client_id"  => cfg.anilist_client_id  = opt,
            "igdb_client_id"     => cfg.igdb_client_id     = opt,
            "igdb_client_secret" => cfg.igdb_client_secret = opt,
            "steam_api_key"      => cfg.steam_api_key      = opt,
            "tmdb_access_token"  => cfg.tmdb_access_token  = opt,
            "tmdb_api_key"       => cfg.tmdb_api_key       = opt,
            "comicvine_api_key"  => cfg.comicvine_api_key  = opt,
            _ => {}
        }
    }
    Ok(cfg)
}

#[tauri::command]
pub async fn read_env_config(app_handle: tauri::AppHandle) -> Result<EnvConfig, String> {
    let db = app_handle.state::<crate::db::MetadeaDb>();
    env_from_db(&db)
}

#[tauri::command]
pub async fn write_env_config(
    app_handle: tauri::AppHandle,
    config: EnvConfig,
) -> Result<String, String> {
    let db = app_handle.state::<crate::db::MetadeaDb>();
    let conn = db.conn.lock().str_err()?;
    let now = chrono::Utc::now().to_rfc3339();
    let pairs = [
        ("anilist_client_id",  config.anilist_client_id.as_deref().unwrap_or("")),
        ("igdb_client_id",     config.igdb_client_id.as_deref().unwrap_or("")),
        ("igdb_client_secret", config.igdb_client_secret.as_deref().unwrap_or("")),
        ("steam_api_key",      config.steam_api_key.as_deref().unwrap_or("")),
        ("tmdb_access_token",  config.tmdb_access_token.as_deref().unwrap_or("")),
        ("tmdb_api_key",       config.tmdb_api_key.as_deref().unwrap_or("")),
        ("comicvine_api_key",  config.comicvine_api_key.as_deref().unwrap_or("")),
    ];
    for (name, value) in pairs {
        conn.execute(
            "INSERT INTO app_env (name, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            rusqlite::params![name, value, now],
        ).str_err()?;
    }
    Ok("ok".to_string())
}

pub(crate) fn load_env_config(app_handle: &tauri::AppHandle) -> Result<EnvConfig, String> {
    let db = app_handle.state::<crate::db::MetadeaDb>();
    let cfg = env_from_db(&db)?;
    if cfg.igdb_client_id.is_none() && cfg.igdb_client_secret.is_none() {
        return Err("No IGDB keys configured".into());
    }
    Ok(cfg)
}
