// Repairs what the old cross-type catalog lookup left behind. Until this
// version, get_catalog_entry / save_catalog_entry (media_catalog.rs)
// expanded EVERY `prefix:N` id to `vnovel:N` / `game:N`, so a TMDB/AniList
// work sharing its number with an IGDB game (series:1399 Game of Thrones vs
// game:1399 Professor Layton and the Unwound Future) read that game's row
// and saved over it. Field-by-field damage can't be told apart from real
// data, except two things:
// - country_code on the IGDB row: the IGDB mapper never sets it, only
//   TMDB/AniList do, so on a colliding IGDB row it came from the other work;
// - the other work's own row never got its live data (every save landed on
//   the game row), so its sync_state is dropped to force a fresh fetch.
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "CREATE TEMP TABLE collided AS
         WITH ids AS (
             SELECT external_id,
                    substr(external_id, 1, instr(external_id, ':') - 1) AS prefix,
                    substr(external_id, instr(external_id, ':') + 1) AS num,
                    source
               FROM media_catalog
              WHERE instr(external_id, ':') > 0
         )
         SELECT igdb.external_id AS igdb_id, other.external_id AS other_id
           FROM ids igdb
           JOIN ids other ON other.num = igdb.num
          WHERE igdb.prefix IN ('game', 'vnovel')
            AND other.prefix NOT IN ('game', 'vnovel')
            AND igdb.source = 'igdb';

         UPDATE media_catalog SET country_code = NULL
          WHERE country_code IS NOT NULL
            AND external_id IN (SELECT igdb_id FROM collided);

         DELETE FROM sync_state WHERE external_id IN (SELECT other_id FROM collided);

         DROP TABLE collided;",
    )
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn text(conn: &Connection, sql: &str) -> Option<String> {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    use crate::test_support::count;

    #[test]
    fn clears_leaked_country_and_resyncs_the_shadowed_work() {
        let conn = super::super::db_before(94);

        conn.execute_batch(
            "INSERT INTO media_catalog (id, external_id, type, source, title_main, country_code) VALUES
                ('1', 'game:1399', 'game', 'igdb', 'Layton', 'US'),
                ('2', 'series:1399', 'series', 'tmdb', 'Juego de tronos', NULL),
                ('3', 'game:50', 'game', 'igdb', 'No collision', 'JP'),
                ('4', 'anime:7', 'anime', 'anilist', 'Anime', 'JP'),
                ('5', 'vnovel:7', 'vnovel', 'igdb', 'VN', 'JP'),
                ('6', 'game:8', 'game', 'igdb', 'Game', 'US'),
                ('7', 'vnovel:8', 'vnovel', 'igdb', 'Same IGDB work', NULL);
             INSERT INTO sync_state (external_id, last_synced_at, sync_failed_count) VALUES
                ('series:1399', '2026-09-27T20:07:19Z', 1),
                ('game:1399', '2026-10-16T23:10:19Z', 1),
                ('anime:7', '2026-09-01T00:00:00Z', 0),
                ('game:50', '2026-09-01T00:00:00Z', 0);",
        )
        .unwrap();

        super::super::run_migrations(&conn).unwrap();

        let country = |id: &str| text(&conn, &format!("SELECT country_code FROM media_catalog WHERE external_id = '{id}'"));
        assert_eq!(country("game:1399"), None);
        assert_eq!(country("vnovel:7"), None);
        // Non-IGDB rows and IGDB rows without a foreign twin keep theirs.
        assert_eq!(country("anime:7").as_deref(), Some("JP"));
        assert_eq!(country("game:50").as_deref(), Some("JP"));
        assert_eq!(country("game:8").as_deref(), Some("US"));

        let synced = |id: &str| count(&conn, &format!("SELECT COUNT(*) FROM sync_state WHERE external_id = '{id}'"));
        assert_eq!(synced("series:1399"), 0);
        assert_eq!(synced("anime:7"), 0);
        assert_eq!(synced("game:1399"), 1);
        assert_eq!(synced("game:50"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM media_catalog"), 7);
    }
}
