// The "event" media type (sports competitions via API-Sports) was removed
// from the app. Its data has no reader left, so it goes:
// - media_event_season / media_event_match (created by m66);
// - library rows for those works, then the media_catalog rows themselves;
// - the stored API-Sports key in app_env.
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "DROP TABLE IF EXISTS media_event_match;
         DROP TABLE IF EXISTS media_event_season;
         DELETE FROM user_library
          WHERE type = 'event'
             OR external_id IN (SELECT external_id FROM media_catalog WHERE type = 'event');
         DELETE FROM media_catalog WHERE type = 'event';
         DELETE FROM app_env WHERE name = 'apisports_api_key';",
    )
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn removes_event_tables_rows_and_key() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::ensure_base_schema(&conn).unwrap();
        let index = super::super::MIGRATIONS
            .iter()
            .position(|(version, _)| *version == 91)
            .unwrap();
        super::super::run(&conn, &super::super::MIGRATIONS[..index]).unwrap();

        conn.execute_batch(
            "INSERT INTO media_catalog (id, external_id, type, title_main) VALUES
                ('1', 'event:apisports:football:39', 'event', 'Premier League'),
                ('2', 'anime:1', 'anime', 'Kept');
             INSERT INTO user_library (external_id, type, user_id) VALUES
                ('event:apisports:football:39', 'event', 'local'),
                ('anime:1', 'anime', 'local');
             INSERT INTO media_event_season (external_id, competition_external_id, season_key, season_number, name)
                VALUES ('event:apisports:football:39:2024', 'event:apisports:football:39', '2024', 2024, 'Premier League 2024');
             INSERT INTO app_env (name, value) VALUES ('apisports_api_key', 'x'), ('tmdb_api_key', 'y');",
        )
        .unwrap();

        super::super::run_migrations(&conn).unwrap();

        assert_eq!(count(&conn, "SELECT COUNT(*) FROM sqlite_master WHERE name IN ('media_event_season', 'media_event_match')"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_catalog WHERE type = 'event'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM user_library WHERE type = 'event'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM app_env WHERE name = 'apisports_api_key'"), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_catalog WHERE external_id = 'anime:1'"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM user_library WHERE external_id = 'anime:1'"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM app_env WHERE name = 'tmdb_api_key'"), 1);
    }
}
