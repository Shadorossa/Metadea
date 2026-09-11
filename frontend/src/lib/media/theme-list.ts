// Per-theme data ("Temas" tab on the anime media page) — split out the same
// way episode-list.ts is, sourced from animethemes.moe (the only provider
// this app uses that has opening/ending data at all).
import { fetchAnimeThemes } from '../search/providers/animethemes';
import { parseExternalId } from './mapper-utils';
import { getMediaThemes, saveMediaThemes, type MediaTheme } from '../tauri';

// Cached in media_theme after the first fetch — read from there on every
// later visit instead of re-hitting animethemes.moe. Only anime has
// openings/endings; every other type returns []. force skips the cache
// read entirely (MediaPage's "Reintentar sincronización" button).
export async function fetchMediaThemes(rawId: string, force = false): Promise<MediaTheme[]> {
  if (!force) {
    const cached = await getMediaThemes(rawId).catch(() => []);
    if (cached.length > 0) return cached;
  }

  const { type, id: numericId } = parseExternalId(rawId);
  if (type !== 'anime' || !numericId) return [];

  const themes = await fetchAnimeThemes(numericId).catch(() => []);
  const fresh: MediaTheme[] = themes.map(t => ({
    external_id: rawId,
    slug:        t.slug,
    theme_type:  t.themeType,
    sequence:    t.sequence,
    song_title:  t.songTitle,
    artists:     t.artists,
    episodes:    t.episodes,
    video_url:   t.videoUrl,
  }));

  if (fresh.length > 0) {
    saveMediaThemes(rawId, fresh).catch(err => console.error('Failed to save media themes', err));
  }
  return fresh;
}
