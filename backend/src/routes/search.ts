import { jsonResponse } from '../lib/cors';
import { searchGames, mapIgdbGameToSearchResult } from '../lib/igdb';
import type { CloudflareEnv } from '../types/index';

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
