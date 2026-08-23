import type { MediaType, SearchResult, SearchPage, SearchFilters } from '../index';
import { SEASON_MONTHS } from '../index';
import { isAdultContentEnabled } from '../../settings/preferences';
import { API_ENDPOINTS } from '../../api/endpoints';
import { graphqlPost, type GraphQLResult } from '../../api/client';

// AniList's own fixed genre list (GenreCollection) — stable for years, not
// worth a dedicated request to re-fetch on every mount just for a filter's
// checkbox list.
export const ANILIST_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Hentai',
  'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological',
  'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
];

// AniList's FuzzyDateInt is YYYYMMDD as a plain integer — lexicographic
// integer comparison matches chronological order within a single year (the
// only thing startDate_greater/startDate_lesser are ever used for here),
// so no date-library needed to build one.
function fuzzyDateInt(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

// Builds the optional startDate_greater/startDate_lesser pair for a
// year+season filter — season alone (no year) has no fixed year to anchor
// a range to, so it's a no-op without one.
function dateRangeFromFilters(filters?: SearchFilters): { startDate_greater?: number; startDate_lesser?: number } {
  if (!filters?.year) return {};
  const [fromMonth, toMonth] = filters.season ? SEASON_MONTHS[filters.season] : [1, 12];
  return {
    startDate_greater: fuzzyDateInt(filters.year, fromMonth, 1) - 1,
    startDate_lesser: fuzzyDateInt(filters.year, toMonth, 31) + 1,
  };
}

// ── Detail types ──────────────────────────────────────────────────────────────

interface AniListCharacter {
  id: number;
  name: { full: string };
  image: { large: string | null; medium: string | null };
}

interface AniListCharacterEdge {
  role: string;
  node: AniListCharacter;
}

interface AniListStudio {
  id: number;
  name: string;
  siteUrl: string | null;
}

interface AniListStudioEdge {
  // True for the actual (main) animation studio; false for every other
  // company involved (production committee members — shown on AniList's own
  // site as "Producers"). AniList has no separate query for producers at
  // all — both are the same `studios` connection, told apart only by this flag.
  isMain: boolean;
  node: AniListStudio;
}

interface AniListRelationEdge {
  relationType: string;
  node: {
    id: number;
    type: string;
    format: string | null;
    title: { romaji: string | null };
    coverImage: { extraLarge: string | null; large: string | null; medium: string | null };
    startDate: { year: number | null; month: number | null; day: number | null } | null;
  };
}

export interface AniListStaffEdge {
  role: string;
  node: {
    id: number;
    name: { full: string };
    image: { large: string | null; medium: string | null } | null;
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
  studios: { edges: AniListStudioEdge[] };
  characters: { pageInfo: { hasNextPage: boolean; total: number | null }; edges: AniListCharacterEdge[] };
  relations: { edges: AniListRelationEdge[] };
  staff: { edges: AniListStaffEdge[] };
  // AniList's own aggregation of episode listings from a handful of
  // streaming platforms — the closest thing it has to per-episode data (no
  // official episode name/still-image API of its own the way TMDB has for
  // TV). Not guaranteed complete or present at all for less popular titles.
  streamingEpisodes: { title: string | null; thumbnail: string | null }[];
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
      studios { edges { isMain node { id name siteUrl } } }
      characters(sort: [ROLE, RELEVANCE], page: 1, perPage: 50) {
        pageInfo { hasNextPage total }
        edges { role node { id name { full } image { large medium } } }
      }
      relations {
        edges {
          relationType
          node { id type format title { romaji } coverImage { extraLarge large medium } startDate { year month day } }
        }
      }
      staff(perPage: 50) {
        edges {
          role
          node {
            id
            name { full }
            image { large medium }
          }
        }
      }
      streamingEpisodes { title thumbnail }
    }
  }
`;

// perPage must match DETAIL_QUERY's own characters(perPage) above — this
// walks whatever pages that first page's pageInfo says are left, at the
// same page size it was paginated at.
const CHARACTERS_PER_PAGE = 50;

const CHARACTERS_QUERY = `
  query MediaCharacters($id: Int!, $page: Int!) {
    Media(id: $id) {
      characters(sort: [ROLE, RELEVANCE], page: $page, perPage: ${CHARACTERS_PER_PAGE}) {
        pageInfo { hasNextPage }
        edges { role node { id name { full } image { large medium } } }
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

  const extraEdges = await fetchRemainingEdges(media.characters, CHARACTERS_PER_PAGE, page =>
    anilistPost<{ Media: { characters: AniListMediaDetail['characters'] } }>(CHARACTERS_QUERY, { id, page })
      .then(pageData => pageData?.Media?.characters ?? null),
  );
  media.characters.edges = [...media.characters.edges, ...extraEdges];

  return media;
}

// Deliberately just this one field — episode-list.ts used to call the full
// fetchAniListDetail() a second time (title/banner/description/studios/
// characters incl. its own pagination walk/relations/staff, all discarded)
// purely to read streamingEpisodes, doubling every request the main detail
// fetch already made. This is the one thing that fetch actually needs.
const STREAMING_EPISODES_QUERY = `
  query MediaStreamingEpisodes($id: Int!) {
    Media(id: $id) {
      streamingEpisodes { title thumbnail }
    }
  }
`;

export async function fetchAniListStreamingEpisodes(id: number): Promise<{ title: string | null; thumbnail: string | null }[] | null> {
  const data = await anilistPost<{ Media: { streamingEpisodes: { title: string | null; thumbnail: string | null }[] } }>(
    STREAMING_EPISODES_QUERY, { id },
  );
  return data?.Media?.streamingEpisodes ?? null;
}

interface AniListMedia {
  id: number;
  format: string | null;
  title: { romaji: string | null; native: string | null };
  coverImage: { large: string | null } | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  averageScore: number | null;
  genres: string[] | null;
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
        startDate { year month day } averageScore genres
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
        startDate { year month day } averageScore genres
      }
    }
  }
`;

// No `search` term — an empty search box still shows something (the top
// 100 by rating) instead of a blank tab until you type. startDate_greater/
// startDate_lesser/genre_in are all nullable — a caller with no active
// filter just omits those variables (JSON.stringify drops undefined keys),
// so this same query serves both plain browsing and filtered browsing.
const TOP_RATED_QUERY = `
  query TopRated($type: MediaType!, $page: Int, $isAdult: Boolean, $startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt, $genre_in: [String]) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: $type, isAdult: $isAdult, sort: SCORE_DESC, startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser, genre_in: $genre_in) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
      }
    }
  }
`;

const TOP_RATED_QUERY_WITH_FORMAT = `
  query TopRated($type: MediaType!, $page: Int, $format: MediaFormat!, $isAdult: Boolean, $startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt, $genre_in: [String]) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: $type, format: $format, isAdult: $isAdult, sort: SCORE_DESC, startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser, genre_in: $genre_in) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
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
    genres: media.genres ?? [],
  };
}

// Shared by searchAniList and topRatedAniList — both hit the same Page.media
// shape, just with a different sort/no search term.
function toSearchPage(ok: boolean, result: GraphQLResult<AniListResponse['data']> | null, mediaType: MediaType): SearchPage {
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

// AniList server-enforces a 50-per-page cap regardless of what `perPage` a
// query asks for (confirmed live: requesting 100 silently comes back with
// pageInfo.perPage: 50) — this app's own page size is 100 across every
// provider, so one logical page here means two AniList sub-pages (its own
// pages 2N-1 and 2N) fetched in parallel and merged. hasMore reflects
// whichever sub-page actually had results.
async function fetchAniListDoubledPage(
  query: string,
  buildVariables: (subPage: number) => Record<string, unknown>,
  mediaType: MediaType,
  signal: AbortSignal,
  page: number,
): Promise<SearchPage> {
  const [a, b] = await Promise.all([
    graphqlPost<AniListResponse['data']>(API_ENDPOINTS.ANILIST, query, buildVariables(page * 2 - 1), { signal }),
    graphqlPost<AniListResponse['data']>(API_ENDPOINTS.ANILIST, query, buildVariables(page * 2), { signal }),
  ]);
  const pageA = toSearchPage(a.ok, a.result, mediaType);
  const pageB = toSearchPage(b.ok, b.result, mediaType);
  return {
    results: [...pageA.results, ...pageB.results],
    hasMore: pageB.results.length > 0 ? pageB.hasMore : pageA.hasMore,
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
  const query = format ? SEARCH_QUERY_WITH_FORMAT : SEARCH_QUERY;
  const buildVariables = (subPage: number) => format
    ? { searchQuery, type: anilistType, page: subPage, format, isAdult }
    : { searchQuery, type: anilistType, page: subPage, isAdult };
  return fetchAniListDoubledPage(query, buildVariables, mediaType, signal, page);
}

// No text query — an empty search box shows the top 100 by rating instead
// of a blank tab until you type. AniList's own SCORE_DESC sort.
export async function topRatedAniList(
  anilistType: 'ANIME' | 'MANGA',
  mediaType: MediaType,
  signal: AbortSignal,
  format?: string,
  page = 1,
  filters?: SearchFilters,
): Promise<SearchPage> {
  const isAdult = isAdultContentEnabled() ? null : false;
  const query = format ? TOP_RATED_QUERY_WITH_FORMAT : TOP_RATED_QUERY;
  const dateRange = dateRangeFromFilters(filters);
  const genre_in = filters?.genres?.length ? filters.genres : undefined;
  const buildVariables = (subPage: number) => format
    ? { type: anilistType, page: subPage, format, isAdult, ...dateRange, genre_in }
    : { type: anilistType, page: subPage, isAdult, ...dateRange, genre_in };
  return fetchAniListDoubledPage(query, buildVariables, mediaType, signal, page);
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
    externalId: `character:a:${char.id}`,
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
    genres: [],
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
        // ANIME/MANGA only — a light novel is type MANGA with format NOVEL,
        // AniList has no separate LNOVEL type. Use mapExternalFormatToType
        // (mapper-utils.ts), not `type` alone, wherever this needs to become
        // this app's own manga/lnovel-distinguishing external_id.
        format: string | null;
        startDate: { year: number | null; month: number | null; day: number | null } | null;
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
      media(page: $mediaPage, perPage: 50, sort: START_DATE_DESC) {
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
            format
            startDate { year month day }
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

  // De-duped by the same type:id key every consumer already uses as this
  // media's external_id — a page-boundary overlap (or AniList itself
  // occasionally returning the same node twice) used to surface as literal
  // duplicate "appearances" entries for every downstream reader
  // (character.astro, CharacterPrEditorModal.tsx).
  const seenMedia = new Set<string>();
  const allEdges = [...character.media.edges, ...extraEdges].filter(edge => {
    const key = `${edge.node.type.toLowerCase()}:${edge.node.id}`;
    if (seenMedia.has(key)) return false;
    seenMedia.add(key);
    return true;
  });
  character.media.edges = allEdges;
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


