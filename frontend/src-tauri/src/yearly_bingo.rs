// Yearly Bingo: a board of 1–49 works (any media type; the owner picks the
// size, 16 by default) picked for a year. The size is stored as the length
// of the `items` JSON array — boards saved before sizes existed hold 16
// cells, so they read as 16 with no migration. Only the board itself lives
// here — each cell is a snapshot of the work
// (external id + title/cover/type at pick time, so the board renders even
// for works the local catalog never cached). Results (completed cells,
// bingo lines, scores) are computed on the frontend from the library it
// already caches (lib/bingo/, tested). Table: migrations/yearly_bingo.rs.
//
// A board can only be written inside its edit window, by LOCAL date:
// Dec 20–31 prepares NEXT year's board, Jan 1–10 still edits the CURRENT
// year's; after Jan 10 it is read-only for good. The frontend mirrors the
// rule to hide its edit controls (lib/bingo/bingo-calendar.ts), but this
// check is the one that counts.
use crate::db::ToStringErr;
use crate::error_codes;
use chrono::{Datelike, NaiveDate};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Board sizes (mirror lib/bingo/bingo-grid.ts).
pub const DEFAULT_BINGO_SIZE: usize = 16;
pub const MIN_BINGO_SIZE: usize = 1;
pub const MAX_BINGO_SIZE: usize = 49;
const MIN_YEAR: i32 = 1900;
const MAX_YEAR: i32 = 9999;
const MAX_ID_LEN: usize = 200;
const MAX_TITLE_LEN: usize = 500;
const MAX_TYPE_LEN: usize = 32;
const MAX_COVER_LEN: usize = 4096;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BingoItem {
    pub external_id: String,
    pub title: String,
    pub cover_url: Option<String>,
    pub media_type: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct YearlyBingo {
    pub year: i32,
    /// Number of cells, MIN_BINGO_SIZE..=MAX_BINGO_SIZE.
    pub size: usize,
    /// Always `size` long, in grid order; None is an empty cell.
    pub items: Vec<Option<BingoItem>>,
    /// Unix seconds.
    pub created_at: i64,
    pub updated_at: i64,
}

/// The year whose board may be created/edited on `today` (a local date),
/// or None outside the window.
pub fn bingo_editable_year(today: NaiveDate) -> Option<i32> {
    match (today.month(), today.day()) {
        (12, day) if day >= 20 => Some(today.year() + 1),
        (1, day) if day <= 10 => Some(today.year()),
        _ => None,
    }
}

fn check_year(year: i32) -> Result<(), String> {
    if (MIN_YEAR..=MAX_YEAR).contains(&year) {
        Ok(())
    } else {
        Err(error_codes::with_detail(error_codes::BINGO_INVALID, format!("year {year}")))
    }
}

fn invalid(detail: String) -> String {
    error_codes::with_detail(error_codes::BINGO_INVALID, detail)
}

fn validate_items(size: usize, items: &[Option<BingoItem>]) -> Result<(), String> {
    if !(MIN_BINGO_SIZE..=MAX_BINGO_SIZE).contains(&size) {
        return Err(invalid(format!("size {size}")));
    }
    if items.len() != size {
        return Err(invalid(format!("{} cells for size {size}", items.len())));
    }
    let mut seen = HashSet::new();
    for item in items.iter().flatten() {
        let id = item.external_id.trim();
        if id.is_empty() || id.len() > MAX_ID_LEN || !seen.insert(id) {
            return Err(invalid(format!("external id {:?}", item.external_id)));
        }
        if item.title.len() > MAX_TITLE_LEN {
            return Err(invalid(format!("title of {id}")));
        }
        if item.media_type.trim().is_empty() || item.media_type.len() > MAX_TYPE_LEN {
            return Err(invalid(format!("media type {:?}", item.media_type)));
        }
        if item.cover_url.as_ref().is_some_and(|c| c.len() > MAX_COVER_LEN) {
            return Err(invalid(format!("cover of {id}")));
        }
    }
    Ok(())
}

/// A stored board as it is read back: its length is its size; a length
/// outside the valid range (manual edit) degrades to a DEFAULT_BINGO_SIZE
/// board.
fn normalized(mut items: Vec<Option<BingoItem>>) -> Vec<Option<BingoItem>> {
    if !(MIN_BINGO_SIZE..=MAX_BINGO_SIZE).contains(&items.len()) {
        items.resize(DEFAULT_BINGO_SIZE, None);
    }
    items
}

pub fn read_bingo(conn: &Connection, year: i32) -> rusqlite::Result<Option<YearlyBingo>> {
    let row: Option<(String, i64, i64)> = conn
        .query_row("SELECT items, created_at, updated_at FROM yearly_bingo WHERE year = ?1", [year], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    Ok(row.map(|(raw, created_at, updated_at)| {
        // Only this module writes the column; an unreadable value (manual
        // edit) degrades to an empty board rather than failing the page.
        let items = normalized(serde_json::from_str::<Vec<Option<BingoItem>>>(&raw).unwrap_or_default());
        YearlyBingo { year, size: items.len(), items, created_at, updated_at }
    }))
}

/// Replaces `year`'s board, enforcing the edit window against `today` (the
/// caller's local date) and `items.len() == size`. A board with no work
/// left is deleted.
pub fn write_bingo(
    conn: &Connection,
    year: i32,
    size: usize,
    items: Vec<Option<BingoItem>>,
    today: NaiveDate,
    now_secs: i64,
) -> Result<(), String> {
    check_year(year)?;
    if bingo_editable_year(today) != Some(year) {
        return Err(error_codes::with_detail(error_codes::BINGO_LOCKED, format!("{year} on {today}")));
    }
    validate_items(size, &items)?;
    if items.iter().all(Option::is_none) {
        conn.execute("DELETE FROM yearly_bingo WHERE year = ?1", [year]).str_err()?;
        return Ok(());
    }
    let json = serde_json::to_string(&items).str_err()?;
    conn.execute(
        "INSERT INTO yearly_bingo (year, items, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(year) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at",
        rusqlite::params![year, json, now_secs],
    )
    .str_err()?;
    Ok(())
}

/// `year`'s board, or None when none was saved.
#[tauri::command]
pub async fn get_yearly_bingo(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    year: i32,
) -> Result<Option<YearlyBingo>, String> {
    check_year(year)?;
    let conn = state.conn.lock().str_err()?;
    read_bingo(&conn, year).str_err()
}

/// Replaces `year`'s board with `size` cells; E_BINGO_LOCKED outside its
/// edit window, E_BINGO_INVALID for a size outside 1..=49 or a cell count
/// that isn't `size`.
#[tauri::command]
pub async fn set_yearly_bingo(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    year: i32,
    size: usize,
    items: Vec<Option<BingoItem>>,
) -> Result<(), String> {
    let now = chrono::Local::now();
    let conn = state.conn.lock().str_err()?;
    write_bingo(&conn, year, size, items, now.date_naive(), now.timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn item(id: &str) -> Option<BingoItem> {
        Some(BingoItem { external_id: id.into(), title: format!("Title {id}"), cover_url: None, media_type: "anime".into() })
    }

    /// A `size`-cell board with `filled` at its first cells.
    fn cells(size: usize, filled: &[&str]) -> Vec<Option<BingoItem>> {
        let mut out: Vec<Option<BingoItem>> = filled.iter().map(|id| item(id)).collect();
        out.resize(size, None);
        out
    }

    fn with_db(run: impl FnOnce(&Connection)) {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        run(&conn);
    }

    #[test]
    fn window_opens_on_dec_20_for_next_year_and_closes_after_jan_10() {
        assert_eq!(bingo_editable_year(date(2026, 12, 19)), None, "Dec 19 is the results day, not editable");
        assert_eq!(bingo_editable_year(date(2026, 12, 20)), Some(2027));
        assert_eq!(bingo_editable_year(date(2026, 12, 31)), Some(2027));
        assert_eq!(bingo_editable_year(date(2027, 1, 1)), Some(2027));
        assert_eq!(bingo_editable_year(date(2027, 1, 10)), Some(2027));
        assert_eq!(bingo_editable_year(date(2027, 1, 11)), None);
        assert_eq!(bingo_editable_year(date(2027, 6, 15)), None);
    }

    #[test]
    fn edits_are_rejected_once_locked_or_before_the_window() {
        with_db(|conn| {
            write_bingo(conn, 2027, 1, vec![item("anime:1")], date(2027, 1, 10), 100).unwrap();
            let err = write_bingo(conn, 2027, 1, vec![item("anime:2")], date(2027, 1, 11), 200).unwrap_err();
            assert!(err.starts_with(error_codes::BINGO_LOCKED), "{err}");
            // In December only NEXT year's board is editable.
            let err = write_bingo(conn, 2026, 1, vec![item("anime:2")], date(2026, 12, 22), 200).unwrap_err();
            assert!(err.starts_with(error_codes::BINGO_LOCKED), "{err}");
            let err = write_bingo(conn, 2028, 1, vec![item("anime:2")], date(2027, 6, 1), 200).unwrap_err();
            assert!(err.starts_with(error_codes::BINGO_LOCKED), "{err}");
            let board = read_bingo(conn, 2027).unwrap().unwrap();
            assert_eq!(board.items[0], item("anime:1"));
        });
    }

    #[test]
    fn round_trips_positions_and_keeps_created_at() {
        with_db(|conn| {
            let mut cells = vec![None; DEFAULT_BINGO_SIZE];
            cells[5] = item("book:9");
            cells[15] = item("game:3");
            write_bingo(conn, 2027, DEFAULT_BINGO_SIZE, cells.clone(), date(2026, 12, 20), 100).unwrap();
            cells[0] = item("movie:1");
            write_bingo(conn, 2027, DEFAULT_BINGO_SIZE, cells.clone(), date(2027, 1, 3), 200).unwrap();
            let board = read_bingo(conn, 2027).unwrap().unwrap();
            assert_eq!(board.items, cells);
            assert_eq!(board.size, DEFAULT_BINGO_SIZE);
            assert_eq!((board.created_at, board.updated_at), (100, 200));
            assert!(read_bingo(conn, 2026).unwrap().is_none());
        });
    }

    #[test]
    fn keeps_the_chosen_size_and_deletes_empty_boards() {
        with_db(|conn| {
            for size in [1, 10, MAX_BINGO_SIZE] {
                write_bingo(conn, 2027, size, cells(size, &["anime:1"]), date(2027, 1, 1), 1).unwrap();
                let board = read_bingo(conn, 2027).unwrap().unwrap();
                assert_eq!((board.size, board.items.len()), (size, size));
            }
            write_bingo(conn, 2027, 2, vec![None, None], date(2027, 1, 2), 2).unwrap();
            assert!(read_bingo(conn, 2027).unwrap().is_none());
        });
    }

    #[test]
    fn rows_without_a_valid_length_read_as_16() {
        with_db(|conn| {
            // A board saved before sizes existed is a 16-cell array already;
            // a length outside 1..=49 (manual edit) falls back to 16 too.
            for raw in ["[]", "not json", &serde_json::to_string(&vec![None::<BingoItem>; 60]).unwrap()] {
                conn.execute(
                    "INSERT OR REPLACE INTO yearly_bingo (year, items, created_at, updated_at) VALUES (2027, ?1, 1, 1)",
                    [raw],
                )
                .unwrap();
                let board = read_bingo(conn, 2027).unwrap().unwrap();
                assert_eq!((board.size, board.items.len()), (DEFAULT_BINGO_SIZE, DEFAULT_BINGO_SIZE), "{raw}");
            }
        });
    }

    #[test]
    fn validates_cells() {
        with_db(|conn| {
            let today = date(2027, 1, 5);
            let blank_type = Some(BingoItem { external_id: "a:1".into(), title: String::new(), cover_url: None, media_type: " ".into() });
            for (size, bad) in [
                (2, vec![item("a:1"), item("a:1")]),
                (1, vec![item(" ")]),
                (1, vec![blank_type]),
                // Cell count must match the size, and the size stay in 1..=49.
                (16, cells(15, &["a:1"])),
                (4, cells(5, &["a:1"])),
                (0, vec![]),
                (50, cells(50, &["a:1"])),
            ] {
                let err = write_bingo(conn, 2027, size, bad, today, 0).unwrap_err();
                assert!(err.starts_with(error_codes::BINGO_INVALID), "{err}");
            }
            assert!(write_bingo(conn, 1800, 1, vec![None], today, 0).unwrap_err().starts_with(error_codes::BINGO_INVALID));
        });
    }
}
