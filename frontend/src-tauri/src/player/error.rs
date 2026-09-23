// Errors crossing the IPC boundary carry a stable `code` the frontend maps
// to a translated message (DEVELOPMENT_RULES 3.1: Rust never returns
// user-facing text) plus a free-form `detail` for logs.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PlayerError {
    pub code: &'static str,
    pub detail: String,
}

impl PlayerError {
    pub fn engine_unavailable(detail: impl Into<String>) -> Self {
        Self { code: "engine_unavailable", detail: detail.into() }
    }

    pub fn mpv(detail: impl Into<String>) -> Self {
        Self { code: "mpv_error", detail: detail.into() }
    }

    pub fn not_open() -> Self {
        Self { code: "player_not_open", detail: String::new() }
    }

    pub fn window(detail: impl Into<String>) -> Self {
        Self { code: "window_error", detail: detail.into() }
    }

    pub fn io(detail: impl Into<String>) -> Self {
        Self { code: "io_error", detail: detail.into() }
    }

    /// A crate-wide `E_*` code (error_codes.rs), for failures the frontend
    /// shows through formatAppError (clip export).
    pub fn coded(code: &'static str, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }

    /// The loaded libmpv lacks a feature (e.g. encoding for clips).
    pub fn unsupported(detail: impl Into<String>) -> Self {
        Self { code: "unsupported", detail: detail.into() }
    }

    pub fn invalid_argument(detail: impl Into<String>) -> Self {
        Self { code: "invalid_argument", detail: detail.into() }
    }
}

impl std::fmt::Display for PlayerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.detail.is_empty() {
            write!(f, "{}", self.code)
        } else {
            write!(f, "{}: {}", self.code, self.detail)
        }
    }
}

impl std::error::Error for PlayerError {}

impl From<tauri::Error> for PlayerError {
    fn from(error: tauri::Error) -> Self {
        PlayerError::window(error.to_string())
    }
}

impl From<std::io::Error> for PlayerError {
    fn from(error: std::io::Error) -> Self {
        PlayerError::io(error.to_string())
    }
}
