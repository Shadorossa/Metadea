// One place for "delete this leftover artifact from users' local .db" —
// nothing here changes what the schema can *do*, it only removes tables/
// columns/rows that a past feature left behind after being superseded, so
// this stays separate from db.rs's regular schema migrations (which add or
// change structure the app still relies on). Called once per version bump
// from run_migrations, same as any other migration.
use rusqlite::Connection;

// media_saga_groups persisted "alternate version" clustering as its own
// table, but nothing besides PrEditorModal's own reload ever needed it — it's
// fully re-derivable from ALTERNATIVE edges in media_relations, which are
// already durable (see pr-editor-load.ts). Superseded, not replaced by
// anything else here.
pub fn drop_media_saga_groups(conn: &Connection) {
    let _ = conn.execute("DROP TABLE IF EXISTS media_saga_groups", []);
}
