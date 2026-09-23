use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::{Arc, Mutex};

const CLIENT_ID:      &str = "1521817645043810344";
const DEFAULT_DETAILS: &str = "Exploring the library";
const DEFAULT_STATE:   &str = "";

// -- Estado global -------------------------------------------------------------

pub struct DiscordState {
    client: Arc<Mutex<Option<DiscordIpcClient>>>,
}

impl DiscordState {
    pub fn new() -> Self {
        Self { client: Arc::new(Mutex::new(None)) }
    }

    /// Hilo de fondo: conecta y establece presencia por defecto
    pub fn start_background(&self) {
        let arc = Arc::clone(&self.client);
        std::thread::spawn(move || loop {
            {
                if let Ok(mut guard) = arc.lock() {
                    if guard.is_none() {
                        if let Ok(mut c) = DiscordIpcClient::new(CLIENT_ID) {
                            if c.connect().is_ok() {
                                let assets = activity::Assets::new()
                                    .large_image("metadea")
                                    .large_text("Metadea");
                                
                                let button = activity::Button::new(
                                    "Try Metadea",
                                    "https://github.com/Shadorossa/Metadea"
                                );

                                let payload = activity::Activity::new()
                                    .details(DEFAULT_DETAILS)
                                    .state(DEFAULT_STATE)
                                    .assets(assets)
                                    .buttons(vec![button]);

                                if c.set_activity(payload).is_ok() {
                                    *guard = Some(c);
                                    return;
                                }
                            }
                        }
                    } else {
                        return;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(15));
        });
    }
}

// -- Helpers internos -----------------------------------------------------------

fn ensure_connected(guard: &mut Option<DiscordIpcClient>) -> Result<(), String> {
    if guard.is_some() { return Ok(()); }
    let mut c = DiscordIpcClient::new(CLIENT_ID)
        .map_err(|e| format!("new() failed: {e}"))?;
    c.connect().map_err(|e| format!("connect() failed: {e}"))?;
    *guard = Some(c);
    Ok(())
}

/// Everything a single Rich Presence update carries. Empty strings mean
/// "omit that field" (Discord rejects empty details/state/assets).
struct ActivityPayload<'a> {
    details: &'a str,
    state: &'a str,
    large_img: &'a str,
    large_txt: &'a str,
    small_img: &'a str,
    small_txt: &'a str,
    start_time: Option<u64>,
    end_time: Option<u64>,
    /// "playing" (default) | "watching" | "listening" - Discord's activity
    /// type, which decides the "Playing X" / "Watching X" header.
    activity_type: Option<activity::ActivityType>,
    /// Optional second button after "Try Metadea" (a share link into the
    /// app). Discord only accepts https URLs; anything else is dropped.
    button_label: &'a str,
    button_url: &'a str,
}

fn parse_activity_type(raw: Option<&str>) -> Option<activity::ActivityType> {
    match raw {
        Some("watching") => Some(activity::ActivityType::Watching),
        Some("listening") => Some(activity::ActivityType::Listening),
        Some("playing") => Some(activity::ActivityType::Playing),
        _ => None,
    }
}

/// The optional second button: only with a label and an https URL, the two
/// things Discord validates before showing it.
/// Discord's text fields take 2–128 characters: shorter is omitted (empty),
/// longer is cut with an ellipsis.
fn discord_text(raw: &str) -> String {
    let text = raw.trim();
    let count = text.chars().count();
    if count < 2 {
        return String::new();
    }
    if count <= 128 {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(127).collect();
    cut.push('…');
    cut
}

/// An image Discord can show: an uploaded asset key, or an https URL of at
/// most 256 characters (Discord's limit). Anything else is dropped.
fn discord_image(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 256 {
        return None;
    }
    if value.contains("://") {
        return value.starts_with("https://").then(|| value.to_string());
    }
    value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-').then(|| value.to_string())
}

fn share_button<'a>(label: &'a str, url: &'a str) -> Option<activity::Button<'a>> {
    let label = label.trim();
    // Discord: label 1–32 characters, url at most 512.
    if label.is_empty() || label.chars().count() > 32 || url.len() > 512 || !url.starts_with("https://") {
        return None;
    }
    Some(activity::Button::new(label, url))
}

fn apply_activity(client: &mut DiscordIpcClient, payload: &ActivityPayload<'_>) -> bool {
    let ActivityPayload {
        details, state, large_img, large_txt, small_img, small_txt, start_time, end_time, ref activity_type, button_label, button_url,
    } = *payload;
    let mut assets = activity::Assets::new();

    if !large_img.is_empty() {
        assets = assets.large_image(large_img).large_text(large_txt);
    }
    if !small_img.is_empty() {
        assets = assets.small_image(small_img).small_text(small_txt);
    }

    let download_button = activity::Button::new(
        "Try Metadea",
        "https://github.com/Shadorossa/Metadea"
    );

    let mut buttons = vec![download_button];
    if let Some(link) = share_button(button_label, button_url) {
        buttons.push(link);
    }

    let mut payload = activity::Activity::new()
        .assets(assets)
        .buttons(buttons);
    if let Some(kind) = activity_type {
        payload = payload.activity_type(kind.clone());
    }

    if let Some(start) = start_time {
        let mut ts = activity::Timestamps::new().start(start as i64);
        if let Some(end) = end_time {
            ts = ts.end(end as i64);
        }
        payload = payload.timestamps(ts);
    }

    if !details.is_empty() {
        payload = payload.details(details);
    }
    if !state.is_empty() {
        payload = payload.state(state);
    }

    client.set_activity(payload).is_ok()
}


fn send_activity(guard: &mut Option<DiscordIpcClient>, payload: &ActivityPayload<'_>) -> Result<(), String> {
    if guard.is_some() {
        if let Some(client) = guard.as_mut() {
            if apply_activity(client, payload) {
                return Ok(());
            }
        }
    }
    if let Some(mut old) = guard.take() {
        let _ = old.close();
    }
    ensure_connected(guard)?;
    if let Some(client) = guard.as_mut() {
        if apply_activity(client, payload) {
            return Ok(());
        }
    }
    if let Some(mut old) = guard.take() {
        let _ = old.close();
    }
    Err("set_activity failed".into())
}

// Arity is dictated by the frontend `invoke("update_presence", …)` contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn update_presence(
    discord: tauri::State<'_, DiscordState>,
    details: String,
    state: String,
    large_image: Option<String>,
    large_text: Option<String>,
    small_image: Option<String>,
    small_text: Option<String>,
    start_time: Option<u64>,
    end_time: Option<u64>,
    activity_type: Option<String>,
    button_label: Option<String>,
    button_url: Option<String>,
) -> Result<(), String> {
    let mut guard = discord.client.lock().map_err(|e| format!("mutex: {e}"))?;
    // Discord drops (or renders as an empty card, notably in the small
    // profile popout) an activity with a field outside its limits, so every
    // field is brought within them here.
    let details = discord_text(&details);
    let state = discord_text(&state);
    let large_img = large_image.as_deref().and_then(discord_image).unwrap_or_else(|| "metadea".to_string());
    let large_txt = large_text.as_deref().map(discord_text).filter(|t| !t.is_empty()).unwrap_or_else(|| "Metadea".to_string());
    let small_img = small_image.as_deref().and_then(discord_image).unwrap_or_default();
    let small_txt = if small_img.is_empty() { String::new() } else { small_text.as_deref().map(discord_text).unwrap_or_default() };
    let button_label = button_label.unwrap_or_default();
    let button_url = button_url.unwrap_or_default();
    let end_time = end_time.filter(|end| start_time.map_or(true, |start| *end > start));
    send_activity(
        &mut guard,
        &ActivityPayload {
            details: &details,
            state: &state,
            large_img: &large_img,
            large_txt: &large_txt,
            small_img: &small_img,
            small_txt: &small_txt,
            start_time,
            end_time,
            activity_type: parse_activity_type(activity_type.as_deref()),
            button_label: &button_label,
            button_url: &button_url,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::share_button;

    #[test]
    fn texts_are_kept_within_discords_limits() {
        assert_eq!(super::discord_text(" a "), "");
        assert_eq!(super::discord_text("Naruto"), "Naruto");
        let long = "x".repeat(200);
        let cut = super::discord_text(&long);
        assert_eq!(cut.chars().count(), 128);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn images_must_be_asset_keys_or_short_https_urls() {
        assert_eq!(super::discord_image("metadea").as_deref(), Some("metadea"));
        assert_eq!(super::discord_image("https://img/x.jpg").as_deref(), Some("https://img/x.jpg"));
        assert_eq!(super::discord_image("http://img/x.jpg"), None);
        assert_eq!(super::discord_image("asset://localhost/x.png"), None);
        assert_eq!(super::discord_image(&format!("https://{}", "a".repeat(300))), None);
        assert_eq!(super::discord_image(""), None);
    }

    #[test]
    fn share_button_needs_a_label_and_an_https_url() {
        assert!(share_button("Open in Metadea", "https://shadorossa.github.io/Metadea/open/?to=media/anime:1").is_some());
        assert!(share_button("", "https://example.com").is_none());
        assert!(share_button("Open", "http://example.com").is_none());
        assert!(share_button("Open", "metadea://media/anime:1").is_none());
    }
}

#[tauri::command]
pub fn reset_presence(discord: tauri::State<'_, DiscordState>) -> Result<(), String> {
    let mut guard = discord.client.lock().map_err(|e| format!("mutex: {e}"))?;
    send_activity(
        &mut guard,
        &ActivityPayload {
            details: DEFAULT_DETAILS,
            state: DEFAULT_STATE,
            large_img: "metadea",
            large_txt: "Metadea",
            small_img: "",
            small_txt: "",
            start_time: None,
            end_time: None,
            activity_type: None,
            button_label: "",
            button_url: "",
        },
    )
}

