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
