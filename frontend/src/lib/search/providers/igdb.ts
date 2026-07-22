import { API_URL } from '../../config';
import { igdbSearch, igdbImageUrl, isTauri, readEnvConfig } from '../../tauri';
import type { MediaType, SearchResult, SearchPage } from '../index';
import { cleanEditionTitle } from '../../media/title-utils';
import { unixToDateParts } from '../../media/mapper-utils';
import { MissingApiKeyError } from '../errors';

export async function searchGames(
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
  page = 1,
): Promise<SearchPage> {
  if (isTauri()) {
    return searchGamesLocal(searchQuery, mediaType, signal, page);
  }

  const url = `${API_URL}/api/search/games?q=${encodeURIComponent(searchQuery)}&type=${mediaType}&page=${page}`;
  const response = await fetch(url, { signal });
  if (!response.ok) return { results: [], hasMore: false };
  const data = await response.json() as { results?: SearchResult[]; hasMore?: boolean };
  return { results: data.results ?? [], hasMore: data.hasMore ?? false };
}

// Shared by searchGameBundles/searchGameExpandedEditions/searchGameRemasters —
// live IGDB search restricted to specific categories plain search
// deliberately excludes (bundles, expanded editions, remasters, ...).
async function searchGamesByCategories(
  searchQuery: string,
  signal: AbortSignal,
  page: number,
  categories: number[],
  format: string,
  bundlesOnlyQueryParam: string,
): Promise<SearchPage> {
  if (isTauri()) {
    const cfg = await readEnvConfig().catch(() => ({}));
    if (!cfg.igdb_client_id || !cfg.igdb_client_secret) return { results: [], hasMore: false };

    let pageResult;
    try {
      pageResult = await igdbSearch(searchQuery, false, page, categories);
    } catch {
      return { results: [], hasMore: false };
    }

    const results = pageResult.games.map(g => {
      const dateParts = g.first_release_date ? unixToDateParts(g.first_release_date) : null;
      const coverUrl = g.cover?.image_id ? igdbImageUrl(g.cover.image_id, 'cover_big') : null;
      return {
        externalId:   `game:${g.id}`,
        type:         'game' as MediaType,
        format:       format || (g.category === 8 ? 'REMAKE' : g.category === 9 ? 'REMASTER' : 'GAME'),
        source:       'igdb' as const,
        titleMain:    cleanEditionTitle(g.name),
        titleRomaji:  null,
        titleNative:  null,
        coverUrl,
        releaseYear:  dateParts?.year ?? null,
        releaseMonth: dateParts?.month ?? null,
        releaseDay:   dateParts?.day ?? null,
        scoreGlobal:  g.rating != null ? Math.round(g.rating) / 10 : null,
      };
    });

    return { results, hasMore: pageResult.hasMore };
  }

  const url = `${API_URL}/api/search/games?q=${encodeURIComponent(searchQuery)}&type=game&page=${page}&${bundlesOnlyQueryParam}=true`;
  const response = await fetch(url, { signal });
  if (!response.ok) return { results: [], hasMore: false };
  const data = await response.json() as { results?: SearchResult[]; hasMore?: boolean };
  return { results: data.results ?? [], hasMore: data.hasMore ?? false };
}

// IGDB category 3 (bundle) — the "Bundled In" relation picker.
export async function searchGameBundles(searchQuery: string, signal: AbortSignal, page = 1): Promise<SearchPage> {
  return searchGamesByCategories(searchQuery, signal, page, [3], 'BUNDLE', 'bundlesOnly');
}

// IGDB category 10 (expanded_game) — the "Contains" relation picker.
export async function searchGameExpandedEditions(searchQuery: string, signal: AbortSignal, page = 1): Promise<SearchPage> {
  return searchGamesByCategories(searchQuery, signal, page, [10], 'EXPANDED_GAME', 'expandedOnly');
}

// IGDB categories 8 (remake) & 9 (remaster) — the "Contains" relation picker for remasters.
export async function searchGameRemasters(searchQuery: string, signal: AbortSignal, page = 1): Promise<SearchPage> {
  return searchGamesByCategories(searchQuery, signal, page, [8, 9], 'REMASTER', 'remastersOnly');
}

async function searchGamesLocal(
  searchQuery: string,
  mediaType: MediaType,
  _signal: AbortSignal,
  page: number,
): Promise<SearchPage> {
  const cfg = await readEnvConfig().catch(() => ({}));
  if (!cfg.igdb_client_id || !cfg.igdb_client_secret) {
    throw new MissingApiKeyError(['igdb']);
  }

  let pageResult;
  try {
    pageResult = await igdbSearch(searchQuery, mediaType === 'vnovel', page);
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : 'IGDB error');
  }

  const results = pageResult.games.map(g => {
    const dateParts = g.first_release_date ? unixToDateParts(g.first_release_date) : null;

    const coverUrl = g.cover?.image_id
      ? igdbImageUrl(g.cover.image_id, 'cover_big')
      : null;

    return {
      externalId:   `${mediaType}:${g.id}`,
      type:         mediaType as MediaType,
      format:       mediaType === 'vnovel' ? 'VISUAL_NOVEL' : 'GAME',
      source:       'igdb' as const,
      titleMain:    cleanEditionTitle(g.name),
      titleRomaji:  null,
      titleNative:  null,
      coverUrl,
      releaseYear:  dateParts?.year ?? null,
      releaseMonth: dateParts?.month ?? null,
      releaseDay:   dateParts?.day ?? null,
      scoreGlobal:  g.rating != null ? Math.round(g.rating) / 10 : null,
    };
  });

  return { results, hasMore: pageResult.hasMore };
}
