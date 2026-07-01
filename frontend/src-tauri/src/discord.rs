use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;

const CLIENT_ID: &str = "1521817645043810344";

pub struct DiscordState {
    client: Mutex<Option<DiscordIpcClient>>,
}

impl DiscordState {
    pub fn new() -> Self {
        Self { client: Mutex::new(None) }
    }
}

fn try_connect(guard: &mut Option<DiscordIpcClient>) -> Result<(), String> {
    if guard.is_some() {
        return Ok(());
    }
    eprintln!("[Discord] Intentando conectar con Discord IPC...");
    let mut c = DiscordIpcClient::new(CLIENT_ID)
        .map_err(|e| format!("new() failed: {e}"))?;
    c.connect().map_err(|e| format!("connect() failed: {e}"))?;
    eprintln!("[Discord] Conectado con Discord IPC correctamente.");
    *guard = Some(c);
    Ok(())
}

#[tauri::command]
pub fn update_presence(
    discord: tauri::State<'_, DiscordState>,
    details: String,
    state: String,
    large_image_url: Option<String>,
    large_image_text: Option<String>,
) -> Result<(), String> {
    eprintln!("[Discord] update_presence llamado: '{details}' / '{state}'");

    let mut guard = discord.client.lock()
        .map_err(|e| format!("mutex: {e}"))?;

    if let Err(e) = try_connect(&mut guard) {
        eprintln!("[Discord] No se pudo conectar: {e}");
        return Err(e);
    }

    let client = guard.as_mut().ok_or("no client")?;

    let img_url  = large_image_url.as_deref().unwrap_or("");
    let img_text = large_image_text.as_deref().unwrap_or("Metadea");

    let mut assets = activity::Assets::new().large_text(img_text);
    if !img_url.is_empty() {
        assets = assets.large_image(img_url);
    }

    let payload = activity::Activity::new()
        .details(&details)
        .state(&state)
        .assets(assets);

    let ok = client.set_activity(payload).is_ok();

    if !ok {
        eprintln!("[Discord] set_activity falló, reseteando cliente para reconectar.");
        *guard = None;
        return Err("set_activity failed".into());
    }

    eprintln!("[Discord] Presencia actualizada correctamente.");
    Ok(())
}

#[tauri::command]
pub fn clear_presence(discord: tauri::State<'_, DiscordState>) -> Result<(), String> {
    eprintln!("[Discord] clear_presence llamado.");
    let mut guard = discord.client.lock()
        .map_err(|e| format!("mutex: {e}"))?;
    let Some(client) = guard.as_mut() else { return Ok(()) };
    client.clear_activity().map_err(|e| {
        guard.take();
        e.to_string()
    })?;
    Ok(())
}
