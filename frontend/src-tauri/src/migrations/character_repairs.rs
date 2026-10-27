// Migrations that repair character_appearances / character ids written by
// since-fixed bugs. Bodies are unchanged from when they lived in mod.rs:
// installs have already run them.
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn refile_light_novel_appearances(tx: &Transaction) -> SqlResult<()> {
    // One-time cleanup for character_appearances rows keyed "manga:<N>"
    // that should have been "lnovel:<N>" — AniList's `type` field can't
    // tell manga from light novel (both are type MANGA, only `format`
    // distinguishes them), and earlier appearance-seeding code used
    // `type` bare, filing every light-novel appearance under the wrong
    // id. A manga:<N>/lnovel:<N> pair sharing the same numeric id can
    // only be the same underlying AniList entry (AniList ids are unique
    // regardless of type/format), so a lnovel:<N> catalog row already
    // existing is solid proof the manga:<N> appearance is the stray one.
    //
    // Step 1: rename in place wherever nothing already occupies the
    // correct id for that character (silently skipped by OR IGNORE
    // when it does, handled by step 2 instead).
    tx.execute(
        "UPDATE OR IGNORE character_appearances
         SET media_external_id = 'lnovel:' || substr(media_external_id, 7)
         WHERE media_external_id LIKE 'manga:%'
           AND EXISTS (SELECT 1 FROM media_catalog WHERE external_id = 'lnovel:' || substr(character_appearances.media_external_id, 7))",
        [],
    )?;
    // Step 2: drop whatever's left under the wrong id once its correct
    // sibling exists for that same character (covers both the rename's
    // IGNORE'd conflicts and any pre-existing duplicate).
    tx.execute(
        "DELETE FROM character_appearances
         WHERE media_external_id LIKE 'manga:%'
           AND EXISTS (
               SELECT 1 FROM character_appearances b
               WHERE b.character_external_id = character_appearances.character_external_id
                 AND b.media_external_id = 'lnovel:' || substr(character_appearances.media_external_id, 7)
           )",
        [],
    )?;
    Ok(())
}

// Migrations 40 and 51 (the same repair, run a second time).
// character:<N> id scheme unification (AniList/Comic Vine/TMDB) — see
// fix_character_ids' own doc comment in vestigial_cleanup.rs, which is
// where this temporary fixup actually lives.
pub(super) fn unify_character_ids(tx: &Transaction) -> SqlResult<()> {
    crate::vestigial_cleanup::fix_character_ids(tx);
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn appearance(conn: &Connection, character: &str, media: &str) {
        conn.execute(
            "INSERT INTO character_appearances (character_external_id, media_external_id, relation_type) VALUES (?1, ?2, 'MAIN')",
            [character, media],
        ).unwrap();
    }

    fn media_of(conn: &Connection, character: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT media_external_id FROM character_appearances WHERE character_external_id = ?1 ORDER BY 1")
            .unwrap();
        stmt.query_map([character], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn manga_appearances_of_a_light_novel_are_refiled() {
        let conn = super::super::db_before(33);
        conn.execute("INSERT INTO media_catalog (id, external_id, type, title_main) VALUES ('1', 'lnovel:10', 'lnovel', 'LN')", []).unwrap();
        appearance(&conn, "character:1", "manga:10");
        appearance(&conn, "character:2", "manga:10");
        appearance(&conn, "character:2", "lnovel:10");
        appearance(&conn, "character:3", "manga:11");
        super::super::apply(&conn, 33);
        assert_eq!(media_of(&conn, "character:1"), ["lnovel:10"]);
        assert_eq!(media_of(&conn, "character:2"), ["lnovel:10"]);
        // No lnovel:11 row: a real manga keeps its appearance.
        assert_eq!(media_of(&conn, "character:3"), ["manga:11"]);
    }
}
