// Installed-game discovery, one submodule per launcher. The public surface
// (LocalGame, steam_root and the two commands) is glob re-exported so existing
// `crate::platform_scanning::*` paths keep resolving — that includes the hidden
// `__cmd__*` macros `#[tauri::command]` emits next to each command, which
// lib.rs's `generate_handler![platform_scanning::…]` expands to.

mod commands;
mod common;
mod ea;
mod emulator_roms;
mod epic;
mod gog;
mod local_folders;
pub mod rom_header;
pub mod rom_library;
mod scan_cache;
mod steam_library;
mod xbox;

pub use commands::*;
pub use common::*;
pub use rom_library::*;
pub use steam_library::*;
