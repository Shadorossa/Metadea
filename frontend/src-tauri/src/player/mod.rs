// Built-in video player: libmpv (library only, no mpv UI) drives decoding
// and rendering into a native child window of the main Tauri window,
// while every control the user sees lives in React (see
// frontend/src/components/player). Split by concern:
//
// - libmpv_ffi:     runtime loading of libmpv + the handful of C entry points used
// - mpv_api:        the trait the engine talks to (mocked in tests), event types
// - status:         PlayerStatus and the property-change accumulator behind it
// - event_loop:     the event thread: throttled status emission, track changes
// - engine:         session state, the client lifecycle, playback commands
// - screenshot_names: F12 capture naming, mirrored from folders/screenshots.rs
// - continue_frame: the frame + row Home's "continue watching" card reads
// - video_host:     the native HWND mpv draws into (Windows) / no-op elsewhere
// - window:         the overlay window + keeping surface/overlay aligned to the
//                   video rect the player modal reports inside the main window
// - commands:       the #[tauri::command] surface the frontend invokes
// - clip:           instant MP4/GIF clips on a headless encoding handle,
//                   copied to the clipboard as a file (CF_HDROP)
// - thumbnails:     seek-bar hover previews from a second, headless libmpv
//                   handle (sprite sheets cached under $APPCACHE/thumbnails)

mod clip;
mod commands;
mod continue_frame;
mod engine;
#[cfg(test)]
mod engine_tests;
mod error;
mod event_loop;
mod libmpv_ffi;
mod mpv_api;
mod screenshot_names;
mod status;
mod thumbnails;
mod video_host;
mod window;

pub use clip::*;
pub use commands::*;
pub use engine::PlayerEngineState;
pub use thumbnails::*;
