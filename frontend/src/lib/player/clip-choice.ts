// The clip chooser's last answer (format, size, audio), remembered as the
// next export's default. Device-level localStorage; nothing in Settings.
// Subtitle burn-in is not remembered: it defaults to "on" whenever
// subtitles are showing when the clip is made.

import { STORAGE_KEYS } from '../storage/storage-keys';
import type { ClipFormat, ClipSize } from '../tauri/player';

export interface ClipChoice {
  format: ClipFormat;
  size: ClipSize;
  includeAudio: boolean;
}

export const DEFAULT_CLIP_CHOICE: ClipChoice = { format: 'mp4', size: '480p', includeAudio: true };

export function parseClipChoice(raw: string | null | undefined): ClipChoice {
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') value = parsed as Record<string, unknown>;
  } catch { /* corrupt value: defaults */ }
  return {
    format: value.format === 'gif' ? 'gif' : DEFAULT_CLIP_CHOICE.format,
    size: value.size === '720p' ? '720p' : DEFAULT_CLIP_CHOICE.size,
    includeAudio: value.includeAudio !== false,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getLastClipChoice(): ClipChoice {
  return parseClipChoice(storage()?.getItem(STORAGE_KEYS.playerClipLastChoice));
}

export function rememberClipChoice(choice: ClipChoice): void {
  storage()?.setItem(STORAGE_KEYS.playerClipLastChoice, JSON.stringify(choice));
}
