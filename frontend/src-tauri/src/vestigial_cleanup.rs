// "Delete this leftover artifact from users' local .db" — kept separate from
// db.rs's schema migrations, which add/change structure the app still uses.
use rusqlite::Connection;
use crate::db::ToStringErr;

// Superseded: re-derivable live from ALTERNATIVE edges (pr-editor-load.ts).
pub fn drop_media_saga_groups(conn: &Connection) {
    let _ = conn.execute("DROP TABLE IF EXISTS media_saga_groups", []);
}

// TEMPORARY — safe to delete this function (and its call site in db.rs's
// `if v < 40` block) once this has shipped for a while and every active
// user's db has long since passed through it once.
//
// character:<N> never distinguished which provider <N> belongs to — AniList
// used bare "character:<N>", while Comic Vine and TMDB each glued their own
// provider tag on ("character:comicvine:<N>", "character:tmdb:<credit_id>")
// instead of a real, consistently-shaped provider code. Rewritten to
// character:<code>:<id> for all three (a/co/ms), leaving room for a future
// character:cu:<N> (user-created characters) without any of them colliding
// on id space. Every affected column gets all three old->new rewrites:
// characters/favorite_custom_images (PRIMARY KEY/UNIQUE — guarded against a
// target id that already exists, which would otherwise abort the whole
// migration on a constraint violation) and character_actors/
// character_appearances/user_list_items (composite key or scoped by
// list_key — collision is unrealistic there, but guarded anyway for
// consistency).
pub fn fix_character_ids(conn: &Connection) {
    for (table, column, extra_where) in [
        ("characters", "external_id", ""),
        ("character_actors", "character_external_id", ""),
        ("character_appearances", "character_external_id", ""),
        ("user_list_items", "external_id", "AND list_key = 'character_fav'"),
        ("favorite_custom_images", "external_id", ""),
    ] {
        for (old_prefix, new_prefix) in [
            ("character:comicvine:", "character:co:"),
            ("character:tmdb:", "character:ms:"),
            ("character:[0-9]*", "character:a:"),
        ] {
            let skip_len = if old_prefix.ends_with('*') { "character:".len() } else { old_prefix.len() };
            let glob_pattern = if old_prefix.ends_with('*') { old_prefix.to_string() } else { format!("{old_prefix}*") };
            let sql = format!(
                "UPDATE {table} SET {column} = '{new_prefix}' || substr({column}, {pos})
                 WHERE {column} GLOB '{glob_pattern}' {extra_where}
                   AND NOT EXISTS (
                     SELECT 1 FROM {table} t2
                     WHERE t2.{column} = '{new_prefix}' || substr({table}.{column}, {pos}) {extra_where}
                   )",
                pos = skip_len + 1,
            );
            let _ = conn.execute(&sql, []);
        }
    }
}

// TEMPORARY — manual trigger for fix_character_ids above (Settings >
// Novedades' "Reparar ids de personajes" button), for a user whose db.rs
// migration already ran before this fixup covered comicvine:/tmdb: rows and
// favorite_custom_images. Delete alongside fix_character_ids.
#[tauri::command]
pub async fn fix_character_ids_command(
    state: tauri::State<'_, crate::db::MetadeaDb>,
) -> Result<(), String> {
    let conn = state.conn.lock().str_err()?;
    fix_character_ids(&conn);
    Ok(())
}
