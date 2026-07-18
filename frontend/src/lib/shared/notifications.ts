// Thin wrapper around @tauri-apps/plugin-notification — every call site
// just wants "show this if I'm allowed to," not to handle permission
// prompting/checking itself, and this no-ops cleanly outside Tauri (the
// dynamic import throws, caught below) instead of every caller needing its
// own try/catch for that.
export async function notifyNewEpisode(title: string, episodeLabel: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }
    if (!granted) return;
    sendNotification({ title: 'Nuevo episodio disponible', body: `${title} — ${episodeLabel}` });
  } catch {
    // Not running under Tauri, or the plugin/webview doesn't support it —
    // this is a best-effort nicety, never worth surfacing an error for.
  }
}
