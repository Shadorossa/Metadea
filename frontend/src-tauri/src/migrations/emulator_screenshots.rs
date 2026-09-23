//! emulator_configs.screenshots_dir: an override of the folder the
//! platform's emulator writes its screenshots to, for emulators the
//! auto-detection table (emulators::default_screenshots_dirs) does not know.
//! It is only a SOURCE: folders::emulator_captures moves every capture out of
//! it into $PICTURES/Metadea/<game>/.

use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    // Same duplicate-column tolerance as migrations::add_column: a fresh
    // database replays every migration and must not fail on a column its
    // base schema may already carry.
    match tx.execute(
        "ALTER TABLE emulator_configs ADD COLUMN screenshots_dir TEXT NOT NULL DEFAULT ''",
        [],
    ) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(_, Some(msg)))
        | Err(rusqlite::Error::SqlInputError { msg, .. })
            if msg.contains("duplicate column name") => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn adds_the_column_once_and_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE emulator_configs (platform_id TEXT NOT NULL UNIQUE, emulator_name TEXT NOT NULL)",
        )
        .unwrap();
        for _ in 0..2 {
            let tx = conn.unchecked_transaction().unwrap();
            migrate(&tx).unwrap();
            tx.commit().unwrap();
        }
        let columns: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('emulator_configs') WHERE name = 'screenshots_dir'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(columns, 1);
    }
}
