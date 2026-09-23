// MyAnimeList OAuth2 with PKCE (MAL only supports the `plain` challenge
// method: the challenge *is* the verifier). The owner registers their own
// client id at myanimelist.net/apiconfig with `metadea://auth/mal` as the
// App Redirect URL; the authorization code comes back through that deep
// link (src/deep_link.rs) and is exchanged here. Tokens live encrypted in
// `user_sessions` (service = 'mal') as one JSON blob, same DPAPI wrapping
// as the AniList/GitHub tokens.
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::db::{MetadeaDb, ToStringErr};
use crate::error_codes;

pub const AUTHORIZE_URL: &str = "https://myanimelist.net/v1/oauth2/authorize";
pub const TOKEN_URL: &str = "https://myanimelist.net/v1/oauth2/token";
/// The exact text the owner pastes into MAL's "App Redirect URL" field.
pub const REDIRECT_URI: &str = "metadea://auth/mal";
const SERVICE: &str = "mal";
/// An access token is refreshed this long before its stated expiry, so a
/// sync never races the deadline. MAL issues ~31-day access tokens.
pub const REFRESH_MARGIN_SECS: i64 = 24 * 60 * 60;
/// RFC 7636: 43–128 characters from the unreserved set.
const VERIFIER_LEN: usize = 96;
const STATE_LEN: usize = 32;
const UNRESERVED: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
}

/// The verifier/state pair of a login that was started but not completed.
#[derive(Debug, Clone)]
pub struct PendingLogin {
    pub verifier: String,
    pub state: String,
}

// ─── PKCE material ────────────────────────────────────────────────────────────

/// `len` characters drawn uniformly from the unreserved set (rejection
/// sampling over OS randomness, so no modulo bias).
fn random_unreserved(len: usize) -> Result<String, String> {
    let limit = 256 - (256 % UNRESERVED.len()); // 198: largest multiple of 66
    let mut out = String::with_capacity(len);
    let mut buf = [0u8; 64];
    while out.len() < len {
        getrandom::getrandom(&mut buf).map_err(|e| error_codes::with_detail(error_codes::MAL_AUTH, e))?;
        for byte in buf {
            if (byte as usize) < limit {
                out.push(UNRESERVED[byte as usize % UNRESERVED.len()] as char);
                if out.len() == len {
                    break;
                }
            }
        }
    }
    Ok(out)
}

pub fn new_pending_login() -> Result<PendingLogin, String> {
    let verifier = random_unreserved(VERIFIER_LEN)?;
    if !is_valid_verifier(&verifier) {
        return Err(error_codes::with_detail(error_codes::MAL_AUTH, "generated verifier out of shape"));
    }
    Ok(PendingLogin { verifier, state: random_unreserved(STATE_LEN)? })
}

pub fn is_valid_verifier(verifier: &str) -> bool {
    (43..=128).contains(&verifier.len()) && verifier.bytes().all(|b| UNRESERVED.contains(&b))
}

/// The page the system browser opens. `code_challenge` is the verifier
/// itself (`plain`), which is the only method MAL accepts.
pub fn authorize_url(client_id: &str, login: &PendingLogin) -> Result<String, String> {
    reqwest::Url::parse_with_params(
        AUTHORIZE_URL,
        &[
            ("response_type", "code"),
            ("client_id", client_id),
            ("code_challenge", login.verifier.as_str()),
            ("code_challenge_method", "plain"),
            ("state", login.state.as_str()),
            ("redirect_uri", REDIRECT_URI),
        ],
    )
    .map(|url| url.to_string())
    .map_err(|e| error_codes::with_detail(error_codes::MAL_AUTH, e))
}

// ─── Token lifecycle ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}

pub fn tokens_from_response(body: &str, now: i64) -> Result<StoredTokens, String> {
    let parsed: TokenResponse =
        serde_json::from_str(body).map_err(|e| error_codes::with_detail(error_codes::MAL_AUTH, format!("token response: {e}")))?;
    if parsed.access_token.is_empty() || parsed.refresh_token.is_empty() {
        return Err(error_codes::with_detail(error_codes::MAL_AUTH, "token response without tokens"));
    }
    Ok(StoredTokens {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_at: now.saturating_add(parsed.expires_in.max(0)),
    })
}

pub fn needs_refresh(tokens: &StoredTokens, now: i64) -> bool {
    now >= tokens.expires_at.saturating_sub(REFRESH_MARGIN_SECS)
}

pub fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

async fn token_request(form: &[(&str, &str)]) -> Result<StoredTokens, String> {
    let response = crate::http::http_client()
        .post(TOKEN_URL)
        .header("Accept", "application/json")
        .form(form)
        .send()
        .await
        .map_err(|e| error_codes::with_detail(error_codes::MAL_NETWORK, e))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| error_codes::with_detail(error_codes::MAL_NETWORK, e))?;
    if !status.is_success() {
        return Err(error_codes::with_detail(error_codes::MAL_AUTH, format!("{} {}", status.as_u16(), oauth_error_summary(&body))));
    }
    tokens_from_response(&body, now_unix())
}

/// `{"error": "invalid_grant", "message": "..."}` → a short technical detail.
fn oauth_error_summary(body: &str) -> String {
    let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let field = |name: &str| parsed.as_ref().and_then(|v| v.get(name)).and_then(|v| v.as_str()).map(str::to_string);
    match (field("error"), field("message")) {
        (Some(error), Some(message)) => format!("{error}: {message}"),
        (Some(error), None) => error,
        (None, Some(message)) => message,
        (None, None) => body.chars().take(120).collect(),
    }
}

pub async fn exchange_code(client_id: &str, code: &str, verifier: &str) -> Result<StoredTokens, String> {
    token_request(&[
        ("client_id", client_id),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", REDIRECT_URI),
    ])
    .await
}

pub async fn refresh_tokens(client_id: &str, refresh_token: &str) -> Result<StoredTokens, String> {
    token_request(&[("client_id", client_id), ("grant_type", "refresh_token"), ("refresh_token", refresh_token)]).await
}

// ─── Storage ──────────────────────────────────────────────────────────────────

pub fn save_tokens(db: &MetadeaDb, tokens: &StoredTokens) -> Result<(), String> {
    let json = serde_json::to_string(tokens).str_err()?;
    let encrypted = crate::utils::encrypt_secret(&json)?;
    let now = chrono::Utc::now().to_rfc3339();
    let conn = db.conn.lock().str_err()?;
    conn.execute(
        "INSERT INTO user_sessions (service, token, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(service) DO UPDATE SET token = excluded.token, updated_at = excluded.updated_at",
        rusqlite::params![SERVICE, encrypted, now],
    )
    .map(|_| ())
    .str_err()
}

pub fn load_tokens(db: &MetadeaDb) -> Result<Option<StoredTokens>, String> {
    let stored: Option<String> = {
        let conn = db.conn.lock().str_err()?;
        conn.query_row("SELECT token FROM user_sessions WHERE service = ?1", [SERVICE], |row| row.get(0))
            .optional()
            .str_err()?
    };
    let Some(stored) = stored else { return Ok(None) };
    let json = crate::utils::decrypt_secret(&stored)?;
    serde_json::from_str(&json).map(Some).str_err()
}

pub fn delete_tokens(db: &MetadeaDb) -> Result<(), String> {
    let conn = db.conn.lock().str_err()?;
    conn.execute("DELETE FROM user_sessions WHERE service = ?1", [SERVICE]).map(|_| ()).str_err()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_and_state_have_the_pkce_shape() {
        let login = new_pending_login().unwrap();
        assert_eq!(login.verifier.len(), VERIFIER_LEN);
        assert!(is_valid_verifier(&login.verifier));
        assert_eq!(login.state.len(), STATE_LEN);
        assert!(login.state.bytes().all(|b| UNRESERVED.contains(&b)));
        // Two logins never share material.
        assert_ne!(new_pending_login().unwrap().verifier, login.verifier);
    }

    #[test]
    fn verifier_validation_follows_rfc_7636() {
        assert!(is_valid_verifier(&"a".repeat(43)));
        assert!(is_valid_verifier(&"Z9-._~".repeat(20)));
        assert!(!is_valid_verifier(&"a".repeat(42)));
        assert!(!is_valid_verifier(&"a".repeat(129)));
        assert!(!is_valid_verifier(&"a b".repeat(20)));
        assert!(!is_valid_verifier(&"a+b".repeat(20)));
    }

    #[test]
    fn authorize_url_uses_the_plain_challenge_and_the_deep_link() {
        let login = PendingLogin { verifier: "v".repeat(50), state: "st4te".into() };
        let url = authorize_url("client 1", &login).unwrap();
        assert!(url.starts_with("https://myanimelist.net/v1/oauth2/authorize?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("client_id=client+1"));
        assert!(url.contains(&format!("code_challenge={}", "v".repeat(50))));
        assert!(url.contains("code_challenge_method=plain"));
        assert!(url.contains("state=st4te"));
        assert!(url.contains("redirect_uri=metadea%3A%2F%2Fauth%2Fmal"));
    }

    const TOKEN_FIXTURE: &str = r#"{"token_type":"Bearer","expires_in":2678400,"access_token":"acc.ess","refresh_token":"re.fresh"}"#;

    #[test]
    fn token_response_fixture_becomes_stored_tokens() {
        let tokens = tokens_from_response(TOKEN_FIXTURE, 1_000).unwrap();
        assert_eq!(tokens, StoredTokens { access_token: "acc.ess".into(), refresh_token: "re.fresh".into(), expires_at: 2_679_400 });
        assert!(tokens_from_response(r#"{"error":"invalid_grant"}"#, 0).unwrap_err().starts_with("E_MAL_AUTH"));
        assert!(tokens_from_response("<html>", 0).unwrap_err().starts_with("E_MAL_AUTH"));
        assert!(tokens_from_response(r#"{"access_token":"","refresh_token":"","expires_in":1}"#, 0).is_err());
    }

    #[test]
    fn refresh_decision_keeps_a_one_day_margin() {
        let tokens = StoredTokens { access_token: "a".into(), refresh_token: "r".into(), expires_at: 1_000_000 };
        assert!(!needs_refresh(&tokens, 1_000_000 - REFRESH_MARGIN_SECS - 1));
        assert!(needs_refresh(&tokens, 1_000_000 - REFRESH_MARGIN_SECS));
        assert!(needs_refresh(&tokens, 1_000_000 + 5));
    }

    #[test]
    fn oauth_errors_are_summarised_for_the_detail() {
        assert_eq!(oauth_error_summary(r#"{"error":"invalid_grant","message":"Bad code"}"#), "invalid_grant: Bad code");
        assert_eq!(oauth_error_summary(r#"{"error":"invalid_client"}"#), "invalid_client");
        assert_eq!(oauth_error_summary("boom"), "boom");
    }

    #[test]
    fn tokens_round_trip_through_the_sessions_table() {
        let db = MetadeaDb::open_in_memory().unwrap();
        assert_eq!(load_tokens(&db).unwrap(), None);
        let tokens = StoredTokens { access_token: "acc".into(), refresh_token: "ref".into(), expires_at: 42 };
        save_tokens(&db, &tokens).unwrap();
        assert_eq!(load_tokens(&db).unwrap(), Some(tokens.clone()));
        let newer = StoredTokens { expires_at: 99, ..tokens };
        save_tokens(&db, &newer).unwrap();
        assert_eq!(load_tokens(&db).unwrap(), Some(newer));
        delete_tokens(&db).unwrap();
        assert_eq!(load_tokens(&db).unwrap(), None);
    }
}
