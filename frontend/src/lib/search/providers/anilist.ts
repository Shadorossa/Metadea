import type { MediaType, SearchResult } from '../index';

// ── Detail types ──────────────────────────────────────────────────────────────

export interface AniListCharacter {
  id: number;
  name: { full: string };
  image: { medium: string | null };
}

export interface AniListCharacterEdge {
  role: string;
  node: AniListCharacter;
}

export interface AniListStudio {
  name: string;
  siteUrl: string | null;
}

export interface AniListRelationEdge {
  relationType: string;
  node: {
    id: number;
    type: string;
    format: string | null;
    title: { romaji: string | null };
    coverImage: { medium: string | null };
    startDate: { year: number | null; month: number | null; day: number | null } | null;
  };
}

export interface AniListMediaDetail {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  bannerImage: string | null;
  coverImage: { extraLarge: string | null; large: string | null; color: string | null } | null;
  description: string | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  chapters: number | null;
  volumes: number | null;
  duration: number | null;
  averageScore: number | null;
  popularity: number | null;
  favourites: number | null;
  genres: string[];
  season: string | null;
  seasonYear: number | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  endDate: { year: number | null; month: number | null; day: number | null } | null;
  source: string | null;
  studios: { nodes: AniListStudio[] };
  characters: { pageInfo: { hasNextPage: boolean }; edges: AniListCharacterEdge[] };
  relations: { edges: AniListRelationEdge[] };
}

const DETAIL_QUERY = `
  query Media($id: Int!) {
    Media(id: $id) {
      id
      title { romaji english native }
      bannerImage
      coverImage { extraLarge large color }
      description(asHtml: true)
      format status episodes chapters volumes duration
      averageScore popularity favourites genres
      season seasonYear
      startDate { year month day }
      endDate   { year month day }
      source
      studios(isMain: true) { nodes { name siteUrl } }
      characters(sort: [ROLE, RELEVANCE], page: 1, perPage: 25) {
        pageInfo { hasNextPage }
        edges { role node { id name { full } image { medium } } }
      }
      relations {
        edges {
          relationType
          node { id type format title { romaji } coverImage { medium } startDate { year month day } }
        }
      }
    }
  }
`;

const CHARACTERS_QUERY = `
  query MediaCharacters($id: Int!, $page: Int!) {
    Media(id: $id) {
      characters(sort: [ROLE, RELEVANCE], page: $page, perPage: 25) {
        pageInfo { hasNextPage }
        edges { role node { id name { full } image { medium } } }
      }
    }
  }
`;

async function anilistPost<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return null;
    return (await res.json() as { data?: T }).data ?? null;
  } catch { return null; }
}

export async function fetchAniListDetail(id: number): Promise<AniListMediaDetail | null> {
  const data = await anilistPost<{ Media: AniListMediaDetail }>( DETAIL_QUERY, { id });
  const media = data?.Media ?? null;
  if (!media) return null;

  // Si hay más páginas de personajes, las pedimos todas en serie
  if (media.characters.pageInfo.hasNextPage) {
    let page = 2;
    const extraEdges: AniListCharacterEdge[] = [];

    while (true) {
      const pageData = await anilistPost<{ Media: { characters: AniListMediaDetail['characters'] } }>(
        CHARACTERS_QUERY, { id, page }
      );
      const chars = pageData?.Media?.characters;
      if (!chars) break;
      extraEdges.push(...chars.edges);
      if (!chars.pageInfo.hasNextPage) break;
      page++;
    }

    media.characters.edges = [
      ...media.characters.edges,
      ...extraEdges,
    ];
  }

  return media;
}

interface AniListMedia {
  id: number;
  format: string | null;
  title: { romaji: string | null; native: string | null };
  coverImage: { large: string | null } | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  averageScore: number | null;
}

interface AniListResponse {
  data?: { Page?: { media?: AniListMedia[] } };
}

const SEARCH_QUERY = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int) {
    Page(page: $page, perPage: 20) {
      media(search: $searchQuery, type: $type, sort: SEARCH_MATCH) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore
      }
    }
  }
`;

const SEARCH_QUERY_WITH_FORMAT = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int, $format: MediaFormat!) {
    Page(page: $page, perPage: 20) {
      media(search: $searchQuery, type: $type, format: $format, sort: SEARCH_MATCH) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore
      }
    }
  }
`;

function mapAniListMediaToResult(media: AniListMedia, mediaType: MediaType): SearchResult {
  return {
    externalId: `${mediaType}:${media.id}`,
    type: mediaType,
    format: media.format ?? '',
    source: 'anilist',
    titleMain: media.title.romaji ?? media.title.native ?? '',
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    coverUrl: media.coverImage?.large ?? null,
    releaseYear: media.startDate?.year ?? null,
    releaseMonth: media.startDate?.month ?? null,
    releaseDay: media.startDate?.day ?? null,
    scoreGlobal: media.averageScore ? media.averageScore / 10 : null,
  };
}

export async function searchAniList(
  searchQuery: string,
  anilistType: 'ANIME' | 'MANGA',
  mediaType: MediaType,
  signal: AbortSignal,
  format?: string,
): Promise<SearchResult[]> {
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      format
        ? { query: SEARCH_QUERY_WITH_FORMAT, variables: { searchQuery, type: anilistType, page: 1, format } }
        : { query: SEARCH_QUERY,             variables: { searchQuery, type: anilistType, page: 1 } },
    ),
    signal,
  });

  if (!response.ok) return [];
  const json: AniListResponse = await response.json();
  return (json.data?.Page?.media ?? []).map(media => mapAniListMediaToResult(media, mediaType));
}
