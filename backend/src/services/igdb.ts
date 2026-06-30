import type { CloudflareEnv } from '../types';

interface IgdbGame {
  id: number;
  name: string;
  category?: number;
  cover?: { url: string };
  first_release_date?: number;
  rating?: number;
  total_rating?: number;
  genres?: Array<{ id?: number; name?: string }>;
  version_parent?: { id: number; genres?: Array<{ id?: number }> } | null;
  parent_game?:    { id: number; genres?: Array<{ id?: number }> } | null;
  alternative_names?: Array<{ name: string; comment?: string }>;
}

interface IgdbTokenResponse {
  access_token: string;
}

const IGDB_GENRE_VISUAL_NOVEL = 34;
const IGDB_GENRE_RPG          = 12;
const IGDB_GENRE_FIGHTING     = 4;

const IGDB_CATEGORY_LABELS: Record<number, string> = {
  0:  'base_game',
  1:  'dlc',
  2:  'expansion',
  3:  'bundle',
  4:  'standalone_expansion',
  5:  'mod',
  6:  'episode',
  7:  'season',
  8:  'remake',
  9:  'remaster',
  10: 'expanded_game',
  11: 'port',
  12: 'fork',
  13: 'pack',
  14: 'update',
};

let cachedAccessToken: string | null = null;

async function fetchAccessToken(env: CloudflareEnv): Promise<string> {
  if (env.IGDB_ACCESS_TOKEN) return env.IGDB_ACCESS_TOKEN;
  if (cachedAccessToken) return cachedAccessToken;

  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${env.IGDB_CLIENT_ID}&client_secret=${env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error('IGDB token fetch failed');

  const data = await response.json() as IgdbTokenResponse;
  cachedAccessToken = data.access_token;
  return cachedAccessToken;
}

function buildCoverImageUrl(rawUrl: string): string {
  return `https:${rawUrl.replace('t_thumb', 't_cover_big')}`;
}

function parseDateFromUnixTimestamp(unixTimestamp: number): { year: number; month: number; day: number } {
  const date = new Date(unixTimestamp * 1000);
  return {
    year:  date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day:   date.getUTCDate(),
  };
}

function extractJapaneseName(alternativeNames?: Array<{ name: string; comment?: string }>): string | null {
  if (!alternativeNames) return null;
  const japaneseEntry = alternativeNames.find(entry => {
    const comment = (entry.comment ?? '').toLowerCase();
    return comment.includes('japanese') || comment.includes('jp') || /[぀-ヿ一-龯]/.test(entry.name);
  });
  return japaneseEntry?.name ?? null;
}

function hasVisualNovelGenre(genres: Array<{ id: number }>): boolean {
  const allIds = genres.map(g => g.id);
  const topThree = genres.slice(0, 3).map(g => g.id);
  return topThree.includes(IGDB_GENRE_VISUAL_NOVEL)
    && !allIds.includes(IGDB_GENRE_RPG)
    && !allIds.includes(IGDB_GENRE_FIGHTING);
}

function classifyAsVisualNovel(game: IgdbGame): boolean {
  if (game.genres && hasVisualNovelGenre(game.genres)) return true;
  const parent = game.version_parent ?? game.parent_game;
  if (parent?.genres && hasVisualNovelGenre(parent.genres)) return true;
  return false;
}

export async function searchGames(
  searchQuery: string,
  env: CloudflareEnv,
  options: { visualNovelsOnly?: boolean } = {},
): Promise<IgdbGame[]> {
  const accessToken = await fetchAccessToken(env);

  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'text/plain',
    },
    body: [
      `search "${searchQuery.replace(/"/g, '\\"')}";`,
      `fields name, category, cover.url, first_release_date, rating, total_rating,`,
      `       genres.id, genres.name,`,
      `       version_parent.id, version_parent.genres.id,`,
      `       parent_game.id, parent_game.genres.id,`,
      `       alternative_names.name, alternative_names.comment;`,
      `limit 50;`,
    ].join('\n'),
  });

  if (!response.ok) return [];
  const games = await response.json() as IgdbGame[];

  return games.filter(game => {
    if (game.version_parent) return false;
    const isVisualNovel = classifyAsVisualNovel(game);
    return options.visualNovelsOnly ? isVisualNovel : !isVisualNovel;
  });
}

export function mapIgdbGameToSearchResult(game: IgdbGame) {
  const releaseDate = game.first_release_date
    ? parseDateFromUnixTimestamp(game.first_release_date)
    : null;

  const score = game.total_rating ?? game.rating ?? null;

  return {
    externalId:   `game:${game.id}`,
    type:         'game' as const,
    format:       game.category !== undefined ? (IGDB_CATEGORY_LABELS[game.category] ?? '') : '',
    source:       'igdb' as const,
    titleMain:    game.name,
    titleRomaji:  null,
    titleNative:  extractJapaneseName(game.alternative_names),
    coverUrl:     game.cover ? buildCoverImageUrl(game.cover.url) : null,
    releaseYear:  releaseDate?.year   ?? null,
    releaseMonth: releaseDate?.month  ?? null,
    releaseDay:   releaseDate?.day    ?? null,
    scoreGlobal:  score ? Math.round(score) / 10 : null,
  };
}
