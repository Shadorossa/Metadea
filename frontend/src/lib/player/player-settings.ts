// Player preferences. Device-level, never synced. There is no engine choice:
// local video always plays in the built-in libmpv player (a stale
// `metadea_playback_engine` value from older versions is simply never read).
// - `controlsMode`: `overlay` (default) draws the controls in a transparent
//   window floating over the native video; `docked` renders them in the
//   main WebView under the video, with no extra window at all — the escape
//   hatch if transparent WebView2 misbehaves on a machine.

// - `skipMode`: what the player does with opening/ending segments (MKV
//   chapters or AniSkip): `button` (default) offers a "Skip" button while
//   inside one, `auto` seeks past it on entry (with an Undo toast), `off`
//   ignores segments entirely.

// - `seekThumbnails`: frame preview when hovering the seek bar (default on).
// - track preferences: smart audio/subtitle selection (lib/player/track-preferences.ts).
// - clip defaults: format (MP4/GIF) and size (480p/720p) the scissors start with.

import { STORAGE_KEYS } from '../storage/storage-keys';
import {
  DEFAULT_TRACK_PREFERENCES, type AnimeAudioPreference, type FallbackSubtitles, type TrackPreferences,
} from './track-preferences';

export type PlayerControlsMode = 'overlay' | 'docked';
export type PlayerSkipMode = 'button' | 'auto' | 'off';

// Local to this module rather than lib/storage/storage-keys.ts: that
// registry is edited concurrently by other work; the keys are namespaced
// the same way as every other entry there.
export const PLAYER_CONTROLS_MODE_STORAGE_KEY = 'metadea_player_controls_mode';
export const PLAYER_SKIP_MODE_STORAGE_KEY = 'metadea_player_skip_mode';

export const DEFAULT_CONTROLS_MODE: PlayerControlsMode = 'overlay';
export const DEFAULT_SKIP_MODE: PlayerSkipMode = 'button';

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

export function getSeekThumbnailsEnabled(): boolean {
  return storage()?.getItem(STORAGE_KEYS.playerSeekThumbnails) !== 'off';
}

export function setSeekThumbnailsEnabled(enabled: boolean): void {
  storage()?.setItem(STORAGE_KEYS.playerSeekThumbnails, enabled ? 'on' : 'off');
}

/** Languages the subtitle-language setting offers besides "app language". */
export const SUBTITLE_LANGUAGE_OPTIONS = ['en', 'es', 'ca', 'de', 'fr', 'it', 'ja', 'ru'] as const;

export function parseAnimeAudio(raw: unknown): AnimeAudioPreference {
  return raw === 'preferred' || raw === 'default' ? raw : DEFAULT_TRACK_PREFERENCES.animeAudio;
}

export function parseFallbackSubtitles(raw: unknown): FallbackSubtitles {
  return raw === 'none' ? 'none' : DEFAULT_TRACK_PREFERENCES.fallbackSubtitles;
}

export function parseSubtitleLanguage(raw: unknown): string {
  return typeof raw === 'string' && (SUBTITLE_LANGUAGE_OPTIONS as readonly string[]).includes(raw)
    ? raw
    : DEFAULT_TRACK_PREFERENCES.subtitleLanguage;
}

export function parseTrackPreferences(raw: string | null | undefined): TrackPreferences {
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') value = parsed as Record<string, unknown>;
  } catch { /* corrupt value: defaults */ }
  return {
    smart: value.smart !== false,
    animeAudio: parseAnimeAudio(value.animeAudio),
    subtitleLanguage: parseSubtitleLanguage(value.subtitleLanguage),
    fallbackSubtitles: parseFallbackSubtitles(value.fallbackSubtitles),
  };
}

export function getTrackPreferences(): TrackPreferences {
  return parseTrackPreferences(storage()?.getItem(STORAGE_KEYS.playerTrackPreferences));
}

export function setTrackPreferences(patch: Partial<TrackPreferences>): void {
  storage()?.setItem(STORAGE_KEYS.playerTrackPreferences, JSON.stringify({ ...getTrackPreferences(), ...patch }));
}
