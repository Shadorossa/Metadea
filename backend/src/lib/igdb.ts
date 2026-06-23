import type { CloudflareEnv } from '../types/index';

interface IGDBGame {
  id: number;
  name: string;
  cover?: { url: string };
  first_release_date?: number;
  rating?: number;
}

// Token cache dentro del isolate (dura 60 días en IGDB)
let cachedToken: string | null = null;

async function getToken(env: CloudflareEnv): Promise<string> {
  if (env.IGDB_ACCESS_TOKEN) return env.IGDB_ACCESS_TOKEN;
  if (cachedToken) return cachedToken;

  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${env.IGDB_CLIENT_ID}&client_secret=${env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error('IGDB token fetch failed');
  const data = await res.json() as { access_token: string };
  cachedToken = data.access_token;
  return cachedToken;
}

function coverUrl(raw: string): string {
  // IGDB returns "//images.igdb.com/.../t_thumb/co1234.jpg"
  return `https:${raw.replace('t_thumb', 't_cover_big')}`;
}

export async function searchGames(q: string, env: CloudflareEnv): Promise<IGDBGame[]> {
  const token = await getToken(env);

  const res = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: `search "${q.replace(/"/g, '')}"; fields name,cover.url,first_release_date,rating; limit 20;`,
  });

  if (!res.ok) return [];
  return res.json() as Promise<IGDBGame[]>;
}

export function mapGame(game: IGDBGame) {
  return {
    id: String(game.id),
    externalId: `game:${game.id}`,
    type: 'game' as const,
    title: game.name,
    cover: game.cover ? coverUrl(game.cover.url) : null,
    year: game.first_release_date ? new Date(game.first_release_date * 1000).getFullYear() : null,
    score: game.rating ? Math.round(game.rating) / 10 : null,
  };
}
