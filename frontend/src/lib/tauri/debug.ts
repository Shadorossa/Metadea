import { tauriCmd, tauriRun, isTauri } from './core';

export async function debugScanInfo(): Promise<string> {
  return tauriCmd<string>('debug_scan_info', 'Tauri not available - using fallback');
}

export async function openEnvFolder(): Promise<void> {
  return tauriRun('open_env_folder');
}

export async function launchGame(launcher: string, appId?: string | null, installPath?: string | null): Promise<void> {
  return tauriRun('launch_game', { launcher, appId: appId ?? null, installPath: installPath ?? null });
}

// Fire-and-forget: the Rust side polls for a process under installPath to
// appear then disappear again, and reports back later via a
// "game-session-ended" event (see listenGameSessionEnded) — no result here,
// since a session can take anywhere from minutes to hours to actually end.
export async function startPlaytimeSession(installPath: string, externalId: string): Promise<void> {
  return tauriRun('start_playtime_session', { installPath, externalId });
}

export interface GameSessionEndedPayload {
  external_id: string;
  hours: number;
}

// Fires once, later, whenever the Rust-side poll started by
// startPlaytimeSession above actually detects the game process ending —
// could be minutes or hours after this is set up. Returns an unlisten
// function (no-op outside Tauri), same shape as @tauri-apps/api's own
// listen() so callers can just useEffect-cleanup it directly.
export async function listenGameSessionEnded(
  callback: (payload: GameSessionEndedPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import(/* @vite-ignore */ '@tauri-apps/api/event');
  return listen<GameSessionEndedPayload>('game-session-ended', event => callback(event.payload));
}

// Hands any URL off to the OS's own handler — needed for custom schemes
// like "steam://" a plain <a target="_blank">/window.open can't reliably
// escape the webview with.
export async function openExternalUrl(url: string): Promise<void> {
  return tauriRun('open_external_url', { url });
}
