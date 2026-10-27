// Migrations that repair sagas/saga_relations rows written by since-fixed
// bugs (superseded anchors, fragmented sagas, names taken from a late
// sequel). Bodies are unchanged from when they lived in mod.rs: installs
// have already run them.
use rusqlite::{Result as SqlResult, Transaction};
use rusqlite::OptionalExtension;

use crate::db::merge_fragmented_sagas;

pub(super) fn drop_superseded_anchor_sagas(tx: &Transaction) -> SqlResult<()> {
    // save_cached_saga anchors a saga's id on its lexicographically-
    // smallest member — adding an earlier-released member later shifts
    // that anchor to a new id, but the *old* sagas row was never
    // cleaned up, only ever left to linger as an apparent duplicate of
    // the same saga (first surfaced by the admin panel's Sagas tab,
    // which lists every sagas row unfiltered). A superseded row is
    // identifiable without tracking history: its own id now shows up as
    // a plain *member* of some other, current saga_id — a work is never
    // legitimately both a saga's own anchor and another saga's member
    // at once. ON DELETE CASCADE on saga_relations.saga_id handles the
    // now-pointless relations rows that go with it.
    tx.execute(
        "DELETE FROM sagas WHERE id IN (
            SELECT s.id FROM sagas s
            WHERE EXISTS (
                SELECT 1 FROM saga_relations sr
                WHERE sr.media_external_id = s.id AND sr.saga_id != s.id
            )
         )",
        [],
    )?;
    Ok(())
}

pub(super) fn merge_fragmented(tx: &Transaction) -> SqlResult<()> {
    // Migration 21 only caught sagas whose own anchor shifted (the old
    // anchor still shows up as a plain member of the live saga). It
    // missed the more common fragmentation: the collaborative-catalog PR
    // pipeline mis-anchoring *every* saga member as its own standalone
    // single-member saga in the first place (see merge_fragmented_sagas'
    // own doc comment for why) — visible as the same saga name appearing
    // once per member instead of once total. Rebuilds sagas/
    // saga_relations from the real PREQUEL/SEQUEL graph instead of
    // trusting that bookkeeping.
    merge_fragmented_sagas(tx)
}

// (title_main, release_year, release_month, release_day) of one saga member.
type SagaMemberRow = (String, Option<i64>, Option<i64>, Option<i64>);

// Migrations 55 and 63 (the same repair, run a second time).
// save_cached_saga's no-explicit-name fallback used to reuse the anchor
// entry's own title — the anchor being whichever member's external_id
// sorts smallest as plain TEXT (a stable key for the `sagas` row, unrelated
// to release order: AniList ids aren't zero-padded, so e.g. "anime:100784"
// sorts before "anime:918" as a string even though it's a 2018 entry and
// 918 is the 2006 original). A saga several members deep could end up
// permanently named after a late sequel instead of its first work.
// Re-derive every saga currently named after ANY one of its own members'
// title — the signal that the name was this auto-fallback, never something
// a curator actually typed (nobody hand-types a saga name that happens to
// exactly match one member's own title) — to whichever member has the
// earliest release date instead. Curator-typed names (not matching any
// member's title) are left untouched.
pub(super) fn rename_after_earliest_member(tx: &Transaction) -> SqlResult<()> {
    let saga_ids: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM sagas")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    for saga_id in saga_ids {
        let members: Vec<SagaMemberRow> = {
            let mut stmt = tx.prepare(
                "SELECT mc.title_main, mc.release_year, mc.release_month, mc.release_day
                 FROM saga_relations sr JOIN media_catalog mc ON mc.external_id = sr.media_external_id
                 WHERE sr.saga_id = ?1",
            )?;
            let rows = stmt.query_map([&saga_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?;
            rows.filter_map(|r| r.ok()).collect()
        };
        if members.is_empty() { continue; }

        let current_name: String = match tx.query_row(
            "SELECT name FROM sagas WHERE id = ?1", [&saga_id], |r| r.get(0),
        ).optional()? {
            Some(n) => n,
            None => continue,
        };
        if !members.iter().any(|(title, ..)| *title == current_name) {
            continue; // curator-typed name — don't touch
        }

        // Same "unknown sorts last" sentinel as sagas.rs's own
        // release_date_key (9999/12/31) — kept as plain numbers here
        // since this runs once, pre-refactor, against raw SQL rows
        // rather than a SagaEntry.
        let earliest = members.iter().min_by_key(|(_, y, m, d)| {
            (y.unwrap_or(9999), m.unwrap_or(12), d.unwrap_or(31))
        });
        if let Some((earliest_title, ..)) = earliest {
            if *earliest_title != current_name {
                tx.execute(
                    "UPDATE sagas SET name = ?1 WHERE id = ?2",
                    rusqlite::params![earliest_title, &saga_id],
                )?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn work(conn: &Connection, id: &str, title: &str, year: i64) {
        conn.execute(
            "INSERT INTO media_catalog (id, external_id, type, title_main, release_year) VALUES (?1, ?1, 'anime', ?2, ?3)",
            rusqlite::params![id, title, year],
        ).unwrap();
    }

    fn saga(conn: &Connection, id: &str, name: &str, members: &[&str]) {
        conn.execute("INSERT INTO sagas (id, name) VALUES (?1, ?2)", [id, name]).unwrap();
        for member in members {
            conn.execute("INSERT INTO saga_relations (media_external_id, saga_id) VALUES (?1, ?2)", [member, id]).unwrap();
        }
    }

    fn name(conn: &Connection, id: &str) -> Option<String> {
        conn.query_row("SELECT name FROM sagas WHERE id = ?1", [id], |r| r.get(0)).ok()
    }

    #[test]
    fn superseded_anchor_saga_is_dropped() {
        let conn = super::super::db_before(21);
        saga(&conn, "anime:2", "Old", &["anime:2"]);
        saga(&conn, "anime:1", "Current", &["anime:1", "anime:2"]);
        super::super::apply(&conn, 21);
        assert_eq!(name(&conn, "anime:2"), None);
        assert_eq!(name(&conn, "anime:1").as_deref(), Some("Current"));
    }

    // 55 and 63 run the same repair; both must rename only auto-named sagas.
    #[test]
    fn auto_named_sagas_take_the_earliest_member_title() {
        for version in [55, 63] {
            let conn = super::super::db_before(version);
            work(&conn, "anime:100784", "Late Sequel", 2018);
            work(&conn, "anime:918", "Original", 2006);
            work(&conn, "anime:5", "Other", 2001);
            work(&conn, "anime:6", "Other Sequel", 2003);
            saga(&conn, "anime:100784", "Late Sequel", &["anime:100784", "anime:918"]);
            saga(&conn, "anime:5", "Curated Name", &["anime:5", "anime:6"]);
            super::super::apply(&conn, version);
            assert_eq!(name(&conn, "anime:100784").as_deref(), Some("Original"), "m{version}");
            assert_eq!(name(&conn, "anime:5").as_deref(), Some("Curated Name"), "m{version}");
        }
    }
}
