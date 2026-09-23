import { tauriCmd, tauriRun, isTauri, waitForTauriBridge } from './bridge';

export async function debugScanInfo(): Promise<string> {
  return tauriCmd<string>('debug_scan_info', 'Tauri not available - using fallback');
}

export async function openEnvFolder(): Promise<void> {
  return tauriRun('open_env_folder');
}

// `title` names the folder an emulator session's screenshots are moved to
// ($PICTURES/Metadea/<title>/, the one get_local_screenshots lists) and, with
// `coverUrl`, the game session's presence (src-tauri/src/game_sessions.rs).
export async function launchGame(
  launcher: string, appId?: string | null, installPath?: string | null, romPlatform?: string | null, externalId?: string | null,
  title?: string | null, coverUrl?: string | null,
  // A multi-disc game's picked disc and .m3u (lib/local/disc-choice.ts).
  disc?: { discPath: string | null; discPlaylist: string | null } | null,
): Promise<void> {
  return tauriRun('launch_game', {
    launcher, appId: appId ?? null, installPath: installPath ?? null, romPlatform: romPlatform ?? null, externalId: externalId ?? null,
    title: title ?? null, coverUrl: coverUrl ?? null,
    discPath: disc?.discPath ?? null, discPlaylist: disc?.discPlaylist ?? null,
  });
}

// Fire-and-forget: the Rust side registers the game session, polls for a
// process to appear then disappear again, records the playtime itself and
// reports back later via "game-session-ended" (see listenGameSessionEnded) —
// no result here, since a session can take hours to actually end. romPlatform switches what
// the Rust side actually watches for — installPath (a folder, for a real
// Steam/Epic/GOG install) vs the platform's own configured emulator
// executable (installPath is just the ROM file for those, not a folder
// anything runs from) — see track_playtime_session's own comment.
export async function startPlaytimeSession(
  installPath: string,
  externalId: string,
  romPlatform?: string | null,
  launcher?: string | null,
  appId?: string | null,
  title?: string | null,
  coverUrl?: string | null,
): Promise<void> {
  return tauriRun('start_playtime_session', {
    installPath,
    externalId,
    romPlatform: romPlatform ?? null,
    launcher: launcher ?? null,
    appId: appId ?? null,
    title: title ?? null,
    coverUrl: coverUrl ?? null,
  });
}

export async function stopGameProcess(
  installPath: string,
  romPlatform?: string | null,
): Promise<number> {
  return tauriCmd<number>('stop_game_process', 0, {
    installPath,
    romPlatform: romPlatform ?? null,
  });
}

export interface GameSessionEndedPayload {
  external_id: string;
  hours: number;
  // True when Rust already added the session to the library entry; the
  // frontend never writes playtime itself, it only refreshes.
  recorded: boolean;
}

// Fires once, later, whenever a game session (ROM or startPlaytimeSession)
// ends — could be minutes or hours after this is set up. Returns an unlisten
// function (no-op outside Tauri), same shape as @tauri-apps/api's own
// listen() so callers can just useEffect-cleanup it directly.
export async function listenGameSessionEnded(
  callback: (payload: GameSessionEndedPayload) => void,
): Promise<() => void> {
  if (!isTauri() && !(await waitForTauriBridge())) return () => {};
  const { listen } = await import(/* @vite-ignore */ '@tauri-apps/api/event');
  return listen<GameSessionEndedPayload>('game-session-ended', event => callback(event.payload));
}

// A game launched from Metadea that is still running (game_sessions.rs's
// ActiveSession). `started_unix` is when playtime started counting.
export interface ActiveGameSession {
  session_id: string;
  external_id: string;
  title: string;
  cover_url: string | null;
  platform: string | null;
  launcher: string;
  app_id: string | null;
  install_path: string | null;
  exe_path: string | null;
  pids: number[];
  started_unix: number;
  last_heartbeat_unix: number;
  running: boolean;
  // Pause menu suspends (unix seconds); excluded from the break reminder.
  paused_seconds: number;
  paused_since: number | null;
}

export async function getActiveGameSessions(): Promise<ActiveGameSession[]> {
  return tauriCmd<ActiveGameSession[]>('get_active_game_sessions', []);
}

// The full list, newest first, every time a session starts, starts running
// (store launchers), or ends.
export async function listenGameSessionsChanged(
  callback: (sessions: ActiveGameSession[]) => void,
): Promise<() => void> {
  if (!isTauri() && !(await waitForTauriBridge())) return () => {};
  const { listen } = await import(/* @vite-ignore */ '@tauri-apps/api/event');
  return listen<ActiveGameSession[]>('game-sessions-changed', event => callback(event.payload));
}

export interface GamePlayStats {
  total_minutes: number;
  sessions_count: number;
  last_played_unix: number | null;
  average_session_minutes: number | null;
}

export async function getGamePlayStats(externalId: string): Promise<GamePlayStats | null> {
  return tauriCmd<GamePlayStats | null>('get_game_play_stats', null, { externalId });
}

// Hands any URL off to the OS's own handler — needed for custom schemes
// like "steam://" a plain <a target="_blank">/window.open can't reliably
// escape the webview with.
export async function openExternalUrl(url: string): Promise<void> {
  return tauriRun('open_external_url', { url });
}
