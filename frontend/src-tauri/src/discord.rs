use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;

const CLIENT_ID: &str = "1521817645043810344";

// -- Estado global -------------------------------------------------------------

pub struct DiscordState {
    client: Mutex<Option<DiscordIpcClient>>,
}

impl DiscordState {
    pub fn new() -> Self {
        Self { client: Mutex::new(None) }
    }

    /// Intenta conectar con Discord. Si Discord no esta abierto, no hace nada.
    fn try_connect(guard: &mut Option<DiscordIpcClient>) {
        if guard.is_some() {
            return;
        }
        match DiscordIpcClient::new(CLIENT_ID) {
            Ok(mut c) => {
                if c.connect().is_ok() {
                    *guard = Some(c);
                }
            }
            Err(_) => {}
        }
    }
}

// -- Comandos Tauri ------------------------------------------------------------

/// Actualiza la presencia de Discord con el titulo y estado de la obra actual.
/// Si Discord no esta abierto, simplemente no hace nada.
#[tauri::command]
pub fn update_presence(
    discord: tauri::State<'_, DiscordState>,
    details: String,
    state: String,
    large_image_url: Option<String>,
    large_image_text: Option<String>,
) {
    let Ok(mut guard) = discord.client.lock() else { return };

    // Intento de reconexion lazy si no estamos conectados
    DiscordState::try_connect(&mut guard);

    let Some(client) = guard.as_mut() else { return };

    let img_url  = large_image_url.as_deref().unwrap_or("metadea");
    let img_text = large_image_text.as_deref().unwrap_or("Metadea");

    let payload = activity::Activity::new()
        .details(&details)
        .state(&state)
        .assets(
            activity::Assets::new()
                .large_image(img_url)
                .large_text(img_text),
        );

    // Si la conexion se perdio, reseteamos para que el proximo update reconecte
    if client.set_activity(payload).is_err() {
        *guard = None;
    }
}

/// Limpia la presencia de Discord (llamar al salir de la media page).
#[tauri::command]
pub fn clear_presence(discord: tauri::State<'_, DiscordState>) {
    let Ok(mut guard) = discord.client.lock() else { return };
    let Some(client) = guard.as_mut() else { return };
    if client.clear_activity().is_err() {
        *guard = None;
    }
}
