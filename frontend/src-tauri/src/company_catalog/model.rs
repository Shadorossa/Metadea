// Shapes shared by the company page providers: the render-ready page the
// frontend receives, the paging cursor kept next to it in company_cache, and
// the provider id grammar (`/company?id=<provider>:<id>`).
use serde::{Deserialize, Serialize};

/// One work credited to the company, in the same external id scheme as
/// search results (`game:1942`, `anime:21`, `movie:603`, ...).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CompanyWork {
    pub external_id: String,
    pub title: String,
    pub cover_url: Option<String>,
    pub year: Option<i32>,
    pub media_type: String,
    /// `developer` | `publisher` | `studio` | `producer` | `production` | `network`.
    pub roles: Vec<String>,
    /// DLC, bundle, pack, mod or update: hidden by default on the page and
    /// left out of the completion count unless the user includes them.
    pub is_extra: bool,
    /// Not out yet (or cancelled): never counted as missing.
    pub unreleased: bool,
    /// The provider's average on the app's 0–10 scale (scoreGlobal), when
    /// rated: the career timeline marks 8+ as a masterpiece.
    pub score: Option<f32>,
    /// AniList's isAdult: hidden unless the user shows adult content, like
    /// search does (lib/search/exclusion-filters.ts).
    pub is_adult: bool,
    /// The local catalog's format (`DLC`, `REMASTER`...) on pages rebuilt
    /// from it, for the same exclusions search applies to local rows.
    pub format: Option<String>,
}

/// A provider's 0–100 average as the app's 0–10 score, one decimal.
pub fn score_from_100(value: Option<f64>) -> Option<f32> {
    value.filter(|v| *v > 0.0).map(|v| v.round() as f32 / 10.0)
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CompanyPage {
    pub provider_id: String,
    /// `igdb` | `anilist` | `tmdb` | `local` — `local` means the page was
    /// rebuilt from the local catalog (no keys, offline or no provider).
    pub source: String,
    pub name: String,
    pub logo_url: Option<String>,
    pub description: Option<String>,
    /// ISO 3166-1 alpha-2; the frontend localises the name.
    pub country_code: Option<String>,
    pub headquarters: Option<String>,
    pub founded_year: Option<i32>,
    pub websites: Vec<String>,
    /// The company's own page on the provider (AniList studio, IGDB
    /// company, TMDB company/network), shown as the provider's logo button.
    pub source_url: Option<String>,
    pub roles: Vec<String>,
    pub works: Vec<CompanyWork>,
    /// What the provider reports as the full size of the list, when known.
    pub total_hint: Option<u32>,
}

/// An IGDB game id still to resolve: `(id, developed, published)`.
pub type PendingGame = (u64, bool, bool);

/// Where the next `load_more_company_works` call resumes.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorksCursor {
    #[default]
    Done,
    /// IGDB hands back every game id with the company; games are then
    /// resolved in batches.
    Igdb { pending: Vec<PendingGame> },
    AniList { next_page: u32 },
    Tmdb { movie_page: Option<u32>, tv_page: Option<u32> },
}

impl WorksCursor {
    pub fn is_done(&self) -> bool {
        match self {
            WorksCursor::Done => true,
            WorksCursor::Igdb { pending } => pending.is_empty(),
            WorksCursor::AniList { .. } => false,
            WorksCursor::Tmdb { movie_page, tv_page } => movie_page.is_none() && tv_page.is_none(),
        }
    }
}

/// Stored as `company_cache.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CachedCompany {
    pub page: CompanyPage,
    pub cursor: WorksCursor,
}

/// What the commands return.
#[derive(Debug, Clone, Serialize)]
pub struct CompanyPagePayload {
    pub page: CompanyPage,
    pub fetched_at: i64,
    /// Older than the TTL: render it, then refresh in the background.
    pub stale: bool,
    /// Every work the provider has is in `page.works`.
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompanyProvider {
    Igdb(u64),
    AniListStudio(u64),
    TmdbCompany(u64),
    TmdbNetwork(u64),
    ComicVine(String),
}

impl CompanyProvider {
    /// `igdb:70`, `anilist-studio:11`, `tmdb-company:420`, `tmdb-network:213`,
    /// `comicvine:31`. Mirrors lib/company/company-page-id.ts.
    pub fn parse(provider_id: &str) -> Option<Self> {
        let (prefix, id) = provider_id.split_once(':')?;
        let numeric = || id.parse::<u64>().ok().filter(|n| *n > 0);
        match prefix {
            "igdb" => numeric().map(Self::Igdb),
            "anilist-studio" => numeric().map(Self::AniListStudio),
            "tmdb-company" => numeric().map(Self::TmdbCompany),
            "tmdb-network" => numeric().map(Self::TmdbNetwork),
            "comicvine" if !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') => {
                Some(Self::ComicVine(id.to_string()))
            }
            _ => None,
        }
    }

    /// The row id in the local `companies` / `media_by_company` tables — the
    /// mappers' own namespacing (igdb-mapper, anilist-mapper, tmdb-mapper,
    /// comicvine-mapper). TMDB networks and production companies share it.
    pub fn local_company_id(&self) -> String {
        match self {
            Self::Igdb(id) => format!("company:{id}"),
            Self::AniListStudio(id) => format!("company:anilist:{id}"),
            Self::TmdbCompany(id) | Self::TmdbNetwork(id) => format!("company:tmdb:{id}"),
            Self::ComicVine(id) => format!("company:comicvine:{id}"),
        }
    }

    /// Maps a local `media_by_company.role` onto this page's role names, or
    /// `None` when that relation belongs to the other TMDB namespace.
    pub fn local_role(&self, stored_role: &str) -> Option<&'static str> {
        match (self, stored_role) {
            (Self::Igdb(_), "developer") => Some("developer"),
            (Self::Igdb(_), _) => Some("publisher"),
            (Self::AniListStudio(_), "developer") => Some("studio"),
            (Self::AniListStudio(_), _) => Some("producer"),
            (Self::TmdbCompany(_), "developer") => Some("production"),
            (Self::TmdbNetwork(_), "publisher") => Some("network"),
            (Self::TmdbCompany(_) | Self::TmdbNetwork(_), _) => None,
            (Self::ComicVine(_), _) => Some("publisher"),
        }
    }
}

/// Folds `incoming` into `works`, merging the roles of a work credited twice
/// (a self-published game shows up in both IGDB lists).
pub fn merge_works(works: &mut Vec<CompanyWork>, incoming: Vec<CompanyWork>) {
    // Indexed: a big publisher's list runs into the thousands.
    let mut index: std::collections::HashMap<String, usize> =
        works.iter().enumerate().map(|(i, w)| (w.external_id.clone(), i)).collect();
    for work in incoming {
        if let Some(&i) = index.get(&work.external_id) {
            let existing = &mut works[i];
            for role in work.roles {
                if !existing.roles.contains(&role) {
                    existing.roles.push(role);
                }
            }
        } else {
            index.insert(work.external_id.clone(), works.len());
            works.push(work);
        }
    }
}

/// Union of the roles held across the works, in a stable order.
pub fn collect_roles(works: &[CompanyWork]) -> Vec<String> {
    const ORDER: &[&str] = &["developer", "publisher", "studio", "producer", "production", "network"];
    ORDER
        .iter()
        .filter(|role| works.iter().any(|w| w.roles.iter().any(|r| r == *role)))
        .map(|role| role.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids_round_trip_to_local_company_ids() {
        assert_eq!(CompanyProvider::parse("igdb:70"), Some(CompanyProvider::Igdb(70)));
        assert_eq!(CompanyProvider::parse("anilist-studio:11").unwrap().local_company_id(), "company:anilist:11");
        assert_eq!(CompanyProvider::parse("tmdb-network:213").unwrap().local_company_id(), "company:tmdb:213");
        assert_eq!(CompanyProvider::parse("comicvine:31").unwrap().local_company_id(), "company:comicvine:31");
        for bad in ["igdb:", "igdb:abc", "igdb:0", "steam:1", "anilist:1", "comicvine:a b", "70", ""] {
            assert_eq!(CompanyProvider::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn tmdb_local_roles_split_networks_from_production_companies() {
        let company = CompanyProvider::TmdbCompany(1);
        let network = CompanyProvider::TmdbNetwork(1);
        assert_eq!(company.local_role("developer"), Some("production"));
        assert_eq!(company.local_role("publisher"), None);
        assert_eq!(network.local_role("publisher"), Some("network"));
        assert_eq!(network.local_role("developer"), None);
    }

    #[test]
    fn merging_keeps_one_card_per_work_with_every_role() {
        let work = |id: &str, role: &str| CompanyWork {
            external_id: id.into(),
            roles: vec![role.into()],
            ..Default::default()
        };
        let mut works = vec![work("game:1", "developer")];
        merge_works(&mut works, vec![work("game:1", "publisher"), work("game:2", "publisher")]);
        assert_eq!(works.len(), 2);
        assert_eq!(works[0].roles, vec!["developer", "publisher"]);
        assert_eq!(collect_roles(&works), vec!["developer", "publisher"]);
    }

    #[test]
    fn scores_come_out_on_the_ten_point_scale() {
        assert_eq!(score_from_100(Some(87.4)), Some(8.7));
        assert_eq!(score_from_100(Some(80.0)), Some(8.0));
        assert_eq!(score_from_100(Some(0.0)), None);
        assert_eq!(score_from_100(None), None);
    }

    #[test]
    fn cached_pages_without_the_new_fields_still_load() {
        let cached: CompanyWork = serde_json::from_str(r#"{"external_id":"game:1","title":"A"}"#).unwrap();
        assert_eq!(cached.score, None);
        assert!(!cached.is_adult);
    }
}
