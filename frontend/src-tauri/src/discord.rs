use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::{Arc, Mutex};

const CLIENT_ID:      &str = "1521817645043810344";
const DEFAULT_DETAILS: &str = "Metadea";
const DEFAULT_STATE:   &str = "Navegando por la biblioteca";

// ── Estado global ──────────────────────────────────────────────────────────────

pub struct DiscordState {
    client: Arc<Mutex<Option<DiscordIpcClient>>>,
}

impl DiscordState {
    pub fn new() -> Self {
        Self { client: Arc::new(Mutex::new(None)) }
    }

    /// Hilo de fondo: intenta conectar con Discord cada 15 s y,
    /// una vez conectado, establece la presencia por defecto.
    pub fn start_background(&self) {
        let arc = Arc::clone(&self.client);
        std::thread::spawn(move || loop {
            {
                if let Ok(mut guard) = arc.lock() {
                    if guard.is_none() {
                        if let Ok(mut c) = DiscordIpcClient::new(CLIENT_ID) {
                            if c.connect().is_ok() {
                                let payload = activity::Activity::new()
                                    .details(DEFAULT_DETAILS)
                                    .state(DEFAULT_STATE);
                                if c.set_activity(payload).is_ok() {
                                    eprintln!("[Discord] Conectado y presencia por defecto establecida.");
                                    *guard = Some(c);
                                    return; // Salir del hilo: ya no necesitamos reintentar
                                }
                            }
                        }
                    } else {
                        return; // Ya conectado por otro camino
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(15));
        });
    }
}

// ── Helpers internos ───────────────────────────────────────────────────────────

fn ensure_connected(guard: &mut Option<DiscordIpcClient>) -> Result<(), String> {
    if guard.is_some() { return Ok(()); }
    eprintln!("[Discord] Conectando (lazy)...");
    let mut c = DiscordIpcClient::new(CLIENT_ID)
        .map_err(|e| format!("new() failed: {e}"))?;
    c.connect().map_err(|e| format!("connect() failed: {e}"))?;
    eprintln!("[Discord] Conectado.");
    *guard = Some(c);
    Ok(())
}

fn apply_activity(
    client: &mut DiscordIpcClient,
    details: &str,
    state: &str,
    img_url: &str,
    img_text: &str,
) -> bool {
    let mut assets = activity::Assets::new().large_text(img_text);
    if !img_url.is_empty() {
        assets = assets.large_image(img_url);
    }
    let payload = activity::Activity::new()
        .details(details)
        .state(state)
        .assets(assets);
    client.set_activity(payload).is_ok()
}

// ── Comandos Tauri ─────────────────────────────────────────────────────────────

/// Actualiza la presencia con el título y el estado de la obra actual.
#[tauri::command]
pub fn update_presence(
    discord: tauri::State<'_, DiscordState>,
    details: String,
    state: String,
    large_image_url: Option<String>,
    large_image_text: Option<String>,
) -> Result<(), String> {
    eprintln!("[Discord] update_presence: '{details}' / '{state}'");
    let mut guard = discord.client.lock().map_err(|e| format!("mutex: {e}"))?;
    ensure_connected(&mut guard)?;
    let img_url  = large_image_url.as_deref().unwrap_or("");
    let img_text = large_image_text.as_deref().unwrap_or("Metadea");
    let client = guard.as_mut().ok_or("no client")?;
    if !apply_activity(client, &details, &state, img_url, img_text) {
        *guard = None;
        return Err("set_activity failed".into());
    }
    eprintln!("[Discord] Presencia actualizada OK.");
    Ok(())
}

/// Restablece la presencia por defecto "Navegando por la biblioteca".
#[tauri::command]
pub fn reset_presence(discord: tauri::State<'_, DiscordState>) -> Result<(), String> {
    eprintln!("[Discord] reset_presence: volviendo a presencia por defecto.");
    let mut guard = discord.client.lock().map_err(|e| format!("mutex: {e}"))?;
    ensure_connected(&mut guard)?;
    let client = guard.as_mut().ok_or("no client")?;
    if !apply_activity(client, DEFAULT_DETAILS, DEFAULT_STATE, "", "Metadea") {
        *guard = None;
        return Err("reset failed".into());
    }
    Ok(())
}
