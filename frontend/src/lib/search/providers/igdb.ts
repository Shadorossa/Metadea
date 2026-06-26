import { API_URL } from '../../config';
import { igdbSearch, igdbImageUrl } from '../../tauri';
import type { MediaType, SearchResult } from '../index';

const isTauri = () => typeof window !== 'undefined' && '__TAURI__' in window;

export async function searchGames(
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  if (isTauri()) {
    return searchGamesLocal(searchQuery, mediaType, signal);
  }

  const url = `${API_URL}/api/search/games?q=${encodeURIComponent(searchQuery)}&type=${mediaType}`;
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const data = await response.json() as { results?: SearchResult[] };
  return data.results ?? [];
}

async function searchGamesLocal(
  searchQuery: string,
  mediaType: MediaType,
  _signal: AbortSignal,
): Promise<SearchResult[]> {
  let results;
  try {
    results = await igdbSearch(searchQuery, mediaType === 'vnovel');
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : 'IGDB error');
  }

  return results.map(g => {
    const year = g.first_release_date
      ? new Date(g.first_release_date * 1000).getFullYear()
      : null;

    const coverUrl = g.cover?.image_id
      ? igdbImageUrl(g.cover.image_id, 'cover_big')
      : null;

    return {
      externalId:   `${mediaType}:${g.id}`,
      type:         mediaType as MediaType,
      format:       mediaType === 'vnovel' ? 'VISUAL_NOVEL' : 'GAME',
      source:       'igdb' as const,
      titleMain:    g.name,
      titleRomaji:  null,
      titleNative:  null,
      coverUrl,
      releaseYear:  year,
      releaseMonth: g.first_release_date
        ? new Date(g.first_release_date * 1000).getMonth() + 1
        : null,
      releaseDay:   g.first_release_date
        ? new Date(g.first_release_date * 1000).getDate()
        : null,
      scoreGlobal:  g.rating != null ? Math.round(g.rating) / 10 : null,
    };
  });
}
