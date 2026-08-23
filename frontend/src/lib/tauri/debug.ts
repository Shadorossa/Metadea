import { tauriCmd, tauriRun } from './core';

export async function debugScanInfo(): Promise<string> {
  return tauriCmd<string>('debug_scan_info', 'Tauri not available - using fallback');
}

export async function openEnvFolder(): Promise<void> {
  return tauriRun('open_env_folder');
}

export async function launchGame(launcher: string, appId?: string | null, installPath?: string | null): Promise<void> {
  return tauriRun('launch_game', { launcher, appId: appId ?? null, installPath: installPath ?? null });
}

// Hands any URL off to the OS's own handler — needed for custom schemes
// like "steam://" a plain <a target="_blank">/window.open can't reliably
// escape the webview with.
export async function openExternalUrl(url: string): Promise<void> {
  return tauriRun('open_external_url', { url });
}
