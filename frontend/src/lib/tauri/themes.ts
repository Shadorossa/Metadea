import { tauriCmd, tauriRun } from './bridge';
// ── Anime openings/endings, animethemes.moe (media page's "Temas" tab) ──────

export interface MediaTheme {
  external_id: string;
  slug:        string;
  theme_type:  'OP' | 'ED';
  sequence:    number;
  song_title:  string | null;
  artists:     string | null;
  episodes:    string | null;
  video_url:   string | null;
  preview_url?: string | null;
  versions?:   string | null;
}

export async function getMediaThemes(externalId: string): Promise<MediaTheme[]> {
  return tauriCmd<MediaTheme[]>('get_media_themes', [], { externalId });
}

export async function saveMediaThemes(externalId: string, themes: MediaTheme[]): Promise<void> {
  return tauriRun('save_media_themes', { externalId, themes });
}

export async function saveThemePreviewFrame(externalId: string, slug: string, dataBase64: string): Promise<string> {
  return tauriCmd<string>('save_theme_preview_frame', '', { externalId, slug, dataBase64 });
}

export async function getThemePreviewFrame(externalId: string, slug: string): Promise<string | null> {
  return tauriCmd<string | null>('get_theme_preview_frame', null, { externalId, slug });
}

export async function cacheThemeVideo(url: string, externalId: string, slug: string): Promise<string> {
  return tauriCmd<string>('cache_theme_video', '', { url, externalId, slug });
}

export async function getThemeVideoPath(externalId: string, slug: string): Promise<string | null> {
  return tauriCmd<string | null>('get_cached_theme_video', null, { externalId, slug });
}

export async function deleteCachedThemeVideo(externalId: string, slug: string): Promise<void> {
  return tauriRun('delete_cached_theme_video', { externalId, slug });
}
