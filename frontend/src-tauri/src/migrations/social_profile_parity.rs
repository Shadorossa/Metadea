// Public profiles showing what their owner sees (social_profile.rs):
// - social_user_list gains the synced per-work fields the owner's own
//   Stats/Library read — real time spent (minutes_spent), the second rating
//   and its progress, re-runs — plus the owner's chosen cover
//   (preferred_cover). All nullable: a profile synced by an older app has
//   none, and the viewer keeps its estimates for those rows.
// - social_user_activity now holds every journey kind (start / progress /
//   complete), not only completions, so a start and a completion logged in
//   the same second no longer collide on (timestamp, external_id): the key
//   gains event_type, and `occurrence` numbers re-runs. The table is a
//   cache (fully replaced per profile by hydrate_social_profile), rebuilt
//   here with its rows copied over.
// - social_yearly_goals / _resolutions / _resolution_settings mirror the
//   owner's yearly_goals / yearly_resolutions / yearly_resolution_settings
//   (migration 79) per social_user_id: the synced "Challenge {year}" tab,
//   current year plus up to two previous ones.
use rusqlite::{Result as SqlResult, Transaction};

use super::add_column;

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    for column in [
        "rating_2 REAL",
        "progress_2 REAL",
        "minutes_spent REAL",
        "reconsumption_count INTEGER",
        "reconsuming INTEGER",
        "preferred_cover TEXT",
    ] {
        add_column(tx, &format!("ALTER TABLE social_user_list ADD COLUMN {column}"))?;
    }
    add_column(tx, "ALTER TABLE social_user_activity ADD COLUMN occurrence INTEGER")?;
    tx.execute_batch(
        "CREATE TABLE social_user_activity_new (
            social_user_id TEXT NOT NULL,
            external_id    TEXT NOT NULL,
            media_type     TEXT,
            event_type     TEXT NOT NULL,
            progress_start INTEGER,
            progress_end   INTEGER,
            date           TEXT,
            timestamp      TEXT NOT NULL,
            occurrence     INTEGER,
            PRIMARY KEY (social_user_id, timestamp, external_id, event_type)
        );
        INSERT OR IGNORE INTO social_user_activity_new
            (social_user_id, external_id, media_type, event_type, progress_start, progress_end, date, timestamp, occurrence)
            SELECT social_user_id, external_id, media_type, event_type, progress_start, progress_end, date, timestamp, occurrence
            FROM social_user_activity;
        DROP TABLE social_user_activity;
        ALTER TABLE social_user_activity_new RENAME TO social_user_activity;

        CREATE TABLE IF NOT EXISTS social_yearly_goals (
            social_user_id      TEXT    NOT NULL,
            year                INTEGER NOT NULL,
            media_type          TEXT    NOT NULL,
            target              INTEGER NOT NULL,
            count_reconsumption INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (social_user_id, year, media_type)
        );
        CREATE TABLE IF NOT EXISTS social_yearly_resolutions (
            social_user_id TEXT    NOT NULL,
            year           INTEGER NOT NULL,
            external_id    TEXT    NOT NULL,
            position       INTEGER NOT NULL DEFAULT 0,
            added_at       INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (social_user_id, year, external_id)
        );
        CREATE TABLE IF NOT EXISTS social_yearly_resolution_settings (
            social_user_id TEXT    NOT NULL,
            year           INTEGER NOT NULL,
            size           INTEGER NOT NULL,
            locked_at      TEXT,
            PRIMARY KEY (social_user_id, year)
        );",
    )
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn upgrades_the_pre_parity_social_tables_keeping_their_rows() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE social_user_list (
                social_user_id TEXT NOT NULL, external_id TEXT NOT NULL, rating REAL, started_at TEXT,
                finished_at TEXT, notes TEXT, tags TEXT, status TEXT, progress REAL,
                PRIMARY KEY (social_user_id, external_id)
            );
            CREATE TABLE social_user_activity (
                social_user_id TEXT NOT NULL, external_id TEXT NOT NULL, media_type TEXT,
                event_type TEXT NOT NULL, progress_start INTEGER, progress_end INTEGER, date TEXT,
                timestamp TEXT NOT NULL, PRIMARY KEY (social_user_id, timestamp, external_id)
            );
            INSERT INTO social_user_list (social_user_id, external_id, progress) VALUES ('u', 'game:1', 12);
            INSERT INTO social_user_activity (social_user_id, external_id, event_type, date, timestamp)
                VALUES ('u', 'game:1', 'complete', '2026-09-01', '2026-09-01T10:00:00Z');",
        ).unwrap();

        let tx = conn.transaction().unwrap();
        super::migrate(&tx).unwrap();
        tx.commit().unwrap();

        conn.execute(
            "INSERT INTO social_user_activity (social_user_id, external_id, event_type, date, timestamp, occurrence)
             VALUES ('u', 'game:1', 'start', '2026-09-01', '2026-09-01T10:00:00Z', NULL)",
            [],
        ).unwrap();
        let events: i64 = conn.query_row("SELECT COUNT(*) FROM social_user_activity", [], |r| r.get(0)).unwrap();
        assert_eq!(events, 2);
        let minutes: Option<f64> = conn
            .query_row("SELECT minutes_spent FROM social_user_list WHERE external_id = 'game:1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(minutes, None);
    }
}
