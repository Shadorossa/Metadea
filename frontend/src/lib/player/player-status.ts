// Types mirrored from src-tauri/src/player (status.rs, engine.rs,
// commands.rs). Pure declarations: no React, no Tauri imports.

export type PlayerStateKind = 'idle' | 'playing' | 'paused' | 'ended';

export type PlayerTrackKind = 'audio' | 'sub' | 'video';

export interface PlayerTrack {
  id: number;
  kind: PlayerTrackKind | string;
  title: string | null;
  lang: string | null;
  selected: boolean;
  is_default: boolean;
  codec: string | null;
  external: boolean;
}

// One MKV chapter (mpv `chapter-list`); skip segments are derived from the
// titles in lib/player/skip-segments.ts.
export interface PlayerChapter {
  title: string | null;
  time_secs: number;
}

export interface PlayerStatus {
  state: PlayerStateKind;
  position_secs: number;
  duration_secs: number;
  path: string | null;
  playlist_index: number;
  playlist_len: number;
  tracks: PlayerTrack[];
  chapters: PlayerChapter[];
  volume: number;
  muted: boolean;
  speed: number;
  sub_delay_secs: number;
}

export interface PlayerSessionInfo {
  work_name: string;
  queue: string[];
  episode_labels: string[];
  titles: string[];
  // Catalog id (`anime:<anilistId>`) and per-entry episode numbers, so the
  // controls window can resolve skip segments for what is playing.
  external_id: string | null;
  episode_numbers: number[];
}

export interface PlayerTrackChanged {
  index: number;
  path: string | null;
}

// `player://ended` (src-tauri/src/player/window.rs): the exact position at
// the moment the engine stopped, read from mpv itself - the resume point.
export interface PlayerEnded {
  reason: string;
  position_secs: number;
  duration_secs: number;
  playlist_index: number;
  path: string | null;
  /** Frame captured at the stop point for Home's "Continue watching" card
   *  (player/continue_frame.rs); null when nothing was captured. */
  frame_path: string | null;
}

export interface PlayerErrorEvent {
  code: string;
}

export interface PlayerScreenshotSaved {
  work_name: string;
  episode_label: string;
  timecode: string;
  path: string;
}

// Shape of a rejected `player_*` invoke (src-tauri/src/player/error.rs).
export interface PlayerError {
  code: string;
  detail: string;
}

export const EMPTY_PLAYER_STATUS: PlayerStatus = {
  state: 'idle',
  position_secs: 0,
  duration_secs: 0,
  path: null,
  playlist_index: -1,
  playlist_len: 0,
  tracks: [],
  chapters: [],
  volume: 100,
  muted: false,
  speed: 1,
  sub_delay_secs: 0,
};

export function isPlayerError(value: unknown): value is PlayerError {
  return typeof value === 'object' && value !== null && typeof (value as PlayerError).code === 'string';
}

export function playerErrorCode(value: unknown): string {
  return isPlayerError(value) ? value.code : 'unknown';
}

// "00h02m03s456" (the capture file's timecode) -> "0:02:03.456".
export function formatCaptureTimecode(timecode: string): string {
  const match = timecode.match(/^(\d+)h(\d{2})m(\d{2})s(\d{3})$/);
  if (!match) return timecode;
  return `${Number(match[1])}:${match[2]}:${match[3]}.${match[4]}`;
}
