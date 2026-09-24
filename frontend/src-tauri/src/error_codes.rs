//! Stable machine codes for the errors a `#[tauri::command]` returns to the
//! webview. Commands keep `Result<T, String>` for IPC compatibility, but the
//! String is one of the `E_*` codes below, optionally followed by
//! `": <technical detail>"` (see [`with_detail`]). The frontend maps the code
//! to a translated message (`frontend/src/lib/errors/format-error.ts`, keys
//! under `errors.*` in every locale) and appends the detail, so the user never
//! sees a raw code and Rust never carries user-facing prose in any language.
//!
//! Adding a code: declare it here, add it to `ALL`, add `errors.<CODE>` to
//! the 8 locales and to `frontend/src/lib/errors/error-codes.ts`. The tests
//! below and the vitest parity test keep the lists in sync.

pub const CAPTURE_DIR_CREATE: &str = "E_CAPTURE_DIR_CREATE";
pub const PICTURES_DIR_LOCATE: &str = "E_PICTURES_DIR_LOCATE";

pub const COMIC_OPEN_CBR: &str = "E_COMIC_OPEN_CBR";
pub const COMIC_READ_CBR: &str = "E_COMIC_READ_CBR";
pub const COMIC_OPEN_CBZ: &str = "E_COMIC_OPEN_CBZ";
pub const COMIC_READ_CBZ: &str = "E_COMIC_READ_CBZ";
pub const COMIC_EXTRACT_PAGE: &str = "E_COMIC_EXTRACT_PAGE";
pub const COMIC_CREATE_FILE: &str = "E_COMIC_CREATE_FILE";
pub const COMIC_FORMAT_UNSUPPORTED: &str = "E_COMIC_FORMAT_UNSUPPORTED";
pub const COMIC_READ_FILE: &str = "E_COMIC_READ_FILE";
pub const COMIC_NO_PAGES: &str = "E_COMIC_NO_PAGES";
pub const COMIC_DECODE_BASE64: &str = "E_COMIC_DECODE_BASE64";
pub const COMIC_OPEN_PAGE_IMAGE: &str = "E_COMIC_OPEN_PAGE_IMAGE";
pub const COMIC_SAVE_PNG: &str = "E_COMIC_SAVE_PNG";
pub const EPUB_INVALID: &str = "E_EPUB_INVALID";
pub const EPUB_CHAPTER_TOO_LARGE: &str = "E_EPUB_CHAPTER_TOO_LARGE";
pub const EPUB_NOT_OPEN: &str = "E_EPUB_NOT_OPEN";

pub const BACKUP_DEST_IS_DIR: &str = "E_BACKUP_DEST_IS_DIR";
pub const BACKUP_ZIP_UNSAFE_PATH: &str = "E_BACKUP_ZIP_UNSAFE_PATH";
pub const BACKUP_ZIP_OPEN: &str = "E_BACKUP_ZIP_OPEN";
pub const BACKUP_ZIP_INVALID: &str = "E_BACKUP_ZIP_INVALID";
pub const BACKUP_MANIFEST_INVALID: &str = "E_BACKUP_MANIFEST_INVALID";
pub const BACKUP_ZIP_RESERVED_ENTRY: &str = "E_BACKUP_ZIP_RESERVED_ENTRY";
pub const BACKUP_NOT_METADEA: &str = "E_BACKUP_NOT_METADEA";
pub const BACKUP_FORMAT_UNSUPPORTED: &str = "E_BACKUP_FORMAT_UNSUPPORTED";
pub const BACKUP_NO_DATABASE: &str = "E_BACKUP_NO_DATABASE";
pub const BACKUP_INSIDE_DATA_DIR: &str = "E_BACKUP_INSIDE_DATA_DIR";
pub const BACKUP_FILE_NOT_FOUND: &str = "E_BACKUP_FILE_NOT_FOUND";
pub const RESTORE_MARKER_INVALID: &str = "E_RESTORE_MARKER_INVALID";
pub const RESTORE_STAGE_MISSING: &str = "E_RESTORE_STAGE_MISSING";
pub const RESTORE_MOVE_CURRENT: &str = "E_RESTORE_MOVE_CURRENT";
pub const RESTORE_ACTIVATE: &str = "E_RESTORE_ACTIVATE";
// 7z backups (src/backup). HASH_MISMATCH is a file whose size or SHA-256
// differs from the manifest; SCHEMA_NEWER a backup from a newer Metadea.
pub const BACKUP_BUSY: &str = "E_BACKUP_BUSY";
pub const BACKUP_CANCELLED: &str = "E_BACKUP_CANCELLED";
pub const BACKUP_SNAPSHOT: &str = "E_BACKUP_SNAPSHOT";
pub const BACKUP_DB_INVALID: &str = "E_BACKUP_DB_INVALID";
pub const BACKUP_ARCHIVE_WRITE: &str = "E_BACKUP_ARCHIVE_WRITE";
pub const BACKUP_ARCHIVE_INVALID: &str = "E_BACKUP_ARCHIVE_INVALID";
pub const BACKUP_HASH_MISMATCH: &str = "E_BACKUP_HASH_MISMATCH";
pub const BACKUP_SCHEMA_NEWER: &str = "E_BACKUP_SCHEMA_NEWER";
pub const BACKUP_TOO_LARGE: &str = "E_BACKUP_TOO_LARGE";

// Google Drive backups (src/google_drive). AUTH covers a refused consent,
// a rejected code exchange/refresh and a 401; NOT_LINKED is no stored account.
pub const GDRIVE_NOT_CONFIGURED: &str = "E_GDRIVE_NOT_CONFIGURED";
pub const GDRIVE_NOT_LINKED: &str = "E_GDRIVE_NOT_LINKED";
pub const GDRIVE_AUTH: &str = "E_GDRIVE_AUTH";
pub const GDRIVE_STATE_MISMATCH: &str = "E_GDRIVE_STATE_MISMATCH";
pub const GDRIVE_LOGIN_TIMEOUT: &str = "E_GDRIVE_LOGIN_TIMEOUT";
pub const GDRIVE_LOGIN_CANCELLED: &str = "E_GDRIVE_LOGIN_CANCELLED";
pub const GDRIVE_NETWORK: &str = "E_GDRIVE_NETWORK";
pub const GDRIVE_API: &str = "E_GDRIVE_API";
pub const GDRIVE_NOT_FOUND: &str = "E_GDRIVE_NOT_FOUND";

pub const GITHUB_SESSION_EXPIRED: &str = "E_GITHUB_SESSION_EXPIRED";
pub const GITHUB_API: &str = "E_GITHUB_API";
pub const GITHUB_NETWORK: &str = "E_GITHUB_NETWORK";

pub const GOG_GALAXY_NOT_FOUND: &str = "E_GOG_GALAXY_NOT_FOUND";
pub const GOG_LAUNCH: &str = "E_GOG_LAUNCH";
// Only returned by the non-Windows stub of launch_gog_game.
#[cfg_attr(windows, allow(dead_code))]
pub const GOG_WINDOWS_ONLY: &str = "E_GOG_WINDOWS_ONLY";
pub const GAME_INSTALL_PATH_UNKNOWN: &str = "E_GAME_INSTALL_PATH_UNKNOWN";

// RetroAchievements (src/retro_achievements). RA_HASH_UNAVAILABLE is the
// build without the vendored rcheevos hasher; RA_HASH_FAILED is rc_hash
// refusing a file it does have (unreadable, not a ROM of that system).
pub const RA_HASH_UNAVAILABLE: &str = "E_RA_HASH_UNAVAILABLE";
pub const RA_HASH_FAILED: &str = "E_RA_HASH_FAILED";
pub const RA_NOT_CONFIGURED: &str = "E_RA_NOT_CONFIGURED";
pub const RA_UNAUTHORIZED: &str = "E_RA_UNAUTHORIZED";
pub const RA_API: &str = "E_RA_API";
pub const RA_NETWORK: &str = "E_RA_NETWORK";
pub const RA_CONSOLE_UNSUPPORTED: &str = "E_RA_CONSOLE_UNSUPPORTED";
pub const RA_LINK_INVALID: &str = "E_RA_LINK_INVALID";

// MyAnimeList (src/mal). MAL_AUTH covers a rejected code exchange, a
// refresh MAL no longer honours and a 401 from the API; STATE_MISMATCH is a
// redirect that does not belong to the login this app started.
pub const MAL_NOT_CONFIGURED: &str = "E_MAL_NOT_CONFIGURED";
pub const MAL_NOT_CONNECTED: &str = "E_MAL_NOT_CONNECTED";
pub const MAL_AUTH: &str = "E_MAL_AUTH";
pub const MAL_STATE_MISMATCH: &str = "E_MAL_STATE_MISMATCH";
pub const MAL_API: &str = "E_MAL_API";
pub const MAL_NETWORK: &str = "E_MAL_NETWORK";

// User UI themes / skins (src/ui_themes.rs).
pub const UI_THEME_INVALID_ID: &str = "E_UI_THEME_INVALID_ID";
pub const UI_THEME_NOT_FOUND: &str = "E_UI_THEME_NOT_FOUND";
pub const UI_THEME_MANIFEST_INVALID: &str = "E_UI_THEME_MANIFEST_INVALID";
pub const UI_THEME_CSS_TOO_LARGE: &str = "E_UI_THEME_CSS_TOO_LARGE";
pub const UI_THEME_IO: &str = "E_UI_THEME_IO";
pub const UI_THEME_OPEN_FOLDER: &str = "E_UI_THEME_OPEN_FOLDER";

// Anime OP/ED video cache (src/media_themes.rs). DOWNLOAD covers a failed
// request, a stalled body and a response that is not a WebM file;
// CANCELLED is cancel_theme_video_downloads stopping a background download.
pub const THEME_VIDEO_DOWNLOAD: &str = "E_THEME_VIDEO_DOWNLOAD";
pub const THEME_VIDEO_CANCELLED: &str = "E_THEME_VIDEO_CANCELLED";

// Company pages (src/company_catalog). KEYS_MISSING is IGDB/TMDB without the
// user's credentials and nothing in the local catalog to fall back on.
pub const COMPANY_ID_INVALID: &str = "E_COMPANY_ID_INVALID";
pub const COMPANY_NOT_FOUND: &str = "E_COMPANY_NOT_FOUND";
pub const COMPANY_KEYS_MISSING: &str = "E_COMPANY_KEYS_MISSING";
pub const COMPANY_API: &str = "E_COMPANY_API";

// Comic Vine story-arc import (src/comicvine.rs). KEY_MISSING is no Comic
// Vine API key in Settings; API is a non-2xx or unparseable response.
pub const COMICVINE_KEY_MISSING: &str = "E_COMICVINE_KEY_MISSING";
pub const COMICVINE_NETWORK: &str = "E_COMICVINE_NETWORK";
pub const COMICVINE_API: &str = "E_COMICVINE_API";

// Yearly Bingo (src/yearly_bingo.rs). LOCKED is a board write outside its
// edit window (Dec 20 of the previous year – Jan 10, local date); INVALID is
// an out-of-range year, too many cells, or a duplicate/blank work.
pub const BINGO_LOCKED: &str = "E_BINGO_LOCKED";
pub const BINGO_INVALID: &str = "E_BINGO_INVALID";

// Character reactions (src/character_reactions.rs): a reaction other than
// like / interest / dislike / none.
pub const CHARACTER_REACTION_INVALID: &str = "E_CHARACTER_REACTION_INVALID";

// Tier lists (src/tier_lists.rs): the list was deleted (e.g. in another
// window) while an editor still had it open.
pub const TIER_LIST_NOT_FOUND: &str = "E_TIER_LIST_NOT_FOUND";

// Emulator save manager (src/saves). ROOT_INVALID is a saves folder that is
// relative, a drive root, a file or inside the app data folder; PATH_UNSAFE
// a save id or Drive name that would leave its folder; IO a failed copy,
// move or manifest write.
pub const SAVES_ROOT_INVALID: &str = "E_SAVES_ROOT_INVALID";
pub const SAVES_PATH_UNSAFE: &str = "E_SAVES_PATH_UNSAFE";
pub const SAVES_NOT_FOUND: &str = "E_SAVES_NOT_FOUND";
pub const SAVES_IO: &str = "E_SAVES_IO";
pub const SAVES_LABEL_TOO_LONG: &str = "E_SAVES_LABEL_TOO_LONG";
pub const SAVES_OPEN_FOLDER: &str = "E_SAVES_OPEN_FOLDER";

// Anime filler lists (src/anime_filler): the local cache could not be read
// or written, or a link was rejected (bad slug, negative offset).
pub const FILLER_DB: &str = "E_FILLER_DB";
pub const FILLER_INVALID_LINK: &str = "E_FILLER_INVALID_LINK";

// Sakuga clips (src/sakuga): the local Sakugabooru cache could not be read
// or written.
pub const SAKUGA_DB: &str = "E_SAKUGA_DB";

// Player clips (src/player/clip): ENCODING_UNSUPPORTED is a libmpv built
// without encoding (`o`); NO_SOURCE a stream or nothing playing.
pub const CLIP_ENCODING_UNSUPPORTED: &str = "E_CLIP_ENCODING_UNSUPPORTED";
pub const CLIP_ENCODE_FAILED: &str = "E_CLIP_ENCODE_FAILED";
pub const CLIP_BUSY: &str = "E_CLIP_BUSY";
pub const CLIP_NO_SOURCE: &str = "E_CLIP_NO_SOURCE";
pub const CLIP_CANCELLED: &str = "E_CLIP_CANCELLED";
pub const CLIP_PATH_INVALID: &str = "E_CLIP_PATH_INVALID";

// Controller pause menu (src/game_pause): NOT_PAUSED an action on a menu
// that is already closed; SAVE_STATE RetroArch's network command could not
// be sent (or is not enabled); SETTINGS the settings file write.
pub const GAME_PAUSE_NOT_PAUSED: &str = "E_GAME_PAUSE_NOT_PAUSED";
pub const GAME_PAUSE_SAVE_STATE: &str = "E_GAME_PAUSE_SAVE_STATE";
pub const GAME_PAUSE_SETTINGS: &str = "E_GAME_PAUSE_SETTINGS";
pub const GAME_PAUSE_FAILED: &str = "E_GAME_PAUSE_FAILED";

// "Download metadata" in Local (src/igdb/batch.rs). KEYS_MISSING is no IGDB
// client id/secret in Settings › Environment; AUTH is Twitch refusing them;
// NETWORK is Twitch/IGDB unreachable; METADATA_DB_BUSY the local database
// staying locked by another operation for longer than the batch waits.
pub const IGDB_KEYS_MISSING: &str = "E_IGDB_KEYS_MISSING";
pub const IGDB_AUTH: &str = "E_IGDB_AUTH";
pub const IGDB_NETWORK: &str = "E_IGDB_NETWORK";
pub const METADATA_DB_BUSY: &str = "E_METADATA_DB_BUSY";

// Plugins (src/plugins, docs/PLUGINS.md). PACKAGE_INVALID is an unreadable
// zip, a missing manifest or an unsafe entry path; INSTALL_EXPIRED a consent
// prompt answered after its staged package was cleaned up; CONSENT_REQUIRED a
// package asking for permissions the user has not granted; HOST_NOT_ALLOWED a
// plugin request outside its granted hosts (or plain http to a public host).
pub const PLUGIN_MANIFEST_INVALID: &str = "E_PLUGIN_MANIFEST_INVALID";
pub const PLUGIN_API_UNSUPPORTED: &str = "E_PLUGIN_API_UNSUPPORTED";
pub const PLUGIN_PACKAGE_INVALID: &str = "E_PLUGIN_PACKAGE_INVALID";
pub const PLUGIN_PACKAGE_TOO_LARGE: &str = "E_PLUGIN_PACKAGE_TOO_LARGE";
pub const PLUGIN_IO: &str = "E_PLUGIN_IO";
pub const PLUGIN_NOT_FOUND: &str = "E_PLUGIN_NOT_FOUND";
pub const PLUGIN_DB: &str = "E_PLUGIN_DB";
pub const PLUGIN_INSTALL_EXPIRED: &str = "E_PLUGIN_INSTALL_EXPIRED";
pub const PLUGIN_URL_INVALID: &str = "E_PLUGIN_URL_INVALID";
pub const PLUGIN_DOWNLOAD: &str = "E_PLUGIN_DOWNLOAD";
pub const PLUGIN_DISABLED: &str = "E_PLUGIN_DISABLED";
pub const PLUGIN_CONSENT_REQUIRED: &str = "E_PLUGIN_CONSENT_REQUIRED";
pub const PLUGIN_OPEN_FOLDER: &str = "E_PLUGIN_OPEN_FOLDER";
pub const PLUGIN_SETTINGS_INVALID: &str = "E_PLUGIN_SETTINGS_INVALID";
pub const PLUGIN_STORAGE_LIMIT: &str = "E_PLUGIN_STORAGE_LIMIT";
pub const PLUGIN_HTTP_REQUEST_INVALID: &str = "E_PLUGIN_HTTP_REQUEST_INVALID";
pub const PLUGIN_HOST_NOT_ALLOWED: &str = "E_PLUGIN_HOST_NOT_ALLOWED";
pub const PLUGIN_HTTP_NETWORK: &str = "E_PLUGIN_HTTP_NETWORK";
pub const PLUGIN_HTTP_TIMEOUT: &str = "E_PLUGIN_HTTP_TIMEOUT";
pub const PLUGIN_HTTP_TOO_LARGE: &str = "E_PLUGIN_HTTP_TOO_LARGE";

/// Every code above, for the parity tests below (the TS side parses the
/// consts themselves — see lib/errors/error-codes.test.ts).
#[cfg(test)]
pub const ALL: &[&str] = &[
    CAPTURE_DIR_CREATE,
    PICTURES_DIR_LOCATE,
    COMIC_OPEN_CBR,
    COMIC_READ_CBR,
    COMIC_OPEN_CBZ,
    COMIC_READ_CBZ,
    COMIC_EXTRACT_PAGE,
    COMIC_CREATE_FILE,
    COMIC_FORMAT_UNSUPPORTED,
    COMIC_READ_FILE,
    COMIC_NO_PAGES,
    COMIC_DECODE_BASE64,
    COMIC_OPEN_PAGE_IMAGE,
    COMIC_SAVE_PNG,
    EPUB_INVALID,
    EPUB_CHAPTER_TOO_LARGE,
    EPUB_NOT_OPEN,
    BACKUP_DEST_IS_DIR,
    BACKUP_ZIP_UNSAFE_PATH,
    BACKUP_ZIP_OPEN,
    BACKUP_ZIP_INVALID,
    BACKUP_MANIFEST_INVALID,
    BACKUP_ZIP_RESERVED_ENTRY,
    BACKUP_NOT_METADEA,
    BACKUP_FORMAT_UNSUPPORTED,
    BACKUP_NO_DATABASE,
    BACKUP_INSIDE_DATA_DIR,
    BACKUP_FILE_NOT_FOUND,
    RESTORE_MARKER_INVALID,
    RESTORE_STAGE_MISSING,
    RESTORE_MOVE_CURRENT,
    RESTORE_ACTIVATE,
    BACKUP_BUSY,
    BACKUP_CANCELLED,
    BACKUP_SNAPSHOT,
    BACKUP_DB_INVALID,
    BACKUP_ARCHIVE_WRITE,
    BACKUP_ARCHIVE_INVALID,
    BACKUP_HASH_MISMATCH,
    BACKUP_SCHEMA_NEWER,
    BACKUP_TOO_LARGE,
    GDRIVE_NOT_CONFIGURED,
    GDRIVE_NOT_LINKED,
    GDRIVE_AUTH,
    GDRIVE_STATE_MISMATCH,
    GDRIVE_LOGIN_TIMEOUT,
    GDRIVE_LOGIN_CANCELLED,
    GDRIVE_NETWORK,
    GDRIVE_API,
    GDRIVE_NOT_FOUND,
    GITHUB_SESSION_EXPIRED,
    GITHUB_API,
    GITHUB_NETWORK,
    GOG_GALAXY_NOT_FOUND,
    GOG_LAUNCH,
    GOG_WINDOWS_ONLY,
    GAME_INSTALL_PATH_UNKNOWN,
    RA_HASH_UNAVAILABLE,
    RA_HASH_FAILED,
    RA_NOT_CONFIGURED,
    RA_UNAUTHORIZED,
    RA_API,
    RA_NETWORK,
    RA_CONSOLE_UNSUPPORTED,
    RA_LINK_INVALID,
    MAL_NOT_CONFIGURED,
    MAL_NOT_CONNECTED,
    MAL_AUTH,
    MAL_STATE_MISMATCH,
    MAL_API,
    MAL_NETWORK,
    UI_THEME_INVALID_ID,
    UI_THEME_NOT_FOUND,
    UI_THEME_MANIFEST_INVALID,
    UI_THEME_CSS_TOO_LARGE,
    UI_THEME_IO,
    UI_THEME_OPEN_FOLDER,
    THEME_VIDEO_DOWNLOAD,
    THEME_VIDEO_CANCELLED,
    COMPANY_ID_INVALID,
    COMPANY_NOT_FOUND,
    COMPANY_KEYS_MISSING,
    COMPANY_API,
    COMICVINE_KEY_MISSING,
    COMICVINE_NETWORK,
    COMICVINE_API,
    BINGO_LOCKED,
    BINGO_INVALID,
    CHARACTER_REACTION_INVALID,
    TIER_LIST_NOT_FOUND,
    SAVES_ROOT_INVALID,
    SAVES_PATH_UNSAFE,
    SAVES_NOT_FOUND,
    SAVES_IO,
    SAVES_LABEL_TOO_LONG,
    SAVES_OPEN_FOLDER,
    FILLER_DB,
    FILLER_INVALID_LINK,
    SAKUGA_DB,
    CLIP_ENCODING_UNSUPPORTED,
    CLIP_ENCODE_FAILED,
    CLIP_BUSY,
    CLIP_NO_SOURCE,
    CLIP_CANCELLED,
    CLIP_PATH_INVALID,
    GAME_PAUSE_NOT_PAUSED,
    GAME_PAUSE_SAVE_STATE,
    GAME_PAUSE_SETTINGS,
    GAME_PAUSE_FAILED,
    IGDB_KEYS_MISSING,
    IGDB_AUTH,
    IGDB_NETWORK,
    METADATA_DB_BUSY,
    PLUGIN_MANIFEST_INVALID,
    PLUGIN_API_UNSUPPORTED,
    PLUGIN_PACKAGE_INVALID,
    PLUGIN_PACKAGE_TOO_LARGE,
    PLUGIN_IO,
    PLUGIN_NOT_FOUND,
    PLUGIN_DB,
    PLUGIN_INSTALL_EXPIRED,
    PLUGIN_URL_INVALID,
    PLUGIN_DOWNLOAD,
    PLUGIN_DISABLED,
    PLUGIN_CONSENT_REQUIRED,
    PLUGIN_OPEN_FOLDER,
    PLUGIN_SETTINGS_INVALID,
    PLUGIN_STORAGE_LIMIT,
    PLUGIN_HTTP_REQUEST_INVALID,
    PLUGIN_HOST_NOT_ALLOWED,
    PLUGIN_HTTP_NETWORK,
    PLUGIN_HTTP_TIMEOUT,
    PLUGIN_HTTP_TOO_LARGE,
];

/// `"E_CODE: detail"` — the detail is technical (an io/zip/reqwest error),
/// shown after the translated message, never instead of it.
pub fn with_detail(code: &'static str, detail: impl std::fmt::Display) -> String {
    format!("{code}: {detail}")
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::path::Path;

    fn rust_sources(dir: &Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).expect("read src dir").flatten() {
            let path = entry.path();
            if path.is_dir() {
                rust_sources(&path, out);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                out.push(std::fs::read_to_string(&path).expect("read rust source"));
            }
        }
    }

    // Every "E_..." string literal in a source file (the tokens between an
    // odd and an even double quote).
    fn quoted_codes(source: &str) -> BTreeSet<String> {
        source
            .split('"')
            .skip(1)
            .step_by(2)
            .filter(|literal| literal.len() > 2 && literal.starts_with("E_") && literal[2..].chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'))
            .map(str::to_string)
            .collect()
    }

    // A code used anywhere in the crate but missing here would reach the
    // webview with no translation, so the user would see the bare code.
    #[test]
    fn every_code_used_in_the_crate_is_listed() {
        let listed: BTreeSet<String> = super::ALL.iter().map(|code| code.to_string()).collect();
        let mut sources = Vec::new();
        rust_sources(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut sources);
        let used: BTreeSet<String> = sources.iter().flat_map(|source| quoted_codes(source)).collect();
        let unlisted: Vec<&String> = used.difference(&listed).collect();
        assert!(unlisted.is_empty(), "E_* codes used in the crate but missing from error_codes::ALL: {unlisted:?}");
    }

    #[test]
    fn all_is_unique_and_matches_the_declared_consts() {
        let declared = quoted_codes(include_str!("error_codes.rs"));
        let listed: BTreeSet<String> = super::ALL.iter().map(|code| code.to_string()).collect();
        assert_eq!(super::ALL.len(), listed.len(), "duplicate entry in error_codes::ALL");
        assert_eq!(declared, listed, "a declared const is missing from ALL (or vice versa)");
    }

    #[test]
    fn with_detail_keeps_the_code_as_prefix() {
        assert_eq!(super::with_detail(super::GOG_LAUNCH, "boom"), "E_GOG_LAUNCH: boom");
    }
}
