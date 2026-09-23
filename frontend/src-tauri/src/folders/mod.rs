// Local-library plumbing, split by concern. Every submodule is glob
// re-exported so existing `crate::folders::*` paths keep resolving — that
// includes the hidden `__cmd__*` macros `#[tauri::command]` emits next to each
// command, which lib.rs's `generate_handler![folders::…]` expands to.

mod dialogs;
mod disc_launch;
mod emulator_captures;
mod emulator_launch;
mod process_tracking;
mod routes;
mod screenshots;
mod toast_window;

pub use dialogs::*;
pub use emulator_captures::*;
pub use emulator_launch::*;
pub use process_tracking::*;
pub use routes::*;
pub use screenshots::*;
pub use toast_window::*;
