// Pure mapping between the media page's theme cards and the jukebox queue:
// which cards are starred, what a toggle does to the local queue, and the
// key list a reorder sends to Rust.
import type { FavoriteTheme, FavoriteThemeKey } from '../tauri/jukebox';
import type { MediaTheme } from '../tauri/themes';
import { themeKey } from './jukebox-store';

export function favoriteKeySet(queue: FavoriteTheme[]): Set<string> {
  return new Set(queue.map(f => themeKey(f.theme)));
}

export function isThemeFavorite(queue: FavoriteTheme[], theme: Pick<MediaTheme, 'external_id' | 'slug'>): boolean {
  return queue.some(f => f.theme.external_id === theme.external_id && f.theme.slug === theme.slug);
}

export function toFavoriteKeys(queue: FavoriteTheme[]): FavoriteThemeKey[] {
  return queue.map(f => ({ external_id: f.theme.external_id, slug: f.theme.slug }));
}

export interface FavoriteToggleContext {
  mediaTitle: string;
  coverUrl: string | null;
}

// The queue as it will look once Rust confirms the toggle: a star appends
// at the end (re-starring is a no-op), an unstar removes wherever it sits.
// Used to update the strip optimistically before the reload lands.
export function applyFavoriteToggle(
  queue: FavoriteTheme[],
  theme: MediaTheme,
  favorite: boolean,
  context: FavoriteToggleContext,
): FavoriteTheme[] {
  const present = isThemeFavorite(queue, theme);
  if (favorite) {
    if (present) return queue;
    return [...queue, {
      theme,
      media_title: context.mediaTitle,
      cover_url: context.coverUrl,
      preview_frame_path: null,
    }];
  }
  if (!present) return queue;
  return queue.filter(f => !(f.theme.external_id === theme.external_id && f.theme.slug === theme.slug));
}

// Label for the strip and the media session: song title, or "OP1"-style
// fallback when animethemes.moe has no title for it.
export function themeDisplayTitle(theme: MediaTheme): string {
  return theme.song_title?.trim() || `${theme.theme_type}${theme.sequence}`;
}
