// IGDB `game_time_to_beats`: hastily / normally / completely in seconds
// plus the submission count, one row per game. Batched (`where game_id =
// (…)`, up to 500 ids a request) through the shared igdb_query, so the
// IGDB_BUDGET limiter paces it with every other IGDB call.
use serde_json::Value;

use super::TimeToBeatData;
use crate::igdb::{get_twitch_token, igdb_query};

const IGDB_API_TIME_TO_BEATS: &str = "https://api.igdb.com/v4/game_time_to_beats";
const IDS_PER_REQUEST: usize = 500;

/// Positive seconds only: IGDB leaves a field out (or sends 0) when nobody
/// submitted that kind of run.
fn seconds(value: &Value) -> Option<i64> {
    value.as_i64().filter(|s| *s > 0)
}

/// `game_time_to_beats` rows → (IGDB game id, data). A row with none of the
/// three durations carries nothing to show and is dropped (a negative).
pub(super) fn parse_time_to_beats(rows: &Value) -> Vec<(u64, TimeToBeatData)> {
    let Some(rows) = rows.as_array() else { return Vec::new() };
    rows.iter()
        .filter_map(|row| {
            let game_id = row["game_id"].as_u64()?;
            let data = TimeToBeatData {
                main_seconds: seconds(&row["hastily"]),
                extra_seconds: seconds(&row["normally"]),
                completionist_seconds: seconds(&row["completely"]),
                votes: row["count"].as_i64().filter(|c| *c > 0),
                length_bucket: None,
                source: "igdb".into(),
            };
            data.has_data().then_some((game_id, data))
        })
        .collect()
}

pub(super) fn query_body(ids: &[u64]) -> String {
    let list = ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",");
    format!("fields game_id,hastily,normally,completely,count; where game_id = ({list}); limit {};", ids.len())
}

/// None when the user has no IGDB keys (nothing can be learned, so nothing
/// is cached as missing); Err on a failed request.
pub(super) async fn fetch(app_handle: &tauri::AppHandle, ids: &[u64]) -> Result<Option<Vec<(u64, TimeToBeatData)>>, String> {
    if ids.is_empty() {
        return Ok(Some(Vec::new()));
    }
    let cfg = crate::igdb_env::load_env_config(app_handle)?;
    let (Some(client_id), Some(secret)) = (cfg.igdb_client_id, cfg.igdb_client_secret) else {
        return Ok(None);
    };
    let token = get_twitch_token(&client_id, &secret).await?;
    let client = crate::http::http_client();
    let mut found = Vec::new();
    for chunk in ids.chunks(IDS_PER_REQUEST) {
        let rows = igdb_query(client, &client_id, &token, IGDB_API_TIME_TO_BEATS, &query_body(chunk)).await?;
        found.extend(parse_time_to_beats(&rows));
    }
    Ok(Some(found))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_fixture_and_drops_rows_without_durations() {
        let rows: Value = serde_json::from_str(include_str!("fixtures/igdb_time_to_beats.json")).unwrap();
        let parsed = parse_time_to_beats(&rows);
        assert_eq!(parsed.len(), 2);
        let (id, zelda) = &parsed[0];
        assert_eq!(*id, 1942);
        assert_eq!(zelda.main_seconds, Some(108_000));
        assert_eq!(zelda.extra_seconds, Some(180_000));
        assert_eq!(zelda.completionist_seconds, Some(360_000));
        assert_eq!(zelda.votes, Some(412));
        assert_eq!(zelda.source, "igdb");
        let (_, partial) = &parsed[1];
        assert_eq!(partial.completionist_seconds, None);
    }

    #[test]
    fn batches_ids_into_one_where_clause() {
        assert_eq!(
            query_body(&[1, 2, 3]),
            "fields game_id,hastily,normally,completely,count; where game_id = (1,2,3); limit 3;"
        );
    }
}
