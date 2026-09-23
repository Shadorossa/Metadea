// `metadea://` deep links: a URL that opens Metadea on a specific page
// (Discord Rich Presence "Open in Metadea" button, links shared between
// users). The scheme is registered through tauri-plugin-deep-link; the
// single-instance plugin (with its `deep-link` feature) forwards a second
// launch's argv to the running process, so on Windows/Linux the URL always
// lands in the already-open window.
//
// Nothing is executed from a URL: it is parsed into a `DeepLinkTarget`,
// validated strictly (see `parse_deep_link`) and handed to the frontend as a
// `deep-link://navigate` event, which just runs the app's client router.
// A URL that arrives before the webview has loaded (app launched by the
// link) is parked in `PendingDeepLink` and collected by the frontend via the
// `get_pending_deep_link` command once its listener is up.
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

pub const SCHEME: &str = "metadea";
pub const NAVIGATE_EVENT: &str = "deep-link://navigate";
const MAIN_WINDOW: &str = "main";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DeepLinkTarget {
    /// `metadea://media/<external_id>` — a catalog work, e.g. `anime:21610`.
    Media { external_id: String },
    /// `metadea://character/<id>` — a character page id, e.g. `a:12345`.
    Character { id: String },
    /// `metadea://profile/<user>` — another user's public profile.
    Profile { user: String },
    /// `metadea://home`
    Home,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLinkError {
    WrongScheme,
    UnknownKind(String),
    MissingId,
    UnexpectedId,
    InvalidId(String),
}

impl std::fmt::Display for DeepLinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WrongScheme => write!(f, "not a {SCHEME}:// link"),
            Self::UnknownKind(kind) => write!(f, "unknown deep link kind '{kind}'"),
            Self::MissingId => write!(f, "deep link is missing its id"),
            Self::UnexpectedId => write!(f, "deep link kind takes no id"),
            Self::InvalidId(id) => write!(f, "deep link id '{id}' is not valid"),
        }
    }
}

// `^[a-z]+:[A-Za-z0-9_-]+$` — provider prefix, a colon, then a plain id.
// Mirrored in site/open/index.html and src/lib/deep-link/deep-link-routes.ts;
// keep the three in sync.
fn is_prefixed_id(value: &str) -> bool {
    let Some((prefix, id)) = value.split_once(':') else {
        return false;
    };
    !prefix.is_empty()
        && prefix.bytes().all(|b| b.is_ascii_lowercase())
        && is_plain_id(id)
}

// `^[A-Za-z0-9_-]+$`
fn is_plain_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Parses `metadea://<kind>[/<id>][?query][#fragment]` into a typed target.
/// The scheme is matched case-insensitively (URL schemes are), everything
/// after it must match exactly: one kind, at most one id segment (a single
/// trailing slash is tolerated), ids restricted to the character classes
/// above so `..`, `%`, spaces or extra path segments never get through.
/// Query and fragment are discarded.
pub fn parse_deep_link(raw: &str) -> Result<DeepLinkTarget, DeepLinkError> {
    let raw = raw.trim();
    let prefix_len = SCHEME.len() + "://".len();
    let scheme_matches = raw.len() >= prefix_len
        && raw[..SCHEME.len()].eq_ignore_ascii_case(SCHEME)
        && &raw[SCHEME.len()..prefix_len] == "://";
    if !scheme_matches {
        return Err(DeepLinkError::WrongScheme);
    }
    let rest = &raw[prefix_len..];
    let rest = rest.split(['?', '#']).next().unwrap_or("");
    let rest = rest.strip_suffix('/').unwrap_or(rest);

    let (kind, id) = match rest.split_once('/') {
        Some((kind, id)) => (kind, Some(id)),
        None => (rest, None),
    };

    match kind {
        "home" => match id {
            None => Ok(DeepLinkTarget::Home),
            Some(_) => Err(DeepLinkError::UnexpectedId),
        },
        "media" => {
            let id = id.ok_or(DeepLinkError::MissingId)?;
            if is_prefixed_id(id) {
                Ok(DeepLinkTarget::Media { external_id: id.to_string() })
            } else {
                Err(DeepLinkError::InvalidId(id.to_string()))
            }
        }
        "character" => {
            let id = id.ok_or(DeepLinkError::MissingId)?;
            if is_prefixed_id(id) {
                Ok(DeepLinkTarget::Character { id: id.to_string() })
            } else {
                Err(DeepLinkError::InvalidId(id.to_string()))
            }
        }
        "profile" => {
            let id = id.ok_or(DeepLinkError::MissingId)?;
            if is_plain_id(id) {
                Ok(DeepLinkTarget::Profile { user: id.to_string() })
            } else {
                Err(DeepLinkError::InvalidId(id.to_string()))
            }
        }
        other => Err(DeepLinkError::UnknownKind(other.to_string())),
    }
}

/// A link that arrived before the frontend registered its listener.
#[derive(Default)]
pub struct PendingDeepLink(Mutex<Option<DeepLinkTarget>>);

/// Collected once by the frontend's listener on startup; empties the slot.
#[tauri::command]
pub fn get_pending_deep_link(state: tauri::State<'_, PendingDeepLink>) -> Option<DeepLinkTarget> {
    state.0.lock().ok().and_then(|mut slot| slot.take())
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn dispatch(app: &AppHandle, raw: &str) {
    let target = match parse_deep_link(raw) {
        Ok(target) => target,
        Err(error) => {
            log::warn!("Ignoring deep link {raw:?}: {error}");
            return;
        }
    };
    log::info!("Deep link: {target:?}");
    // Park it for the frontend as well as emitting: if the webview is not
    // listening yet (cold start through the link) the event is lost, and the
    // listener drains the slot as soon as it registers. A listener that is
    // already up handles the event and finds the slot empty afterwards
    // only if it drains it before this write — it drains once at startup,
    // so a runtime link is never applied twice.
    if let Ok(mut slot) = app.state::<PendingDeepLink>().0.lock() {
        *slot = Some(target.clone());
    }
    let _ = app.emit_to(MAIN_WINDOW, NAVIGATE_EVENT, &target);
    focus_main_window(app);
}

/// Wires the plugin: in dev builds registers the scheme in the OS (the MSI
/// does it for installed builds), subscribes to runtime links and replays
/// the one the process may have been launched with.
pub fn install(app: &AppHandle) {
    app.manage(PendingDeepLink::default());

    #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
    if let Err(error) = app.deep_link().register_all() {
        log::warn!("Could not register the {SCHEME}:// scheme for this dev build: {error}");
    }

    let handle = app.clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            dispatch(&handle, url.as_str());
        }
    });

    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                dispatch(app, url.as_str());
            }
        }
        Ok(None) => {}
        Err(error) => log::warn!("Could not read the startup deep link: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn media(id: &str) -> DeepLinkTarget {
        DeepLinkTarget::Media { external_id: id.to_string() }
    }

    #[test]
    fn parses_every_kind() {
        assert_eq!(parse_deep_link("metadea://home"), Ok(DeepLinkTarget::Home));
        assert_eq!(parse_deep_link("metadea://home/"), Ok(DeepLinkTarget::Home));
        assert_eq!(parse_deep_link("metadea://media/anime:21610"), Ok(media("anime:21610")));
        assert_eq!(parse_deep_link("metadea://media/book:OL262758W/"), Ok(media("book:OL262758W")));
        assert_eq!(
            parse_deep_link("metadea://character/a:12345"),
            Ok(DeepLinkTarget::Character { id: "a:12345".into() })
        );
        assert_eq!(
            parse_deep_link("metadea://character/ms:5256c8a2"),
            Ok(DeepLinkTarget::Character { id: "ms:5256c8a2".into() })
        );
        assert_eq!(
            parse_deep_link("metadea://profile/Shadorossa-01_x"),
            Ok(DeepLinkTarget::Profile { user: "Shadorossa-01_x".into() })
        );
    }

    #[test]
    fn scheme_is_case_insensitive_and_query_is_ignored() {
        assert_eq!(parse_deep_link("METADEA://home"), Ok(DeepLinkTarget::Home));
        assert_eq!(parse_deep_link("Metadea://media/anime:1?src=discord"), Ok(media("anime:1")));
        assert_eq!(parse_deep_link("metadea://media/anime:1#frag"), Ok(media("anime:1")));
        assert_eq!(parse_deep_link("  metadea://home  "), Ok(DeepLinkTarget::Home));
    }

    #[test]
    fn rejects_other_schemes_and_shapes() {
        assert_eq!(parse_deep_link("https://example.com"), Err(DeepLinkError::WrongScheme));
        assert_eq!(parse_deep_link("metadea:media/anime:1"), Err(DeepLinkError::WrongScheme));
        assert_eq!(parse_deep_link("metadea:/media/anime:1"), Err(DeepLinkError::WrongScheme));
        assert_eq!(parse_deep_link(""), Err(DeepLinkError::WrongScheme));
        assert_eq!(parse_deep_link("metadea://"), Err(DeepLinkError::UnknownKind(String::new())));
        assert_eq!(parse_deep_link("metadea://settings"), Err(DeepLinkError::UnknownKind("settings".into())));
        assert_eq!(parse_deep_link("metadea://MEDIA/anime:1"), Err(DeepLinkError::UnknownKind("MEDIA".into())));
        assert_eq!(parse_deep_link("metadea://media"), Err(DeepLinkError::MissingId));
        assert_eq!(parse_deep_link("metadea://media/"), Err(DeepLinkError::MissingId));
        assert_eq!(parse_deep_link("metadea://home/extra"), Err(DeepLinkError::UnexpectedId));
    }

    #[test]
    fn rejects_malformed_and_injected_ids() {
        for raw in [
            "metadea://media/../x",
            "metadea://media/anime:1/../../etc",
            "metadea://media/anime:1/extra",
            "metadea://media/anime",
            "metadea://media/:1",
            "metadea://media/Anime:1",
            "metadea://media/anime:1 2",
            "metadea://media/anime:%2E%2E",
            "metadea://media/anime:1;rm",
            "metadea://media/anime:<script>",
            "metadea://media/anime:é",
            "metadea://character/12345",
            "metadea://character/a:",
            "metadea://profile/",
            "metadea://profile/user name",
            "metadea://profile/user:name",
            "metadea://profile/../x",
        ] {
            assert!(
                matches!(parse_deep_link(raw), Err(DeepLinkError::InvalidId(_) | DeepLinkError::MissingId)),
                "{raw} should be rejected, got {:?}",
                parse_deep_link(raw)
            );
        }
    }

    #[test]
    fn serializes_with_a_kind_tag_for_the_frontend() {
        let json = serde_json::to_value(media("anime:21610")).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "media", "external_id": "anime:21610" }));
        assert_eq!(serde_json::to_value(DeepLinkTarget::Home).unwrap(), serde_json::json!({ "kind": "home" }));
    }
}
