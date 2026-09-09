// "Delete this leftover artifact from users' local .db" — kept separate from
// db.rs's schema migrations, which add/change structure the app still uses.
use rusqlite::Connection;
use crate::db::ToStringErr;

// Superseded: re-derivable live from ALTERNATIVE edges (pr-editor-load.ts).
pub fn drop_media_saga_groups(conn: &Connection) {
    let _ = conn.execute("DROP TABLE IF EXISTS media_saga_groups", []);
}

// Normalización de IDs de personajes a character:<code>:<id> (a/co/ms).
pub fn fix_character_ids(conn: &Connection) {
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
    ];

    for (table, column, composite_join) in configs {
        let join_cond = composite_join.replace("{table}", table);
        for (old_prefix, new_prefix) in rewrites {
            let skip_len = if old_prefix.ends_with('*') { "character:".len() } else { old_prefix.len() };
            let glob_pattern = if old_prefix.ends_with('*') { old_prefix.to_string() } else { format!("{old_prefix}*") };
            let pos = skip_len + 1;

            let delete_sql = format!(
                "DELETE FROM {table}
                 WHERE {column} GLOB '{glob_pattern}'
                   AND EXISTS (
                     SELECT 1 FROM {table} t2
                     WHERE t2.{column} = '{new_prefix}' || substr({table}.{column}, {pos}) {join_cond}
                   )"
            );
            let _ = conn.execute(&delete_sql, []);

            let update_sql = format!(
                "UPDATE {table} SET {column} = '{new_prefix}' || substr({column}, {pos})
                 WHERE {column} GLOB '{glob_pattern}'"
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
