// IPC layer for the built-in player (src-tauri/src/player/commands.rs).
//
// Uses @tauri-apps/api directly instead of ./bridge's invoke: the player
// windows never run `init_database`, and bridge gates every invoke on that
// (5 s stall otherwise). Outside Tauri every call is a no-op / null.

import { isTauri } from './bridge';
import type {
  PlayerEnded, PlayerErrorEvent, PlayerScreenshotSaved, PlayerSessionInfo, PlayerStatus, PlayerTrackChanged, PlayerTrackKind,
} from '../player/player-status';

export const PLAYER_EVENTS = {
  status: 'player://status',
  trackChanged: 'player://track-changed',
  ended: 'player://ended',
  error: 'player://error',
  session: 'player://session',
  screenshot: 'player://screenshot',
} as const;

async function invokePlayer<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Tauri not available');
  const { invoke } = await import(/* @vite-ignore */ '@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function runPlayer(cmd: string, args?: Record<string, unknown>): Promise<void> {
  if (!isTauri()) return;
  await invokePlayer<void>(cmd, args);
}

export interface PlayerOpenRequest {
  queue: string[];
  startIndex?: number;
  startSeconds?: number | null;
  workName: string;
  episodeLabels: string[];
  titles?: string[];
  // Catalog id of the work and the episode number of each queue entry —
  // what the skip-segment lookup (usePlayerSkipSegments) keys on.
  externalId?: string | null;
  episodeNumbers?: number[];
  // false = docked controls in the main WebView, no overlay window.
  overlay?: boolean;
}

export async function playerEngineAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  return invokePlayer<boolean>('player_engine_available').catch(() => false);
}

export async function playerOpen(request: PlayerOpenRequest): Promise<PlayerSessionInfo> {
  return invokePlayer<PlayerSessionInfo>('player_open', { request });
}

export const playerTogglePause = () => runPlayer('player_toggle_pause');
export const playerSetPause = (paused: boolean) => runPlayer('player_set_pause', { paused });
export const playerSeek = (seconds: number, relative: boolean) => runPlayer('player_seek', { seconds, relative });
export const playerNext = () => runPlayer('player_next');
export const playerPrev = () => runPlayer('player_prev');
export const playerPlayIndex = (index: number) => runPlayer('player_play_index', { index });
export const playerSetTrack = (kind: PlayerTrackKind, id: number | null) => runPlayer('player_set_track', { kind, id });
export const playerSetVolume = (volume: number) => runPlayer('player_set_volume', { volume });
export const playerSetMute = (muted: boolean) => runPlayer('player_set_mute', { muted });
export const playerSetSpeed = (speed: number) => runPlayer('player_set_speed', { speed });
export const playerSetSubDelay = (seconds: number) => runPlayer('player_set_sub_delay', { seconds });
// mpv `frame-back-step` / `frame-step` — pauses and moves one frame.
export const playerFrameStep = (direction: 'back' | 'forward') => runPlayer('player_frame_step', { direction });
// mpv `cycle sub` / `cycle audio` — next track of that kind, wrapping through "off".
export const playerCycleTrack = (kind: 'sub' | 'audio') => runPlayer('player_cycle_track', { kind });
// `reason` comes back in the `player://ended` event: 'stopped' (user
// closed the player) vs 'navigate' (route left) let the page decide
// whether it still has to navigate away itself.
export const playerStopClose = (reason: 'stopped' | 'navigate' = 'stopped') => runPlayer('player_stop_close', { reason });
export const playerSetVideoBounds = (x: number, y: number, width: number, height: number) =>
  runPlayer('player_set_video_bounds', { x, y, width, height });
export const playerSetFullscreen = (fullscreen: boolean) => runPlayer('player_set_fullscreen', { fullscreen });
export const playerFocusOverlay = () => runPlayer('player_focus_overlay');

// Native "marked as watched" toast (src-tauri/src/folders/toast_window.rs);
// `token` identifies the mark its Undo button refers to.
export const showEpisodeWatchedToast = (workName: string, episodeLabel: string, token: number) =>
  runPlayer('show_episode_watched_toast', { workName, episodeLabel, token });

export interface ToastAction {
  action: string;
  token: number;
}

export async function playerScreenshot(): Promise<PlayerScreenshotSaved> {
  return invokePlayer<PlayerScreenshotSaved>('player_screenshot');
}

export async function playerGetStatus(): Promise<PlayerStatus | null> {
  if (!isTauri()) return null;
  return invokePlayer<PlayerStatus | null>('player_get_status').catch(() => null);
}

export async function playerGetSession(): Promise<PlayerSessionInfo | null> {
  if (!isTauri()) return null;
  return invokePlayer<PlayerSessionInfo | null>('player_get_session').catch(() => null);
}

export async function playerIsFullscreen(): Promise<boolean> {
  if (!isTauri()) return false;
  return invokePlayer<boolean>('player_is_fullscreen').catch(() => false);
}

export type Unlisten = () => void;

async function listenPlayerEvent<T>(name: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!isTauri()) return () => {};
  const { listen } = await import(/* @vite-ignore */ '@tauri-apps/api/event');
  return listen<T>(name, event => handler(event.payload));
}

export const listenPlayerStatus = (handler: (status: PlayerStatus) => void) =>
  listenPlayerEvent<PlayerStatus>(PLAYER_EVENTS.status, handler);
export const listenPlayerTrackChanged = (handler: (change: PlayerTrackChanged) => void) =>
  listenPlayerEvent<PlayerTrackChanged>(PLAYER_EVENTS.trackChanged, handler);
export const listenPlayerEnded = (handler: (ended: PlayerEnded) => void) =>
  listenPlayerEvent<PlayerEnded>(PLAYER_EVENTS.ended, handler);
export const listenPlayerError = (handler: (error: PlayerErrorEvent) => void) =>
  listenPlayerEvent<PlayerErrorEvent>(PLAYER_EVENTS.error, handler);
export const listenPlayerSession = (handler: (session: PlayerSessionInfo) => void) =>
  listenPlayerEvent<PlayerSessionInfo>(PLAYER_EVENTS.session, handler);
export const listenPlayerScreenshot = (handler: (saved: PlayerScreenshotSaved) => void) =>
  listenPlayerEvent<PlayerScreenshotSaved>(PLAYER_EVENTS.screenshot, handler);
export const listenToastAction = (handler: (action: ToastAction) => void) =>
  listenPlayerEvent<ToastAction>('toast://action', handler);
