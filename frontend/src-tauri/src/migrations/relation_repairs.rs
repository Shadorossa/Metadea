// Migrations that repair media_relations rows written by since-fixed bugs
// (duplicate rows per pair, missing reciprocal edges, localized labels,
// inverted SOURCE/ADAPTATION reciprocals). Bodies are unchanged from when
// they lived in mod.rs: installs have already run them.
use rusqlite::{Result as SqlResult, Transaction};

pub(super) fn dedupe_relations_per_pair(tx: &Transaction) -> SqlResult<()> {
    // media_relations used to key on (media, related, relation_type),
    // which let the same target accumulate more than one row over time —
    // most visibly, an old sync writing the raw display label as
    // relation_type ("Expanded Edition") and a later one writing the
    // canonical key ("EXPANDED_GAME") for the exact same pair, so the
    // same related title rendered twice in a row's relations. Rebuild
    // the table keyed on (media, related) only, keeping the
    // most-recently-written row per pair (rowid DESC + INSERT OR IGNORE
    // = first-seen-wins-per-key, so the newest survives).
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_relations_v5 (
            media_external_id         TEXT NOT NULL,
            related_media_external_id TEXT NOT NULL,
            relation_type             TEXT NOT NULL,
            type_label                TEXT NOT NULL,
            PRIMARY KEY (media_external_id, related_media_external_id)
         );
         INSERT OR IGNORE INTO media_relations_v5
            (media_external_id, related_media_external_id, relation_type, type_label)
         SELECT media_external_id, related_media_external_id, relation_type, type_label
         FROM media_relations
         ORDER BY rowid DESC;
         DROP TABLE media_relations;
         ALTER TABLE media_relations_v5 RENAME TO media_relations;"
    )
}

pub(super) fn backfill_reciprocal_edges(tx: &Transaction) -> SqlResult<()> {
    // Backfill: media_relations rows saved before save_media_relations /
    // import_proposal_bundle started writing the reciprocal edge (see
    // reciprocal_relation() in media_catalog.rs) could be one-directional
    // — a SEQUEL on one side with no matching PREQUEL on the other. The
    // saga chain's recursive walk only follows a row's own
    // media_external_id column forward, so a missing reciprocal edge
    // silently truncated the chain right there. INSERT OR IGNORE so an
    // already-curated (possibly different) classification on the other
    // side is never overwritten — this only fills genuine gaps.
    let pairs: &[(&str, &str, &str)] = &[
        ("SEQUEL", "PREQUEL", "Prequel"),
        ("PREQUEL", "SEQUEL", "Sequel"),
        ("SOURCE", "ADAPTATION", "Adaptation"),
        ("ADAPTATION", "SOURCE", "Source Material"),
        ("EPISODE", "PART_OF", "Part of"),
        ("UPDATE", "PART_OF", "Part of"),
    ];
    for (from_type, recip_type, recip_label) in pairs {
        tx.execute(
            "INSERT OR IGNORE INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             SELECT related_media_external_id, media_external_id, ?2, ?3
             FROM media_relations WHERE relation_type = ?1",
            rusqlite::params![from_type, recip_type, recip_label],
        )?;
    }
    Ok(())
}

pub(super) fn canonicalize_type_labels(tx: &Transaction) -> SqlResult<()> {
    // Backfill: media_relations.type_label used to be written from
    // whichever UI language the editor's app happened to be in (see
    // PrEditorModal.tsx's now-removed `relationLabels` write path), so
    // rows saved from a Spanish-language session hold Spanish text
    // ("Secuela", "Precuela", ...) instead of the canonical English the
    // shared community catalog expects. relation_type itself (the
    // actual key everything else matches on) was never affected by that
    // bug, so it's a reliable source to re-derive the correct label
    // from — this just re-applies canonical_relation_label() to every
    // row regardless of its current type_label, which is simpler and
    // more robust than trying to detect "is this already English".
    for (relation_type, label) in canonical_relation_labels() {
        tx.execute(
            "UPDATE media_relations SET type_label = ?2 WHERE relation_type = ?1 AND type_label != ?2",
            rusqlite::params![relation_type, label],
        )?;
    }
    Ok(())
}

pub(super) fn fix_inverted_adaptation_reciprocal(tx: &Transaction) -> SqlResult<()> {
    // Fix inverted reciprocal relation for ADAPTATION (previously mapped to SOURCE,
    // which erroneously marked anime adaptations as the "Source Material" of their original manga).
    tx.execute(
        "UPDATE media_relations
         SET relation_type = 'ADAPTATION', type_label = 'Adaptation'
         WHERE relation_type = 'SOURCE' AND (related_media_external_id LIKE 'anime:%' OR related_media_external_id LIKE 'movie:%' OR related_media_external_id LIKE 'series:%')",
        [],
    )?;
    Ok(())
}

pub(super) fn fix_adaptation_reciprocal_to_source(tx: &Transaction) -> SqlResult<()> {
    // reciprocal_relation() (media_catalog.rs) used to map ADAPTATION's
    // reciprocal to ADAPTATION instead of SOURCE — so an anime whose
    // manga source was only ever seen via that manga's own SOURCE
    // relation reciprocating onto the anime (rather than the anime's
    // own live AniList fetch, which correctly says SOURCE directly)
    // got mislabeled "Adaptation" instead of "Source Material" on its
    // own page. Mirrors migration 20's same corrective pattern for the
    // opposite direction. AniList never tags an anime/movie/series'
    // own relation to its manga/book source as ADAPTATION directly —
    // only this buggy reciprocal insert could have produced that
    // combination, so this is safe to correct unconditionally.
    tx.execute(
        "UPDATE media_relations
         SET relation_type = 'SOURCE', type_label = 'Source Material'
         WHERE relation_type = 'ADAPTATION'
           AND (media_external_id LIKE 'anime:%' OR media_external_id LIKE 'movie:%' OR media_external_id LIKE 'series:%')
           AND (related_media_external_id LIKE 'manga:%' OR related_media_external_id LIKE 'lnovel:%' OR related_media_external_id LIKE 'book:%')",
        [],
    )?;
    Ok(())
}

// Canonical (always-English) relation_type -> type_label pairs — mirrors
// frontend/src/i18n/en.ts's `media.relations` table plus the few keys
// (EPISODE/UPDATE/PART_OF/SOURCE) that are only ever written as hardcoded
// English literals in the frontend rather than through that i18n table.
// Kept here (not shared with media_catalog.rs's reciprocal_relation, which
// only needs a handful of these) since this is a one-off backfill list, not
// a piece of ongoing relation-writing logic.
fn canonical_relation_labels() -> &'static [(&'static str, &'static str)] {
    &[
        ("SEQUEL", "Sequel"), ("PREQUEL", "Prequel"), ("SIDE_STORY", "Side story"),
        ("ALTERNATIVE", "Alternative"), ("ADAPTATION", "Adaptation"), ("PARENT", "Parent Story"),
        ("BASE_EDITION", "Base Edition"),
        ("SUMMARY", "Summary"), ("SPIN_OFF", "Spin-off"), ("OTHER", "Other"),
        ("CHARACTER", "Character"), ("CONTAINS", "Contains"), ("RECOMMENDATION", "Recommended"),
        ("EDITIONS", "Editions"),
        ("REL_ADAPTATION", "Adaptation"),
        ("REL_SOURCE", "Source Material"),
        ("REL_ALTERNATIVE", "Alternative Version"),
        ("REMASTER", "Remaster"),
        ("REMAKE", "Remake"),
        ("EXPANDED_GAME", "Expanded Edition"),
        ("REL_UPDATE", "Update"),
        ("DLC", "DLC"),
        ("EXPANSION", "Content Expansion"),
        ("STANDALONE", "Standalone Expansion"),
        ("FORK", "Fork"),
        ("SEASON", "Season"),
        ("SOURCE", "Source Material"),
        ("EPISODE", "Episode"),
        ("UPDATE", "Update"),
        ("PART_OF", "Part of"),
    ]
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn relation(conn: &Connection, media: &str, related: &str, kind: &str, label: &str) {
        conn.execute(
            "INSERT INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label)
             VALUES (?1, ?2, ?3, ?4)",
            [media, related, kind, label],
        ).unwrap();
    }

    fn edge(conn: &Connection, media: &str, related: &str) -> Option<(String, String)> {
        conn.query_row(
            "SELECT relation_type, type_label FROM media_relations
             WHERE media_external_id = ?1 AND related_media_external_id = ?2",
            [media, related],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).ok()
    }

    fn pair(kind: &str, label: &str) -> Option<(String, String)> {
        Some((kind.into(), label.into()))
    }

    #[test]
    fn backfill_adds_only_missing_reciprocal_edges() {
        let conn = super::super::db_before(8);
        relation(&conn, "anime:1", "anime:2", "SEQUEL", "Sequel");
        relation(&conn, "anime:3", "anime:4", "SEQUEL", "Sequel");
        relation(&conn, "anime:4", "anime:3", "SIDE_STORY", "Side story");
        super::super::apply(&conn, 8);
        assert_eq!(edge(&conn, "anime:2", "anime:1"), pair("PREQUEL", "Prequel"));
        // An existing (curated) reverse edge is never overwritten.
        assert_eq!(edge(&conn, "anime:4", "anime:3"), pair("SIDE_STORY", "Side story"));
    }

    #[test]
    fn localized_labels_become_canonical_english() {
        let conn = super::super::db_before(9);
        relation(&conn, "anime:1", "anime:2", "SEQUEL", "Secuela");
        relation(&conn, "anime:2", "anime:1", "PREQUEL", "Prequel");
        super::super::apply(&conn, 9);
        assert_eq!(edge(&conn, "anime:1", "anime:2"), pair("SEQUEL", "Sequel"));
        assert_eq!(edge(&conn, "anime:2", "anime:1"), pair("PREQUEL", "Prequel"));
    }

    #[test]
    fn source_pointing_at_an_adaptation_is_flipped() {
        let conn = super::super::db_before(20);
        relation(&conn, "manga:1", "anime:2", "SOURCE", "Source Material");
        relation(&conn, "anime:2", "manga:1", "SOURCE", "Source Material");
        super::super::apply(&conn, 20);
        assert_eq!(edge(&conn, "manga:1", "anime:2"), pair("ADAPTATION", "Adaptation"));
        assert_eq!(edge(&conn, "anime:2", "manga:1"), pair("SOURCE", "Source Material"));
    }

    #[test]
    fn adaptation_pointing_at_a_source_is_flipped() {
        let conn = super::super::db_before(27);
        relation(&conn, "anime:2", "manga:1", "ADAPTATION", "Adaptation");
        relation(&conn, "anime:2", "anime:3", "ADAPTATION", "Adaptation");
        super::super::apply(&conn, 27);
        assert_eq!(edge(&conn, "anime:2", "manga:1"), pair("SOURCE", "Source Material"));
        assert_eq!(edge(&conn, "anime:2", "anime:3"), pair("ADAPTATION", "Adaptation"));
    }
}
