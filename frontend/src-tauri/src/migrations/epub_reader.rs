//! EPUB reader positions (src/epub_reader, src/reading_progress.rs):
//! - reading_progress gains chapter_index / chapter_fraction / percent so an
//!   EPUB resumes at "chapter 7, 38 % into it" instead of a page number
//!   (page_number keeps carrying chapter_index + 1 for the old readers of
//!   that column). percent is the byte-weighted share of the book read.
//! - epub_bookmarks: a bookmark is a (chapter, fraction) pair, which does
//!   not fit comic_bookmarks' integer page_number + UNIQUE constraint.
//!
//! `create_tables` is idempotent so unit tests can build the schema on a
//! bare in-memory connection.

use rusqlite::{Connection, Result as SqlResult, Transaction};

fn add_column_if_missing(conn: &Connection, table: &str, column: &str, decl: &str) -> SqlResult<()> {
    let exists: bool = conn
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |r| r.get::<_, String>(1))?
        .flatten()
        .any(|name| name == column);
    if !exists {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])?;
    }
    Ok(())
}

pub(crate) fn create_tables(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reading_progress (
            external_id    TEXT NOT NULL,
            episode_number REAL NOT NULL,
            page_number    INTEGER NOT NULL,
            total_pages    INTEGER,
            updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (external_id, episode_number)
         );
         CREATE TABLE IF NOT EXISTS epub_bookmarks (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            external_id      TEXT NOT NULL,
            episode_number   REAL NOT NULL,
            chapter_index    INTEGER NOT NULL,
            chapter_fraction REAL NOT NULL DEFAULT 0,
            label            TEXT,
            created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );
         CREATE INDEX IF NOT EXISTS idx_epub_bookmarks_entry ON epub_bookmarks(external_id, episode_number);",
    )?;
    add_column_if_missing(conn, "reading_progress", "chapter_index", "INTEGER")?;
    add_column_if_missing(conn, "reading_progress", "chapter_fraction", "REAL")?;
    add_column_if_missing(conn, "reading_progress", "percent", "REAL")
}

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    create_tables(tx)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        conn.prepare(&format!("PRAGMA table_info({table})"))
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .flatten()
            .collect()
    }

    #[test]
    fn adds_columns_and_bookmark_table_idempotently() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        create_tables(&conn).unwrap();
        let cols = columns(&conn, "reading_progress");
        for expected in ["page_number", "chapter_index", "chapter_fraction", "percent"] {
            assert!(cols.iter().any(|c| c == expected), "missing {expected}");
        }
        assert!(columns(&conn, "epub_bookmarks").iter().any(|c| c == "chapter_fraction"));
    }
}
