// Thin wrapper around @tauri-apps/plugin-notification. Callers don't need
// to handle permission checks, and this no-ops cleanly outside Tauri.
export async function notifySystem(title: string, body: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }
    if (!granted) return false;
    await sendNotification({ title, body });
    return true;
  } catch {
    // Not running under Tauri, or the plugin/webview doesn't support it —
    // this is a best-effort nicety, never worth surfacing an error for.
    return false;
  }
}

export async function notifyNewEpisode(title: string, episodeLabel: string): Promise<void> {
  await notifySystem('Nuevo episodio disponible', `${title} — ${episodeLabel}`);
}
