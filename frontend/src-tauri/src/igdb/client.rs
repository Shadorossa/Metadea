// IGDB endpoint/image constants and the retrying APIcalypse query helper
// every other submodule goes through.

use crate::db::ToStringErr;

// -- Constants ----------------------------------------------------------------

pub(crate) const IGDB_API_GAMES: &str = "https://api.igdb.com/v4/games";
pub(crate) const IGDB_API_EXTERNAL_GAMES: &str = "https://api.igdb.com/v4/external_games";
pub(super) const IGDB_API_ARTWORKS: &str = "https://api.igdb.com/v4/artworks";
pub(super) const IGDB_API_SCREENSHOTS: &str = "https://api.igdb.com/v4/screenshots";
pub(super) const IGDB_API_COVERS: &str = "https://api.igdb.com/v4/covers";
pub(crate) const IGDB_API_MULTIQUERY: &str = "https://api.igdb.com/v4/multiquery";
pub(crate) const IGDB_IMAGE_COVER_BIG: &str = "https://images.igdb.com/igdb/image/upload/t_cover_big";
pub(super) const IGDB_IMAGE_1080P: &str = "https://images.igdb.com/igdb/image/upload/t_1080p";

pub(crate) const EDITION_KEYWORDS: &[&str] = &[
    "deluxe",
    "digital",
    "edition",
    "skin",
    "pack",
    "bundle",
    "gold",
    "premium",
    "ultimate",
    "complete",
    "goty",
    "remastered",
    "definitive",
    "anniversary",
    "collector",
    "limited",
    "special",
    "enhanced",
    "expanded",
];

pub(crate) const IGDB_GAME_FIELDS: &str = "id,cover.image_id,name,summary,first_release_date,genres.name,rating,category,involved_companies.company.name,involved_companies.developer,involved_companies.publisher";

// -- Request budgets -----------------------------------------------------------

// Sliding-window budget for a provider whose requests are made from Rust
// (IGDB here, Comic Vine in comicvine.rs) — the WebView-side limiter in
// lib/api/rate-limiter.ts can't see these. `max` requests per `window`, plus
// an optional minimum gap between consecutive requests for providers that
// police burst velocity rather than a plain quota. Callers await `acquire`
// right before sending; nothing is dropped, only delayed.
pub(crate) struct RequestBudget {
    max: usize,
    window: std::time::Duration,
    min_gap: std::time::Duration,
    hits: std::sync::Mutex<std::collections::VecDeque<std::time::Instant>>,
}

impl RequestBudget {
    pub(crate) const fn new(max: usize, window: std::time::Duration, min_gap: std::time::Duration) -> Self {
        Self { max, window, min_gap, hits: std::sync::Mutex::new(std::collections::VecDeque::new()) }
    }

    // How long the next request has to wait as of `now`; zero records the
    // request as sent.
    fn reserve(&self, now: std::time::Instant) -> std::time::Duration {
        let mut hits = self.hits.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        while hits.front().is_some_and(|t| now.duration_since(*t) >= self.window) {
            hits.pop_front();
        }
        let gap_wait = hits
            .back()
            .map(|t| self.min_gap.saturating_sub(now.duration_since(*t)))
            .unwrap_or(std::time::Duration::ZERO);
        let window_wait = match hits.front() {
            Some(oldest) if hits.len() >= self.max => self.window.saturating_sub(now.duration_since(*oldest)),
            _ => std::time::Duration::ZERO,
        };
        let wait = gap_wait.max(window_wait);
        if wait.is_zero() {
            hits.push_back(now);
        }
        wait
    }

    pub(crate) async fn acquire(&self) {
        loop {
            let wait = self.reserve(std::time::Instant::now());
            if wait.is_zero() {
                return;
            }
            tokio::time::sleep(wait).await;
        }
    }
}

// IGDB: 4 requests per second per client id.
pub(crate) static IGDB_BUDGET: RequestBudget =
    RequestBudget::new(4, std::time::Duration::from_secs(1), std::time::Duration::ZERO);


// -- IGDB helpers --------------------------------------------------------------

// Longest single wait after a 429. A server Retry-After of minutes (or a
// garbage value) would otherwise park a batch with no progress for that long;
// with MAX_RETRIES the whole retry chain stays bounded at a couple of minutes.
pub(crate) const MAX_RETRY_WAIT_SECS: u64 = 30;

pub(crate) fn retry_wait_secs(retry_after: Option<&str>, backoff_secs: u64) -> u64 {
    retry_after
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(backoff_secs)
        .clamp(1, MAX_RETRY_WAIT_SECS)
}

pub(crate) async fn igdb_query(
    client: &reqwest::Client,
    client_id: &str,
    token: &str,
    endpoint: &str,
    body: &str,
) -> Result<serde_json::Value, String> {
    const MAX_RETRIES: u32 = 4;
    let mut delay_secs = 1u64;

    for attempt in 0..=MAX_RETRIES {
        IGDB_BUDGET.acquire().await;
        let resp = client
            .post(endpoint)
            .header("Client-ID", client_id)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "text/plain")
            .body(body.to_string())
            .send()
            .await
            .str_err()?;

        let status = resp.status();

        if status.as_u16() == 429 {
            if attempt == MAX_RETRIES {
                return Err(format!(
                    "IGDB error (HTTP 429): rate limited after {} retries",
                    MAX_RETRIES
                ));
            }
            // Respect Retry-After header if present, otherwise exponential backoff
            let wait = retry_wait_secs(resp.headers().get("Retry-After").and_then(|v| v.to_str().ok()), delay_secs);
            log::info!("[IGDB] HTTP 429 (attempt {}/{MAX_RETRIES}), retrying in {wait}s", attempt + 1);
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            delay_secs = (delay_secs * 2).min(30);
            continue;
        }

        if !status.is_success() {
            let b = resp.text().await.unwrap_or_default();
            return Err(format!("IGDB error (HTTP {}): {}", status, b));
        }

        return resp
            .json::<serde_json::Value>()
            .await
            .str_err();
    }
    Err("IGDB: unreachable".into())
}

#[cfg(test)]
mod budget_tests {
    use super::RequestBudget;
    use std::time::{Duration, Instant};

    #[test]
    fn window_quota_delays_the_overflow_and_frees_up_as_the_window_slides() {
        let budget = RequestBudget::new(2, Duration::from_secs(10), Duration::ZERO);
        let t0 = Instant::now();
        assert!(budget.reserve(t0).is_zero());
        assert!(budget.reserve(t0 + Duration::from_secs(1)).is_zero());
        let wait = budget.reserve(t0 + Duration::from_secs(2));
        assert_eq!(wait, Duration::from_secs(8));
        assert!(budget.reserve(t0 + Duration::from_secs(10)).is_zero());
    }

    #[test]
    fn a_429_wait_is_bounded_whatever_the_server_says() {
        use super::{retry_wait_secs, MAX_RETRY_WAIT_SECS};
        assert_eq!(retry_wait_secs(Some("3"), 1), 3);
        assert_eq!(retry_wait_secs(Some("86400"), 1), MAX_RETRY_WAIT_SECS);
        assert_eq!(retry_wait_secs(Some("0"), 8), 1, "never a zero-wait spin");
        assert_eq!(retry_wait_secs(Some("Wed, 21 Oct 2015 07:28:00 GMT"), 4), 4);
        assert_eq!(retry_wait_secs(None, 64), MAX_RETRY_WAIT_SECS);
    }

    #[test]
    fn minimum_gap_spaces_consecutive_requests() {
        let budget = RequestBudget::new(100, Duration::from_secs(3600), Duration::from_millis(250));
        let t0 = Instant::now();
        assert!(budget.reserve(t0).is_zero());
        assert_eq!(budget.reserve(t0 + Duration::from_millis(100)), Duration::from_millis(150));
        assert!(budget.reserve(t0 + Duration::from_millis(250)).is_zero());
    }
}
