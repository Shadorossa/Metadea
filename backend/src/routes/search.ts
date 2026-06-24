import { jsonResponse } from '../middleware/cors';
import { searchGames, mapIgdbGameToSearchResult } from '../services/igdb';
import type { CloudflareEnv } from '../types';

export async function searchGamesRoute(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  const url         = new URL(request.url);
  const searchQuery = url.searchParams.get('q')?.trim() ?? '';
  const mediaType   = url.searchParams.get('type') ?? 'game';

  if (searchQuery.length < 2) {
    return jsonResponse({ results: [] });
  }

  try {
    const games = await searchGames(searchQuery, env, {
      visualNovelsOnly: mediaType === 'vnovel',
    });
    return jsonResponse({ results: games.map(mapIgdbGameToSearchResult) });
  } catch {
    return jsonResponse({ error: 'Search failed' }, 500);
  }
}
