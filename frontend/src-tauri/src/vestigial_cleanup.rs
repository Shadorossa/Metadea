// "Delete this leftover artifact from users' local .db" — kept separate from
// db.rs's schema migrations, which add/change structure the app still uses.
use rusqlite::Connection;
use crate::db::ToStringErr;

// Superseded: re-derivable live from ALTERNATIVE edges (pr-editor-load.ts).
pub fn drop_media_saga_groups(conn: &Connection) {
    let _ = conn.execute("DROP TABLE IF EXISTS media_saga_groups", []);
}

// Migration 92. Leftovers found in a real install, all empty there:
// - staff_appearances: m12's rename to media_staff_relation is skipped when
//   METADEA_SCHEMA already created the new name, leaving the old table behind.
// - media_saga_groups: m23 dropped it, but METADEA_SCHEMA still created it at
//   the time, so the next start brought it back.
// - local_anime_folders: created by METADEA_SCHEMA, never read or written.
// - the 'characters_fav' list: created by the old key mismatch fixed in
//   character-page-data.ts; the real list is 'character_fav'. Any items are
//   moved there before it goes.
pub(crate) fn drop_unused_tables_and_lists(tx: &rusqlite::Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "DROP TABLE IF EXISTS staff_appearances;
         DROP TABLE IF EXISTS media_saga_groups;
         DROP TABLE IF EXISTS local_anime_folders;
         INSERT OR IGNORE INTO user_list_items (list_key, external_id, position, added_at)
             SELECT 'character_fav', external_id, position, added_at
             FROM user_list_items
             WHERE list_key = 'characters_fav'
               AND EXISTS (SELECT 1 FROM user_lists WHERE key = 'character_fav');
         DELETE FROM user_list_items WHERE list_key = 'characters_fav';
         DELETE FROM user_lists WHERE key = 'characters_fav';",
    )
}

// Normalización de IDs de personajes a character:<code>:<id> (a/co/ms).
pub fn fix_character_ids(conn: &Connection) {
    // Fusionar metadatos de filas huérfanas numéricas a su versión canónica character:a:<id>
    let _ = conn.execute(
        "UPDATE characters
         SET name_native = COALESCE(name_native, (SELECT t2.name_native FROM characters t2 WHERE t2.external_id = substr(characters.external_id, 13))),
             aliases_csv = COALESCE(aliases_csv, (SELECT t2.aliases_csv FROM characters t2 WHERE t2.external_id = substr(characters.external_id, 13))),
             biography   = COALESCE(biography, (SELECT t2.biography FROM characters t2 WHERE t2.external_id = substr(characters.external_id, 13))),
             gender      = COALESCE(gender, (SELECT t2.gender FROM characters t2 WHERE t2.external_id = substr(characters.external_id, 13))),
             age         = COALESCE(age, (SELECT t2.age FROM characters t2 WHERE t2.external_id = substr(characters.external_id, 13))),
             blood_type  = COALESCE(blood_type, (SELECT t2.blood_type FROM characters t2 WHERE t2.external_id = substr(characters.external_id, 13)))
         WHERE external_id GLOB 'character:a:[0-9]*'
           AND EXISTS (
             SELECT 1 FROM characters t2 WHERE t2.external_id = substr(characters.external_id, 13)
           )",
        [],
    );

    let configs: &[(&str, &str, &str)] = &[
        ("characters", "external_id", ""),
        ("character_actors", "character_external_id", "AND t2.actor_external_id = {table}.actor_external_id"),
        ("character_appearances", "character_external_id", "AND t2.media_external_id = {table}.media_external_id"),
        ("user_list_items", "external_id", "AND t2.list_key = {table}.list_key"),
        ("tier_list_items", "external_id", "AND t2.tier_list_id = {table}.tier_list_id"),
        ("favorite_custom_images", "external_id", ""),
    ];

    let rewrites = [
        ("character:comicvine:", "character:co:"),
        ("character:tmdb:", "character:ms:"),
        ("character:[0-9]*", "character:a:"),
        ("[0-9]*", "character:a:"),
    ];

    for (table, column, composite_join) in configs {
        let join_cond = composite_join.replace("{table}", table);
        for (old_prefix, new_prefix) in rewrites {
            let is_bare_numeric = old_prefix == "[0-9]*";
            let skip_len = if is_bare_numeric {
                0
            } else if old_prefix.ends_with('*') {
                "character:".len()
            } else {
                old_prefix.len()
            };
            let glob_pattern = if old_prefix.ends_with('*') { old_prefix.to_string() } else { format!("{old_prefix}*") };
            let pos = skip_len + 1;
            let numeric_filter = if is_bare_numeric { "AND {column} NOT GLOB '*[^0-9]*'" } else { "" };
            let numeric_filter = numeric_filter.replace("{column}", column);

            let delete_sql = format!(
                "DELETE FROM {table}
                 WHERE {column} GLOB '{glob_pattern}' {numeric_filter}
                   AND EXISTS (
                     SELECT 1 FROM {table} t2
                     WHERE t2.{column} = '{new_prefix}' || substr({table}.{column}, {pos}) {join_cond}
                   )"
            );
            let _ = conn.execute(&delete_sql, []);

            let update_sql = format!(
                "UPDATE {table} SET {column} = '{new_prefix}' || substr({column}, {pos})
                 WHERE {column} GLOB '{glob_pattern}' {numeric_filter}"
            );
            let _ = conn.execute(&update_sql, []);
        }
    }
}

#[tauri::command]
pub async fn fix_character_ids_command(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    fix_character_ids(&conn);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_exists(conn: &Connection, table: &str) -> bool {
        conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |r| r.get::<_, i64>(0))
            .unwrap() > 0
    }

    #[test]
    fn a_fresh_install_has_none_of_the_leftovers() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        for table in ["staff_appearances", "media_saga_groups", "local_anime_folders"] {
            assert!(!table_exists(&conn, table), "{table}");
        }
    }

    #[test]
    fn drops_the_leftovers_and_moves_characters_fav_items_to_character_fav() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let mut conn = db.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE staff_appearances (staff_external_id TEXT, media_external_id TEXT);
             CREATE TABLE media_saga_groups (group_name TEXT, media_external_id TEXT PRIMARY KEY);
             CREATE TABLE local_anime_folders (anilist_id INTEGER PRIMARY KEY, folder_path TEXT NOT NULL);
             INSERT OR IGNORE INTO user_lists (key, name, is_fav) VALUES ('character_fav', 'Personajes favoritos', 1);
             INSERT INTO user_lists (key, name, is_fav) VALUES ('characters_fav', 'characters_fav', 1);
             INSERT INTO user_list_items (list_key, external_id, position) VALUES
                 ('characters_fav', 'character:a:1', 0),
                 ('characters_fav', 'character:a:2', 1),
                 ('character_fav', 'character:a:2', 0);",
        )
        .unwrap();

        let tx = conn.transaction().unwrap();
        drop_unused_tables_and_lists(&tx).unwrap();
        tx.commit().unwrap();

        for table in ["staff_appearances", "media_saga_groups", "local_anime_folders"] {
            assert!(!table_exists(&conn, table), "{table}");
        }
        let lists: i64 = conn.query_row("SELECT COUNT(*) FROM user_lists WHERE key = 'characters_fav'", [], |r| r.get(0)).unwrap();
        assert_eq!(lists, 0);
        let mut moved: Vec<String> = conn
            .prepare("SELECT external_id FROM user_list_items WHERE list_key = 'character_fav' ORDER BY external_id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        moved.dedup();
        assert_eq!(moved, ["character:a:1", "character:a:2"]);
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM user_list_items WHERE list_key = 'characters_fav'", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
