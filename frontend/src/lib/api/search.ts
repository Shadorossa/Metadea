export type MediaType = 'anime' | 'manga' | 'game' | 'movie' | 'series' | 'book';

export interface SearchResult {
  id: string;
  externalId: string;
  type: MediaType;
  title: string;
  cover: string | null;
  year: number | null;
  score: number | null;
}

// ── AniList ─────────────────────────────────────────────────────────────────

const ANILIST_QUERY = `
  query Search($q: String!, $type: MediaType!, $page: Int) {
    Page(page: $page, perPage: 20) {
      media(search: $q, type: $type, sort: SEARCH_MATCH) {
        id title { romaji native } coverImage { large } startDate { year } averageScore
      }
    }
  }
`;

async function searchAniList(q: string, type: 'ANIME' | 'MANGA'): Promise<SearchResult[]> {
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { q, type, page: 1 } }),
  });

  if (!res.ok) return [];

  const { data } = await res.json();
  const mediaType = type === 'ANIME' ? 'anime' : 'manga';

  return (data?.Page?.media ?? []).map((m: any): SearchResult => ({
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

async function searchIGDB(q: string): Promise<SearchResult[]> {
  const res = await fetch(`http://localhost:8787/api/search/games?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function search(q: string, type: MediaType): Promise<SearchResult[]> {
  switch (type) {
    case 'anime':  return searchAniList(q, 'ANIME');
    case 'manga':  return searchAniList(q, 'MANGA');
    case 'game':   return searchIGDB(q);
    default:       return [];
  }
}
