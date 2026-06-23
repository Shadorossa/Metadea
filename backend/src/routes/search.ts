import { jsonResponse } from '../lib/cors';
import { searchGames, mapGame } from '../lib/igdb';
import type { CloudflareEnv } from '../types/index';

export async function searchGamesRoute(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';

  if (q.length < 2) {
    return jsonResponse({ results: [] });
  }

  try {
    const games = await searchGames(q, env);
    return jsonResponse({ results: games.map(mapGame) });
  } catch {
    return jsonResponse({ error: 'Search failed' }, 500);
  }
}
