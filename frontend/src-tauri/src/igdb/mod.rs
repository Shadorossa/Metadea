// IGDB integration, split by concern. Every submodule is glob re-exported so
// existing `crate::igdb::*` paths keep resolving — that includes the hidden
// `__cmd__*` macros `#[tauri::command]` emits next to each command, which
// lib.rs's `generate_handler![igdb::…]` expands to.

mod auth;
mod cache;
mod client;
mod detail;
mod images;
mod mapping;
mod search;

pub use cache::*;
pub(crate) use client::*;
pub use detail::*;
pub use images::*;
pub(crate) use mapping::*;
pub use search::*;

// -- Env config -----------------------------------------------------------
// Moved to igdb_env.rs; read_env_config re-exported so comicvine.rs's
// `crate::igdb::read_env_config(...)` call keeps working (lib.rs's
// generate_handler! needs the real defining module for both commands, so
// that one references igdb_env:: directly instead).
pub use crate::igdb_env::read_env_config;
