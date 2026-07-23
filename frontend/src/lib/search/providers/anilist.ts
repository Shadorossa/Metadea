import type { MediaType, SearchResult, SearchPage } from '../index';
import { isAdultContentEnabled } from '../../settings/preferences';
import { API_ENDPOINTS } from '../../api/endpoints';
import { graphqlPost } from '../../api/client';

// ── Detail types ──────────────────────────────────────────────────────────────

interface AniListCharacter {
  id: number;
  name: { full: string };
  image: { medium: string | null };
}

interface AniListCharacterEdge {
  role: string;
  node: AniListCharacter;
}

interface AniListStudio {
  name: string;
  siteUrl: string | null;
}

interface AniListRelationEdge {
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

export interface AniListStaffEdge {
  role: string;
  node: {
    id: number;
    name: { full: string };
    image: { medium: string | null } | null;
  };
}

export interface AniListMediaDetail {
  id: number;
  siteUrl: string | null;
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
  countryOfOrigin: string | null;
  // Only present while status is RELEASING — AniList doesn't know the final
  // episode count yet, but this tells us how many have aired so far
  // (nextAiringEpisode.episode - 1), which is what a RELEASING anime's own
  // total_count should track until it finishes airing.
  nextAiringEpisode: { episode: number } | null;
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
  characters: { pageInfo: { hasNextPage: boolean; total: number | null }; edges: AniListCharacterEdge[] };
  relations: { edges: AniListRelationEdge[] };
  staff: { edges: AniListStaffEdge[] };
}

const DETAIL_QUERY = `
  query Media($id: Int!) {
    Media(id: $id) {
      id
      siteUrl
      title { romaji english native }
      bannerImage
      coverImage { extraLarge large color }
      description(asHtml: true)
      format status episodes chapters volumes duration countryOfOrigin
      nextAiringEpisode { episode }
      averageScore popularity favourites genres
      season seasonYear
      startDate { year month day }
      endDate   { year month day }
      source
      studios(isMain: true) { nodes { name siteUrl } }
      characters(sort: [ROLE, RELEVANCE], page: 1, perPage: 25) {
        pageInfo { hasNextPage total }
        edges { role node { id name { full } image { medium } } }
      }
      relations {
        edges {
          relationType
          node { id type format title { romaji } coverImage { medium } startDate { year month day } }
        }
      }
      staff(perPage: 25) {
        edges {
          role
          node {
            id
            name { full }
            image { medium }
          }
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
    const { ok, result } = await graphqlPost<T>(API_ENDPOINTS.ANILIST, query, variables);
    if (!ok) return null;
    return result?.data ?? null;
  } catch { return null; }
}

interface PagedEdges<E> { pageInfo: { hasNextPage: boolean; total?: number | null }; edges: E[]; }

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetches every page after the first (already-fetched) one for a paginated
// AniList edge list. Pages are walked one at a time (with a short pause in
// between) instead of firing all of them concurrently — a single hover
// prefetch used to blow through AniList's rate limit by itself on media
// with a large cast (dozens of parallel character-page requests), which then
// 429'd every other AniList call for a while, including unrelated ones like
// the media editor's "import from AniList" button. Sequential fetching still
// retrieves every page, just spread out instead of bursted.
async function fetchRemainingEdges<E>(
  firstPage: PagedEdges<E>,
  perPage: number,
  fetchPage: (page: number) => Promise<PagedEdges<E> | null>,
): Promise<E[]> {
  if (!firstPage.pageInfo.hasNextPage) return [];

  const total = firstPage.pageInfo.total;
  const totalPages = total ? Math.ceil(total / perPage) : Infinity;

  const extra: E[] = [];
  let page = 2;
  while (page <= totalPages) {
    const next = await fetchPage(page);
    if (!next) break;
    extra.push(...next.edges);
    if (!next.pageInfo.hasNextPage) break;
    page++;
    if (page <= totalPages) await delay(150);
  }
  return extra;
}

export async function fetchAniListDetail(id: number): Promise<AniListMediaDetail | null> {
  const data = await anilistPost<{ Media: AniListMediaDetail }>( DETAIL_QUERY, { id });
  const media = data?.Media ?? null;
  if (!media) return null;

  const extraEdges = await fetchRemainingEdges(media.characters, 25, page =>
    anilistPost<{ Media: { characters: AniListMediaDetail['characters'] } }>(CHARACTERS_QUERY, { id, page })
      .then(pageData => pageData?.Media?.characters ?? null),
  );
  media.characters.edges = [...media.characters.edges, ...extraEdges];

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
  data?: { Page?: { pageInfo?: { hasNextPage: boolean }; media?: AniListMedia[] } };
}

const SEARCH_QUERY = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int, $isAdult: Boolean) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(search: $searchQuery, type: $type, isAdult: $isAdult, sort: SEARCH_MATCH) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore
      }
    }
  }
`;

const SEARCH_QUERY_WITH_FORMAT = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int, $format: MediaFormat!, $isAdult: Boolean) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(search: $searchQuery, type: $type, format: $format, isAdult: $isAdult, sort: SEARCH_MATCH) {
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
  page = 1,
): Promise<SearchPage> {
  // Adult content is opt-in (Settings → Actividad). Off by default: filter to
  // isAdult: false. When enabled, omit the filter entirely (null) so both
  // adult and non-adult results are returned.
  const isAdult = isAdultContentEnabled() ? null : false;

  const variables = format
    ? { searchQuery, type: anilistType, page, format, isAdult }
    : { searchQuery, type: anilistType, page, isAdult };
  const { ok, result } = await graphqlPost<AniListResponse['data']>(
    API_ENDPOINTS.ANILIST,
    format ? SEARCH_QUERY_WITH_FORMAT : SEARCH_QUERY,
    variables,
    { signal },
  );

  if (!ok) return { results: [], hasMore: false };
  const pageData = result?.data?.Page;
  if (!pageData) return { results: [], hasMore: false };

  // AniList's MANGA type covers both manga and light novels — the 'lnovel'
  // caller filters to format: NOVEL explicitly, but the plain 'manga' caller
  // (no format filter, so it can still find ONE_SHOT/DOUJIN/etc alongside
  // regular manga) never excluded NOVEL, so the same work turned up twice:
  // once correctly under "lnovel", once again mislabeled "manga:{id}".
  const media = mediaType === 'manga'
    ? (pageData.media ?? []).filter(m => m.format !== 'NOVEL')
    : (pageData.media ?? []);

  return {
    results: media.map(m => mapAniListMediaToResult(m, mediaType)),
    hasMore: pageData.pageInfo?.hasNextPage ?? false,
  };
}

interface AniListCharacterSearch {
  id: number;
  name: { full: string; native: string | null; alternative: string[] | null };
  image: { large: string | null } | null;
}

interface AniListCharResponse {
  data?: { Page?: { pageInfo?: { hasNextPage: boolean }; characters?: AniListCharacterSearch[] } };
}

const SEARCH_CHARACTERS_QUERY = `
  query SearchCharacters($searchQuery: String!, $page: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      characters(search: $searchQuery, sort: SEARCH_MATCH) {
        id
        name { full native alternative }
        image { large }
      }
    }
  }
`;

export async function searchAniListCharacters(
  searchQuery: string,
  signal: AbortSignal,
  page = 1,
): Promise<SearchPage> {
  const { ok, result } = await graphqlPost<AniListCharResponse['data']>(
    API_ENDPOINTS.ANILIST,
    SEARCH_CHARACTERS_QUERY,
    { searchQuery, page },
    { signal },
  );

  if (!ok) return { results: [], hasMore: false };
  const pageData = result?.data?.Page;
  if (!pageData) return { results: [], hasMore: false };

  const chars = pageData.characters ?? [];
  const results: SearchResult[] = chars.map(char => ({
    externalId: `character:${char.id}`,
    type: 'character' as MediaType,
    format: '',
    source: 'anilist' as const,
    titleMain: char.name.full,
    titleRomaji: char.name.alternative?.join(', ') ?? null,
    titleNative: char.name.native,
    coverUrl: char.image?.large ?? null,
    releaseYear: null,
    releaseMonth: null,
    releaseDay: null,
    scoreGlobal: null,
  }));
  return { results, hasMore: pageData.pageInfo?.hasNextPage ?? false };
}

export interface AniListStaffSearchResult {
  id: number;
  name: string;
  nameNative: string | null;
  image: string | null;
}

interface AniListStaffSearchResponse {
  data?: {
    Page?: {
      pageInfo?: { hasNextPage: boolean };
      staff?: Array<{ id: number; name: { full: string; native: string | null }; image: { large: string | null } | null }>;
    };
  };
}

const SEARCH_STAFF_QUERY = `
  query SearchStaff($searchQuery: String!, $page: Int) {
    Page(page: $page, perPage: 25) {
      pageInfo { hasNextPage }
      staff(search: $searchQuery, sort: SEARCH_MATCH) {
        id
        name { full native }
        image { large }
      }
    }
  }
`;

// Voice actor picker (CharacterPrEditorModal) — AniList models a voice actor
// as Staff, same entity type as a work's director/writer/composer, just
// linked via Character.media.edges[].voiceActors instead of Media.staff.
export async function searchAniListStaff(
  searchQuery: string,
  signal: AbortSignal,
  page = 1,
): Promise<{ results: AniListStaffSearchResult[]; hasMore: boolean }> {
  const { ok, result } = await graphqlPost<AniListStaffSearchResponse['data']>(
    API_ENDPOINTS.ANILIST,
    SEARCH_STAFF_QUERY,
    { searchQuery, page },
    { signal },
  );

  if (!ok) return { results: [], hasMore: false };
  const pageData = result?.data?.Page;
  if (!pageData) return { results: [], hasMore: false };

  const staff = pageData.staff ?? [];
  return {
    results: staff.map(s => ({ id: s.id, name: s.name.full, nameNative: s.name.native, image: s.image?.large ?? null })),
    hasMore: pageData.pageInfo?.hasNextPage ?? false,
  };
}

export interface AniListCharacterDetail {
  id: number;
  name: {
    full: string;
    native: string | null;
    alternative: string[];
    alternativeSpoiler: string[];
  };
  image: {
    large: string | null;
  } | null;
  description: string | null;
  gender: string | null;
  dateOfBirth: {
    year: number | null;
    month: number | null;
    day: number | null;
  } | null;
  age: string | null;
  bloodType: string | null;
  media: {
    edges: Array<{
      // Character's role in that specific work (MAIN/SUPPORTING/BACKGROUND).
      // Not to be confused with Media.relations' `relationType` (a different
      // connection, for media-to-media relations) — Character.media's own
      // field is `characterRole`; querying `relationType` here just returns
      // null for every edge.
      characterRole: string;
      node: {
        id: number;
        title: {
          userPreferred: string;
        };
        coverImage: {
          large: string;
        };
        type: string;
      };
    }>;
  };
}

type AniListCharacterMediaEdge = AniListCharacterDetail['media']['edges'][number];

interface AniListCharacterDetailPage extends Omit<AniListCharacterDetail, 'media'> {
  media: {
    pageInfo: { hasNextPage: boolean; total: number | null };
    edges: AniListCharacterMediaEdge[];
  };
}

const DETAIL_CHARACTER_QUERY = `
  query GetCharacterDetail($id: Int, $mediaPage: Int) {
    Character(id: $id) {
      id
      name {
        full
        native
        alternative
        alternativeSpoiler
      }
      image {
        large
      }
      description(asHtml: true)
      gender
      dateOfBirth {
        year
        month
        day
      }
      age
      bloodType
      media(page: $mediaPage, perPage: 50, sort: START_DATE) {
        pageInfo {
          hasNextPage
          total
        }
        edges {
          characterRole
          voiceActors {
            id
            name {
              full
              native
              userPreferred
            }
            languageV2
            image {
              large
              medium
            }
            siteUrl
          }
          node {
            id
            title {
              userPreferred
            }
            coverImage {
              large
            }
            type
          }
        }
      }
    }
  }
`;

export async function fetchAniListCharacterDetail(id: number): Promise<AniListCharacterDetail | null> {
  // Page 1 also carries the character's own profile fields, so it has to be
  // fetched (and awaited) on its own before the remaining pages can be fanned
  // out (see fetchRemainingEdges).
  const firstData = await anilistPost<{ Character: AniListCharacterDetailPage }>(DETAIL_CHARACTER_QUERY, { id, mediaPage: 1 });
  const character = firstData?.Character ?? null;
  if (!character) return null;

  const extraEdges = await fetchRemainingEdges(character.media, 50, page =>
    anilistPost<{ Character: AniListCharacterDetailPage }>(DETAIL_CHARACTER_QUERY, { id, mediaPage: page })
      .then(data => data?.Character?.media ?? null),
  );

  character.media.edges = [...character.media.edges, ...extraEdges];
  return character;
}

export interface AniListStaffDetail {
  name: { full: string; native: string | null; alternative: string[] };
  image: { large: string | null } | null;
  description: string | null;
  staffMedia: {
    edges: {
      staffRole: string;
      node: {
        id: number;
        type: string;
        format: string | null;
        title: { romaji: string | null; english: string | null };
        coverImage: { medium: string | null } | null;
      };
    }[];
  };
}

export async function fetchAniListStaffDetail(staffId: number): Promise<AniListStaffDetail | null> {
  const query = `
    query Staff($id: Int!) {
      Staff(id: $id) {
        name { full native alternative }
        image { large }
        description(asHtml: true)
        staffMedia(sort: [START_DATE_DESC]) {
          edges {
            staffRole
            node {
              id type format title { romaji english } coverImage { medium }
            }
          }
        }
      }
    }
  `;
  const res = await anilistPost<{ Staff: AniListStaffDetail }>(query, { id: staffId });
  return res?.Staff ?? null;
}


