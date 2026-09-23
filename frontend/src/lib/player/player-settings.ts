// Player preferences. Device-level, never synced.
// - `playbackEngine`: `internal` (libmpv, default) falls back to `vlc` at
//   runtime when the library cannot be loaded — see playback-service.ts.
// - `controlsMode`: `overlay` (default) draws the controls in a transparent
//   window floating over the native video; `docked` renders them in the
//   main WebView under the video, with no extra window at all — the escape
//   hatch if transparent WebView2 misbehaves on a machine.

// - `skipMode`: what the player does with opening/ending segments (MKV
//   chapters or AniSkip): `button` (default) offers a "Skip" button while
//   inside one, `auto` seeks past it on entry (with an Undo toast), `off`
//   ignores segments entirely.

export type PlaybackEngine = 'internal' | 'vlc';
export type PlayerControlsMode = 'overlay' | 'docked';
export type PlayerSkipMode = 'button' | 'auto' | 'off';

// Local to this module rather than lib/storage/storage-keys.ts: that
// registry is edited concurrently by other work; the keys are namespaced
// the same way as every other entry there.
export const PLAYBACK_ENGINE_STORAGE_KEY = 'metadea_playback_engine';
export const PLAYER_CONTROLS_MODE_STORAGE_KEY = 'metadea_player_controls_mode';
export const PLAYER_SKIP_MODE_STORAGE_KEY = 'metadea_player_skip_mode';

export const DEFAULT_PLAYBACK_ENGINE: PlaybackEngine = 'internal';
export const DEFAULT_CONTROLS_MODE: PlayerControlsMode = 'overlay';
export const DEFAULT_SKIP_MODE: PlayerSkipMode = 'button';

export function parsePlaybackEngine(raw: string | null | undefined): PlaybackEngine {
  return raw === 'vlc' ? 'vlc' : DEFAULT_PLAYBACK_ENGINE;
}

export function parseControlsMode(raw: string | null | undefined): PlayerControlsMode {
  return raw === 'docked' ? 'docked' : DEFAULT_CONTROLS_MODE;
}

export function parseSkipMode(raw: string | null | undefined): PlayerSkipMode {
  return raw === 'auto' || raw === 'off' ? raw : DEFAULT_SKIP_MODE;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getPlaybackEngine(): PlaybackEngine {
  return parsePlaybackEngine(storage()?.getItem(PLAYBACK_ENGINE_STORAGE_KEY));
}

export function setPlaybackEngine(engine: PlaybackEngine): void {
  storage()?.setItem(PLAYBACK_ENGINE_STORAGE_KEY, engine);
}

export function getControlsMode(): PlayerControlsMode {
  return parseControlsMode(storage()?.getItem(PLAYER_CONTROLS_MODE_STORAGE_KEY));
}

export function setControlsMode(mode: PlayerControlsMode): void {
  storage()?.setItem(PLAYER_CONTROLS_MODE_STORAGE_KEY, mode);
}

export function getSkipMode(): PlayerSkipMode {
  return parseSkipMode(storage()?.getItem(PLAYER_SKIP_MODE_STORAGE_KEY));
}

export function setSkipMode(mode: PlayerSkipMode): void {
  storage()?.setItem(PLAYER_SKIP_MODE_STORAGE_KEY, mode);
}
