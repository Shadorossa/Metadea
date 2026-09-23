// Env/API-key config, split out of igdb.rs (which re-exports read_env_config).
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
    pub apisports_api_key: Option<String>,
    // RetroAchievements (src/retro_achievements reads these two rows itself).
    pub ra_username: Option<String>,
    pub ra_api_key: Option<String>,
    // MyAnimeList OAuth client id (src/mal reads it).
    pub mal_client_id: Option<String>,
    // Google OAuth client for Drive backups (src/google_drive). Overrides the
    // build-time METADEA_GOOGLE_CLIENT_ID / _SECRET when set.
    #[serde(default)]
    pub google_client_id: Option<String>,
    #[serde(default)]
    pub google_client_secret: Option<String>,
}

pub(crate) fn env_from_db(db: &crate::db::MetadeaDb) -> Result<EnvConfig, String> {
    let conn = db.conn.lock().str_err()?;
    let mut stmt = conn.prepare(
        "SELECT name, value FROM app_env WHERE name IN (
            'anilist_client_id','igdb_client_id','igdb_client_secret',
            'steam_api_key','tmdb_access_token','tmdb_api_key','comicvine_api_key','apisports_api_key',
            'ra_username','ra_api_key','mal_client_id','google_client_id','google_client_secret'
         )"
    ).str_err()?;
    let mut cfg = EnvConfig {
        anilist_client_id: None, igdb_client_id: None, igdb_client_secret: None,
        steam_api_key: None, tmdb_access_token: None, tmdb_api_key: None,
        comicvine_api_key: None,
        apisports_api_key: None,
        ra_username: None,
        ra_api_key: None,
        mal_client_id: None,
        google_client_id: None,
        google_client_secret: None,
    };
    let rows: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .str_err()?
        .filter_map(|r| r.ok())
        .collect();
    for (name, value) in rows {
        // Keys saved before write_env_config encrypted are plaintext rows.
        let opt = if value.is_empty() { None } else { Some(crate::utils::decrypt_secret_or_plaintext(&value)) };
        match name.as_str() {
            "anilist_client_id"  => cfg.anilist_client_id  = opt,
            "igdb_client_id"     => cfg.igdb_client_id     = opt,
            "igdb_client_secret" => cfg.igdb_client_secret = opt,
            "steam_api_key"      => cfg.steam_api_key      = opt,
            "tmdb_access_token"  => cfg.tmdb_access_token  = opt,
            "tmdb_api_key"       => cfg.tmdb_api_key       = opt,
            "comicvine_api_key"  => cfg.comicvine_api_key  = opt,
            "apisports_api_key"  => cfg.apisports_api_key  = opt,
            "ra_username"        => cfg.ra_username        = opt,
            "ra_api_key"         => cfg.ra_api_key         = opt,
            "mal_client_id"      => cfg.mal_client_id      = opt,
            "google_client_id"     => cfg.google_client_id     = opt,
            "google_client_secret" => cfg.google_client_secret = opt,
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
    let mut conn = db.conn.lock().str_err()?;
    // All credentials are saved together; a partial write mixes the old
    // and new sets and leaves providers authenticating with mismatched pairs.
    let tx = conn.transaction().str_err()?;
    let now = chrono::Utc::now().to_rfc3339();
    let pairs = [
        ("anilist_client_id",  config.anilist_client_id.as_deref().unwrap_or("")),
        ("igdb_client_id",     config.igdb_client_id.as_deref().unwrap_or("")),
        ("igdb_client_secret", config.igdb_client_secret.as_deref().unwrap_or("")),
        ("steam_api_key",      config.steam_api_key.as_deref().unwrap_or("")),
        ("tmdb_access_token",  config.tmdb_access_token.as_deref().unwrap_or("")),
        ("tmdb_api_key",       config.tmdb_api_key.as_deref().unwrap_or("")),
        ("comicvine_api_key",  config.comicvine_api_key.as_deref().unwrap_or("")),
        ("apisports_api_key",  config.apisports_api_key.as_deref().unwrap_or("")),
        ("ra_username",        config.ra_username.as_deref().unwrap_or("")),
        ("ra_api_key",         config.ra_api_key.as_deref().unwrap_or("")),
        ("mal_client_id",      config.mal_client_id.as_deref().unwrap_or("")),
        ("google_client_id",     config.google_client_id.as_deref().unwrap_or("")),
        ("google_client_secret", config.google_client_secret.as_deref().unwrap_or("")),
    ];
    for (name, value) in pairs {
        // An empty value means "unset" to env_from_db, so it stays empty.
        let value = if value.is_empty() { String::new() } else { crate::utils::encrypt_secret(value)? };
        tx.execute(
            "INSERT INTO app_env (name, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            rusqlite::params![name, value, now],
        ).str_err()?;
    }
    tx.commit().str_err()?;
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
