//! Google OAuth 2.0 for installed apps: PKCE (S256) with a loopback redirect.
//!
//! Google does not allow custom URI schemes (`metadea://`) for new desktop
//! clients, so the redirect is `http://127.0.0.1:<random port>/callback`,
//! answered by a one-shot listener bound to the loopback interface only.
//! The client secret of a "Desktop app" client is not confidential (Google
//! says so; it ships inside every copy of the app) — PKCE and the `state`
//! check are what protect the code exchange.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::error_codes::{self, with_detail};

pub const AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
/// App-private Drive folder: non-sensitive scope, files invisible in the
/// user's Drive UI and to every other app.
pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
pub const CALLBACK_PATH: &str = "/callback";
/// How long the browser sign-in may take before the listener gives up.
pub const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// Refresh this long before the stated expiry (Google issues 1 h tokens).
const REFRESH_MARGIN_SECS: i64 = 120;

#[derive(Debug, Clone)]
pub struct ClientCredentials {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

fn random_url_safe(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::getrandom(&mut buffer).map_err(|e| with_detail(error_codes::GDRIVE_AUTH, e))?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

/// RFC 7636 S256: BASE64URL(SHA256(ASCII(verifier))), unpadded.
pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn new_pkce() -> Result<Pkce, String> {
    // 64 random bytes → 86 unreserved characters (within RFC 7636's 43–128).
    let verifier = random_url_safe(64)?;
    Ok(Pkce { challenge: challenge_for(&verifier), verifier, state: random_url_safe(24)? })
}

pub fn loopback_redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{port}{CALLBACK_PATH}")
}

/// `login_hint`: the email of the Metadea account (signed in with Google), so
/// Google opens straight on that account and only asks for the Drive scope.
pub fn authorize_url(client_id: &str, redirect_uri: &str, pkce: &Pkce, login_hint: Option<&str>) -> Result<String, String> {
    let hint = login_hint.map(str::trim).filter(|h| h.contains('@') && h.len() <= 254);
    let mut params = vec![
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", SCOPE),
        ("code_challenge", pkce.challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("state", pkce.state.as_str()),
        // A refresh token, every time (a re-link after "unlink" too).
        ("access_type", "offline"),
        ("prompt", "consent"),
    ];
    if let Some(hint) = hint {
        params.push(("login_hint", hint));
    }
    reqwest::Url::parse_with_params(AUTHORIZE_URL, &params)
        .map(|url| url.to_string())
        .map_err(|e| with_detail(error_codes::GDRIVE_AUTH, e))
}

#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    Code(String),
    /// Google redirected with `error=` (e.g. `access_denied`).
    Denied(String),
    StateMismatch,
    /// Some other request to the listener (`/favicon.ico`…): keep waiting.
    Unrelated,
}

/// Interprets the request target (`/callback?code=…&state=…`).
pub fn parse_callback(target: &str, expected_state: &str) -> Callback {
    let Ok(url) = reqwest::Url::parse(&format!("http://127.0.0.1{target}")) else { return Callback::Unrelated };
    if url.path() != CALLBACK_PATH {
        return Callback::Unrelated;
    }
    let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
    if param("state").as_deref() != Some(expected_state) {
        return Callback::StateMismatch;
    }
    if let Some(error) = param("error") {
        return Callback::Denied(error);
    }
    match param("code") {
        Some(code) if !code.is_empty() => Callback::Code(code),
        _ => Callback::Denied("missing code".into()),
    }
}

/// Text of the page the browser shows after the redirect (localized by the
/// caller; HTML-escaped here).
#[derive(Debug, Clone, Deserialize)]
pub struct LoopbackPage {
    pub title: String,
    pub body: String,
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn respond(stream: &mut TcpStream, status: &str, page: Option<&LoopbackPage>) {
    let body = page
        .map(|p| {
            format!(
                "<!doctype html><html><head><meta charset=\"utf-8\"><title>{0}</title></head>\
                 <body style=\"font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0\">\
                 <main style=\"text-align:center\"><h1>{0}</h1><p>{1}</p></main></body></html>",
                escape_html(&p.title),
                escape_html(&p.body)
            )
        })
        .unwrap_or_default();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Request line target of one HTTP request (`GET <target> HTTP/1.1`).
fn read_request_target(stream: &mut TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !buffer.windows(4).any(|w| w == b"\r\n\r\n") && buffer.len() < 16 * 1024 {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let text = String::from_utf8_lossy(&buffer);
    let mut parts = text.lines().next()?.split_whitespace();
    (parts.next()? == "GET").then_some(())?;
    parts.next().map(str::to_string)
}

/// Blocks until the browser hits the callback, the timeout passes or
/// `cancelled` is set. Returns the authorization code.
pub fn wait_for_code(
    listener: &TcpListener,
    expected_state: &str,
    page: &LoopbackPage,
    timeout: Duration,
    cancelled: &AtomicBool,
) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| with_detail(error_codes::GDRIVE_AUTH, e))?;
    let deadline = Instant::now() + timeout;
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(error_codes::GDRIVE_LOGIN_CANCELLED.into());
        }
        if Instant::now() >= deadline {
            return Err(error_codes::GDRIVE_LOGIN_TIMEOUT.into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let Some(target) = read_request_target(&mut stream) else {
                    respond(&mut stream, "400 Bad Request", None);
                    continue;
                };
                match parse_callback(&target, expected_state) {
                    Callback::Code(code) => {
                        respond(&mut stream, "200 OK", Some(page));
                        return Ok(code);
                    }
                    Callback::Denied(reason) => {
                        respond(&mut stream, "200 OK", Some(page));
                        return Err(with_detail(error_codes::GDRIVE_AUTH, reason));
                    }
                    Callback::StateMismatch => {
                        respond(&mut stream, "400 Bad Request", None);
                        return Err(error_codes::GDRIVE_STATE_MISMATCH.into());
                    }
                    Callback::Unrelated => respond(&mut stream, "404 Not Found", None),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(error) => return Err(with_detail(error_codes::GDRIVE_AUTH, error)),
        }
    }
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

/// A refresh response carries no refresh token; the old one stays valid.
pub fn tokens_from_response(body: &str, now: i64, previous_refresh: Option<&str>) -> Result<StoredTokens, String> {
    let parsed: TokenResponse =
        serde_json::from_str(body).map_err(|e| with_detail(error_codes::GDRIVE_AUTH, format!("token response: {e}")))?;
    let refresh_token = parsed.refresh_token.or_else(|| previous_refresh.map(str::to_string)).unwrap_or_default();
    if parsed.access_token.is_empty() || refresh_token.is_empty() {
        return Err(with_detail(error_codes::GDRIVE_AUTH, "token response without tokens"));
    }
    Ok(StoredTokens { access_token: parsed.access_token, refresh_token, expires_at: now.saturating_add(parsed.expires_in.max(0)) })
}

pub fn needs_refresh(tokens: &StoredTokens, now: i64) -> bool {
    now >= tokens.expires_at.saturating_sub(REFRESH_MARGIN_SECS)
}

async fn token_request(form: &[(&str, &str)], previous_refresh: Option<&str>) -> Result<StoredTokens, String> {
    let response = crate::http::http_client()
        .post(TOKEN_URL)
        .timeout(Duration::from_secs(30))
        .form(form)
        .send()
        .await
        .map_err(|e| with_detail(error_codes::GDRIVE_NETWORK, e))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| with_detail(error_codes::GDRIVE_NETWORK, e))?;
    if !status.is_success() {
        let summary: String = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or_else(|| body.chars().take(120).collect());
        return Err(with_detail(error_codes::GDRIVE_AUTH, format!("{} {summary}", status.as_u16())));
    }
    tokens_from_response(&body, chrono::Utc::now().timestamp(), previous_refresh)
}

pub async fn exchange_code(client: &ClientCredentials, code: &str, verifier: &str, redirect_uri: &str) -> Result<StoredTokens, String> {
    token_request(
        &[
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ],
        None,
    )
    .await
}

pub async fn refresh_tokens(client: &ClientCredentials, refresh_token: &str) -> Result<StoredTokens, String> {
    token_request(
        &[
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ],
        Some(refresh_token),
    )
    .await
}

/// Best effort: unlinking locally must work offline too.
pub async fn revoke(token: &str) {
    let _ = crate::http::http_client().post(REVOKE_URL).timeout(Duration::from_secs(10)).form(&[("token", token)]).send().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_vector() {
        // RFC 7636, appendix B.
        assert_eq!(challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn generated_pkce_has_the_right_shape() {
        let pkce = new_pkce().unwrap();
        let unreserved = |s: &str| s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._~".contains(&b));
        assert!((43..=128).contains(&pkce.verifier.len()));
        assert!(unreserved(&pkce.verifier));
        assert_eq!(pkce.challenge.len(), 43);
        assert_eq!(pkce.challenge, challenge_for(&pkce.verifier));
        assert!(unreserved(&pkce.state) && pkce.state.len() >= 32);
        assert_ne!(new_pkce().unwrap().verifier, pkce.verifier);
    }

    #[test]
    fn loopback_redirect_and_authorize_url() {
        assert_eq!(loopback_redirect_uri(53682), "http://127.0.0.1:53682/callback");
        let pkce = Pkce { verifier: "v".repeat(43), challenge: "c".into(), state: "s1".into() };
        let url = reqwest::Url::parse(&authorize_url("id.apps.googleusercontent.com", &loopback_redirect_uri(8080), &pkce, None).unwrap()).unwrap();
        let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(param("redirect_uri").as_deref(), Some("http://127.0.0.1:8080/callback"));
        assert_eq!(param("scope").as_deref(), Some(SCOPE));
        assert_eq!(param("code_challenge_method").as_deref(), Some("S256"));
        assert_eq!(param("code_challenge").as_deref(), Some("c"));
        assert_eq!(param("state").as_deref(), Some("s1"));
        assert_eq!(param("access_type").as_deref(), Some("offline"));
        assert_eq!(param("login_hint"), None);
    }

    #[test]
    fn authorize_url_carries_a_valid_login_hint_only() {
        let pkce = Pkce { verifier: "v".repeat(43), challenge: "c".into(), state: "s1".into() };
        let hint_of = |hint: Option<&str>| {
            let url = reqwest::Url::parse(&authorize_url("id", &loopback_redirect_uri(1), &pkce, hint).unwrap()).unwrap();
            url.query_pairs().find(|(k, _)| k == "login_hint").map(|(_, v)| v.into_owned())
        };
        assert_eq!(hint_of(Some(" me@example.com ")).as_deref(), Some("me@example.com"));
        assert_eq!(hint_of(Some("not-an-email")), None);
        assert_eq!(hint_of(Some("")), None);
    }

    #[test]
    fn parses_the_callback() {
        assert_eq!(parse_callback("/callback?state=abc&code=4%2F0xyz", "abc"), Callback::Code("4/0xyz".into()));
        assert_eq!(parse_callback("/callback?state=abc&error=access_denied", "abc"), Callback::Denied("access_denied".into()));
        assert_eq!(parse_callback("/callback?state=evil&code=1", "abc"), Callback::StateMismatch);
        assert_eq!(parse_callback("/favicon.ico", "abc"), Callback::Unrelated);
    }

    #[test]
    fn loopback_listener_returns_the_code() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = std::thread::spawn(move || {
            let mut favicon = TcpStream::connect(("127.0.0.1", port)).unwrap();
            favicon.write_all(b"GET /favicon.ico HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut ignored = String::new();
            let _ = favicon.read_to_string(&mut ignored);
            let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
            stream.write_all(b"GET /callback?state=st&code=the-code HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        });
        let page = LoopbackPage { title: "Done <b>".into(), body: "Close this tab".into() };
        let code = wait_for_code(&listener, "st", &page, Duration::from_secs(10), &AtomicBool::new(false)).unwrap();
        assert_eq!(code, "the-code");
        let response = client.join().unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("Done &lt;b&gt;"));
    }

    #[test]
    fn refresh_keeps_the_previous_refresh_token() {
        let tokens = tokens_from_response(r#"{"access_token":"a2","expires_in":3599}"#, 100, Some("r1")).unwrap();
        assert_eq!(tokens, StoredTokens { access_token: "a2".into(), refresh_token: "r1".into(), expires_at: 3699 });
        assert!(tokens_from_response(r#"{"access_token":"a","expires_in":1}"#, 0, None).is_err());
        assert!(needs_refresh(&tokens, 3699 - 60));
        assert!(!needs_refresh(&tokens, 100));
    }
}
