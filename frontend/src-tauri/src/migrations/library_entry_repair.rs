// Library rows written wrong by since-fixed bugs:
// - the first launcher play session of an untracked game created its entry
//   with status 'in_progress' (game_sessions.rs) — not a status the app
//   knows, so the game never showed under "In progress", in stats or in the
//   status dropdown — and always with type 'game', even for `vnovel:` ids;
// - the AniList import read scores in the user's own AniList scale, so a
//   POINT_100 user's 85 was stored as 85 on the app's 0–10 scale. Anything
//   above 10 can only come from that and is brought back to 0–10 (a POINT_5
//   4 can't be told from a real 4/10, so those stay).
use rusqlite::{Result as SqlResult, Transaction};

pub(crate) fn migrate(tx: &Transaction) -> SqlResult<()> {
    tx.execute_batch(
        "UPDATE user_library SET status = 'playing' WHERE status = 'in_progress';
         UPDATE user_library SET type = 'vnovel' WHERE type = 'game' AND external_id LIKE 'vnovel:%';
         UPDATE user_library SET rating = rating / 10.0 WHERE rating > 10 AND rating <= 100;
         UPDATE user_library SET rating_2 = rating_2 / 10.0 WHERE rating_2 > 10 AND rating_2 <= 100;",
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn repairs_launcher_created_entries() {
        let conn = super::super::db_before(97);
        conn.execute_batch(
            "INSERT INTO user_library (id, user_id, external_id, type, status, rating) VALUES
                ('1', 'local', 'game:1', 'game', 'in_progress', NULL),
                ('2', 'local', 'vnovel:2', 'game', 'in_progress', 85),
                ('3', 'local', 'anime:3', 'anime', 'watching', 7.5);",
        )
        .unwrap();
        super::super::apply(&conn, 97);
        let mut stmt = conn
            .prepare("SELECT external_id || ' ' || type || ' ' || status || ' ' || IFNULL(rating, '-') FROM user_library ORDER BY 1")
            .unwrap();
        let rows: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(rows, ["anime:3 anime watching 7.5", "game:1 game playing -", "vnovel:2 vnovel playing 8.5"]);
    }
}
