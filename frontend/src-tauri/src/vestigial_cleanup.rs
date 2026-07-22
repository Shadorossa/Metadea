// "Delete this leftover artifact from users' local .db" — kept separate from
// db.rs's schema migrations, which add/change structure the app still uses.
use rusqlite::Connection;

// Superseded: re-derivable live from ALTERNATIVE edges (pr-editor-load.ts).
pub fn drop_media_saga_groups(conn: &Connection) {
    let _ = conn.execute("DROP TABLE IF EXISTS media_saga_groups", []);
}
