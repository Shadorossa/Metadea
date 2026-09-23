// AniList studios (animation studios and producers/licensors alike): no key
// needed, media paged 50 at a time. Requests go through their own budget —
// the WebView-side limiter can't see calls made from Rust.
use serde_json::Value;

use super::model::{score_from_100, CompanyPage, CompanyWork, WorksCursor};
use super::FetchError;
use crate::igdb::RequestBudget;

const ANILIST_API: &str = "https://graphql.anilist.co";
pub(super) const PER_PAGE: u32 = 50;

// AniList allows 90 requests a minute (30 while degraded); this leaves room
// for the rest of the app's AniList traffic.
static ANILIST_COMPANY_BUDGET: RequestBudget =
    RequestBudget::new(20, std::time::Duration::from_secs(60), std::time::Duration::from_millis(800));

const STUDIO_QUERY: &str = "query ($id: Int, $page: Int, $perPage: Int) {
  Studio(id: $id) {
    id name isAnimationStudio siteUrl
    media(sort: START_DATE, page: $page, perPage: $perPage) {
      pageInfo { hasNextPage total currentPage }
      edges { isMainStudio node { id type format status isAdult averageScore title { romaji english } coverImage { large } startDate { year } } }
    }
  }
}";

pub(super) struct StudioPage {
    pub header: CompanyPage,
    pub works: Vec<CompanyWork>,
    pub has_next: bool,
}

fn media_type(node: &Value) -> &'static str {
    match (node["type"].as_str(), node["format"].as_str()) {
        (Some("ANIME"), _) => "anime",
        (_, Some("NOVEL")) => "lnovel",
        _ => "manga",
    }
}

/// One `Studio` response page → header + works.
pub(super) fn parse_studio(provider_id: &str, body: &Value) -> Option<StudioPage> {
    let studio = &body["data"]["Studio"];
    let name = studio["name"].as_str()?.to_string();
    let media = &studio["media"];
    let is_animation_studio = studio["isAnimationStudio"].as_bool().unwrap_or(false);

    let works: Vec<CompanyWork> = media["edges"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|edge| {
            let node = &edge["node"];
            let id = node["id"].as_u64()?;
            let kind = media_type(node);
            let title = node["title"]["english"].as_str().or_else(|| node["title"]["romaji"].as_str())?;
            let role = if edge["isMainStudio"].as_bool().unwrap_or(false) { "studio" } else { "producer" };
            Some(CompanyWork {
                external_id: format!("{kind}:{id}"),
                title: title.to_string(),
                cover_url: node["coverImage"]["large"].as_str().map(str::to_string),
                year: node["startDate"]["year"].as_i64().map(|y| y as i32),
                media_type: kind.to_string(),
                roles: vec![role.to_string()],
                is_extra: false,
                unreleased: matches!(node["status"].as_str(), Some("NOT_YET_RELEASED" | "CANCELLED")),
                score: score_from_100(node["averageScore"].as_f64()),
                is_adult: node["isAdult"].as_bool().unwrap_or(false),
                format: None,
            })
        })
        .collect();

    let header = CompanyPage {
        provider_id: provider_id.to_string(),
        source: "anilist".into(),
        name,
        source_url: studio["siteUrl"].as_str().map(str::to_string),
        roles: vec![if is_animation_studio { "studio" } else { "producer" }.to_string()],
        total_hint: media["pageInfo"]["total"].as_u64().map(|t| t as u32),
        ..Default::default()
    };
    Some(StudioPage {
        header,
        works,
        has_next: media["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false),
    })
}

pub(super) async fn fetch_page(provider_id: &str, studio_id: u64, page: u32) -> Result<(StudioPage, WorksCursor), FetchError> {
    ANILIST_COMPANY_BUDGET.acquire().await;
    let response = crate::http::http_client()
        .post(ANILIST_API)
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "query": STUDIO_QUERY,
            "variables": { "id": studio_id, "page": page, "perPage": PER_PAGE },
        }))
        .send()
        .await
        .map_err(|e| FetchError::Api(e.to_string()))?;
    let status = response.status();
    if status.as_u16() == 404 {
        return Err(FetchError::NotFound);
    }
    if !status.is_success() {
        return Err(FetchError::Api(format!("AniList HTTP {status}")));
    }
    let body: Value = response.json().await.map_err(|e| FetchError::Api(e.to_string()))?;
    let parsed = parse_studio(provider_id, &body).ok_or(FetchError::NotFound)?;
    let cursor = if parsed.has_next { WorksCursor::AniList { next_page: page + 1 } } else { WorksCursor::Done };
    Ok((parsed, cursor))
}

#[cfg(test)]
mod tests {
    use super::*;

    const STUDIO: &str = include_str!("fixtures/anilist_studio.json");

    #[test]
    fn studio_fixture_parses_roles_and_release_state() {
        let body: Value = serde_json::from_str(STUDIO).unwrap();
        let page = parse_studio("anilist-studio:11", &body).unwrap();
        assert_eq!(page.header.name, "MADHOUSE");
        assert_eq!(page.header.roles, vec!["studio"]);
        assert_eq!(page.header.total_hint, Some(412));
        assert!(page.has_next);
        assert_eq!(page.works.len(), 3, "the null node is skipped");

        let death_note = &page.works[0];
        assert_eq!(death_note.external_id, "anime:1535");
        assert_eq!(death_note.roles, vec!["studio"]);
        assert_eq!(death_note.year, Some(2006));
        assert_eq!(death_note.score, Some(8.4));
        assert!(!death_note.is_adult);
        assert!(page.works[1].is_adult);
        assert_eq!(page.works[1].score, None, "unrated");
        assert_eq!(page.header.source_url.as_deref(), Some("https://anilist.co/studio/11"));
        assert!(page.header.websites.is_empty(), "the AniList page is the source link, not a website");

        let monster = &page.works[1];
        assert_eq!(monster.title, "Monster", "romaji when there is no english title");
        assert_eq!(monster.roles, vec!["producer"]);
        assert_eq!(monster.cover_url, None);

        assert!(page.works[2].unreleased);
        assert_eq!(page.works[2].year, None);
    }

    #[test]
    fn missing_studio_is_none() {
        assert!(parse_studio("anilist-studio:1", &serde_json::json!({ "data": { "Studio": null } })).is_none());
    }
}
