//! SQLite side of plugins: the `plugins` rows, the per-plugin key/value
//! store behind `metadea.storage`, and the per-work source links of the
//! "Read" tab (tables created by migrations/plugins.rs). Plain functions on
//! a `Connection` so the tests run them against an in-memory database.
use std::collections::BTreeSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error_codes::{self, with_detail};

pub const MAX_STORAGE_KEY_LEN: usize = 256;
pub const MAX_STORAGE_VALUE_BYTES: usize = 1024 * 1024;
pub const MAX_STORAGE_TOTAL_BYTES: i64 = 10 * 1024 * 1024;

fn db_err(e: rusqlite::Error) -> String {
    with_detail(error_codes::PLUGIN_DB, e)
}

#[derive(Debug, Clone, PartialEq)]
pub struct PluginRow {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub installed_at: i64,
    pub updated_at: i64,
    pub granted: BTreeSet<String>,
    pub settings: Map<String, Value>,
}

fn row_from(row: &rusqlite::Row) -> rusqlite::Result<PluginRow> {
    let granted: String = row.get(5)?;
    let settings: String = row.get(6)?;
    Ok(PluginRow {
        id: row.get(0)?,
        version: row.get(1)?,
        enabled: row.get::<_, i64>(2)? != 0,
        installed_at: row.get(3)?,
        updated_at: row.get(4)?,
        granted: serde_json::from_str::<Vec<String>>(&granted).unwrap_or_default().into_iter().collect(),
        settings: serde_json::from_str::<Map<String, Value>>(&settings).unwrap_or_default(),
    })
}

const SELECT_ROW: &str = "SELECT id, version, enabled, installed_at, updated_at, granted_permissions, settings FROM plugins";

pub fn get(conn: &Connection, id: &str) -> Result<Option<PluginRow>, String> {
    conn.query_row(&format!("{SELECT_ROW} WHERE id = ?1"), [id], row_from).optional().map_err(db_err)
}

pub fn require(conn: &Connection, id: &str) -> Result<PluginRow, String> {
    get(conn, id)?.ok_or_else(|| with_detail(error_codes::PLUGIN_NOT_FOUND, id))
}

pub fn list(conn: &Connection) -> Result<Vec<PluginRow>, String> {
    let mut stmt = conn.prepare(&format!("{SELECT_ROW} ORDER BY id")).map_err(db_err)?;
    let rows = stmt.query_map([], row_from).map_err(db_err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_err)
}

fn granted_json(granted: &BTreeSet<String>) -> String {
    serde_json::to_string(&granted.iter().collect::<Vec<_>>()).unwrap_or_else(|_| "[]".into())
}

/// Records an install or update the user consented to. A new plugin starts
/// enabled; an update keeps the enabled flag and the settings.
pub fn upsert_install(conn: &Connection, id: &str, version: &str, granted: &BTreeSet<String>, now: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO plugins (id, version, enabled, installed_at, updated_at, granted_permissions, settings)
         VALUES (?1, ?2, 1, ?3, ?3, ?4, '{}')
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at,
                                       granted_permissions = excluded.granted_permissions",
        params![id, version, now, granted_json(granted)],
    )
    .map(|_| ())
    .map_err(db_err)
}

pub fn set_granted(conn: &Connection, id: &str, granted: &BTreeSet<String>) -> Result<(), String> {
    let changed = conn
        .execute("UPDATE plugins SET granted_permissions = ?2 WHERE id = ?1", params![id, granted_json(granted)])
        .map_err(db_err)?;
    if changed == 0 { Err(with_detail(error_codes::PLUGIN_NOT_FOUND, id)) } else { Ok(()) }
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> Result<(), String> {
    let changed = conn
        .execute("UPDATE plugins SET enabled = ?2 WHERE id = ?1", params![id, enabled as i64])
        .map_err(db_err)?;
    if changed == 0 { Err(with_detail(error_codes::PLUGIN_NOT_FOUND, id)) } else { Ok(()) }
}

pub fn set_settings(conn: &Connection, id: &str, settings: &Map<String, Value>) -> Result<(), String> {
    let json = serde_json::to_string(settings).map_err(|e| with_detail(error_codes::PLUGIN_DB, e))?;
    let changed = conn.execute("UPDATE plugins SET settings = ?2 WHERE id = ?1", params![id, json]).map_err(db_err)?;
    if changed == 0 { Err(with_detail(error_codes::PLUGIN_NOT_FOUND, id)) } else { Ok(()) }
}

/// Removes the row, its storage and every work link that points at it.
pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM plugin_storage WHERE plugin_id = ?1", [id]).map_err(db_err)?;
    conn.execute("DELETE FROM plugin_work_links WHERE plugin_id = ?1", [id]).map_err(db_err)?;
    conn.execute("DELETE FROM plugins WHERE id = ?1", [id]).map_err(db_err)?;
    Ok(())
}

// ── metadea.storage ───────────────────────────────────────────────────────────

fn check_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_STORAGE_KEY_LEN || key.chars().any(char::is_control) {
        return Err(with_detail(error_codes::PLUGIN_STORAGE_LIMIT, "invalid key"));
    }
    Ok(())
}

pub fn storage_get(conn: &Connection, plugin_id: &str, key: &str) -> Result<Option<String>, String> {
    check_key(key)?;
    conn.query_row(
        "SELECT value FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
        params![plugin_id, key],
        |row| row.get(0),
    )
    .optional()
    .map_err(db_err)
}

/// `None` deletes the key. Values are JSON text written by the SDK.
pub fn storage_set(conn: &Connection, plugin_id: &str, key: &str, value: Option<&str>, now: i64) -> Result<(), String> {
    check_key(key)?;
    let Some(value) = value else {
        conn.execute("DELETE FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2", params![plugin_id, key]).map_err(db_err)?;
        return Ok(());
    };
    if value.len() > MAX_STORAGE_VALUE_BYTES {
        return Err(with_detail(error_codes::PLUGIN_STORAGE_LIMIT, "value larger than 1 MB"));
    }
    let others: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB)) + LENGTH(CAST(key AS BLOB))), 0)
             FROM plugin_storage WHERE plugin_id = ?1 AND key <> ?2",
            params![plugin_id, key],
            |row| row.get(0),
        )
        .map_err(db_err)?;
    if others + (value.len() + key.len()) as i64 > MAX_STORAGE_TOTAL_BYTES {
        return Err(with_detail(error_codes::PLUGIN_STORAGE_LIMIT, "plugin storage is full (10 MB)"));
    }
    conn.execute(
        "INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![plugin_id, key, value, now],
    )
    .map(|_| ())
    .map_err(db_err)
}

// ── Work links ("Read" tab) ───────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkLink {
    pub plugin_id: String,
    pub source_id: String,
    pub item_id: String,
    #[serde(default)]
    pub item_title: String,
}

pub fn work_link_get(conn: &Connection, external_id: &str) -> Result<Option<WorkLink>, String> {
    conn.query_row(
        "SELECT plugin_id, source_id, item_id, item_title FROM plugin_work_links WHERE external_id = ?1",
        [external_id],
        |row| Ok(WorkLink { plugin_id: row.get(0)?, source_id: row.get(1)?, item_id: row.get(2)?, item_title: row.get(3)? }),
    )
    .optional()
    .map_err(db_err)
}

pub fn work_link_set(conn: &Connection, external_id: &str, link: Option<&WorkLink>, now: i64) -> Result<(), String> {
    match link {
        None => conn.execute("DELETE FROM plugin_work_links WHERE external_id = ?1", [external_id]).map(|_| ()),
        Some(link) => conn
            .execute(
                "INSERT INTO plugin_work_links (external_id, plugin_id, source_id, item_id, item_title, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(external_id) DO UPDATE SET plugin_id = excluded.plugin_id, source_id = excluded.source_id,
                     item_id = excluded.item_id, item_title = excluded.item_title, updated_at = excluded.updated_at",
                params![external_id, link.plugin_id, link.source_id, link.item_id, link.item_title, now],
            )
            .map(|_| ()),
    }
    .map_err(db_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::MetadeaDb;

    fn db() -> MetadeaDb {
        MetadeaDb::open_in_memory().unwrap()
    }

    fn tokens(list: &[&str]) -> BTreeSet<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn install_update_keeps_enabled_and_settings() {
        let db = db();
        let conn = db.conn.lock().unwrap();
        upsert_install(&conn, "com.example.a", "1.0.0", &tokens(&["host:a.example.com"]), 10).unwrap();
        let row = require(&conn, "com.example.a").unwrap();
        assert!(row.enabled);
        assert_eq!(row.granted, tokens(&["host:a.example.com"]));

        set_enabled(&conn, "com.example.a", false).unwrap();
        let mut settings = Map::new();
        settings.insert("server".into(), Value::String("http://nas:4567".into()));
        set_settings(&conn, "com.example.a", &settings).unwrap();

        upsert_install(&conn, "com.example.a", "1.1.0", &tokens(&["host:a.example.com", "cap:notifications"]), 20).unwrap();
        let row = require(&conn, "com.example.a").unwrap();
        assert_eq!(row.version, "1.1.0");
        assert!(!row.enabled, "an update keeps the plugin disabled");
        assert_eq!(row.settings, settings);
        assert_eq!(row.installed_at, 10);
        assert_eq!(row.updated_at, 20);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn storage_is_namespaced_and_capped() {
        let db = db();
        let conn = db.conn.lock().unwrap();
        storage_set(&conn, "com.example.a", "k", Some("\"a\""), 1).unwrap();
        storage_set(&conn, "com.example.b", "k", Some("\"b\""), 1).unwrap();
        assert_eq!(storage_get(&conn, "com.example.a", "k").unwrap().as_deref(), Some("\"a\""));
        assert_eq!(storage_get(&conn, "com.example.b", "k").unwrap().as_deref(), Some("\"b\""));
        storage_set(&conn, "com.example.a", "k", None, 2).unwrap();
        assert_eq!(storage_get(&conn, "com.example.a", "k").unwrap(), None);

        let big = "x".repeat(MAX_STORAGE_VALUE_BYTES + 1);
        assert!(storage_set(&conn, "com.example.a", "big", Some(&big), 3).unwrap_err().starts_with(error_codes::PLUGIN_STORAGE_LIMIT));
        assert!(storage_get(&conn, "com.example.a", "").is_err());

        let chunk = "y".repeat(MAX_STORAGE_VALUE_BYTES - 10);
        for i in 0..9 {
            storage_set(&conn, "com.example.a", &format!("c{i}"), Some(&chunk), 4).unwrap();
        }
        let full = storage_set(&conn, "com.example.a", "c9", Some(&chunk), 4).and_then(|_| storage_set(&conn, "com.example.a", "c10", Some(&chunk), 4));
        assert!(full.unwrap_err().starts_with(error_codes::PLUGIN_STORAGE_LIMIT));
        // Overwriting an existing key does not count its old value.
        storage_set(&conn, "com.example.a", "c0", Some(&chunk), 5).unwrap();
    }

    #[test]
    fn work_links_and_uninstall_cleanup() {
        let db = db();
        let conn = db.conn.lock().unwrap();
        upsert_install(&conn, "com.example.a", "1.0.0", &BTreeSet::new(), 1).unwrap();
        let link = WorkLink { plugin_id: "com.example.a".into(), source_id: "main".into(), item_id: "42".into(), item_title: "T".into() };
        work_link_set(&conn, "manga:1", Some(&link), 1).unwrap();
        assert_eq!(work_link_get(&conn, "manga:1").unwrap(), Some(link));
        storage_set(&conn, "com.example.a", "k", Some("1"), 1).unwrap();

        delete(&conn, "com.example.a").unwrap();
        assert_eq!(get(&conn, "com.example.a").unwrap(), None);
        assert_eq!(work_link_get(&conn, "manga:1").unwrap(), None);
        assert_eq!(storage_get(&conn, "com.example.a", "k").unwrap(), None);
    }
}
