//! `retro_achievements_links`: which RA game a library entry (its
//! `external_id`) shows progress for, and how that link was established
//! (`hash` from the ROM file, `name` from the console's game list, or
//! `manual` from the picker).

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaLink {
    pub external_id: String,
    pub ra_game_id: u32,
    pub matched_by: String,
    pub rom_hash: Option<String>,
    pub updated_at: String,
}

pub const MATCHED_BY: &[&str] = &["hash", "name", "manual"];

pub fn get(conn: &Connection, external_id: &str) -> rusqlite::Result<Option<RaLink>> {
    conn.query_row(
        "SELECT external_id, ra_game_id, matched_by, rom_hash, updated_at
         FROM retro_achievements_links WHERE external_id = ?1",
        [external_id],
        |r| Ok(RaLink {
            external_id: r.get(0)?,
            ra_game_id: r.get::<_, i64>(1)? as u32,
            matched_by: r.get(2)?,
            rom_hash: r.get(3)?,
            updated_at: r.get(4)?,
        }),
    )
    .optional()
}

pub fn set(conn: &Connection, external_id: &str, ra_game_id: u32, matched_by: &str, rom_hash: Option<&str>) -> rusqlite::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO retro_achievements_links (external_id, ra_game_id, matched_by, rom_hash, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(external_id) DO UPDATE SET
           ra_game_id = excluded.ra_game_id, matched_by = excluded.matched_by,
           rom_hash = excluded.rom_hash, updated_at = excluded.updated_at",
        rusqlite::params![external_id, ra_game_id as i64, matched_by, rom_hash, now],
    )?;
    Ok(())
}

pub fn remove(conn: &Connection, external_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM retro_achievements_links WHERE external_id = ?1", [external_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::migrations::retro_achievements::create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn set_then_get_round_trips_and_upserts() {
        let conn = conn();
        assert!(get(&conn, "game:1").unwrap().is_none());
        set(&conn, "game:1", 10, "hash", Some("abc")).unwrap();
        let link = get(&conn, "game:1").unwrap().unwrap();
        assert_eq!((link.ra_game_id, link.matched_by.as_str(), link.rom_hash.as_deref()), (10, "hash", Some("abc")));
        set(&conn, "game:1", 11, "manual", None).unwrap();
        let link = get(&conn, "game:1").unwrap().unwrap();
        assert_eq!((link.ra_game_id, link.matched_by.as_str(), link.rom_hash), (11, "manual", None));
        remove(&conn, "game:1").unwrap();
        assert!(get(&conn, "game:1").unwrap().is_none());
    }

    #[test]
    fn the_matched_by_check_constraint_rejects_other_values() {
        let conn = conn();
        assert!(set(&conn, "game:1", 10, "guess", None).is_err());
    }
}
