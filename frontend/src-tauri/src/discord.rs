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
}

fn parse_activity_type(raw: Option<&str>) -> Option<activity::ActivityType> {
    match raw {
        Some("watching") => Some(activity::ActivityType::Watching),
        Some("listening") => Some(activity::ActivityType::Listening),
        Some("playing") => Some(activity::ActivityType::Playing),
        _ => None,
    }
}

fn apply_activity(client: &mut DiscordIpcClient, payload: &ActivityPayload<'_>) -> bool {
    let ActivityPayload { details, state, large_img, large_txt, small_img, small_txt, start_time, end_time, ref activity_type } = *payload;
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

    let mut payload = activity::Activity::new()
        .assets(assets)
        .buttons(vec![download_button]);
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
) -> Result<(), String> {
    let mut guard = discord.client.lock().map_err(|e| format!("mutex: {e}"))?;
    let large_img = large_image.unwrap_or_else(|| "metadea".to_string());
    let large_txt = large_text.unwrap_or_else(|| "Metadea".to_string());
    let small_img = small_image.unwrap_or_default();
    let small_txt = small_text.unwrap_or_default();
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
        },
    )
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
        },
    )
}

