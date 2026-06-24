use rusqlite::{Connection, Result as SqliteResult, Error as SqliteError, params};
use std::path::PathBuf;
use std::sync::Mutex;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryItem {
  pub id:          Option<i32>,
  pub external_id: String,
  pub item_type:   String,
  pub rating:      Option<i32>,
  pub status:      String,
  pub created_at:  String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
  pub token:    String,
  pub username: String,
}

pub struct Database {
  connection: Mutex<Option<Connection>>,
}

impl Database {
  pub fn new() -> Self {
    Database { connection: Mutex::new(None) }
  }

  fn lock(&self) -> SqliteResult<std::sync::MutexGuard<Option<Connection>>> {
    self.connection.lock().map_err(|_| {
      SqliteError::InvalidParameterName("db_mutex_poisoned".to_string())
    })
  }

  pub fn init(&self, app_data_dir: PathBuf) -> SqliteResult<()> {
    let db_path = app_data_dir.join("metadea.db");
    let conn = Connection::open(&db_path)?;

    conn.execute_batch(
      "PRAGMA journal_mode = WAL;

       CREATE TABLE IF NOT EXISTS user_library (
         id          INTEGER PRIMARY KEY,
         external_id TEXT UNIQUE NOT NULL,
         item_type   TEXT NOT NULL,
         rating      INTEGER,
         status      TEXT NOT NULL DEFAULT 'planning',
         created_at  TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_type   ON user_library(item_type);
       CREATE INDEX IF NOT EXISTS idx_status ON user_library(status);

       CREATE TABLE IF NOT EXISTS config (
         key   TEXT PRIMARY KEY,
         value TEXT NOT NULL
       );"
    )?;

    *self.lock()? = Some(conn);
    Ok(())
  }

  pub fn save_item(&self, item: LibraryItem) -> SqliteResult<()> {
    let guard = self.lock()?;
    let conn  = guard.as_ref().ok_or_else(|| SqliteError::InvalidParameterName("db_not_initialized".to_string()))?;
    conn.execute(
      "INSERT OR REPLACE INTO user_library (external_id, item_type, rating, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)",
      params![item.external_id, item.item_type, item.rating, item.status, item.created_at],
    )?;
    Ok(())
  }

  pub fn get_all_items(&self) -> SqliteResult<Vec<LibraryItem>> {
    let guard = self.lock()?;
    let conn  = guard.as_ref().ok_or_else(|| SqliteError::InvalidParameterName("db_not_initialized".to_string()))?;
    let mut stmt = conn.prepare(
      "SELECT id, external_id, item_type, rating, status, created_at
       FROM user_library ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map([], |row| {
      Ok(LibraryItem {
        id:          Some(row.get(0)?),
        external_id: row.get(1)?,
        item_type:   row.get(2)?,
        rating:      row.get(3)?,
        status:      row.get(4)?,
        created_at:  row.get(5)?,
      })
    })?;
    let mut result = Vec::new();
    for row in rows { result.push(row?); }
    Ok(result)
  }

  pub fn get_stats(&self) -> SqliteResult<serde_json::Value> {
    let guard = self.lock()?;
    let conn  = guard.as_ref().ok_or_else(|| SqliteError::InvalidParameterName("db_not_initialized".to_string()))?;
    let total: i32 = conn.query_row(
      "SELECT COUNT(*) FROM user_library", [], |row| row.get(0),
    )?;
    let mut stmt = conn.prepare(
      "SELECT item_type, COUNT(*) FROM user_library GROUP BY item_type"
    )?;
    let mut by_type = std::collections::HashMap::new();
    let rows = stmt.query_map([], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
    })?;
    for row in rows {
      let (k, v) = row?;
      by_type.insert(k, v);
    }
    Ok(serde_json::json!({ "total": total, "by_type": by_type }))
  }

  // ── Config (auth token storage) ──────────────────────────────────────────

  pub fn set_config(&self, key: &str, value: &str) -> SqliteResult<()> {
    let guard = self.lock()?;
    let conn  = guard.as_ref().ok_or_else(|| SqliteError::InvalidParameterName("db_not_initialized".to_string()))?;
    conn.execute(
      "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
      params![key, value],
    )?;
    Ok(())
  }

  pub fn get_config(&self, key: &str) -> SqliteResult<Option<String>> {
    let guard = self.lock()?;
    let conn  = guard.as_ref().ok_or_else(|| SqliteError::InvalidParameterName("db_not_initialized".to_string()))?;
    let mut stmt = conn.prepare("SELECT value FROM config WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
      Ok(Some(row.get(0)?))
    } else {
      Ok(None)
    }
  }

  pub fn delete_config(&self, key: &str) -> SqliteResult<()> {
    let guard = self.lock()?;
    let conn  = guard.as_ref().ok_or_else(|| SqliteError::InvalidParameterName("db_not_initialized".to_string()))?;
    conn.execute("DELETE FROM config WHERE key = ?1", params![key])?;
    Ok(())
  }
}
