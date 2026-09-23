//! Drive v3 calls against the app-private `appDataFolder`: account info,
//! list, resumable upload, download and delete. Every call has a timeout;
//! transient failures (network, 429, 5xx) are retried with backoff.

use reqwest::{Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::future::Future;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::Duration;

use super::schedule::RemoteBackup;
use crate::backup::progress::ProgressSink;
use crate::error_codes::{self, with_detail};

const FILES_URL: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,createdTime,appProperties";
const UPLOAD_BASE_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";
const UPLOAD_QUERY: &str = "uploadType=resumable&fields=id,name,size,createdTime,appProperties";
/// Emulator saves (src/saves/drive.rs): any content type.
const MIME_OCTET: &str = "application/octet-stream";
const ABOUT_URL: &str = "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)";
const MIME_7Z: &str = "application/x-7z-compressed";
/// Marks the files this app uploads (the only kind in its appDataFolder).
const APP_PROPERTY: &str = "metadea";
/// Resumable chunks must be multiples of 256 KiB.
const CHUNK_SIZE: usize = 32 * 256 * 1024;
const MAX_ATTEMPTS: u32 = 5;
const API_TIMEOUT: Duration = Duration::from_secs(30);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(180);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveAccount {
    pub email: String,
    pub name: String,
    pub photo_url: Option<String>,
}

enum Failure {
    /// Worth another attempt: network error, 429 or 5xx.
    Transient(String),
    Fatal(String),
}

fn backoff(attempt: u32) -> Duration {
    Duration::from_millis(500u64.saturating_mul(1 << attempt.min(6)))
}

fn classify_status(status: StatusCode, body: &str) -> Failure {
    let detail = format!("{} {}", status.as_u16(), body.chars().take(200).collect::<String>());
    if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        Failure::Transient(with_detail(error_codes::GDRIVE_API, detail))
    } else if status == StatusCode::UNAUTHORIZED {
        Failure::Fatal(with_detail(error_codes::GDRIVE_AUTH, detail))
    } else if status == StatusCode::NOT_FOUND {
        Failure::Fatal(with_detail(error_codes::GDRIVE_NOT_FOUND, detail))
    } else {
        Failure::Fatal(with_detail(error_codes::GDRIVE_API, detail))
    }
}

async fn with_retries<T, F, Fut>(mut call: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, Failure>>,
{
    let mut attempt = 0;
    loop {
        match call().await {
            Ok(value) => return Ok(value),
            Err(Failure::Fatal(error)) => return Err(error),
            Err(Failure::Transient(error)) => {
                attempt += 1;
                if attempt >= MAX_ATTEMPTS {
                    return Err(error);
                }
                tokio::time::sleep(backoff(attempt)).await;
            }
        }
    }
}

fn network(error: reqwest::Error) -> Failure {
    Failure::Transient(with_detail(error_codes::GDRIVE_NETWORK, error))
}

async fn ok_or_failure(response: Response) -> Result<Response, Failure> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(classify_status(status, &body))
}

async fn get_json<T: for<'de> Deserialize<'de>>(token: &str, url: &str) -> Result<T, String> {
    with_retries(|| async {
        let response = crate::http::http_client().get(url).bearer_auth(token).timeout(API_TIMEOUT).send().await.map_err(network)?;
        let response = ok_or_failure(response).await?;
        response.json::<T>().await.map_err(|e| Failure::Fatal(with_detail(error_codes::GDRIVE_API, e)))
    })
    .await
}

pub async fn about(token: &str) -> Result<DriveAccount, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct User {
        display_name: Option<String>,
        email_address: Option<String>,
        photo_link: Option<String>,
    }
    #[derive(Deserialize)]
    struct About {
        user: User,
    }
    let about: About = get_json(token, ABOUT_URL).await?;
    Ok(DriveAccount {
        email: about.user.email_address.unwrap_or_default(),
        name: about.user.display_name.unwrap_or_default(),
        photo_url: about.user.photo_link.filter(|url| url.starts_with("https://")),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFile {
    id: String,
    name: String,
    size: Option<String>,
    created_time: Option<String>,
    app_properties: Option<std::collections::HashMap<String, String>>,
}

impl From<DriveFile> for RemoteBackup {
    fn from(file: DriveFile) -> Self {
        RemoteBackup {
            id: file.id,
            name: file.name,
            size: file.size.and_then(|s| s.parse().ok()).unwrap_or(0),
            created_at: file.created_time.unwrap_or_default(),
            app_version: file.app_properties.and_then(|p| p.get("app_version").cloned()),
        }
    }
}

pub async fn list_backups(token: &str) -> Result<Vec<RemoteBackup>, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Page {
        files: Vec<DriveFile>,
        next_page_token: Option<String>,
    }
    let mut out = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut url = reqwest::Url::parse_with_params(
            FILES_URL,
            &[
                ("spaces", "appDataFolder"),
                ("q", "appProperties has { key='metadea' and value='backup' } and trashed = false"),
                ("fields", "nextPageToken,files(id,name,size,createdTime,appProperties)"),
                ("orderBy", "createdTime desc"),
                ("pageSize", "100"),
            ],
        )
        .map_err(|e| with_detail(error_codes::GDRIVE_API, e))?;
        if let Some(page_token) = &page_token {
            url.query_pairs_mut().append_pair("pageToken", page_token);
        }
        let page: Page = get_json(token, url.as_str()).await?;
        out.extend(page.files.into_iter().map(RemoteBackup::from));
        match page.next_page_token {
            Some(next) if out.len() < 10_000 => page_token = Some(next),
            _ => return Ok(out),
        }
    }
}

pub async fn delete(token: &str, file_id: &str) -> Result<(), String> {
    let url = format!("{FILES_URL}/{}", urlencode(file_id));
    with_retries(|| async {
        let response = crate::http::http_client().delete(&url).bearer_auth(token).timeout(API_TIMEOUT).send().await.map_err(network)?;
        ok_or_failure(response).await.map(|_| ())
    })
    .await
}

fn urlencode(id: &str) -> String {
    id.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

pub struct UploadMeta<'a> {
    pub name: &'a str,
    pub fingerprint: &'a str,
    pub schema_version: i64,
    pub app_version: &'a str,
}

/// Parses the `Range: bytes=0-N` header of a 308 into the next offset.
pub fn next_offset(range: Option<&str>) -> u64 {
    range
        .and_then(|r| r.strip_prefix("bytes=0-"))
        .and_then(|end| end.trim().parse::<u64>().ok())
        .map_or(0, |end| end + 1)
}

enum ChunkOutcome {
    Done(DriveFile),
    Continue(u64),
}

async fn chunk_outcome(response: Response) -> Result<ChunkOutcome, Failure> {
    let status = response.status();
    if status.as_u16() == 308 {
        let range = response.headers().get("range").and_then(|v| v.to_str().ok()).map(str::to_string);
        return Ok(ChunkOutcome::Continue(next_offset(range.as_deref())));
    }
    let response = ok_or_failure(response).await?;
    let file: DriveFile = response.json().await.map_err(|e| Failure::Fatal(with_detail(error_codes::GDRIVE_API, e)))?;
    Ok(ChunkOutcome::Done(file))
}

/// Resumable upload (Drive v3) of `path` into `appDataFolder`, reporting
/// `upload` progress. An interrupted chunk asks the session how far it got
/// and resumes from there instead of starting over.
pub async fn upload(token: &str, path: &Path, meta: UploadMeta<'_>, progress: &dyn ProgressSink) -> Result<RemoteBackup, String> {
    let metadata = serde_json::json!({
        "name": meta.name,
        "parents": ["appDataFolder"],
        "mimeType": MIME_7Z,
        "appProperties": {
            APP_PROPERTY: "backup",
            "fingerprint": meta.fingerprint,
            "schema_version": meta.schema_version.to_string(),
            "app_version": meta.app_version,
        },
    });
    let session = UploadSession { method: reqwest::Method::POST, url: UPLOAD_URL.to_string(), metadata, mime: MIME_7Z };
    resumable_upload(token, path, session, progress).await.map(RemoteBackup::from)
}

/// How a resumable upload session is opened: POST for a new file, PATCH
/// on `files/{id}` to replace an existing file's content.
struct UploadSession {
    method: reqwest::Method,
    url: String,
    metadata: serde_json::Value,
    mime: &'static str,
}

async fn resumable_upload(token: &str, path: &Path, request: UploadSession, progress: &dyn ProgressSink) -> Result<DriveFile, String> {
    let total = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let session = with_retries(|| async {
        let response = crate::http::http_client()
            .request(request.method.clone(), &request.url)
            .bearer_auth(token)
            .timeout(API_TIMEOUT)
            .header("X-Upload-Content-Type", request.mime)
            .header("X-Upload-Content-Length", total.to_string())
            .json(&request.metadata)
            .send()
            .await
            .map_err(network)?;
        let response = ok_or_failure(response).await?;
        response
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| Failure::Fatal(with_detail(error_codes::GDRIVE_API, "no upload session")))
    })
    .await?;

    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut offset = 0u64;
    let mut attempt = 0u32;
    let mut buffer = vec![0u8; CHUNK_SIZE];
    progress.report("upload", 0.0);
    loop {
        if progress.cancelled() {
            let _ = crate::http::http_client().delete(&session).timeout(Duration::from_secs(10)).send().await;
            return Err(error_codes::BACKUP_CANCELLED.into());
        }
        let length = (total - offset).min(CHUNK_SIZE as u64) as usize;
        file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        file.read_exact(&mut buffer[..length]).map_err(|e| e.to_string())?;
        let range = if total == 0 { "bytes */0".to_string() } else { format!("bytes {}-{}/{}", offset, offset + length as u64 - 1, total) };
        let sent = crate::http::http_client()
            .put(&session)
            .timeout(CHUNK_TIMEOUT)
            .header("Content-Range", range)
            .body(buffer[..length].to_vec())
            .send()
            .await;
        let outcome = match sent {
            Ok(response) => chunk_outcome(response).await,
            Err(error) => Err(network(error)),
        };
        match outcome {
            Ok(ChunkOutcome::Done(remote)) => {
                progress.report("upload", 100.0);
                return Ok(remote);
            }
            Ok(ChunkOutcome::Continue(next)) => {
                attempt = 0;
                offset = next.min(total);
                progress.report("upload", offset as f64 * 100.0 / total.max(1) as f64);
            }
            Err(Failure::Fatal(error)) => return Err(error),
            Err(Failure::Transient(error)) => {
                attempt += 1;
                if attempt >= MAX_ATTEMPTS {
                    return Err(error);
                }
                tokio::time::sleep(backoff(attempt)).await;
                // Ask the session how much it actually stored.
                let status = crate::http::http_client()
                    .put(&session)
                    .timeout(API_TIMEOUT)
                    .header("Content-Range", format!("bytes */{total}"))
                    .body(Vec::new())
                    .send()
                    .await;
                if let Ok(response) = status {
                    match chunk_outcome(response).await {
                        Ok(ChunkOutcome::Done(remote)) => return Ok(remote),
                        Ok(ChunkOutcome::Continue(next)) => offset = next.min(total),
                        Err(Failure::Fatal(error)) => return Err(error),
                        Err(Failure::Transient(_)) => {}
                    }
                }
            }
        }
    }
}

/// Downloads a backup to `destination`, reporting `download` progress.
/// A failed attempt restarts the file from scratch (backups are small
/// enough that byte-range resumption is not worth its complexity here).
pub async fn download(token: &str, file_id: &str, expected_size: u64, destination: &Path, progress: &dyn ProgressSink) -> Result<(), String> {
    let url = format!("{FILES_URL}/{}?alt=media", urlencode(file_id));
    let mut attempt = 0u32;
    loop {
        match download_once(token, &url, expected_size, destination, progress).await {
            Ok(()) => return Ok(()),
            Err(Failure::Fatal(error)) => return Err(error),
            Err(Failure::Transient(error)) => {
                attempt += 1;
                if attempt >= MAX_ATTEMPTS {
                    return Err(error);
                }
                tokio::time::sleep(backoff(attempt)).await;
            }
        }
    }
}

async fn download_once(token: &str, url: &str, expected_size: u64, destination: &Path, progress: &dyn ProgressSink) -> Result<(), Failure> {
    let response = crate::http::http_client().get(url).bearer_auth(token).timeout(DOWNLOAD_TIMEOUT).send().await.map_err(network)?;
    let mut response = ok_or_failure(response).await?;
    let total = response.content_length().unwrap_or(expected_size).max(1);
    if total > crate::backup::archive::MAX_TOTAL_BYTES {
        return Err(Failure::Fatal(with_detail(error_codes::BACKUP_TOO_LARGE, total)));
    }
    let mut output = File::create(destination).map_err(|e| Failure::Fatal(e.to_string()))?;
    let mut done = 0u64;
    progress.report("download", 0.0);
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        if progress.cancelled() {
            return Err(Failure::Fatal(error_codes::BACKUP_CANCELLED.into()));
        }
        done += chunk.len() as u64;
        if done > crate::backup::archive::MAX_TOTAL_BYTES {
            return Err(Failure::Fatal(with_detail(error_codes::BACKUP_TOO_LARGE, done)));
        }
        output.write_all(&chunk).map_err(|e| Failure::Fatal(e.to_string()))?;
        progress.report("download", done as f64 * 100.0 / total as f64);
    }
    output.sync_all().map_err(|e| Failure::Fatal(e.to_string()))?;
    Ok(())
}

// --- Emulator saves (src/saves/drive.rs) ---------------------------------------

/// One save file in appDataFolder. `name` is its path under the central
/// folder (`Saves/<Platform>/<Game>/battery/...`); `game` groups the
/// files of one game across PCs whatever its folder is called there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteSave {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub game: Option<String>,
    pub sha256: Option<String>,
    pub mtime_ms: Option<i64>,
}

impl From<DriveFile> for RemoteSave {
    fn from(file: DriveFile) -> Self {
        let properties = file.app_properties.unwrap_or_default();
        RemoteSave {
            id: file.id,
            name: file.name,
            size: file.size.and_then(|s| s.parse().ok()).unwrap_or(0),
            game: properties.get("game").cloned(),
            sha256: properties.get("sha256").cloned(),
            mtime_ms: properties.get("mtime").and_then(|m| m.parse().ok()),
        }
    }
}

/// Every save file (or one game's, by its `game` property).
pub async fn list_saves(token: &str, game: Option<&str>) -> Result<Vec<RemoteSave>, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Page {
        files: Vec<DriveFile>,
        next_page_token: Option<String>,
    }
    let mut query = "appProperties has { key='metadea' and value='save' } and trashed = false".to_string();
    if let Some(game) = game {
        // Hex only (saves::layout::short_hash), so nothing needs quoting.
        let game: String = game.chars().filter(char::is_ascii_hexdigit).collect();
        query.push_str(&format!(" and appProperties has {{ key='game' and value='{game}' }}"));
    }
    let mut out = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut url = reqwest::Url::parse_with_params(
            FILES_URL,
            &[
                ("spaces", "appDataFolder"),
                ("q", query.as_str()),
                ("fields", "nextPageToken,files(id,name,size,createdTime,appProperties)"),
                ("pageSize", "1000"),
            ],
        )
        .map_err(|e| with_detail(error_codes::GDRIVE_API, e))?;
        if let Some(page_token) = &page_token {
            url.query_pairs_mut().append_pair("pageToken", page_token);
        }
        let page: Page = get_json(token, url.as_str()).await?;
        out.extend(page.files.into_iter().map(RemoteSave::from));
        match page.next_page_token {
            Some(next) if out.len() < 100_000 => page_token = Some(next),
            _ => return Ok(out),
        }
    }
}

pub struct SaveUploadMeta<'a> {
    pub name: &'a str,
    pub game: &'a str,
    pub sha256: &'a str,
    pub mtime_ms: i64,
}

/// Uploads one save file: a new file, or new content for `existing_id`.
pub async fn upload_save(
    token: &str,
    path: &Path,
    meta: SaveUploadMeta<'_>,
    existing_id: Option<&str>,
    progress: &dyn ProgressSink,
) -> Result<RemoteSave, String> {
    let properties = serde_json::json!({
        APP_PROPERTY: "save",
        "game": meta.game,
        "sha256": meta.sha256,
        "mtime": meta.mtime_ms.to_string(),
    });
    let session = match existing_id {
        Some(id) => UploadSession {
            method: reqwest::Method::PATCH,
            url: format!("{UPLOAD_BASE_URL}/{}?{UPLOAD_QUERY}", urlencode(id)),
            metadata: serde_json::json!({ "name": meta.name, "appProperties": properties }),
            mime: MIME_OCTET,
        },
        None => UploadSession {
            method: reqwest::Method::POST,
            url: format!("{UPLOAD_BASE_URL}?{UPLOAD_QUERY}"),
            metadata: serde_json::json!({
                "name": meta.name,
                "parents": ["appDataFolder"],
                "mimeType": MIME_OCTET,
                "appProperties": properties,
            }),
            mime: MIME_OCTET,
        },
    };
    resumable_upload(token, path, session, progress).await.map(RemoteSave::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_resume_offsets() {
        assert_eq!(next_offset(Some("bytes=0-8388607")), 8_388_608);
        assert_eq!(next_offset(None), 0);
        assert_eq!(next_offset(Some("garbage")), 0);
    }

    #[test]
    fn chunk_size_is_a_multiple_of_256_kib() {
        assert_eq!(CHUNK_SIZE % (256 * 1024), 0);
    }

    #[test]
    fn classifies_statuses() {
        assert!(matches!(classify_status(StatusCode::SERVICE_UNAVAILABLE, ""), Failure::Transient(_)));
        assert!(matches!(classify_status(StatusCode::TOO_MANY_REQUESTS, ""), Failure::Transient(_)));
        assert!(matches!(classify_status(StatusCode::UNAUTHORIZED, ""), Failure::Fatal(e) if e.starts_with(error_codes::GDRIVE_AUTH)));
        assert!(matches!(classify_status(StatusCode::NOT_FOUND, ""), Failure::Fatal(e) if e.starts_with(error_codes::GDRIVE_NOT_FOUND)));
    }

    #[test]
    fn maps_drive_files() {
        let file: DriveFile = serde_json::from_str(
            r#"{"id":"1","name":"metadea-backup-x.7z","size":"2048","createdTime":"2026-09-23T10:00:00.000Z","appProperties":{"app_version":"0.6.0"}}"#,
        )
        .unwrap();
        let remote = RemoteBackup::from(file);
        assert_eq!(remote.size, 2048);
        assert_eq!(remote.app_version.as_deref(), Some("0.6.0"));
        assert_eq!(urlencode("a/b c"), "a%2Fb%20c");
    }

    #[test]
    fn maps_save_files() {
        let file: DriveFile = serde_json::from_str(
            r#"{"id":"2","name":"Saves/PS2/FFX/battery/Mcd001.ps2","size":"8650752","appProperties":{"metadea":"save","game":"0123456789abcdef","sha256":"ab","mtime":"1700000000000"}}"#,
        )
        .unwrap();
        let remote = RemoteSave::from(file);
        assert_eq!(remote.size, 8_650_752);
        assert_eq!(remote.game.as_deref(), Some("0123456789abcdef"));
        assert_eq!(remote.mtime_ms, Some(1_700_000_000_000));
    }
}
