// Character reactions — the character page's "Like / Interested / Dislike"
// buttons and the profile Overview's character view.
//
// Stored in the custom lists system (user_lists + user_list_items) as three
// reserved lists, one per reaction. They are hidden: every query that lists
// the user's lists (get_all_user_lists → Lists tab, list pickers, the
// profile sync's `lists`) filters HIDDEN_LIST_KEYS_SQL out, and they are
// seeded with is_fav = 0 so the favourites readers never see them either.
// A character sits in at most one of the three — set_reaction removes it
// from the other two in the same transaction.
//
// Before this, the reaction was a `characters.reaction` column; seed_lists
// moves any value still there into the matching list once and clears it.
//
// Other users' reactions (their synced profile) are cached per social user
// in social_character_reactions and read back with the same shape.
use crate::db::ToStringErr;
use crate::error_codes;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Manager;

pub const LIKE_KEY: &str = "char_like";
pub const INTEREST_KEY: &str = "char_interest";
pub const DISLIKE_KEY: &str = "char_dislike";

/// For `WHERE key NOT IN …` / `list_key IN …` on user_lists(_items).
pub const HIDDEN_LIST_KEYS_SQL: &str = "('char_like', 'char_interest', 'char_dislike')";

/// (reaction, list key) — also the display order.
const REACTIONS: &[(&str, &str)] = &[("like", LIKE_KEY), ("interest", INTEREST_KEY), ("dislike", DISLIKE_KEY)];

pub fn is_reaction_list_key(key: &str) -> bool {
    REACTIONS.iter().any(|(_, k)| *k == key)
}

pub(crate) fn reaction_for_key(key: &str) -> Option<&'static str> {
    REACTIONS.iter().find(|(_, k)| *k == key).map(|(r, _)| *r)
}

/// The list a reaction value lives in: Ok(None) is "no reaction". The old
/// page stored "interested", still accepted.
fn list_key_for(reaction: Option<&str>) -> Result<Option<&'static str>, String> {
    match reaction.map(str::trim) {
        None | Some("") | Some("none") => Ok(None),
        Some("like") => Ok(Some(LIKE_KEY)),
        Some("interest") | Some("interested") => Ok(Some(INTEREST_KEY)),
        Some("dislike") => Ok(Some(DISLIKE_KEY)),
        Some(other) => Err(error_codes::with_detail(error_codes::CHARACTER_REACTION_INVALID, other)),
    }
}

fn ensure_lists(conn: &Connection) -> rusqlite::Result<()> {
    for (_, key) in REACTIONS {
        conn.execute(
            "INSERT OR IGNORE INTO user_lists (key, name, is_fav, is_private, list_type) VALUES (?1, ?1, 0, 1, 'characters')",
            [key],
        )?;
    }
    Ok(())
}

/// Startup seed (lib.rs, next to seed_fav_lists). Idempotent: the lists are
/// INSERT OR IGNORE, and a legacy `characters.reaction` value is cleared once
/// it has been moved, so a second run finds nothing to move.
pub fn seed_lists(conn: &mut Connection) -> Result<(), String> {
    let tx = conn.transaction().str_err()?;
    ensure_lists(&tx).str_err()?;
    let legacy: Vec<(String, String)> = {
        let mut stmt = tx.prepare(
            "SELECT external_id, reaction FROM characters
             WHERE reaction IS NOT NULL ORDER BY updated_at, external_id",
        ).str_err()?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).str_err()?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for (external_id, reaction) in &legacy {
        // An unknown legacy value is dropped, not an error — nothing could
        // ever display it.
        let Ok(Some(key)) = list_key_for(Some(reaction)) else { continue };
        let already: bool = tx.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM user_list_items WHERE external_id = ?1 AND list_key IN {HIDDEN_LIST_KEYS_SQL})"),
            [external_id],
            |r| r.get(0),
        ).str_err()?;
        if !already {
            insert_at_end(&tx, key, external_id)?;
        }
    }
    if !legacy.is_empty() {
        tx.execute("UPDATE characters SET reaction = NULL WHERE reaction IS NOT NULL", []).str_err()?;
    }
    tx.commit().str_err()
}

pub fn seed_character_reaction_lists(db: &crate::db::MetadeaDb) {
    let Ok(mut conn) = db.conn.lock() else { return };
    if let Err(error) = seed_lists(&mut conn) {
        eprintln!("[character_reactions] seed failed: {error}");
    }
}

fn insert_at_end(conn: &Connection, key: &str, external_id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO user_list_items (list_key, external_id, position, added_at)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM user_list_items WHERE list_key = ?1), ?3)",
        rusqlite::params![key, external_id, now],
    ).str_err()?;
    Ok(())
}

/// Sets (or clears, with None) a character's reaction. Keeps its position
/// when it already has this reaction; otherwise it is appended to the list.
pub(crate) fn set_reaction(conn: &mut Connection, external_id: &str, reaction: Option<&str>) -> Result<(), String> {
    let key = list_key_for(reaction)?;
    let tx = conn.transaction().str_err()?;
    ensure_lists(&tx).str_err()?;
    tx.execute(
        &format!("DELETE FROM user_list_items WHERE external_id = ?1 AND list_key IN {HIDDEN_LIST_KEYS_SQL} AND list_key <> COALESCE(?2, '')"),
        rusqlite::params![external_id, key],
    ).str_err()?;
    if let Some(key) = key {
        insert_at_end(&tx, key, external_id)?;
    }
    tx.commit().str_err()
}

pub(crate) fn load_reaction(conn: &Connection, external_id: &str) -> Result<Option<String>, String> {
    let key: Option<String> = conn.query_row(
        &format!("SELECT list_key FROM user_list_items WHERE external_id = ?1 AND list_key IN {HIDDEN_LIST_KEYS_SQL}
                  ORDER BY position LIMIT 1"),
        [external_id],
        |r| r.get(0),
    ).optional().str_err()?;
    Ok(key.as_deref().and_then(reaction_for_key).map(str::to_string))
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct CharacterReactionItem {
    pub external_id: String,
    pub name: Option<String>,
    /// Portrait: a remote URL, or a stored file path (wrapAssetUrl on the
    /// frontend) — never an inlined data URL.
    pub image_url: Option<String>,
    pub added_at: Option<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct CharacterReactions {
    pub like: Vec<CharacterReactionItem>,
    pub interest: Vec<CharacterReactionItem>,
    pub dislike: Vec<CharacterReactionItem>,
}

impl CharacterReactions {
    fn push(&mut self, reaction: &str, item: CharacterReactionItem) {
        match reaction {
            "like" => self.like.push(item),
            "interest" => self.interest.push(item),
            "dislike" => self.dislike.push(item),
            _ => {}
        }
    }

    fn items_mut(&mut self) -> impl Iterator<Item = &mut CharacterReactionItem> {
        self.like.iter_mut().chain(self.interest.iter_mut()).chain(self.dislike.iter_mut())
    }
}

pub(crate) fn load_reactions(conn: &Connection) -> Result<CharacterReactions, String> {
    let mut stmt = conn.prepare(&format!(
        "SELECT i.list_key, i.external_id, c.name, c.image_url, i.added_at
         FROM user_list_items i
         LEFT JOIN characters c ON c.external_id = i.external_id
         WHERE i.list_key IN {HIDDEN_LIST_KEYS_SQL}
         ORDER BY i.list_key, i.position, i.added_at"
    )).str_err()?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, CharacterReactionItem {
            external_id: r.get(1)?,
            name: r.get(2)?,
            image_url: r.get(3)?,
            added_at: r.get(4)?,
        }))
    }).str_err()?;
    let mut out = CharacterReactions::default();
    for (key, item) in rows.filter_map(|r| r.ok()) {
        if let Some(reaction) = reaction_for_key(&key) { out.push(reaction, item); }
    }
    Ok(out)
}

/// Rewrites one reaction list's order. Ids not in that list are ignored.
pub(crate) fn reorder(conn: &mut Connection, reaction: &str, external_ids: &[String]) -> Result<(), String> {
    let Some(key) = list_key_for(Some(reaction))? else {
        return Err(error_codes::with_detail(error_codes::CHARACTER_REACTION_INVALID, reaction));
    };
    let tx = conn.transaction().str_err()?;
    for (pos, id) in external_ids.iter().enumerate() {
        tx.execute(
            "UPDATE user_list_items SET position = ?1 WHERE list_key = ?2 AND external_id = ?3",
            rusqlite::params![pos as i64, key, id],
        ).str_err()?;
    }
    tx.commit().str_err()
}

fn resolve_images(app_handle: &tauri::AppHandle, reactions: &mut CharacterReactions) -> Result<(), String> {
    let data_dir = app_handle.path().app_data_dir().str_err()?;
    for item in reactions.items_mut() {
        item.image_url = crate::image_storage::resolve_image_path_value(&data_dir, item.image_url.take())?;
    }
    Ok(())
}

// `reaction`: "like" | "interest" | "dislike" | "none" (or null). The
// character needn't be saved locally yet.
#[tauri::command]
pub async fn set_character_reaction(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
    reaction: Option<String>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    set_reaction(&mut conn, &external_id, reaction.as_deref())
}

#[tauri::command]
pub async fn get_character_reaction(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    external_id: String,
) -> Result<Option<String>, String> {
    let conn = state.conn.lock().str_err()?;
    load_reaction(&conn, &external_id)
}

#[tauri::command]
pub async fn get_character_reactions(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<CharacterReactions, String> {
    let mut reactions = {
        let conn = state.conn.lock().str_err()?;
        load_reactions(&conn)?
    };
    resolve_images(&app_handle, &mut reactions)?;
    Ok(reactions)
}

#[tauri::command]
pub async fn reorder_character_reactions(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    reaction: String,
    external_ids: Vec<String>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    reorder(&mut conn, &reaction, &external_ids)
}

// ── Other users' synced reactions (social cache) ─────────────────────────────

/// Upper bound per reaction the cache stores — the app syncs ≤ 500 and the
/// Worker rejects more.
pub const MAX_SOCIAL_REACTIONS_PER_LIST: usize = 500;

#[derive(Debug, Deserialize)]
pub struct SocialReactionEntryInput {
    pub external_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub image_url: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct SocialCharacterReactionsInput {
    pub like: Vec<SocialReactionEntryInput>,
    pub interest: Vec<SocialReactionEntryInput>,
    pub dislike: Vec<SocialReactionEntryInput>,
}

/// Full replace of one social user's cached reactions (None clears them:
/// the profile didn't share any).
pub(crate) fn hydrate_social(
    conn: &mut Connection,
    social_user_id: &str,
    reactions: Option<&SocialCharacterReactionsInput>,
) -> Result<(), String> {
    let tx = conn.transaction().str_err()?;
    tx.execute("DELETE FROM social_character_reactions WHERE social_user_id = ?1", [social_user_id]).str_err()?;
    if let Some(reactions) = reactions {
        for (reaction, entries) in [("like", &reactions.like), ("interest", &reactions.interest), ("dislike", &reactions.dislike)] {
            for (pos, entry) in entries.iter().take(MAX_SOCIAL_REACTIONS_PER_LIST).enumerate() {
                // Primary key (social_user_id, external_id): a character in
                // two lists keeps its first — the same exclusivity as ours.
                tx.execute(
                    "INSERT OR IGNORE INTO social_character_reactions
                     (social_user_id, reaction, external_id, position, name, image_url)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![social_user_id, reaction, entry.external_id, pos as i64, entry.name, entry.image_url],
                ).str_err()?;
            }
        }
    }
    tx.commit().str_err()
}

/// Their reactions, titled/portrayed from YOUR characters table first (same
/// rule as the other social reads) and from what they synced otherwise.
pub(crate) fn load_social(conn: &Connection, social_user_id: &str) -> Result<CharacterReactions, String> {
    let mut stmt = conn.prepare(
        "SELECT s.reaction, s.external_id, COALESCE(c.name, s.name), COALESCE(c.image_url, s.image_url)
         FROM social_character_reactions s
         LEFT JOIN characters c ON c.external_id = s.external_id
         WHERE s.social_user_id = ?1
         ORDER BY s.reaction, s.position",
    ).str_err()?;
    let rows = stmt.query_map([social_user_id], |r| {
        Ok((r.get::<_, String>(0)?, CharacterReactionItem {
            external_id: r.get(1)?,
            name: r.get(2)?,
            image_url: r.get(3)?,
            added_at: None,
        }))
    }).str_err()?;
    let mut out = CharacterReactions::default();
    for (reaction, item) in rows.filter_map(|r| r.ok()) {
        out.push(&reaction, item);
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_social_character_reactions(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, crate::db::MetadeaDb>,
    social_user_id: String,
) -> Result<CharacterReactions, String> {
    let mut reactions = {
        let conn = state.conn.lock().str_err()?;
        load_social(&conn, &social_user_id)?
    };
    resolve_images(&app_handle, &mut reactions)?;
    Ok(reactions)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> crate::db::MetadeaDb {
        crate::db::MetadeaDb::open_in_memory().unwrap()
    }

    fn ids(items: &[CharacterReactionItem]) -> Vec<&str> {
        items.iter().map(|i| i.external_id.as_str()).collect()
    }

    #[test]
    fn a_character_is_in_at_most_one_reaction_list() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        set_reaction(&mut conn, "character:a:1", Some("like")).unwrap();
        set_reaction(&mut conn, "character:a:2", Some("like")).unwrap();
        set_reaction(&mut conn, "character:a:1", Some("dislike")).unwrap();
        set_reaction(&mut conn, "character:a:1", Some("interest")).unwrap();

        let all = load_reactions(&conn).unwrap();
        assert_eq!(ids(&all.like), vec!["character:a:2"]);
        assert_eq!(ids(&all.interest), vec!["character:a:1"]);
        assert!(all.dislike.is_empty());
        let rows: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM user_list_items WHERE external_id = 'character:a:1' AND list_key IN {HIDDEN_LIST_KEYS_SQL}"),
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn toggling_to_none_clears_and_same_reaction_keeps_position() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        for id in ["character:a:1", "character:a:2", "character:a:3"] {
            set_reaction(&mut conn, id, Some("like")).unwrap();
        }
        set_reaction(&mut conn, "character:a:1", Some("like")).unwrap();
        assert_eq!(ids(&load_reactions(&conn).unwrap().like), vec!["character:a:1", "character:a:2", "character:a:3"]);
        assert_eq!(load_reaction(&conn, "character:a:1").unwrap().as_deref(), Some("like"));

        set_reaction(&mut conn, "character:a:1", Some("none")).unwrap();
        set_reaction(&mut conn, "character:a:2", None).unwrap();
        assert_eq!(ids(&load_reactions(&conn).unwrap().like), vec!["character:a:3"]);
        assert_eq!(load_reaction(&conn, "character:a:1").unwrap(), None);

        // The legacy value still maps; garbage is a coded error.
        set_reaction(&mut conn, "character:a:4", Some("interested")).unwrap();
        assert_eq!(load_reaction(&conn, "character:a:4").unwrap().as_deref(), Some("interest"));
        let err = set_reaction(&mut conn, "character:a:4", Some("love")).unwrap_err();
        assert!(err.starts_with(error_codes::CHARACTER_REACTION_INVALID));
        assert_eq!(load_reaction(&conn, "character:a:4").unwrap().as_deref(), Some("interest"));
    }

    #[test]
    fn reorder_rewrites_one_list_only() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        for id in ["character:a:1", "character:a:2", "character:a:3"] {
            set_reaction(&mut conn, id, Some("dislike")).unwrap();
        }
        reorder(&mut conn, "dislike", &["character:a:3".into(), "character:a:1".into(), "character:a:2".into()]).unwrap();
        assert_eq!(ids(&load_reactions(&conn).unwrap().dislike), vec!["character:a:3", "character:a:1", "character:a:2"]);
        assert!(reorder(&mut conn, "none", &[]).is_err());
    }

    #[test]
    fn reaction_lists_are_hidden_from_list_queries() {
        let db = db();
        {
            let mut conn = db.conn.lock().unwrap();
            seed_lists(&mut conn).unwrap();
            set_reaction(&mut conn, "character:a:1", Some("like")).unwrap();
            conn.execute("INSERT INTO user_lists (key, name, is_fav) VALUES ('anime_fav', 'Anime', 1)", []).unwrap();
            conn.execute("INSERT INTO user_lists (key, name, is_fav, list_type) VALUES ('me_1', 'Mine', 0, 'characters')", []).unwrap();
        }
        let conn = db.conn.lock().unwrap();
        let keys = crate::user_lists::load_all_user_lists(&conn).unwrap().into_iter().map(|l| l.key).collect::<Vec<_>>();
        assert_eq!(keys, vec!["anime_fav", "me_1"]);
        let favorites = crate::user_lists::load_user_favorites(&conn).unwrap();
        assert!(favorites.values().all(|ids| !ids.iter().any(|id| id == "character:a:1")));
    }

    #[test]
    fn seed_is_idempotent_and_moves_the_legacy_column_once() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        for (id, reaction, at) in [
            ("character:a:1", "like", "2026-01-01"),
            ("character:a:2", "interested", "2026-01-02"),
            ("character:a:3", "dislike", "2026-01-03"),
            ("character:a:4", "love", "2026-01-04"),
            ("character:a:5", "like", "2026-01-05"),
        ] {
            conn.execute(
                "INSERT INTO characters (id, external_id, name, reaction, created_at, updated_at) VALUES (?1, ?1, ?1, ?2, ?3, ?3)",
                rusqlite::params![id, reaction, at],
            ).unwrap();
        }
        seed_lists(&mut conn).unwrap();
        // The user then clears one: a second seed must not bring it back.
        set_reaction(&mut conn, "character:a:5", None).unwrap();
        seed_lists(&mut conn).unwrap();
        seed_lists(&mut conn).unwrap();

        let lists: i64 = conn.query_row(
            &format!("SELECT COUNT(*) FROM user_lists WHERE key IN {HIDDEN_LIST_KEYS_SQL}"), [], |r| r.get(0),
        ).unwrap();
        assert_eq!(lists, 3);
        let all = load_reactions(&conn).unwrap();
        assert_eq!(ids(&all.like), vec!["character:a:1"]);
        assert_eq!(ids(&all.interest), vec!["character:a:2"]);
        assert_eq!(ids(&all.dislike), vec!["character:a:3"]);
        assert_eq!(all.like[0].name.as_deref(), Some("character:a:1"));
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM characters WHERE reaction IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn social_cache_round_trips_and_prefers_local_characters() {
        let db = db();
        let mut conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO characters (id, external_id, name, image_url, created_at, updated_at) VALUES ('x', 'character:a:1', 'Local', 'https://img/local.png', '', '')",
            [],
        ).unwrap();
        let input: SocialCharacterReactionsInput = serde_json::from_str(r#"{
            "like": [{"external_id":"character:a:1","name":"Synced","image_url":"https://img/s.png"},
                     {"external_id":"character:a:2","name":"Only synced","image_url":null}],
            "dislike": [{"external_id":"character:a:1"}]
        }"#).unwrap();
        hydrate_social(&mut conn, "bob", Some(&input)).unwrap();
        let theirs = load_social(&conn, "bob").unwrap();
        assert_eq!(ids(&theirs.like), vec!["character:a:1", "character:a:2"]);
        assert_eq!(theirs.like[0].name.as_deref(), Some("Local"));
        assert_eq!(theirs.like[1].name.as_deref(), Some("Only synced"));
        assert!(theirs.interest.is_empty() && theirs.dislike.is_empty());
        // Nothing of theirs leaks into your own lists.
        assert!(load_reactions(&conn).unwrap().like.is_empty());

        hydrate_social(&mut conn, "bob", None).unwrap();
        assert!(load_social(&conn, "bob").unwrap().like.is_empty());
    }
}
