// Folding old per-disc library entries into their multi-disc set.
//
// Before multi-disc stacking (platform_scanning/multi_disc.rs) every disc of
// a set was a card of its own, keyed by a hash of its path, and a cue+bin
// dump was keyed by its .bin. The set now keeps its first disc's key; this
// runs on every scan_all_games and moves whatever the other keys still own
// onto it:
//
// | What                           | Rule                                                       |
// |--------------------------------|------------------------------------------------------------|
// | Catalog link (local_game_links)| Disc 1's link wins; if it has none, the other disc's moves |
// | Seen / hidden rows             | Dropped for the old key (the set is seen under Disc 1)     |
// | Library row of an unlinked disc| Playtime/progress summed onto Disc 1's entry; status, score, notes, tags kept from Disc 1 unless empty; favourite/platinum OR-ed; earliest start, latest finish |
// | Other rows keyed by that id    | Re-keyed to Disc 1's entry (skipped on conflict)           |
// | Cover/banner cache folder      | Moved when Disc 1 has none                                 |
//
// A library row keyed by a real catalog id (a disc linked to some work) is
// the user's record of that work and is left alone. Idempotent: once the
// old keys own nothing, a scan finds nothing to do. The first scan that
// merges something leaves a summary for the frontend's one-time toast.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::platform_scanning::LocalGame;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DiscMergeSummary {
    /// Library entries that now show as one.
    pub games: usize,
    /// Old entries folded into them.
    pub entries: usize,
}

static PENDING_SUMMARY: Mutex<Option<DiscMergeSummary>> = Mutex::new(None);

/// The merge summary not yet shown, cleared on read.
#[tauri::command]
pub fn take_rom_disc_merge_summary() -> Option<DiscMergeSummary> {
    PENDING_SUMMARY.lock().ok().and_then(|mut pending| pending.take())
}

fn record_summary(summary: DiscMergeSummary) {
    if summary.entries == 0 {
        return;
    }
    if let Ok(mut pending) = PENDING_SUMMARY.lock() {
        let total = pending.get_or_insert_with(DiscMergeSummary::default);
        total.games += summary.games;
        total.entries += summary.entries;
    }
}

// ─── Library rows (pure merge rule) ──────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct LibraryFields {
    pub status: Option<String>,
    pub rating: Option<f64>,
    pub rating_2: Option<f64>,
    pub progress: f64,
    pub minutes_spent: f64,
    pub is_favorite: i64,
    pub is_platinum: i64,
    pub notes: Option<String>,
    pub tags: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

fn non_empty(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|v| !v.trim().is_empty())
}

fn earliest(a: &Option<String>, b: &Option<String>) -> Option<String> {
    match (a.as_ref().filter(|v| !v.is_empty()), b.as_ref().filter(|v| !v.is_empty())) {
        (Some(a), Some(b)) => Some(if b < a { b.clone() } else { a.clone() }),
        (a, b) => a.or(b).cloned(),
    }
}

fn latest(a: &Option<String>, b: &Option<String>) -> Option<String> {
    match (a.as_ref().filter(|v| !v.is_empty()), b.as_ref().filter(|v| !v.is_empty())) {
        (Some(a), Some(b)) => Some(if b > a { b.clone() } else { a.clone() }),
        (a, b) => a.or(b).cloned(),
    }
}

/// Disc 1's row with another disc's folded in (see the table above).
pub fn merge_library_fields(primary: &LibraryFields, other: &LibraryFields) -> LibraryFields {
    let primary_status_set = primary.status.as_deref().is_some_and(|s| !s.is_empty() && s != "planning");
    LibraryFields {
        status: if primary_status_set || !non_empty(&other.status) { primary.status.clone() } else { other.status.clone() },
        rating: primary.rating.or(other.rating),
        rating_2: primary.rating_2.or(other.rating_2),
        progress: primary.progress + other.progress,
        minutes_spent: primary.minutes_spent + other.minutes_spent,
        is_favorite: primary.is_favorite.max(other.is_favorite),
        is_platinum: primary.is_platinum.max(other.is_platinum),
        notes: if non_empty(&primary.notes) { primary.notes.clone() } else { other.notes.clone() },
        tags: if non_empty(&primary.tags) { primary.tags.clone() } else { other.tags.clone() },
        started_at: earliest(&primary.started_at, &other.started_at),
        finished_at: latest(&primary.finished_at, &other.finished_at),
    }
}

fn read_library_fields(conn: &Connection, external_id: &str) -> rusqlite::Result<Option<LibraryFields>> {
    conn.query_row(
        "SELECT status, rating, rating_2, COALESCE(progress, 0), COALESCE(minutes_spent, 0), COALESCE(is_favorite, 0),
                COALESCE(is_platinum, 0), notes, tags, started_at, finished_at
         FROM user_library WHERE external_id = ?1",
        [external_id],
        |r| {
            Ok(LibraryFields {
                status: r.get(0)?,
                rating: r.get(1)?,
                rating_2: r.get(2)?,
                progress: r.get(3)?,
                minutes_spent: r.get(4)?,
                is_favorite: r.get(5)?,
                is_platinum: r.get(6)?,
                notes: r.get(7)?,
                tags: r.get(8)?,
                started_at: r.get(9)?,
                finished_at: r.get(10)?,
            })
        },
    )
    .optional()
}

// Every table with an external_id column other than the library itself
// (activity, events, list items, links of other services...). Virtual/FTS
// tables and the social caches (other users' data) are left out.
fn tables_keyed_by_external_id(conn: &Connection) -> Vec<String> {
    let names: Vec<(String, String)> = conn
        .prepare("SELECT name, COALESCE(sql, '') FROM sqlite_master WHERE type = 'table'")
        .and_then(|mut stmt| stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect())
        .unwrap_or_default();
    names
        .into_iter()
        .filter(|(name, sql)| {
            name != "user_library"
                && !name.starts_with("sqlite_")
                && !name.starts_with("social_")
                && !name.contains("_fts")
                && !sql.to_ascii_uppercase().starts_with("CREATE VIRTUAL")
        })
        .filter(|(name, _)| {
            conn.prepare(&format!("PRAGMA table_info(\"{}\")", name.replace('"', "")))
                .and_then(|mut stmt| {
                    let columns: Vec<String> = stmt.query_map([], |r| r.get::<_, String>(1))?.collect::<Result<_, _>>()?;
                    Ok(columns.iter().any(|c| c == "external_id"))
                })
                .unwrap_or(false)
        })
        .map(|(name, _)| name)
        .collect()
}

// Moves one unlinked disc's library data onto `target`. True when it had a
// library row.
fn fold_library_entry(conn: &Connection, from: &str, target: &str) -> rusqlite::Result<bool> {
    if from == target {
        return Ok(false);
    }
    let other = read_library_fields(conn, from)?;
    let had_row = other.is_some();
    if let Some(other) = other {
        match read_library_fields(conn, target)? {
            Some(primary) => {
                let merged = merge_library_fields(&primary, &other);
                conn.execute(
                    "UPDATE user_library SET status = ?2, rating = ?3, rating_2 = ?4, progress = ?5, minutes_spent = ?6,
                        is_favorite = ?7, is_platinum = ?8, notes = ?9, tags = ?10, started_at = ?11, finished_at = ?12,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE external_id = ?1",
                    params![
                        target, merged.status, merged.rating, merged.rating_2, merged.progress, merged.minutes_spent,
                        merged.is_favorite, merged.is_platinum, merged.notes, merged.tags, merged.started_at, merged.finished_at,
                    ],
                )?;
                conn.execute("DELETE FROM user_library WHERE external_id = ?1", [from])?;
            }
            None => {
                conn.execute("UPDATE user_library SET external_id = ?2 WHERE external_id = ?1", params![from, target])?;
            }
        }
    }
    for table in tables_keyed_by_external_id(conn) {
        // Best effort per table: a conflicting row stays where it was.
        let _ = conn.execute(
            &format!("UPDATE OR IGNORE \"{table}\" SET external_id = ?2 WHERE external_id = ?1"),
            params![from, target],
        );
    }
    Ok(had_row)
}

fn link_of(conn: &Connection, launcher: &str, key: &str) -> rusqlite::Result<Option<(String, i64)>> {
    conn.query_row(
        "SELECT external_id, COALESCE(manual, 0) FROM local_game_links WHERE launcher = ?1 AND link_key = ?2",
        params![launcher, key],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
}

// Keys that still own something (a row in any local_* table or a library
// row of their own), read once per scan so an already-merged library costs
// three queries, not three per disc.
fn keys_with_rows(conn: &Connection) -> HashSet<String> {
    let mut keys = HashSet::new();
    for sql in [
        "SELECT link_key FROM local_game_links",
        "SELECT link_key FROM local_games_seen",
        "SELECT link_key FROM local_hidden_games",
        "SELECT external_id FROM user_library WHERE external_id LIKE 'rom\\_%' ESCAPE '\\'",
    ] {
        if let Ok(mut stmt) = conn.prepare(sql) {
            if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
                keys.extend(rows.flatten());
            }
        }
    }
    keys
}

// One old key onto the set's key. True when it owned anything.
fn merge_key(conn: &Connection, meta_root: Option<&Path>, launcher: &str, primary: &str, old: &str) -> rusqlite::Result<bool> {
    let old_link = link_of(conn, launcher, old)?;
    let mut primary_link = link_of(conn, launcher, primary)?;
    let mut link_moved = false;
    if primary_link.is_none() {
        if let Some((external_id, manual)) = &old_link {
            conn.execute(
                "INSERT INTO local_game_links (launcher, link_key, external_id, updated_at, manual)
                 VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, ?4)",
                params![launcher, primary, external_id, manual],
            )?;
            primary_link = Some((external_id.clone(), *manual));
            link_moved = true;
        }
    }
    let target = primary_link.as_ref().map(|(id, _)| id.clone()).unwrap_or_else(|| primary.to_string());
    let mut touched = old_link.is_some();
    // An unlinked disc tracked its playtime under its own synthetic id.
    if old_link.is_none() {
        touched |= fold_library_entry(conn, old, &target)?;
    }
    // Disc 1 just got its link from another disc: its own unlinked history
    // follows it to the catalog entry.
    if link_moved {
        fold_library_entry(conn, primary, &target)?;
    }
    for table in ["local_game_links", "local_games_seen", "local_hidden_games"] {
        touched |= conn.execute(&format!("DELETE FROM {table} WHERE launcher = ?1 AND link_key = ?2"), params![launcher, old])? > 0;
    }
    if let Some(root) = meta_root {
        if !root.join(primary).exists() {
            crate::rom_rename::move_metadata_entry(root, old, primary);
        }
    }
    Ok(touched)
}

/// Folds every replaced entry of `games` into its set. Errors on one game
/// roll that game back and leave the rest merged; the next scan retries.
pub fn merge_replaced_entries(conn: &Connection, meta_root: Option<&Path>, games: &[LocalGame]) -> DiscMergeSummary {
    let candidates: Vec<&LocalGame> = games.iter().filter(|g| !g.replaced_app_ids.is_empty() && g.app_id.is_some()).collect();
    if candidates.is_empty() {
        return DiscMergeSummary::default();
    }
    let owned = keys_with_rows(conn);
    let mut summary = DiscMergeSummary::default();
    for game in candidates {
        let primary = game.app_id.as_deref().unwrap_or_default();
        let old_keys: Vec<&String> = game.replaced_app_ids.iter().filter(|k| k.as_str() != primary && owned.contains(k.as_str())).collect();
        if old_keys.is_empty() {
            continue;
        }
        let outcome = (|| -> rusqlite::Result<usize> {
            conn.execute_batch("SAVEPOINT rom_disc_merge")?;
            let mut merged = 0;
            for old in &old_keys {
                match merge_key(conn, meta_root, &game.launcher, primary, old) {
                    Ok(true) => merged += 1,
                    Ok(false) => {}
                    Err(e) => {
                        let _ = conn.execute_batch("ROLLBACK TO rom_disc_merge; RELEASE rom_disc_merge");
                        return Err(e);
                    }
                }
            }
            conn.execute_batch("RELEASE rom_disc_merge")?;
            Ok(merged)
        })();
        match outcome {
            Ok(0) => {}
            Ok(merged) => {
                summary.games += 1;
                summary.entries += merged;
            }
            Err(e) => log::warn!("Could not merge the old disc entries of {}: {e}", game.name),
        }
    }
    record_summary(summary);
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform_scanning::synthetic_app_id;

    fn fields() -> LibraryFields {
        LibraryFields {
            status: None, rating: None, rating_2: None, progress: 0.0, minutes_spent: 0.0, is_favorite: 0, is_platinum: 0,
            notes: None, tags: None, started_at: None, finished_at: None,
        }
    }

    #[test]
    fn merge_rules_sum_time_and_keep_disc_one_choices() {
        let primary = LibraryFields {
            status: Some("in_progress".into()), rating: Some(8.0), progress: 10.0, minutes_spent: 600.0,
            started_at: Some("2024-03-01".into()), notes: Some("mine".into()), ..fields()
        };
        let other = LibraryFields {
            status: Some("completed".into()), rating: Some(6.0), rating_2: Some(3.0), progress: 2.5, minutes_spent: 150.0,
            is_favorite: 1, started_at: Some("2023-12-24".into()), finished_at: Some("2024-05-01".into()),
            notes: Some("other".into()), tags: Some("rpg".into()), ..fields()
        };
        let merged = merge_library_fields(&primary, &other);
        assert_eq!(merged.progress, 12.5);
        assert_eq!(merged.minutes_spent, 750.0);
        assert_eq!(merged.status.as_deref(), Some("in_progress"));
        assert_eq!(merged.rating, Some(8.0));
        assert_eq!(merged.rating_2, Some(3.0));
        assert_eq!(merged.is_favorite, 1);
        assert_eq!(merged.started_at.as_deref(), Some("2023-12-24"));
        assert_eq!(merged.finished_at.as_deref(), Some("2024-05-01"));
        assert_eq!(merged.notes.as_deref(), Some("mine"));
        assert_eq!(merged.tags.as_deref(), Some("rpg"));
    }

    #[test]
    fn an_empty_or_planning_status_takes_the_other_discs() {
        let other = LibraryFields { status: Some("completed".into()), ..fields() };
        assert_eq!(merge_library_fields(&fields(), &other).status.as_deref(), Some("completed"));
        let planning = LibraryFields { status: Some("planning".into()), ..fields() };
        assert_eq!(merge_library_fields(&planning, &other).status.as_deref(), Some("completed"));
        assert_eq!(merge_library_fields(&other, &fields()).status.as_deref(), Some("completed"));
    }

    fn game(launcher: &str, disc1: &str, others: &[&str]) -> LocalGame {
        LocalGame {
            name: "FF7".into(),
            launcher: launcher.into(),
            app_id: Some(synthetic_app_id("rom", disc1)),
            external_id: None,
            install_path: Some(disc1.into()),
            playtime_minutes: None,
            last_played: None,
            installed: Some(true),
            rom_platform: Some("ps1".into()),
            discs: Vec::new(),
            disc_playlist: None,
            replaced_app_ids: others.iter().map(|p| synthetic_app_id("rom", p)).collect(),
            aliases: Vec::new(),
        }
    }

    fn library(conn: &Connection, external_id: &str, status: &str, minutes: f64) {
        conn.execute(
            "INSERT INTO user_library (external_id, type, user_id, status, progress, minutes_spent) VALUES (?1, 'game', 'local', ?2, ?3, ?4)",
            params![external_id, status, minutes / 60.0, minutes],
        )
        .unwrap();
    }

    fn seen(conn: &Connection, launcher: &str, key: &str) {
        conn.execute("INSERT INTO local_games_seen (launcher, link_key, last_seen_at, name) VALUES (?1, ?2, 'now', 'x')", params![launcher, key]).unwrap();
    }

    fn count(conn: &Connection, sql: &str, key: &str) -> i64 {
        conn.query_row(sql, [key], |r| r.get(0)).unwrap()
    }

    #[test]
    fn unlinked_discs_fold_their_playtime_into_disc_one_once() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let (d1, d2, d3) = ("C:/r/FF7 (Disc 1).chd", "C:/r/FF7 (Disc 2).chd", "C:/r/FF7 (Disc 3).chd");
        let (k1, k2, k3) = (synthetic_app_id("rom", d1), synthetic_app_id("rom", d2), synthetic_app_id("rom", d3));
        for key in [&k1, &k2, &k3] {
            seen(&conn, "playstation", key);
        }
        library(&conn, &k1, "in_progress", 120.0);
        library(&conn, &k2, "completed", 60.0);
        conn.execute("INSERT INTO local_hidden_games (launcher, link_key) VALUES ('playstation', ?1)", [&k3]).unwrap();

        let games = vec![game("playstation", d1, &[d2, d3])];
        let summary = merge_replaced_entries(&conn, None, &games);
        assert_eq!(summary, DiscMergeSummary { games: 1, entries: 2 });
        let minutes: f64 = conn.query_row("SELECT minutes_spent FROM user_library WHERE external_id = ?1", [&k1], |r| r.get(0)).unwrap();
        assert_eq!(minutes, 180.0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM user_library WHERE external_id = ?1", &k2), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_games_seen WHERE link_key = ?1", &k2), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_hidden_games WHERE link_key = ?1", &k3), 0, "a hidden extra disc does not hide the set");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_games_seen WHERE link_key = ?1", &k1), 1);

        // Idempotent: nothing left to merge, no second summary.
        assert_eq!(merge_replaced_entries(&conn, None, &games), DiscMergeSummary::default());
        let minutes: f64 = conn.query_row("SELECT minutes_spent FROM user_library WHERE external_id = ?1", [&k1], |r| r.get(0)).unwrap();
        assert_eq!(minutes, 180.0);
        // Left for the frontend's one-time toast (other tests may add to it).
        assert!(take_rom_disc_merge_summary().is_some_and(|s| s.entries >= 2));
    }

    #[test]
    fn disc_one_inherits_a_link_it_lacks_and_linked_discs_keep_their_catalog_rows() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let (d1, d2) = ("C:/r/G (Disc 1).chd", "C:/r/G (Disc 2).chd");
        let (k1, k2) = (synthetic_app_id("rom", d1), synthetic_app_id("rom", d2));
        seen(&conn, "playstation", &k1);
        seen(&conn, "playstation", &k2);
        conn.execute(
            "INSERT INTO local_game_links (launcher, link_key, external_id, manual) VALUES ('playstation', ?1, 'game:77', 1)",
            [&k2],
        )
        .unwrap();
        library(&conn, &k1, "in_progress", 30.0);
        library(&conn, "game:77", "completed", 600.0);

        merge_replaced_entries(&conn, None, &[game("playstation", d1, &[d2])]);
        let (external_id, manual): (String, i64) = conn
            .query_row("SELECT external_id, manual FROM local_game_links WHERE link_key = ?1", [&k1], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((external_id.as_str(), manual), ("game:77", 1));
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM local_game_links WHERE link_key = ?1", &k2), 0);
        // Disc 1's unlinked half-hour joins the catalog entry it now resolves to.
        let (status, minutes): (String, f64) = conn
            .query_row("SELECT status, minutes_spent FROM user_library WHERE external_id = 'game:77'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((status.as_str(), minutes), ("completed", 630.0));
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM user_library WHERE external_id = ?1", &k1), 0);
    }

    #[test]
    fn keys_that_own_nothing_are_not_counted() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let summary = merge_replaced_entries(&conn, None, &[game("playstation", "C:/r/A (Disc 1).iso", &["C:/r/A (Disc 2).iso"])]);
        assert_eq!(summary, DiscMergeSummary::default());
    }
}
