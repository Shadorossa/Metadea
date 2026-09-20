use serde::{Deserialize, Serialize};
use rusqlite::OptionalExtension;
use crate::db::ToStringErr;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiSportsEventSeason {
    pub external_id: String,
    pub competition_external_id: String,
    pub season_key: String,
    pub season_number: i64,
    pub name: String,
    pub cover_url: Option<String>,
    pub air_date: Option<String>,
    pub is_current: bool,
    pub matches_synced_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiSportsEventMatch {
    pub id: String,
    pub date: Option<String>,
    pub time: Option<String>,
    pub home: Option<String>,
    pub away: Option<String>,
    pub home_score: Option<String>,
    pub away_score: Option<String>,
    pub image: Option<String>,
    pub venue: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiSportsEventMatchCache {
    pub synced_at: Option<String>,
    pub matches: Vec<ApiSportsEventMatch>,
}

#[tauri::command]
pub async fn get_api_sports_event_seasons(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    competition_external_id: String,
) -> Result<Vec<ApiSportsEventSeason>, String> {
    let conn = state.conn.lock().str_err()?;

    // Backfill seasons that were already opened before the dedicated season
    // table existed. The external ID encodes the parent competition and
    // season key, so existing catalog rows are enough to restore the edge.
    let legacy_pattern = format!("{}:%", competition_external_id);
    let legacy_rows = {
        let mut stmt = conn.prepare(
            "SELECT external_id, title_main, cover_url, release_year, release_month, release_day
             FROM media_catalog
             WHERE external_id LIKE ?1 AND type = 'event'
             ORDER BY release_year DESC, external_id DESC",
        ).str_err()?;
        let rows = stmt.query_map([&legacy_pattern], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        }).str_err()?;
        rows.filter_map(|row| row.ok()).collect::<Vec<_>>()
    };

    for (external_id, title, cover, year, month, day) in legacy_rows {
        let Some(season_key) = external_id.strip_prefix(&format!("{}:", competition_external_id)) else {
            continue;
        };
        let title = title.unwrap_or_default();
        let name = title.rsplit_once(" - ").map(|(_, suffix)| suffix.to_string()).unwrap_or(title);
        let parsed_year = year.or_else(|| season_key.get(..4).and_then(|part| part.parse::<i64>().ok()));
        let air_date = parsed_year.map(|year| format!("{year:04}-{:02}-{:02}", month.unwrap_or(1), day.unwrap_or(1)));

        conn.execute(
            "INSERT OR IGNORE INTO media_event_season
                (external_id, competition_external_id, season_key, season_number, name, cover_url, air_date, is_current)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
            rusqlite::params![external_id, competition_external_id, season_key, parsed_year.unwrap_or(0), name, cover, air_date],
        ).str_err()?;
    }

    let mut stmt = conn.prepare(
        "SELECT external_id, competition_external_id, season_key, season_number, name, cover_url, air_date, is_current, matches_synced_at
         FROM media_event_season
         WHERE competition_external_id = ?1
         ORDER BY season_number DESC, season_key DESC",
    ).str_err()?;
    let rows = stmt.query_map([&competition_external_id], |row| {
        Ok(ApiSportsEventSeason {
            external_id: row.get(0)?,
            competition_external_id: row.get(1)?,
            season_key: row.get(2)?,
            season_number: row.get(3)?,
            name: row.get(4)?,
            cover_url: row.get(5)?,
            air_date: row.get(6)?,
            is_current: row.get::<_, i64>(7)? != 0,
            matches_synced_at: row.get(8)?,
        })
    }).str_err()?;
    Ok(rows.filter_map(|row| row.ok()).collect())
}

#[tauri::command]
pub async fn save_api_sports_event_seasons(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    seasons: Vec<ApiSportsEventSeason>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    for season in &seasons {
        tx.execute(
            "INSERT INTO media_event_season
                (external_id, competition_external_id, season_key, season_number, name, cover_url, air_date, is_current)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(external_id) DO UPDATE SET
                competition_external_id = excluded.competition_external_id,
                season_key = excluded.season_key,
                season_number = excluded.season_number,
                name = excluded.name,
                cover_url = excluded.cover_url,
                air_date = excluded.air_date,
                is_current = excluded.is_current,
                updated_at = CURRENT_TIMESTAMP",
            rusqlite::params![
                season.external_id,
                season.competition_external_id,
                season.season_key,
                season.season_number,
                season.name,
                season.cover_url,
                season.air_date,
                if season.is_current { 1_i64 } else { 0_i64 },
            ],
        ).str_err()?;
    }
    tx.commit().str_err()?;
    Ok(())
}

#[tauri::command]
pub async fn get_api_sports_event_matches(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    season_external_id: String,
) -> Result<ApiSportsEventMatchCache, String> {
    let conn = state.conn.lock().str_err()?;
    let synced_at: Option<String> = conn.query_row(
        "SELECT matches_synced_at FROM media_event_season WHERE external_id = ?1",
        [&season_external_id],
        |row| row.get::<_, Option<String>>(0),
    ).optional().str_err()?.flatten();
    let mut stmt = conn.prepare(
        "SELECT match_id, date, time, home, away, home_score, away_score, image, venue, status
         FROM media_event_match
         WHERE season_external_id = ?1
         ORDER BY COALESCE(date, '') ASC, COALESCE(time, '') ASC, match_id ASC",
    ).str_err()?;
    let rows = stmt.query_map([&season_external_id], |row| {
        Ok(ApiSportsEventMatch {
            id: row.get(0)?,
            date: row.get(1)?,
            time: row.get(2)?,
            home: row.get(3)?,
            away: row.get(4)?,
            home_score: row.get(5)?,
            away_score: row.get(6)?,
            image: row.get(7)?,
            venue: row.get(8)?,
            status: row.get(9)?,
        })
    }).str_err()?;
    Ok(ApiSportsEventMatchCache {
        synced_at,
        matches: rows.filter_map(|row| row.ok()).collect(),
    })
}

// A successful response replaces one season's list atomically, including a
// genuinely empty result. Failed API requests never call this command, so
// an outage or plan error cannot erase previously cached matches.
#[tauri::command]
pub async fn save_api_sports_event_matches(
    state: tauri::State<'_, crate::db::MetadeaDb>,
    season_external_id: String,
    matches: Vec<ApiSportsEventMatch>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().str_err()?;
    let tx = conn.transaction().str_err()?;
    if let Some((competition_external_id, season_key)) = season_external_id.rsplit_once(':') {
        let year = season_key.get(..4).and_then(|value| value.parse::<i64>().ok());
        let air_date = year.map(|value| format!("{value:04}-01-01"));
        tx.execute(
            "INSERT OR IGNORE INTO media_event_season
                (external_id, competition_external_id, season_key, season_number, name, air_date, is_current)
             VALUES (?1, ?2, ?3, ?4, ?3, ?5, 0)",
            rusqlite::params![season_external_id, competition_external_id, season_key, year.unwrap_or(0), air_date],
        ).str_err()?;
    }
    tx.execute("DELETE FROM media_event_match WHERE season_external_id = ?1", [&season_external_id]).str_err()?;
    for event_match in &matches {
        tx.execute(
            "INSERT OR REPLACE INTO media_event_match
                (season_external_id, match_id, date, time, home, away, home_score, away_score, image, venue, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                season_external_id,
                event_match.id,
                event_match.date,
                event_match.time,
                event_match.home,
                event_match.away,
                event_match.home_score,
                event_match.away_score,
                event_match.image,
                event_match.venue,
                event_match.status,
            ],
        ).str_err()?;
    }
    tx.execute(
        "UPDATE media_event_season SET matches_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE external_id = ?1",
        [&season_external_id],
    ).str_err()?;
    tx.commit().str_err()?;
    Ok(())
}
