import { API_URL } from '../config';

export type MediaType = 'anime' | 'manga' | 'novel' | 'game' | 'vn' | 'movie' | 'series' | 'book';

export interface SearchResult {
  id: string;
  externalId: string;
  type: MediaType;
  title: string;
  cover: string | null;
  year: number | null;
  score: number | null;
}

// ── AniList types ────────────────────────────────────────────────────────────

interface AniListMedia {
  id: number;
  title: { romaji: string | null; native: string | null };
  coverImage: { large: string | null } | null;
  startDate: { year: number | null } | null;
  averageScore: number | null;
}

interface AniListResponse {
  data?: {
    Page?: {
      media?: AniListMedia[];
    };
  };
}

// ── AniList ──────────────────────────────────────────────────────────────────

const ANILIST_QUERY = `
  query Search($q: String!, $type: MediaType!, $page: Int, $format: MediaFormat) {
    Page(page: $page, perPage: 20) {
      media(search: $q, type: $type, format: $format, sort: SEARCH_MATCH) {
        id title { romaji native } coverImage { large } startDate { year } averageScore
      }
    }
  }
`;

async function searchAniList(
  q: string,
  type: 'ANIME' | 'MANGA',
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { q, type, page: 1 } }),
    signal,
  });

  if (!res.ok) return [];

  const json: AniListResponse = await res.json();
  const mediaType = type === 'ANIME' ? 'anime' : 'manga';

  return (json.data?.Page?.media ?? []).map((m): SearchResult => ({
    id: String(m.id),
    externalId: `${mediaType}:${m.id}`,
    type: mediaType as MediaType,
    title: m.title.romaji ?? m.title.native ?? 'Unknown',
    cover: m.coverImage?.large ?? null,
    year: m.startDate?.year ?? null,
    score: m.averageScore ? m.averageScore / 10 : null,
  }));
}

// ── IGDB (via backend) ───────────────────────────────────────────────────────

async function searchIGDB(q: string, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(`${API_URL}/api/search/games?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) return [];
  const data = await res.json() as { results?: SearchResult[] };
  return data.results ?? [];
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function search(
  q: string,
  type: MediaType,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  switch (type) {
    case 'anime':  return searchAniList(q, 'ANIME', signal);
    case 'manga':  return searchAniList(q, 'MANGA', signal);
    case 'game':   return searchIGDB(q, signal);
    default:       return [];
  }
}
