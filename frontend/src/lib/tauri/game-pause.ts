// Controller pause menu (src-tauri/src/game_pause): Rust suspends the
// emulator on Select/Back + Start held 1.5 s, brings Metadea to the front
// and emits "opened"; the overlay (components/game-pause/) answers with one
// of the actions below, after which Rust emits "closed".
import { tauriCmd, tauriRun, isTauri, waitForTauriBridge } from './bridge';

export interface GamePauseInfo {
  sessionId: string;
  externalId: string;
  title: string;
  coverUrl: string | null;
  platform: string | null;
  appId: string | null;
  /** Seconds played this session, at the moment of pausing. */
  sessionSeconds: number;
  /** RetroArch with network commands enabled. */
  canSaveState: boolean;
}

export type GamePauseCloseReason = 'continue' | 'quit' | 'ended';

export interface GamePauseClosed {
  sessionId: string;
  externalId: string;
  reason: GamePauseCloseReason;
}

export interface GamePauseSettings {
  enabled: boolean;
  /** How long the combo is held, in ms (read-only). */
  holdMs: number;
}

export const DEFAULT_GAME_PAUSE_SETTINGS: GamePauseSettings = { enabled: true, holdMs: 1500 };

/** The open pause, if any. Calling it tells Rust the overlay is showing
 *  (otherwise the game resumes on its own after a few seconds). */
export async function gamePauseCurrent(): Promise<GamePauseInfo | null> {
  return tauriCmd<GamePauseInfo | null>('game_pause_current', null);
}

export async function gamePauseContinue(): Promise<void> {
  return tauriRun('game_pause_continue');
}

/** Resolves once the emulator has exited (closed or, after 5 s, terminated). */
export async function gamePauseQuit(): Promise<void> {
  return tauriRun('game_pause_quit');
}

export async function gamePauseSaveState(): Promise<void> {
  return tauriRun('game_pause_save_state');
}

export async function getGamePauseSettings(): Promise<GamePauseSettings> {
  return tauriCmd<GamePauseSettings>('get_game_pause_settings', DEFAULT_GAME_PAUSE_SETTINGS);
}

export async function setGamePauseEnabled(enabled: boolean): Promise<GamePauseSettings> {
  return tauriCmd<GamePauseSettings>('set_game_pause_enabled', { ...DEFAULT_GAME_PAUSE_SETTINGS, enabled }, { enabled });
}

/** Subscribes to the pause menu's open/close events; returns an unlisten. */
export async function listenGamePause(handlers: {
  onOpened: () => void;
  onClosed: (payload: GamePauseClosed) => void;
}): Promise<() => void> {
  if (!isTauri() && !(await waitForTauriBridge())) return () => {};
  const { listen } = await import(/* @vite-ignore */ '@tauri-apps/api/event');
  const unlistenOpened = await listen('game-pause://opened', () => handlers.onOpened());
  const unlistenClosed = await listen<GamePauseClosed>('game-pause://closed', event => handlers.onClosed(event.payload));
  return () => { unlistenOpened(); unlistenClosed(); };
}
