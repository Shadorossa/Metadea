//! TierMaker-style tier lists (tier_lists.rs, `save_tier_list`):
//! - tier_lists.description: optional text shown under the title and in the
//!   exported image.
//! - tier_lists.is_public: 1 = "show on my profile".
//! - tier_lists.settings: JSON display preferences owned by the frontend
//!   (thumbnail size, titles under covers — lib/tier/tier-settings.ts).
//! - tier_list_items.title / cover_url / media_type: a snapshot of what the
//!   item looked like when it was added, so characters and search results
//!   without a local catalog/characters row still render. A real row wins
//!   when there is one.
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn migrate(tx: &Transaction) -> SqlResult<()> {
    super::add_column(tx, "ALTER TABLE tier_lists ADD COLUMN description TEXT NOT NULL DEFAULT ''")?;
    super::add_column(tx, "ALTER TABLE tier_lists ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")?;
    super::add_column(tx, "ALTER TABLE tier_lists ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'")?;
    super::add_column(tx, "ALTER TABLE tier_list_items ADD COLUMN title TEXT")?;
    super::add_column(tx, "ALTER TABLE tier_list_items ADD COLUMN cover_url TEXT")?;
    super::add_column(tx, "ALTER TABLE tier_list_items ADD COLUMN media_type TEXT")
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn keeps_existing_rows_and_adds_defaults() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::ensure_base_schema(&conn).unwrap();
        conn.execute("INSERT INTO tier_lists (id, name, tiers) VALUES ('t', 'Mine', '[]')", []).unwrap();
        conn.execute("INSERT INTO tier_list_items (tier_list_id, external_id) VALUES ('t', 'anime:1')", []).unwrap();
        super::super::run_migrations(&conn).unwrap();
        let (description, is_public, settings): (String, i64, String) = conn
            .query_row("SELECT description, is_public, settings FROM tier_lists WHERE id = 't'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((description.as_str(), is_public, settings.as_str()), ("", 0, "{}"));
        let title: Option<String> = conn
            .query_row("SELECT title FROM tier_list_items WHERE tier_list_id = 't'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, None);
    }
}
