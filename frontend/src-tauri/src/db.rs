use rusqlite::{Connection, Result as SqlResult};
use std::sync::Mutex;

// ─── Two separate DB handles (different types so Tauri can manage both) ───────

pub struct LibraryDb {
    pub conn: Mutex<Connection>,
}

pub struct CatalogDb {
    pub conn: Mutex<Connection>,
}

pub struct SessionDb {
    pub conn: Mutex<Connection>,
}

pub struct EnvDb {
    pub conn: Mutex<Connection>,
}

pub struct ProfileDb {
    pub conn: Mutex<Connection>,
}

pub struct LocalDataDb {
    pub conn: Mutex<Connection>,
}

impl LibraryDb {
    pub fn open(path: &std::path::Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(LIBRARY_SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

impl CatalogDb {
    pub fn open(path: &std::path::Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(CATALOG_SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

impl SessionDb {
    pub fn open(path: &std::path::Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(SESSION_SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

impl EnvDb {
    pub fn open(path: &std::path::Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(ENV_SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

impl ProfileDb {
    pub fn open(path: &std::path::Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(PROFILE_SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

impl LocalDataDb {
    pub fn open(path: &std::path::Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(LOCAL_DATA_SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

// ─── ID generator ─────────────────────────────────────────────────────────────

pub fn generate_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let a = (nanos as u64)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    let b = ((nanos >> 64) as u64)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(a);
    format!("{:016x}{:016x}", a, b)
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const LIBRARY_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS user_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_lists (
    key         TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    is_fav      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_list_items (
    list_key    TEXT NOT NULL,
    external_id TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    added_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (list_key, external_id)
);

CREATE TABLE IF NOT EXISTS user_library (
    id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id           TEXT NOT NULL,
    external_id       TEXT NOT NULL UNIQUE,
    type              TEXT NOT NULL,
    status            TEXT DEFAULT 'planning',
    rating            REAL,
    progress          REAL DEFAULT 0,
    progress_2        REAL DEFAULT 0,
    minutes_spent     REAL DEFAULT 0,
    is_favorite       INTEGER DEFAULT 0,
    is_platinum       INTEGER DEFAULT 0,
    tags              TEXT,
    notes             TEXT,
    added_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    selected_platform TEXT,
    selected_version  TEXT,
    started_at        TEXT,
    finished_at       TEXT
);
";

const CATALOG_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS media_catalog (
    id                   TEXT PRIMARY KEY,
    external_id          TEXT UNIQUE NOT NULL,
    parent_id            TEXT,
    type                 TEXT,
    format               TEXT DEFAULT '',
    source               TEXT DEFAULT '',
    title_main           TEXT DEFAULT '',
    title_romaji         TEXT DEFAULT '',
    title_native         TEXT DEFAULT '',
    synopsis             TEXT,
    cover_url            TEXT,
    banners_csv          TEXT DEFAULT '',
    release_year         INTEGER,
    release_month        INTEGER,
    release_day          INTEGER,
    time_length          INTEGER,
    status               TEXT,
    score_global         REAL,
    favorites_count      INTEGER DEFAULT 0,
    ratings_count        INTEGER DEFAULT 0,
    total_count          INTEGER,
    total_count_2        INTEGER,
    genres_csv           TEXT DEFAULT '',
    genres_tag_csv       TEXT DEFAULT '',
    platforms_csv        TEXT DEFAULT '',
    companies_cache_csv  TEXT DEFAULT '',
    last_synced_at       TEXT,
    sync_failed_count    INTEGER DEFAULT 0,
    last_sync_error      TEXT,
    created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at           TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS media_catalog_external_idx ON media_catalog(external_id);
";

const SESSION_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS user_sessions (
    service    TEXT PRIMARY KEY,
    token      TEXT NOT NULL DEFAULT '',
    username   TEXT,
    saved_at   TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
";

const ENV_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS app_env (
    id                 INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    anilist_client_id  TEXT NOT NULL DEFAULT '',
    igdb_client_id     TEXT NOT NULL DEFAULT '',
    igdb_client_secret TEXT NOT NULL DEFAULT '',
    steam_api_key      TEXT NOT NULL DEFAULT '',
    tmdb_access_token  TEXT NOT NULL DEFAULT '',
    tmdb_api_key       TEXT NOT NULL DEFAULT '',
    updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
);
";

const PROFILE_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS user_profile (
    id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    avatar_data       TEXT NOT NULL DEFAULT '',
    banner_data       TEXT NOT NULL DEFAULT '',
    bio               TEXT NOT NULL DEFAULT '',
    display_name      TEXT NOT NULL DEFAULT '',
    dynamic_theme     INTEGER NOT NULL DEFAULT 0,
    font              TEXT NOT NULL DEFAULT '',
    language          TEXT NOT NULL DEFAULT 'es',
    source_avatar_url TEXT NOT NULL DEFAULT '',
    source_name       TEXT NOT NULL DEFAULT '',
    source_username   TEXT NOT NULL DEFAULT '',
    theme             TEXT NOT NULL DEFAULT 'nebula',
    created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT DEFAULT CURRENT_TIMESTAMP
);
";

const LOCAL_DATA_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS local_routes (
    key        TEXT PRIMARY KEY,
    path       TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS local_folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL DEFAULT '',
    path       TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS local_game_links (
    launcher    TEXT NOT NULL,
    link_key    TEXT NOT NULL DEFAULT '',
    external_id TEXT NOT NULL,
    updated_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (launcher, link_key)
);
";

// ─── JSON migrations (run once on startup when DB is empty) ───────────────────

pub fn migrate_library_from_json(db: &LibraryDb, data_dir: &std::path::Path) {
    let conn = match db.conn.lock() { Ok(c) => c, Err(_) => return };

    // Always seed fav lists — idempotent via INSERT OR IGNORE
    const FAV_SEEDS: &[(&str, &str)] = &[
        ("anime_fav",      "Anime favoritos"),
        ("manga_fav",      "Manga favoritos"),
        ("multimedia_fav", "Multimedia favoritos"),
        ("game_fav",       "Juegos favoritos"),
        ("vnovel_fav",     "Novelas visuales favoritas"),
        ("lnovel_fav",     "Novelas ligeras favoritas"),
        ("series_fav",     "Series favoritas"),
        ("movie_fav",      "Películas favoritas"),
        ("book_fav",       "Libros favoritos"),
        ("character_fav",  "Personajes favoritos"),
    ];
    for (key, name) in FAV_SEEDS {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO user_lists (key, name, is_fav) VALUES (?1, ?2, 1)",
            rusqlite::params![key, name],
        );
    }

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_library", [], |r| r.get(0))
        .unwrap_or(i64::MAX);
    if count > 0 { return; }

    let lib_dir = data_dir.join("user_library");
    if !lib_dir.exists() { return; }

    let now = chrono::Utc::now().to_rfc3339();

    for item in std::fs::read_dir(&lib_dir).into_iter().flatten().flatten() {
        let path = item.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        let json = match std::fs::read_to_string(&path) { Ok(j) => j, Err(_) => continue };
        let v: serde_json::Value = match serde_json::from_str(&json) { Ok(v) => v, Err(_) => continue };

        let eid = match v.get("external_id").and_then(|x| x.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        let tags_json: Option<String> = v.get("tags").and_then(|x| {
            if x.is_null() { None } else { Some(x.to_string()) }
        });

        let _ = conn.execute(
            "INSERT OR IGNORE INTO user_library (
                id, user_id, external_id, type, status, rating, progress, progress_2,
                minutes_spent, is_favorite, is_platinum, tags, notes,
                added_at, updated_at, selected_platform, selected_version,
                started_at, finished_at
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            rusqlite::params![
                v.get("id").and_then(|x| x.as_str()).unwrap_or(&now),
                v.get("user_id").and_then(|x| x.as_str()).unwrap_or("local"),
                eid,
                v.get("type").and_then(|x| x.as_str()).unwrap_or(""),
                v.get("status").and_then(|x| x.as_str()),
                v.get("rating").and_then(|x| x.as_f64()),
                v.get("progress").and_then(|x| x.as_f64()).unwrap_or(0.0),
                v.get("progress_2").or_else(|| v.get("progress_count_2")).and_then(|x| x.as_f64()).unwrap_or(0.0),
                v.get("minutes_spent").and_then(|x| x.as_f64()).unwrap_or(0.0),
                v.get("is_favorite").and_then(|x| x.as_i64()).unwrap_or(0) as i32,
                v.get("is_platinum").and_then(|x| x.as_i64()).unwrap_or(0) as i32,
                tags_json,
                v.get("notes").and_then(|x| x.as_str()),
                v.get("added_at").and_then(|x| x.as_str()),
                v.get("updated_at").and_then(|x| x.as_str()),
                v.get("selected_platform").and_then(|x| x.as_str()),
                v.get("selected_version").and_then(|x| x.as_str()),
                v.get("started_at").and_then(|x| x.as_str()),
                v.get("finished_at").and_then(|x| x.as_str()),
            ],
        );
    }

    // Migrate user_metadata JSON files into the user_metadata table
    let meta_dir = data_dir.join("user_metadata");
    let meta_files = [
        ("monthly_history", "monthly_history.json"),
        ("user_journey",    "user_journey.json"),
    ];
    for (key, filename) in &meta_files {
        let path = meta_dir.join(filename);
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO user_metadata (key, value) VALUES (?1, ?2)",
                    rusqlite::params![key, content],
                );
            }
        }
    }

    // Migrate old user_favorite.json blob → user_list_items
    let fav_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_list_items WHERE list_key LIKE '%_fav'", [], |r| r.get(0))
        .unwrap_or(i64::MAX);
    if fav_count == 0 {
        let fav_path = meta_dir.join("user_favorite.json");
        if let Ok(raw) = std::fs::read_to_string(&fav_path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(obj) = v.as_object() {
                    const MAP: &[(&str, &str)] = &[
                        ("anime",      "anime_fav"),      ("manga",     "manga_fav"),
                        ("multimedia", "multimedia_fav"), ("game",      "game_fav"),
                        ("vnovel",     "vnovel_fav"),     ("novel",     "lnovel_fav"),
                        ("series",     "series_fav"),     ("movie",     "movie_fav"),
                        ("book",       "book_fav"),       ("character", "character_fav"),
                    ];
                    for (old_key, fav_key) in MAP {
                        if let Some(ids) = obj.get(*old_key).and_then(|x| x.as_array()) {
                            for (pos, id) in ids.iter().enumerate() {
                                if let Some(eid) = id.as_str() {
                                    let _ = conn.execute(
                                        "INSERT OR IGNORE INTO user_list_items (list_key, external_id, position) VALUES (?1, ?2, ?3)",
                                        rusqlite::params![fav_key, eid, pos as i64],
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Migrate old user_lists.json blob → user_lists + user_list_items
    let custom_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_lists WHERE is_fav = 0", [], |r| r.get(0))
        .unwrap_or(i64::MAX);
    if custom_count == 0 {
        let lists_path = meta_dir.join("user_lists.json");
        if let Ok(raw) = std::fs::read_to_string(&lists_path) {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
                for item in &arr {
                    let id   = item.get("id").and_then(|x| x.as_str()).unwrap_or("");
                    let name = item.get("name").and_then(|x| x.as_str()).unwrap_or("");
                    let desc = item.get("description").and_then(|x| x.as_str()).unwrap_or("");
                    let cat  = item.get("created_at").and_then(|x| x.as_str()).unwrap_or("");
                    if id.is_empty() { continue; }
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO user_lists (key, name, description, is_fav, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
                        rusqlite::params![id, name, desc, cat],
                    );
                    if let Some(ids) = item.get("item_ids").and_then(|x| x.as_array()) {
                        for (pos, eid_val) in ids.iter().enumerate() {
                            if let Some(eid) = eid_val.as_str() {
                                let _ = conn.execute(
                                    "INSERT OR IGNORE INTO user_list_items (list_key, external_id, position) VALUES (?1, ?2, ?3)",
                                    rusqlite::params![id, eid, pos as i64],
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}

pub fn migrate_catalog_from_json(db: &CatalogDb, data_dir: &std::path::Path) {
    let conn = match db.conn.lock() { Ok(c) => c, Err(_) => return };

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM media_catalog", [], |r| r.get(0))
        .unwrap_or(i64::MAX);
    if count > 0 { return; }

    let cat_dir = data_dir.join("media_catalog");
    if !cat_dir.exists() { return; }

    let now = chrono::Utc::now().to_rfc3339();

    for item in std::fs::read_dir(&cat_dir).into_iter().flatten().flatten() {
        let path = item.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        let json = match std::fs::read_to_string(&path) { Ok(j) => j, Err(_) => continue };
        let v: serde_json::Value = match serde_json::from_str(&json) { Ok(v) => v, Err(_) => continue };

        let eid = match v.get("external_id").and_then(|x| x.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };

        let _ = conn.execute(
            "INSERT OR IGNORE INTO media_catalog (
                id, external_id, parent_id, type, format, source,
                title_main, title_romaji, title_native, synopsis, cover_url,
                banners_csv, release_year, release_month, release_day,
                time_length, status, score_global, favorites_count,
                ratings_count, total_count, total_count_2, genres_csv,
                genres_tag_csv, platforms_csv, companies_cache_csv,
                last_synced_at, sync_failed_count, last_sync_error,
                created_at, updated_at
            ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31)",
            rusqlite::params![
                v.get("id").and_then(|x| x.as_str()).unwrap_or(&now),
                eid,
                v.get("parent_id").and_then(|x| x.as_str()),
                v.get("type").and_then(|x| x.as_str()),
                v.get("format").and_then(|x| x.as_str()),
                v.get("source").and_then(|x| x.as_str()),
                v.get("title_main").and_then(|x| x.as_str()),
                v.get("title_romaji").and_then(|x| x.as_str()),
                v.get("title_native").and_then(|x| x.as_str()),
                v.get("synopsis").and_then(|x| x.as_str()),
                v.get("cover_url").and_then(|x| x.as_str()),
                v.get("banners_csv").and_then(|x| x.as_str()),
                v.get("release_year").and_then(|x| x.as_i64()).map(|x| x as i32),
                v.get("release_month").and_then(|x| x.as_i64()).map(|x| x as i32),
                v.get("release_day").and_then(|x| x.as_i64()).map(|x| x as i32),
                v.get("time_length").and_then(|x| x.as_i64()).map(|x| x as i32),
                v.get("status").and_then(|x| x.as_str()),
                v.get("score_global").and_then(|x| x.as_f64()),
                v.get("favorites_count").and_then(|x| x.as_i64()).map(|x| x as i32),
                v.get("ratings_count").and_then(|x| x.as_i64()).map(|x| x as i32),
                v.get("total_count").and_then(|x| x.as_i64()).map(|x| x as i32),
                v.get("total_count_2").and_then(|x| x.as_i64()).map(|x| x as i32),
                v.get("genres_csv").and_then(|x| x.as_str()),
                v.get("genres_tag_csv").and_then(|x| x.as_str()),
                v.get("platforms_csv").and_then(|x| x.as_str()),
                v.get("companies_cache_csv").and_then(|x| x.as_str()),
                v.get("last_synced_at").and_then(|x| x.as_str()),
                v.get("sync_failed_count").and_then(|x| x.as_i64()).map(|x| x as i32),
                v.get("last_sync_error").and_then(|x| x.as_str()),
                v.get("created_at").and_then(|x| x.as_str()).unwrap_or(&now),
                v.get("updated_at").and_then(|x| x.as_str()).unwrap_or(&now),
            ],
        );
    }
}

pub fn migrate_env_from_json(db: &EnvDb, data_dir: &std::path::Path) {
    let conn = match db.conn.lock() { Ok(c) => c, Err(_) => return };
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM app_env", [], |r| r.get(0))
        .unwrap_or(i64::MAX);
    if count > 0 { return; }

    let path = data_dir.join("env.json");
    if let Ok(raw) = std::fs::read_to_string(&path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO app_env (
                    id, anilist_client_id, igdb_client_id, igdb_client_secret,
                    steam_api_key, tmdb_access_token, tmdb_api_key
                ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    v.get("anilist_client_id").and_then(|x| x.as_str()).unwrap_or(""),
                    v.get("igdb_client_id").and_then(|x| x.as_str()).unwrap_or(""),
                    v.get("igdb_client_secret").and_then(|x| x.as_str()).unwrap_or(""),
                    v.get("steam_api_key").and_then(|x| x.as_str()).unwrap_or(""),
                    v.get("tmdb_access_token").and_then(|x| x.as_str()).unwrap_or(""),
                    v.get("tmdb_api_key").and_then(|x| x.as_str()).unwrap_or(""),
                ],
            );
        }
    }
}

pub fn migrate_profile_from_json(db: &ProfileDb, data_dir: &std::path::Path) {
    let conn = match db.conn.lock() { Ok(c) => c, Err(_) => return };
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_profile", [], |r| r.get(0))
        .unwrap_or(i64::MAX);
    if count > 0 { return; }

    let meta_dir = data_dir.join("user_metadata");

    // user_info.json → profile columns
    let mut display_name = String::new();
    let mut bio = String::new();
    let mut theme = "nebula".to_string();
    let mut dynamic_theme = 0i32;
    let mut font = String::new();
    let mut language = "es".to_string();
    let mut source_name = String::new();
    let mut source_username = String::new();
    let mut source_avatar_url = String::new();

    if let Ok(raw) = std::fs::read_to_string(meta_dir.join("user_info.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(s) = v.get("display_name").or_else(|| v.get("username")).and_then(|x| x.as_str()) {
                display_name = s.to_string();
            }
            if let Some(s) = v.get("bio").and_then(|x| x.as_str()) { bio = s.to_string(); }
            if let Some(s) = v.get("theme").and_then(|x| x.as_str()) { theme = s.to_string(); }
            if let Some(b) = v.get("dynamic_theme").and_then(|x| x.as_bool()) { dynamic_theme = b as i32; }
            if let Some(s) = v.get("font").and_then(|x| x.as_str()) { font = s.to_string(); }
            if let Some(s) = v.get("language").and_then(|x| x.as_str()) { language = s.to_string(); }
            if let Some(s) = v.get("source_name").and_then(|x| x.as_str()) { source_name = s.to_string(); }
            if let Some(s) = v.get("source_username").and_then(|x| x.as_str()) { source_username = s.to_string(); }
            if let Some(s) = v.get("source_avatar_url").and_then(|x| x.as_str()) { source_avatar_url = s.to_string(); }
        }
    }

    // Binary image files → base64 data URLs
    let avatar_data  = read_image_as_data_url(&meta_dir.join("avatar"));
    let banner_data  = read_image_as_data_url(&meta_dir.join("banner"));

    let _ = conn.execute(
        "INSERT OR IGNORE INTO user_profile (
            id, avatar_data, banner_data, bio, display_name, dynamic_theme,
            font, language, source_avatar_url, source_name, source_username, theme
        ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            avatar_data, banner_data, bio, display_name, dynamic_theme,
            font, language, source_avatar_url, source_name, source_username, theme,
        ],
    );
}

fn read_image_as_data_url(path: &std::path::Path) -> String {
    let bytes = match std::fs::read(path) { Ok(b) => b, Err(_) => return String::new() };
    let mime = if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) { "image/png" }
               else if bytes.starts_with(&[0xFF, 0xD8]) { "image/jpeg" }
               else { "image/webp" };
    let b64 = crate::utils::base64_encode(&bytes);
    format!("data:{};base64,{}", mime, b64)
}

pub fn migrate_sessions_from_json(db: &SessionDb, data_dir: &std::path::Path) {
    let conn = match db.conn.lock() { Ok(c) => c, Err(_) => return };

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM user_sessions", [], |r| r.get(0))
        .unwrap_or(i64::MAX);
    if count > 0 { return; }

    // AniList token: session_anilist.json → { anilist_token_encrypted: "..." }
    let anilist_path = data_dir.join("session_anilist.json");
    if let Ok(raw) = std::fs::read_to_string(&anilist_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(token) = v.get("anilist_token_encrypted").and_then(|x| x.as_str()) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO user_sessions (service, token) VALUES ('anilist', ?1)",
                    [token],
                );
            }
        }
    }

    // GitHub token: session.json → { github_token_encrypted: "..." }
    let github_path = data_dir.join("session.json");
    if let Ok(raw) = std::fs::read_to_string(&github_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(token) = v.get("github_token_encrypted").and_then(|x| x.as_str()) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO user_sessions (service, token) VALUES ('github', ?1)",
                    [token],
                );
            }
            // Legacy auth session: { token: "...", username: "..." }
            if let Some(token) = v.get("token").and_then(|x| x.as_str()) {
                let username = v.get("username").and_then(|x| x.as_str());
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO user_sessions (service, token, username) VALUES ('app_auth', ?1, ?2)",
                    rusqlite::params![token, username],
                );
            }
        }
    }
}

pub fn migrate_local_data_from_json(db: &LocalDataDb, data_dir: &std::path::Path) {
    let conn = match db.conn.lock() { Ok(c) => c, Err(_) => return };

    // routes.json → local_routes
    let routes_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM local_routes", [], |r| r.get(0))
        .unwrap_or(i64::MAX);
    if routes_count == 0 {
        let path = data_dir.join("routes.json");
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(obj) = v.as_object() {
                    for (k, val) in obj {
                        if let Some(p) = val.as_str() {
                            let _ = conn.execute(
                                "INSERT OR IGNORE INTO local_routes (key, path) VALUES (?1, ?2)",
                                rusqlite::params![k, p],
                            );
                        }
                    }
                }
            }
        }
    }

    // local_folders.json → local_folders
    let folders_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM local_folders", [], |r| r.get(0))
        .unwrap_or(i64::MAX);
    if folders_count == 0 {
        let path = data_dir.join("local_folders.json");
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
                for item in arr {
                    let label = item.get("label").and_then(|x| x.as_str()).unwrap_or("");
                    let p = item.get("path").and_then(|x| x.as_str()).unwrap_or("");
                    if !p.is_empty() {
                        let _ = conn.execute(
                            "INSERT INTO local_folders (label, path) VALUES (?1, ?2)",
                            rusqlite::params![label, p],
                        );
                    }
                }
            }
        }
    }
}
