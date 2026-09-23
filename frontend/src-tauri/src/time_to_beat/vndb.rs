// VNDB (API v2 "kana", free, no key): the visual novel's average reading
// time from user votes (`length_minutes`), or its 1–5 length bucket when
// nobody voted. The catalog's VNs are IGDB-backed and carry no VNDB id, so
// the VN is found by title search and accepted only on an exact title match
// (any of its titles) in the same release year; without a year, only when a
// single VN matches. Paced at one request per second.
use serde::Deserialize;
use std::time::Duration;

use super::TimeToBeatData;
use crate::igdb::RequestBudget;

const VNDB_API_VN: &str = "https://api.vndb.org/kana/vn";
const FIELDS: &str = "title,alttitle,released,length,length_minutes,length_votes,titles.title";

static VNDB_BUDGET: RequestBudget = RequestBudget::new(1, Duration::from_secs(1), Duration::from_secs(1));

#[derive(Debug, Deserialize)]
pub(super) struct VndbTitle {
    title: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct VndbVn {
    pub(super) id: String,
    title: String,
    alttitle: Option<String>,
    released: Option<String>,
    length: Option<u8>,
    length_minutes: Option<i64>,
    length_votes: Option<i64>,
    #[serde(default)]
    titles: Vec<VndbTitle>,
}

#[derive(Debug, Deserialize)]
pub(super) struct VndbResponse {
    pub(super) results: Vec<VndbVn>,
}

/// Lowercase letters and digits only (any script), so "Steins;Gate" and
/// "STEINS GATE" compare equal.
fn normalize_title(title: &str) -> String {
    title.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// "2009-10-15" / "2009" → 2009; "TBA" / absent → None.
fn release_year(released: Option<&str>) -> Option<i32> {
    released?.get(..4)?.parse().ok()
}

impl VndbVn {
    fn has_title(&self, wanted: &str) -> bool {
        std::iter::once(self.title.as_str())
            .chain(self.alttitle.as_deref())
            .chain(self.titles.iter().map(|t| t.title.as_str()))
            .any(|t| normalize_title(t) == wanted)
    }

    pub(super) fn to_data(&self) -> TimeToBeatData {
        let main_seconds = self.length_minutes.filter(|m| *m > 0).map(|m| m * 60);
        TimeToBeatData {
            main_seconds,
            extra_seconds: None,
            completionist_seconds: None,
            votes: self.length_votes.filter(|v| *v > 0),
            length_bucket: if main_seconds.is_none() { self.length.filter(|b| (1..=5).contains(b)) } else { None },
            source: "vndb".into(),
        }
    }
}

/// The one VN in `results` that is reliably the work asked for, if any.
pub(super) fn pick_match<'a>(results: &'a [VndbVn], title: &str, year: Option<i32>) -> Option<&'a VndbVn> {
    let wanted = normalize_title(title);
    if wanted.is_empty() {
        return None;
    }
    let mut candidates = results.iter().filter(|vn| vn.has_title(&wanted));
    let first = match year {
        Some(y) => {
            let mut same_year = candidates.filter(|vn| release_year(vn.released.as_deref()) == Some(y));
            let first = same_year.next()?;
            if same_year.next().is_some() { return None; }
            first
        }
        None => {
            let first = candidates.next()?;
            if candidates.next().is_some() { return None; }
            first
        }
    };
    Some(first)
}

/// Ok(None) when VNDB has no reliable match or no length for it.
pub(super) async fn fetch(title: &str, year: Option<i32>) -> Result<Option<TimeToBeatData>, String> {
    VNDB_BUDGET.acquire().await;
    let body = serde_json::json!({
        "filters": ["search", "=", title],
        "fields": FIELDS,
        "results": 25,
    });
    let resp = crate::http::http_client()
        .post(VNDB_API_VN)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("VNDB request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("VNDB error (HTTP {})", resp.status()));
    }
    let parsed: VndbResponse = resp.json().await.map_err(|e| format!("VNDB parse failed: {e}"))?;
    let Some(vn) = pick_match(&parsed.results, title, year) else { return Ok(None) };
    log::debug!("time to beat: \"{title}\" matched VNDB {}", vn.id);
    Ok(Some(vn.to_data()).filter(TimeToBeatData::has_data))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<VndbVn> {
        serde_json::from_str::<VndbResponse>(include_str!("fixtures/vndb_vn_search.json")).unwrap().results
    }

    #[test]
    fn matches_the_exact_title_in_the_release_year() {
        let results = fixture();
        let vn = pick_match(&results, "STEINS;GATE", Some(2009)).unwrap();
        assert_eq!(vn.id, "v2002");
        let data = vn.to_data();
        assert_eq!(data.main_seconds, Some(2640 * 60));
        assert_eq!(data.votes, Some(1873));
        assert_eq!(data.length_bucket, None);
        assert_eq!(data.source, "vndb");
    }

    #[test]
    fn rejects_a_year_mismatch_and_a_mere_prefix() {
        let results = fixture();
        assert!(pick_match(&results, "Steins;Gate", Some(2011)).is_none());
        assert!(pick_match(&results, "Steins", None).is_none());
    }

    #[test]
    fn matches_an_alternate_title_and_falls_back_to_the_length_bucket() {
        let results = fixture();
        let vn = pick_match(&results, "City of Light", None).unwrap();
        let data = vn.to_data();
        assert_eq!(data.main_seconds, None);
        assert_eq!(data.votes, None);
        assert_eq!(data.length_bucket, Some(4));
        assert!(data.has_data());
    }

    #[test]
    fn ambiguous_matches_without_a_year_are_rejected() {
        let mut results = fixture();
        results.push(VndbVn {
            id: "v1".into(), title: "Steins;Gate".into(), alttitle: None, released: Some("2013".into()),
            length: None, length_minutes: Some(60), length_votes: Some(3), titles: Vec::new(),
        });
        assert!(pick_match(&results, "Steins;Gate", None).is_none());
        assert_eq!(pick_match(&results, "Steins;Gate", Some(2013)).unwrap().id, "v1");
    }

    #[test]
    fn release_year_reads_partial_dates_and_ignores_tba() {
        assert_eq!(release_year(Some("2009-10-15")), Some(2009));
        assert_eq!(release_year(Some("2009")), Some(2009));
        assert_eq!(release_year(Some("TBA")), None);
        assert_eq!(release_year(None), None);
    }
}
