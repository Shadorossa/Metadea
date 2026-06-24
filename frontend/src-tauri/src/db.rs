use rusqlite::{Connection, Result as SqliteResult, params};
use std::path::PathBuf;
use std::sync::Mutex;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryItem {
  pub id: Option<i32>,
  pub external_id: String,
  pub item_type: String,
  pub rating: Option<i32>,
  pub status: String,
  pub created_at: String,
}

pub struct Database {
  connection: Mutex<Option<Connection>>,
}

impl Database {
  pub fn new() -> Self {
    Database {
      connection: Mutex::new(None),
    }
  }

  pub fn init(&self, app_data_dir: PathBuf) -> SqliteResult<()> {
    let db_path = app_data_dir.join("metadea.db");

    let conn = Connection::open(&db_path)?;
    conn.execute_batch(
      "PRAGMA journal_mode = WAL;
       CREATE TABLE IF NOT EXISTS user_library (
         id INTEGER PRIMARY KEY,
         external_id TEXT UNIQUE NOT NULL,
         item_type TEXT NOT NULL,
         rating INTEGER,
         status TEXT NOT NULL DEFAULT 'planning',
         created_at TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_type ON user_library(item_type);
       CREATE INDEX IF NOT EXISTS idx_status ON user_library(status);"
    )?;

    let mut db = self.connection.lock().unwrap();
    *db = Some(conn);
    Ok(())
  }

  pub fn save_item(&self, item: LibraryItem) -> SqliteResult<()> {
    let db = self.connection.lock().unwrap();
    let conn = db.as_ref().unwrap();

    conn.execute(
      "INSERT OR REPLACE INTO user_library (external_id, item_type, rating, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)",
      params![item.external_id, item.item_type, item.rating, item.status, item.created_at],
    )?;
    Ok(())
  }

  pub fn get_all_items(&self) -> SqliteResult<Vec<LibraryItem>> {
    let db = self.connection.lock().unwrap();
    let conn = db.as_ref().unwrap();

    let mut stmt = conn.prepare(
      "SELECT id, external_id, item_type, rating, status, created_at FROM user_library ORDER BY created_at DESC"
    )?;

    let items = stmt.query_map([], |row| {
      Ok(LibraryItem {
        id: Some(row.get(0)?),
        external_id: row.get(1)?,
        item_type: row.get(2)?,
        rating: row.get(3)?,
        status: row.get(4)?,
        created_at: row.get(5)?,
      })
    })?;

    let mut result = Vec::new();
    for item in items {
      result.push(item?);
    }
    Ok(result)
  }

  pub fn get_stats(&self) -> SqliteResult<serde_json::Value> {
    let db = self.connection.lock().unwrap();
    let conn = db.as_ref().unwrap();

    let total: i32 = conn.query_row(
      "SELECT COUNT(*) FROM user_library",
      [],
      |row| row.get(0),
    )?;

    let mut stmt = conn.prepare(
      "SELECT item_type, COUNT(*) as count FROM user_library GROUP BY item_type"
    )?;

    let mut by_type = std::collections::HashMap::new();
    let rows = stmt.query_map([], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
    })?;

    for row in rows {
      let (type_name, count) = row?;
      by_type.insert(type_name, count);
    }

    Ok(serde_json::json!({
      "total": total,
      "by_type": by_type
    }))
  }
}
