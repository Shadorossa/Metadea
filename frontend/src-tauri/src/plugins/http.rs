//! `plugin_http_fetch` / `plugin_http_download`: the only network path a
//! plugin has. Every hop (redirects included) is checked against the
//! plugin's granted host allowlist and the https-unless-LAN rule
//! (host_rules.rs); methods and headers are restricted, bodies and
//! responses are capped, and the whole exchange has a timeout.
use std::collections::BTreeMap;
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

use super::host_rules::{check_url, HostPattern, UrlRejection};
use crate::error_codes::{self, with_detail};

pub const DEFAULT_TIMEOUT_MS: u64 = 20_000;
pub const MAX_TIMEOUT_MS: u64 = 60_000;
pub const DOWNLOAD_TIMEOUT_MS: u64 = 300_000;
pub const MAX_REQUEST_BODY_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_DOWNLOAD_BYTES: usize = 300 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const MAX_HEADERS: usize = 32;
const MAX_HEADER_VALUE_LEN: usize = 8 * 1024;
const MAX_CONCURRENT_REQUESTS: usize = 12;

const ALLOWED_METHODS: &[&str] = &["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
/// Headers the transport owns (or that would let a plugin smuggle a second
/// request or reach a proxy); `sec-*` and `proxy-*` are refused by prefix.
const FORBIDDEN_HEADERS: &[&str] = &[
    "host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "expect",
];

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResponseType {
    #[default]
    Text,
    Base64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginHttpRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub body_base64: Option<String>,
    #[serde(default)]
    pub response_type: ResponseType,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginHttpResponse {
    pub status: u16,
    /// Final URL after redirects.
    pub url: String,
    /// Lower-cased names; repeated headers joined with ", ".
    pub headers: BTreeMap<String, String>,
    pub body: String,
    /// `text` (UTF-8, lossy) or `base64`.
    pub body_encoding: &'static str,
}

fn invalid_request(detail: impl std::fmt::Display) -> String {
    with_detail(error_codes::PLUGIN_HTTP_REQUEST_INVALID, detail)
}

/// A validated request, ready to send.
#[derive(Debug)]
pub struct PreparedRequest {
    pub url: reqwest::Url,
    pub method: reqwest::Method,
    pub headers: reqwest::header::HeaderMap,
    pub body: Option<Vec<u8>>,
    pub timeout: Duration,
}

fn check_header(name: &str, value: &str) -> Result<(), String> {
    let lower = name.to_ascii_lowercase();
    let token_ok = !name.is_empty()
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b));
    if !token_ok {
        return Err(invalid_request(format!("invalid header name \"{name}\"")));
    }
    if FORBIDDEN_HEADERS.contains(&lower.as_str()) || lower.starts_with("sec-") || lower.starts_with("proxy-") {
        return Err(invalid_request(format!("header \"{name}\" is not allowed")));
    }
    if value.len() > MAX_HEADER_VALUE_LEN || value.contains(['\r', '\n', '\0']) {
        return Err(invalid_request(format!("invalid value for header \"{name}\"")));
    }
    Ok(())
}

pub fn prepare(request: &PluginHttpRequest, default_timeout_ms: u64, max_timeout_ms: u64) -> Result<PreparedRequest, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|e| invalid_request(format!("url: {e}")))?;
    let method_name = request.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    if !ALLOWED_METHODS.contains(&method_name.as_str()) {
        return Err(invalid_request(format!("method {method_name} is not allowed")));
    }
    let method = reqwest::Method::from_bytes(method_name.as_bytes()).map_err(invalid_request)?;
    if request.headers.len() > MAX_HEADERS {
        return Err(invalid_request(format!("more than {MAX_HEADERS} headers")));
    }
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in &request.headers {
        check_header(name, value)?;
        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(invalid_request)?;
        let value = reqwest::header::HeaderValue::from_str(value).map_err(invalid_request)?;
        headers.append(name, value);
    }
    let body = match (&request.body, &request.body_base64) {
        (Some(_), Some(_)) => return Err(invalid_request("body and bodyBase64 are exclusive")),
        (Some(text), None) => Some(text.as_bytes().to_vec()),
        (None, Some(b64)) => Some(crate::utils::base64_decode(b64).map_err(|e| invalid_request(format!("bodyBase64: {e}")))?),
        (None, None) => None,
    };
    if body.as_ref().is_some_and(|b| b.len() > MAX_REQUEST_BODY_BYTES) {
        return Err(invalid_request("request body larger than 4 MB"));
    }
    if body.is_some() && (method == reqwest::Method::GET || method == reqwest::Method::HEAD) {
        return Err(invalid_request("GET and HEAD requests cannot have a body"));
    }
    let timeout_ms = request.timeout_ms.unwrap_or(default_timeout_ms).clamp(1_000, max_timeout_ms);
    Ok(PreparedRequest { url, method, headers, body, timeout: Duration::from_millis(timeout_ms) })
}

pub fn rejection_error(url: &reqwest::Url, rejection: UrlRejection) -> String {
    let host = url.host_str().unwrap_or("").to_string();
    match rejection {
        UrlRejection::Invalid => invalid_request(format!("unsupported URL {}", url.scheme())),
        UrlRejection::InsecureScheme => with_detail(error_codes::PLUGIN_HOST_NOT_ALLOWED, format!("http is only allowed for local hosts ({host})")),
        UrlRejection::HostNotAllowed => with_detail(error_codes::PLUGIN_HOST_NOT_ALLOWED, host),
    }
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            // Redirects are followed by hand so every hop is re-checked.
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Metadea plugin host")
            .timeout(Duration::from_millis(DOWNLOAD_TIMEOUT_MS))
            .build()
            .unwrap_or_default()
    })
}

fn semaphore() -> &'static Semaphore {
    static SEMAPHORE: OnceLock<Semaphore> = OnceLock::new();
    SEMAPHORE.get_or_init(|| Semaphore::new(MAX_CONCURRENT_REQUESTS))
}

fn network_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        with_detail(error_codes::PLUGIN_HTTP_TIMEOUT, e)
    } else {
        with_detail(error_codes::PLUGIN_HTTP_NETWORK, e)
    }
}

/// Sends the request, following up to MAX_REDIRECTS redirects that each
/// pass the allowlist. Returns the final response (not yet read).
async fn send_checked(prepared: PreparedRequest, allowlist: &[HostPattern]) -> Result<reqwest::Response, String> {
    let PreparedRequest { mut url, mut method, mut headers, mut body, .. } = prepared;
    for _ in 0..=MAX_REDIRECTS {
        check_url(&url, allowlist).map_err(|r| rejection_error(&url, r))?;
        let mut builder = client().request(method.clone(), url.clone()).headers(headers.clone());
        if let Some(bytes) = &body {
            builder = builder.body(bytes.clone());
        }
        let response = builder.send().await.map_err(network_error)?;
        let status = response.status();
        if !status.is_redirection() {
            return Ok(response);
        }
        let Some(location) = response.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()) else {
            return Ok(response);
        };
        let next = url.join(location).map_err(|e| with_detail(error_codes::PLUGIN_HTTP_NETWORK, format!("bad redirect: {e}")))?;
        if next.host_str() != url.host_str() || next.port_or_known_default() != url.port_or_known_default() {
            // Same as browsers: credentials never follow a cross-origin redirect.
            headers.remove(reqwest::header::AUTHORIZATION);
            headers.remove(reqwest::header::COOKIE);
        }
        if matches!(status.as_u16(), 301..=303) && method != reqwest::Method::HEAD {
            method = reqwest::Method::GET;
            body = None;
            headers.remove(reqwest::header::CONTENT_TYPE);
        }
        url = next;
    }
    Err(with_detail(error_codes::PLUGIN_HTTP_NETWORK, "too many redirects"))
}

fn response_headers(response: &reqwest::Response) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for (name, value) in response.headers() {
        let value = String::from_utf8_lossy(value.as_bytes()).to_string();
        out.entry(name.as_str().to_string())
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(&value);
            })
            .or_insert(value);
    }
    out
}

/// Reads the body into memory, failing past `cap` bytes.
async fn read_capped(mut response: reqwest::Response, cap: usize) -> Result<Vec<u8>, String> {
    if response.content_length().is_some_and(|len| len as usize > cap) {
        return Err(with_detail(error_codes::PLUGIN_HTTP_TOO_LARGE, format!("{} MB max", cap / 1024 / 1024)));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if body.len() + chunk.len() > cap {
            return Err(with_detail(error_codes::PLUGIN_HTTP_TOO_LARGE, format!("{} MB max", cap / 1024 / 1024)));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub async fn fetch(request: PluginHttpRequest, allowlist: Vec<HostPattern>) -> Result<PluginHttpResponse, String> {
    let prepared = prepare(&request, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)?;
    let timeout = prepared.timeout;
    let _permit = semaphore().acquire().await.map_err(|e| with_detail(error_codes::PLUGIN_HTTP_NETWORK, e))?;
    let exchange = async {
        let response = send_checked(prepared, &allowlist).await?;
        let status = response.status().as_u16();
        let url = response.url().to_string();
        let headers = response_headers(&response);
        let bytes = read_capped(response, MAX_RESPONSE_BYTES).await?;
        let (body, body_encoding) = match request.response_type {
            ResponseType::Text => (String::from_utf8_lossy(&bytes).into_owned(), "text"),
            ResponseType::Base64 => (crate::utils::base64_encode(&bytes), "base64"),
        };
        Ok::<_, String>(PluginHttpResponse { status, url, headers, body, body_encoding })
    };
    tokio::time::timeout(timeout, exchange)
        .await
        .map_err(|_| with_detail(error_codes::PLUGIN_HTTP_TIMEOUT, format!("{} ms", timeout.as_millis())))?
}

/// Streams a (large) response to `dest`; the caller picks the file name.
pub async fn download(request: PluginHttpRequest, allowlist: Vec<HostPattern>, dest: &std::path::Path) -> Result<(), String> {
    use std::io::Write;
    let prepared = prepare(&request, DOWNLOAD_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS)?;
    let timeout = prepared.timeout;
    let _permit = semaphore().acquire().await.map_err(|e| with_detail(error_codes::PLUGIN_HTTP_NETWORK, e))?;
    let partial = dest.with_extension("part");
    let exchange = async {
        let mut response = send_checked(prepared, &allowlist).await?;
        if !response.status().is_success() {
            return Err(with_detail(error_codes::PLUGIN_HTTP_NETWORK, format!("HTTP {}", response.status().as_u16())));
        }
        if response.content_length().is_some_and(|len| len as usize > MAX_DOWNLOAD_BYTES) {
            return Err(with_detail(error_codes::PLUGIN_HTTP_TOO_LARGE, "300 MB max"));
        }
        let mut file = std::fs::File::create(&partial).map_err(|e| with_detail(error_codes::PLUGIN_IO, e))?;
        let mut written = 0usize;
        while let Some(chunk) = response.chunk().await.map_err(network_error)? {
            written += chunk.len();
            if written > MAX_DOWNLOAD_BYTES {
                return Err(with_detail(error_codes::PLUGIN_HTTP_TOO_LARGE, "300 MB max"));
            }
            file.write_all(&chunk).map_err(|e| with_detail(error_codes::PLUGIN_IO, e))?;
        }
        Ok(())
    };
    let result = tokio::time::timeout(timeout, exchange)
        .await
        .map_err(|_| with_detail(error_codes::PLUGIN_HTTP_TIMEOUT, format!("{} ms", timeout.as_millis())))
        .and_then(|inner| inner);
    match result {
        Ok(()) => std::fs::rename(&partial, dest).map_err(|e| with_detail(error_codes::PLUGIN_IO, e)),
        Err(error) => {
            std::fs::remove_file(&partial).ok();
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(url: &str) -> PluginHttpRequest {
        PluginHttpRequest {
            url: url.into(),
            method: None,
            headers: BTreeMap::new(),
            body: None,
            body_base64: None,
            response_type: ResponseType::Text,
            timeout_ms: None,
        }
    }

    #[test]
    fn methods_are_restricted() {
        let mut req = request("https://api.example.com/");
        for ok in ["get", "POST", "delete"] {
            req.method = Some(ok.into());
            assert!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).is_ok(), "{ok}");
        }
        for bad in ["CONNECT", "TRACE", "OPTIONS", "FOO BAR"] {
            req.method = Some(bad.into());
            assert!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).unwrap_err().starts_with(error_codes::PLUGIN_HTTP_REQUEST_INVALID), "{bad}");
        }
    }

    #[test]
    fn headers_are_restricted() {
        for (name, value, ok) in [
            ("Authorization", "Basic abc", true),
            ("X-Custom", "1", true),
            ("User-Agent", "My plugin", true),
            ("Host", "evil.com", false),
            ("Content-Length", "5", false),
            ("Transfer-Encoding", "chunked", false),
            ("Sec-Fetch-Mode", "cors", false),
            ("Proxy-Authorization", "x", false),
            ("Bad Header", "x", false),
            ("X-Split", "a\r\nHost: evil", false),
        ] {
            let mut req = request("https://api.example.com/");
            req.headers.insert(name.into(), value.into());
            assert_eq!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).is_ok(), ok, "{name}");
        }
    }

    #[test]
    fn bodies_and_timeouts() {
        let mut req = request("https://api.example.com/");
        req.body = Some("x".into());
        assert!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).is_err(), "GET with body");
        req.method = Some("POST".into());
        assert!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).is_ok());
        req.body_base64 = Some("eA==".into());
        assert!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).is_err(), "both bodies");
        req.body = None;
        req.body_base64 = Some("!!".into());
        assert!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).is_err(), "bad base64");
        req.body = Some("x".repeat(MAX_REQUEST_BODY_BYTES + 1));
        req.body_base64 = None;
        assert!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).is_err(), "body too large");

        let mut req = request("https://api.example.com/");
        req.timeout_ms = Some(10_000_000);
        assert_eq!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).unwrap().timeout, Duration::from_millis(MAX_TIMEOUT_MS));
        req.timeout_ms = Some(1);
        assert_eq!(prepare(&req, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS).unwrap().timeout, Duration::from_millis(1_000));
    }

    #[test]
    fn fetch_refuses_hosts_outside_the_allowlist_before_any_network() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let allow = vec![HostPattern::parse("api.example.com").unwrap()];
        let error = runtime.block_on(fetch(request("https://other.example.com/x"), allow.clone())).unwrap_err();
        assert!(error.starts_with(error_codes::PLUGIN_HOST_NOT_ALLOWED), "{error}");
        let error = runtime.block_on(fetch(request("http://api.example.com/x"), allow)).unwrap_err();
        assert!(error.starts_with(error_codes::PLUGIN_HOST_NOT_ALLOWED), "{error}");
    }
}
