use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::{Arc, Mutex};

const CLIENT_ID:      &str = "1521817645043810344";
const DEFAULT_DETAILS: &str = "Explorando la biblioteca";
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
                                    "Descargar Metadea",
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

fn apply_activity(
    client: &mut DiscordIpcClient,
    details: &str,
    state: &str,
    large_img: &str,
    large_txt: &str,
    small_img: &str,
    small_txt: &str,
) -> bool {
    let mut assets = activity::Assets::new();
    
    if !large_img.is_empty() {
        assets = assets.large_image(large_img).large_text(large_txt);
    }
    if !small_img.is_empty() {
        assets = assets.small_image(small_img).small_text(small_txt);
    }

    let download_button = activity::Button::new(
        "Descargar Metadea",
        "https://github.com/Shadorossa/Metadea"
    );

    let mut payload = activity::Activity::new()
        .assets(assets)
        .buttons(vec![download_button]);

    if !details.is_empty() {
        payload = payload.details(details);
    }
    if !state.is_empty() {
        payload = payload.state(state);
    }

    client.set_activity(payload).is_ok()
}

// -- Comandos Tauri -------------------------------------------------------------

/// Actualiza la presencia con cover dinámico (large) y el logo de Metadea (small)
#[tauri::command]
pub fn update_presence(
    discord: tauri::State<'_, DiscordState>,
    details: String,
    state: String,
    _large_image_url: Option<String>,
    _large_image_text: Option<String>,
) -> Result<(), String> {
    let mut guard = discord.client.lock().map_err(|e| format!("mutex: {e}"))?;
    ensure_connected(&mut guard)?;
    
    let cover_url = "metadea";
    let cover_txt = "Metadea";
    let client = guard.as_mut().ok_or("no client")?;

    let ok = apply_activity(
        client, 
        &details, 
        &state, 
        cover_url, 
        cover_txt, 
        "", 
        ""
    );

    if !ok {
        *guard = None;
        return Err("set_activity failed".into());
    }
    Ok(())
}

/// Restablece la presencia por defecto "Explorando la biblioteca" con la imagen de Metadea
#[tauri::command]
pub fn reset_presence(discord: tauri::State<'_, DiscordState>) -> Result<(), String> {
    let mut guard = discord.client.lock().map_err(|e| format!("mutex: {e}"))?;
    ensure_connected(&mut guard)?;
    let client = guard.as_mut().ok_or("no client")?;

    let ok = apply_activity(
        client, 
        DEFAULT_DETAILS, 
        DEFAULT_STATE, 
        "metadea", 
        "Metadea", 
        "", 
        ""
    );

    if !ok {
        *guard = None;
        return Err("reset failed".into());
    }
    Ok(())
}
