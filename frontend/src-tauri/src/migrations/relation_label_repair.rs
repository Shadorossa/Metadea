// The frontend's canonical relation labels said "Expansion" / "Standalone"
// for EXPANSION / STANDALONE while the backend (format_to_edition_relation,
// migration 9's backfill) wrote "Content Expansion" / "Standalone
// Expansion", so the same relation_type was stored under two labels
// depending on which side wrote the row. Both sides now share
// fixtures/relations/relation-vocabulary.json; this brings existing rows to
// the backend's spelling.
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "UPDATE media_relations SET type_label = 'Content Expansion'
          WHERE relation_type = 'EXPANSION' AND type_label != 'Content Expansion';
         UPDATE media_relations SET type_label = 'Standalone Expansion'
          WHERE relation_type = 'STANDALONE' AND type_label != 'Standalone Expansion';",
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn rewrites_frontend_spellings_only_for_those_types() {
        let conn = super::super::db_before(95);
        conn.execute_batch(
            "INSERT INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label) VALUES
                ('game:1', 'game:2', 'EXPANSION', 'Expansion'),
                ('game:1', 'game:3', 'STANDALONE', 'Standalone'),
                ('game:1', 'game:4', 'DLC', 'DLC');",
        )
        .unwrap();
        super::super::apply(&conn, 95);
        let label = |related: &str| -> String {
            conn.query_row(
                "SELECT type_label FROM media_relations WHERE related_media_external_id = ?1",
                [related],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(label("game:2"), "Content Expansion");
        assert_eq!(label("game:3"), "Standalone Expansion");
        assert_eq!(label("game:4"), "DLC");
    }
}
