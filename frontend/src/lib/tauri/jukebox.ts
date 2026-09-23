import { tauriCmd, tauriRun } from './bridge';
import type { MediaTheme } from './themes';
// ── Jukebox favourites (media_themes.rs, favorite_themes table) ─────────────

// A starred OP/ED plus what the jukebox strip shows around it. Mirrors
// media_themes.rs's FavoriteTheme.
export interface FavoriteTheme {
  theme:              MediaTheme;
  media_title:        string;
  cover_url:          string | null;
  // Local path of the captured preview frame, when one exists.
  preview_frame_path: string | null;
}

export interface FavoriteThemeKey {
  external_id: string;
  slug:        string;
}

export async function getFavoriteThemes(): Promise<FavoriteTheme[]> {
  return tauriCmd<FavoriteTheme[]>('get_favorite_themes', []);
}

export async function setThemeFavorite(externalId: string, slug: string, favorite: boolean): Promise<void> {
  await tauriRun('set_theme_favorite', { externalId, slug, favorite });
}

export async function reorderFavoriteThemes(keys: FavoriteThemeKey[]): Promise<void> {
  await tauriRun('reorder_favorite_themes', { keys });
}
