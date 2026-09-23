// Tier lists (/tier, /tier/new): a board of coloured rows plus an unranked
// pool. The editor autosaves the whole board through `save_tier_list` — one
// transaction replaces the list's header and every placement, so an undo
// that brings back a removed item, or a row reorder, can never be half
// applied. Items keep a title/cover/type snapshot (tier_list_items.title …)
// so a character or a search result without a local catalog row still
// renders; a catalog or characters row, when there is one, wins.
use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use crate::db::ToStringErr;
use crate::error_codes;

// TierMaker's default board: S → F on its red → green ramp. Mirrors
// DEFAULT_TIER_ROWS in frontend/src/lib/tier/tier-palette.ts.
const DEFAULT_TIERS_JSON: &str = r##"[{"id":"s","label":"S","color":"#ff7f7f"},{"id":"a","label":"A","color":"#ffbf7f"},{"id":"b","label":"B","color":"#ffdf7f"},{"id":"c","label":"C","color":"#ffff7f"},{"id":"d","label":"D","color":"#bfff7f"},{"id":"f","label":"F","color":"#7fff7f"}]"##;

pub const POOL_KEY: &str = "pool";
// Preview thumbnails per row on the /tier index cards.
const PREVIEW_PER_ROW: i64 = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierDef {
    pub id:    String,
    pub label: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierPreviewItem {
    pub external_id: String,
    pub tier_key:    String,
    pub cover_url:   Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierListInfo {
    pub id:          String,
    pub name:        String,
    pub description: String,
    pub list_type:   String,
    pub is_public:   bool,
    pub item_count:  i64,
    pub updated_at:  String,
    pub tiers:       Vec<TierDef>,
    pub preview:     Vec<TierPreviewItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierListItemFull {
    pub external_id: String,
    pub tier_key:    String,
    pub position:    i64,
    pub title_main:  Option<String>,
    pub cover_url:   Option<String>,
    pub media_type:  Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierListDetail {
    pub id:          String,
    pub name:        String,
    pub description: String,
    pub list_type:   String,
    pub is_public:   bool,
    /// Display preferences (thumbnail size, titles under covers) — opaque
    /// JSON owned by the frontend (lib/tier/tier-settings.ts).
    pub settings:    serde_json::Value,
    pub updated_at:  String,
    pub tiers:       Vec<TierDef>,
    pub items:       Vec<TierListItemFull>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TierItemSave {
    pub external_id: String,
    pub tier_key:    String,
    pub position:    i64,
    pub title:       Option<String>,
    pub cover_url:   Option<String>,
    pub media_type:  Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TierListSave {
    pub id:          String,
    pub name:        String,
    pub description: String,
    pub is_public:   bool,
    pub settings:    serde_json::Value,
    pub tiers:       Vec<TierDef>,
    pub items:       Vec<TierItemSave>,
}

// Shared by every read: a catalog row, else a characters row, else the
// snapshot saved with the item. Blocked catalog rows are hidden.
const ITEM_META_JOIN: &str =
    "FROM tier_list_items ti
     LEFT JOIN media_catalog mc ON mc.external_id = ti.external_id
     LEFT JOIN characters ch ON ch.external_id = ti.external_id";

fn parse_tiers(json: &str) -> Vec<TierDef> {
    serde_json::from_str(json).unwrap_or_default()
}

/// Drops duplicate ids and placements pointing at a row that no longer
/// exists (sent to the pool instead), then renumbers positions densely per
/// row in the order given. The frontend already keeps this invariant; this
/// is what makes a stale or hand-crafted payload harmless.
pub(crate) fn normalize_items(tiers: &[TierDef], items: Vec<TierItemSave>) -> Vec<TierItemSave> {
    let row_ids: HashSet<&str> = tiers.iter().map(|t| t.id.as_str()).collect();
    let mut seen = HashSet::new();
    let mut kept: Vec<TierItemSave> = items
        .into_iter()
        .filter(|item| !item.external_id.trim().is_empty() && seen.insert(item.external_id.clone()))
        .map(|mut item| {
            if item.tier_key != POOL_KEY && !row_ids.contains(item.tier_key.as_str()) {
                item.tier_key = POOL_KEY.to_string();
                item.position = i64::MAX;
            }
            item
        })
        .collect();
    kept.sort_by(|a, b| a.tier_key.cmp(&b.tier_key).then(a.position.cmp(&b.position)));
    let mut current_key = String::new();
    let mut next = 0;
    for item in &mut kept {
        if item.tier_key != current_key {
            current_key = item.tier_key.clone();
            next = 0;
        }
        item.position = next;
        next += 1;
    }
    kept
}

#[tauri::command]
pub async fn create_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    name: String,
    list_type: String,
) -> Result<String, String> {
    let id = crate::db::generate_id();
    let now = chrono::Utc::now().to_rfc3339();
    let conn = state.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO tier_lists (id, name, list_type, tiers, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, name, list_type, DEFAULT_TIERS_JSON, now],
    ).str_err()?;
    Ok(id)
}

#[tauri::command]
pub async fn get_all_tier_lists(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<Vec<TierListInfo>, String> {
    let conn = state.conn.lock().str_err()?;

    let mut stmt = conn.prepare(
        "SELECT tl.id, tl.name, tl.description, tl.list_type, tl.is_public, tl.tiers,
                COALESCE(tl.updated_at, tl.created_at, ''),
                (SELECT COUNT(*) FROM tier_list_items ti
                   LEFT JOIN media_catalog mc ON mc.external_id = ti.external_id
                  WHERE ti.tier_list_id = tl.id AND mc.blocked_at IS NULL)
         FROM tier_lists tl
         ORDER BY COALESCE(tl.updated_at, tl.created_at) DESC",
    ).str_err()?;

    type Row = (String, String, String, String, bool, String, String, i64);
    let rows: Vec<Row> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))
        .str_err()?
        .collect::<Result<_, _>>()
        .str_err()?;

    let preview_sql = format!(
        "SELECT external_id, tier_key, cover FROM (
            SELECT ti.external_id, ti.tier_key,
                   COALESCE(mc.cover_url, ch.image_url, ti.cover_url) AS cover,
                   ROW_NUMBER() OVER (PARTITION BY ti.tier_key ORDER BY ti.position) AS rn
            {ITEM_META_JOIN}
            WHERE ti.tier_list_id = ?1 AND ti.tier_key != '{POOL_KEY}' AND mc.blocked_at IS NULL
         ) WHERE rn <= ?2"
    );
    let mut preview_stmt = conn.prepare(&preview_sql).str_err()?;

    let mut result = Vec::with_capacity(rows.len());
    for (id, name, description, list_type, is_public, tiers_json, updated_at, item_count) in rows {
        let preview: Vec<TierPreviewItem> = preview_stmt
            .query_map(rusqlite::params![id, PREVIEW_PER_ROW], |r| Ok(TierPreviewItem {
                external_id: r.get(0)?,
                tier_key:    r.get(1)?,
                cover_url:   r.get(2)?,
            }))
            .str_err()?
            .collect::<Result<_, _>>()
            .str_err()?;
        result.push(TierListInfo {
            id, name, description, list_type, is_public, item_count, updated_at,
            tiers: parse_tiers(&tiers_json),
            preview,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    id: String,
) -> Result<TierListDetail, String> {
    let conn = state.conn.lock().str_err()?;
    read_tier_list(&conn, &id)
}

pub(crate) fn read_tier_list(conn: &rusqlite::Connection, id: &str) -> Result<TierListDetail, String> {
    use rusqlite::OptionalExtension;
    let header: Option<(String, String, String, bool, String, String, String)> = conn.query_row(
        "SELECT name, description, list_type, is_public, settings, tiers, COALESCE(updated_at, created_at, '')
         FROM tier_lists WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
    ).optional().str_err()?;
    let Some((name, description, list_type, is_public, settings_json, tiers_json, updated_at)) = header else {
        return Err(error_codes::TIER_LIST_NOT_FOUND.to_string());
    };

    let sql = format!(
        "SELECT ti.external_id, ti.tier_key, ti.position,
                COALESCE(mc.title_main, ch.name, ti.title),
                COALESCE(mc.cover_url, ch.image_url, ti.cover_url),
                COALESCE(mc.type, CASE WHEN ch.external_id IS NOT NULL THEN 'character' END, ti.media_type)
         {ITEM_META_JOIN}
         WHERE ti.tier_list_id = ?1 AND mc.blocked_at IS NULL
         ORDER BY ti.tier_key, ti.position"
    );
    let mut stmt = conn.prepare(&sql).str_err()?;
    let items: Vec<TierListItemFull> = stmt.query_map([id], |r| {
        Ok(TierListItemFull {
            external_id: r.get(0)?,
            tier_key:    r.get(1)?,
            position:    r.get(2)?,
            title_main:  r.get(3)?,
            cover_url:   r.get(4)?,
            media_type:  r.get(5)?,
        })
    }).str_err()?.collect::<Result<_, _>>().str_err()?;

    Ok(TierListDetail {
        id: id.to_string(),
        name,
        description,
        list_type,
        is_public,
        settings: serde_json::from_str(&settings_json).unwrap_or_else(|_| serde_json::json!({})),
        updated_at,
        tiers: parse_tiers(&tiers_json),
        items,
    })
}

#[tauri::command]
pub async fn delete_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    id: String,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    tx.execute("DELETE FROM tier_list_items WHERE tier_list_id = ?1", [&id]).str_err()?;
    tx.execute("DELETE FROM tier_lists WHERE id = ?1", [&id]).str_err()?;
    tx.commit().str_err()
}

#[tauri::command]
pub async fn save_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    payload: TierListSave,
) -> Result<String, String> {
    let mut conn = state.conn.lock().str_err()?;
    write_tier_list(&mut conn, payload)
}

/// Replaces a list's header and placements atomically; returns the new
/// updated_at.
pub(crate) fn write_tier_list(conn: &mut rusqlite::Connection, payload: TierListSave) -> Result<String, String> {
    let TierListSave { id, name, description, is_public, settings, tiers, items } = payload;
    let tiers_json = serde_json::to_string(&tiers).str_err()?;
    let settings_json = serde_json::to_string(&settings).str_err()?;
    let items = normalize_items(&tiers, items);
    let now = chrono::Utc::now().to_rfc3339();

    let tx = conn.transaction().str_err()?;
    let changed = tx.execute(
        "UPDATE tier_lists SET name = ?1, description = ?2, is_public = ?3, settings = ?4, tiers = ?5, updated_at = ?6
         WHERE id = ?7",
        rusqlite::params![name, description, is_public, settings_json, tiers_json, now, id],
    ).str_err()?;
    if changed == 0 {
        return Err(error_codes::TIER_LIST_NOT_FOUND.to_string());
    }
    // Items hidden because their catalog row is blocked never reach the
    // editor, so they are not in `items` either: keep them instead of
    // treating their absence as a removal.
    tx.execute(
        "DELETE FROM tier_list_items WHERE tier_list_id = ?1
           AND external_id NOT IN (SELECT external_id FROM media_catalog WHERE blocked_at IS NOT NULL)",
        [&id],
    ).str_err()?;
    {
        let mut insert = tx.prepare(
            "INSERT OR REPLACE INTO tier_list_items (tier_list_id, external_id, tier_key, position, title, cover_url, media_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        ).str_err()?;
        for item in &items {
            insert.execute(rusqlite::params![
                id, item.external_id, item.tier_key, item.position, item.title, item.cover_url, item.media_type,
            ]).str_err()?;
        }
    }
    tx.commit().str_err()?;
    Ok(now)
}

#[tauri::command]
pub async fn duplicate_tier_list(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    id: String,
    name: String,
) -> Result<String, String> {
    let mut conn = state.conn.lock().str_err()?;
    copy_tier_list(&mut conn, &id, &name)
}

pub(crate) fn copy_tier_list(conn: &mut rusqlite::Connection, id: &str, name: &str) -> Result<String, String> {
    let new_id = crate::db::generate_id();
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().str_err()?;
    let copied = tx.execute(
        "INSERT INTO tier_lists (id, name, description, list_type, is_public, settings, tiers, created_at, updated_at)
         SELECT ?1, ?2, description, list_type, 0, settings, tiers, ?3, ?3 FROM tier_lists WHERE id = ?4",
        rusqlite::params![new_id, name, now, id],
    ).str_err()?;
    if copied == 0 {
        return Err(error_codes::TIER_LIST_NOT_FOUND.to_string());
    }
    tx.execute(
        "INSERT INTO tier_list_items (tier_list_id, external_id, tier_key, position, title, cover_url, media_type)
         SELECT ?1, external_id, tier_key, position, title, cover_url, media_type
         FROM tier_list_items WHERE tier_list_id = ?2",
        rusqlite::params![new_id, id],
    ).str_err()?;
    tx.commit().str_err()?;
    Ok(new_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn tiers() -> Vec<TierDef> {
        vec![
            TierDef { id: "s".into(), label: "S".into(), color: "#ff7f7f".into() },
            TierDef { id: "a".into(), label: "A".into(), color: "#ffbf7f".into() },
        ]
    }

    fn item(id: &str, key: &str, position: i64) -> TierItemSave {
        TierItemSave {
            external_id: id.into(), tier_key: key.into(), position,
            title: Some(format!("Title {id}")), cover_url: None, media_type: Some("anime".into()),
        }
    }

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::ensure_base_schema(&conn).unwrap();
        crate::migrations::run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn default_tiers_parse() {
        let parsed = parse_tiers(DEFAULT_TIERS_JSON);
        assert_eq!(parsed.iter().map(|t| t.label.as_str()).collect::<Vec<_>>(), ["S", "A", "B", "C", "D", "F"]);
    }

    #[test]
    fn normalize_drops_duplicates_and_orphans_and_renumbers() {
        let out = normalize_items(&tiers(), vec![
            item("anime:1", "s", 5),
            item("anime:2", "s", 2),
            item("anime:1", "a", 0),
            item("anime:3", "gone", 0),
            item("anime:4", "pool", 0),
            item("  ", "pool", 1),
        ]);
        let got: Vec<(&str, &str, i64)> = out.iter().map(|i| (i.external_id.as_str(), i.tier_key.as_str(), i.position)).collect();
        assert_eq!(got, [("anime:4", "pool", 0), ("anime:3", "pool", 1), ("anime:2", "s", 0), ("anime:1", "s", 1)]);
    }

    #[test]
    fn save_read_and_duplicate_round_trip() {
        let mut conn = db();
        conn.execute(
            "INSERT INTO tier_lists (id, name, list_type, tiers) VALUES ('t1', 'Old', 'works', ?1)",
            [DEFAULT_TIERS_JSON],
        ).unwrap();
        write_tier_list(&mut conn, TierListSave {
            id: "t1".into(), name: "Best".into(), description: "desc".into(), is_public: true,
            settings: serde_json::json!({ "thumb_size": "large" }),
            tiers: tiers(),
            items: vec![item("anime:1", "s", 0), item("character:a:9", "pool", 0)],
        }).unwrap();

        let detail = read_tier_list(&conn, "t1").unwrap();
        assert_eq!(detail.name, "Best");
        assert!(detail.is_public);
        assert_eq!(detail.settings["thumb_size"], "large");
        assert_eq!(detail.tiers.len(), 2);
        // No catalog/character rows: the snapshot is what renders.
        let character = detail.items.iter().find(|i| i.external_id == "character:a:9").unwrap();
        assert_eq!(character.title_main.as_deref(), Some("Title character:a:9"));

        // A save replaces placements: dropping an item removes it.
        write_tier_list(&mut conn, TierListSave {
            id: "t1".into(), name: "Best".into(), description: String::new(), is_public: false,
            settings: serde_json::json!({}), tiers: tiers(), items: vec![item("anime:1", "a", 0)],
        }).unwrap();
        let detail = read_tier_list(&conn, "t1").unwrap();
        assert_eq!(detail.items.len(), 1);
        assert_eq!(detail.items[0].tier_key, "a");

        let copy = copy_tier_list(&mut conn, "t1", "Copy").unwrap();
        let copied = read_tier_list(&conn, &copy).unwrap();
        assert_eq!(copied.name, "Copy");
        assert_eq!(copied.items.len(), 1);
        assert!(!copied.is_public);
    }

    #[test]
    fn save_keeps_items_hidden_by_a_blocked_catalog_row() {
        let mut conn = db();
        conn.execute("INSERT INTO tier_lists (id, name, list_type, tiers) VALUES ('t1', 'L', 'works', ?1)", [DEFAULT_TIERS_JSON]).unwrap();
        conn.execute("INSERT INTO media_catalog (id, external_id, type, blocked_at) VALUES ('m1', 'anime:9', 'anime', '2026-01-01')", []).unwrap();
        conn.execute("INSERT INTO tier_list_items (tier_list_id, external_id, tier_key, position) VALUES ('t1', 'anime:9', 's', 0)", []).unwrap();
        assert!(read_tier_list(&conn, "t1").unwrap().items.is_empty());
        write_tier_list(&mut conn, TierListSave {
            id: "t1".into(), name: "L".into(), description: String::new(), is_public: false,
            settings: serde_json::json!({}), tiers: tiers(), items: vec![item("anime:1", "s", 0)],
        }).unwrap();
        let kept: i64 = conn.query_row("SELECT COUNT(*) FROM tier_list_items WHERE tier_list_id = 't1'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 2);
    }

    #[test]
    fn missing_list_is_a_code() {
        let mut conn = db();
        assert_eq!(read_tier_list(&conn, "nope").unwrap_err(), error_codes::TIER_LIST_NOT_FOUND);
        let err = write_tier_list(&mut conn, TierListSave {
            id: "nope".into(), name: String::new(), description: String::new(), is_public: false,
            settings: serde_json::json!({}), tiers: vec![], items: vec![],
        }).unwrap_err();
        assert_eq!(err, error_codes::TIER_LIST_NOT_FOUND);
    }
}
