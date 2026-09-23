// The one reqwest client for the whole app. Built once and reused so every
// caller shares a connection pool and TLS setup instead of paying for a
// fresh one per request (igdb.rs and comicvine.rs each used to cache their
// own; GitHub/AniList/VLC calls built a throwaway client every time).
//
// The default User-Agent is required by Comic Vine, which rejects requests
// without one; other APIs ignore it, and a call site can still override it
// per request (github.rs does). Per-request `.timeout(..)` also still wins
// over the 15s default (the VLC status polls use 2s).
use std::sync::OnceLock;
use std::time::Duration;

pub(crate) fn http_client() -> &'static reqwest::Client {
    static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    HTTP_CLIENT.get_or_init(|| {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::USER_AGENT,
            reqwest::header::HeaderValue::from_static("Metadea (github.com/Shadorossa/Metadea)"),
        );
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .default_headers(headers)
            .build()
            .unwrap_or_default()
    })
}
