// Relations saved before relation types became fixed English keys could
// carry the Spanish PRECUELA / SECUELA. The frontend special-cased them in
// six places while the Rust saga walker and the community build script only
// ever knew PREQUEL / SEQUEL, so those chains broke in some views and not
// others. Rewrite them once; the frontend aliases are gone.
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "UPDATE media_relations SET relation_type = 'PREQUEL', type_label = 'Prequel' WHERE relation_type = 'PRECUELA';
         UPDATE media_relations SET relation_type = 'SEQUEL', type_label = 'Sequel' WHERE relation_type = 'SECUELA';",
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn rewrites_spanish_sequel_keys() {
        let conn = super::super::db_before(96);
        conn.execute_batch(
            "INSERT INTO media_relations (media_external_id, related_media_external_id, relation_type, type_label) VALUES
                ('anime:1', 'anime:2', 'SECUELA', 'Secuela'),
                ('anime:2', 'anime:1', 'PRECUELA', 'Precuela'),
                ('anime:2', 'anime:3', 'SEQUEL', 'Sequel');",
        )
        .unwrap();
        super::super::apply(&conn, 96);
        let mut stmt = conn
            .prepare("SELECT media_external_id || '>' || related_media_external_id || ' ' || relation_type || '/' || type_label FROM media_relations ORDER BY 1")
            .unwrap();
        let rows: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(rows, [
            "anime:1>anime:2 SEQUEL/Sequel",
            "anime:2>anime:1 PREQUEL/Prequel",
            "anime:2>anime:3 SEQUEL/Sequel",
        ]);
    }
}
