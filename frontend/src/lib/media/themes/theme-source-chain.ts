// Where the OP/ED overlay loads a theme's video from, in order, and what it
// does when a source fails: the disk cache first (no network at all), then
// the selected version's remote URL — retried a couple of times, since a
// failure there is usually the CDN's per-IP rate limit (503) passing within
// seconds — then the theme's other versions. Only once the whole chain is
// spent does the overlay show its error and Retry button.
import type { MediaTheme } from '../../tauri/themes';

export interface ThemeVersionEntry {
  version: number;
  episodes: string | null;
  videoUrl: string | null;
}

/** The theme's versions (v1, v2…); a theme without a versions blob is its own v1. */
export function parseThemeVersions(theme: Pick<MediaTheme, 'versions' | 'episodes' | 'video_url'>): ThemeVersionEntry[] {
  if (theme.versions) {
    try {
      const parsed: unknown = JSON.parse(theme.versions);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as ThemeVersionEntry[];
    } catch {}
  }
  return [{ version: 1, episodes: theme.episodes, videoUrl: theme.video_url }];
}

export type ThemeSourceKind = 'cache' | 'remote';

export interface ThemeSource {
  kind: ThemeSourceKind;
  url: string;
  version: number;
}

/**
 * @param cachedUrl playable URL of the disk-cached file, or null. The cache
 *   holds the theme's own `video_url` (what the capture queue downloads), so
 *   it only leads the chain when that is the version being played.
 */
export function buildThemeSourceChain(
  theme: Pick<MediaTheme, 'versions' | 'episodes' | 'video_url'>,
  selectedVersion: number,
  cachedUrl: string | null,
): ThemeSource[] {
  const versions = parseThemeVersions(theme);
  const selected = versions.find(v => v.version === selectedVersion) ?? versions[0];
  const version = selected?.version ?? 1;
  const primaryUrl = selected?.videoUrl || theme.video_url;

  const chain: ThemeSource[] = [];
  if (cachedUrl && primaryUrl === theme.video_url) chain.push({ kind: 'cache', url: cachedUrl, version });
  const pushRemote = (url: string | null | undefined, v: number) => {
    if (url && !chain.some(s => s.kind === 'remote' && s.url === url)) chain.push({ kind: 'remote', url, version: v });
  };
  pushRemote(primaryUrl, version);
  for (const v of versions) pushRemote(v.videoUrl, v.version);
  return chain;
}

/** Automatic retries of a failed remote source, and the wait before each. */
export const THEME_REMOTE_RETRY_DELAYS_MS: readonly number[] = [1000, 3000];

export interface ThemeSourceCursor {
  index: number;
  /** Automatic retries already spent on chain[index]. */
  retries: number;
}

export type ThemeSourceStep =
  | { type: 'retry'; cursor: ThemeSourceCursor; delayMs: number }
  | { type: 'next'; cursor: ThemeSourceCursor }
  | { type: 'exhausted' };

/** What to do after chain[cursor.index] failed to play. */
export function nextThemeSourceStep(chain: readonly ThemeSource[], cursor: ThemeSourceCursor): ThemeSourceStep {
  const failed = chain[cursor.index];
  if (failed?.kind === 'remote' && cursor.retries < THEME_REMOTE_RETRY_DELAYS_MS.length) {
    return {
      type: 'retry',
      cursor: { index: cursor.index, retries: cursor.retries + 1 },
      delayMs: THEME_REMOTE_RETRY_DELAYS_MS[cursor.retries],
    };
  }
  if (cursor.index + 1 < chain.length) return { type: 'next', cursor: { index: cursor.index + 1, retries: 0 } };
  return { type: 'exhausted' };
}
