use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::{Arc, Mutex};

const CLIENT_ID: &str = "1521817645043810344";
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

    /// Lanza un hilo de fondo que intenta conectar con Discord cada 15 s hasta lograrlo
    /// y establece la presencia por defecto "Usando Metadea".
    pub fn start_background(&self) {
        let client_arc = Arc::clone(&self.client);
        std::thread::spawn(move || {
            loop {
                {
                    let mut guard = match client_arc.lock() {
                        Ok(g) => g,
                        Err(_) => { std::thread::sleep(std::time::Duration::from_secs(15)); continue; }
                    };
                    if guard.is_none() {
                        // Intentar conectar
                        if let Ok(mut c) = DiscordIpcClient::new(CLIENT_ID) {
                            if c.connect().is_ok() {
                                eprintln!("[Discord] Conectado al IPC de Discord.");
                                let payload = activity::Activity::new()
                                    .details(DEFAULT_DETAILS)
                                    .state(DEFAULT_STATE);
                                if c.set_activity(payload).is_ok() {
                                    eprintln!("[Discord] Presencia por defecto establecida.");
                                    *guard = Some(c);
                                } else {
                                    eprintln!("[Discord] set_activity (default) falló.");
                                }
                            }
                        }
                    } else {
                        break; // Ya conectado — salir del bucle
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(15));
            }
        });
    }
}

// ── Helpers internos ───────────────────────────────────────────────────────────

fn ensure_connected(guard: &mut Option<DiscordIpcClient>) -> Result<(), String> {
    if guard.is_some() { return Ok(()); }
    eprintln!("[Discord] Intentando conectar (lazy)...");
    let mut c = DiscordIpcClient::new(CLIENT_ID)
        .map_err(|e| format!("new() failed: {e}"))?;
    c.connect().map_err(|e| format!("connect() failed: {e}"))?;
    eprintln!("[Discord] Conectado.");
    *guard = Some(c);
    Ok(())
}

fn set_activity_inner(
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

/// Actualiza la presencia con el título/estado de la obra que se está viendo.
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
    let client = guard.as_mut().ok_or("no client")?;
    let img_url  = large_image_url.as_deref().unwrap_or("");
    let img_text = large_image_text.as_deref().unwrap_or("Metadea");
    let ok = set_activity_inner(client, &details, &state, img_url, img_text);
    if !ok { *guard = None; return Err("set_activity failed".into()); }
    eprintln!("[Discord] Presencia actualizada OK.");
    Ok(())
}

/// Restablece la presencia por defecto "Navegando por la biblioteca".
/// Llamar al salir de la media page.
#[tauri::command]
pub fn reset_presence(discord: tauri::State<'_, DiscordState>) -> Result<(), String> {
    eprintln!("[Discord] reset_presence: volviendo a presencia por defecto.");
    let mut guard = discord.client.lock().map_err(|e| format!("mutex: {e}"))?;
    ensure_connected(&mut guard)?;
    let client = guard.as_mut().ok_or("no client")?;
    let ok = set_activity_inner(client, DEFAULT_DETAILS, DEFAULT_STATE, "", "Metadea");
    if !ok { *guard = None; return Err("reset failed".into()); }
    Ok(())
}
