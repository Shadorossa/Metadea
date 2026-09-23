import type { MediaType, SearchResult, SearchPage, SearchFilters } from '../types';
import { SEASON_MONTHS } from '../types';
import { isAdultContentEnabled, isUnifySeasonsEnabled } from '../../storage/preferences';
import { API_ENDPOINTS } from '../../api/endpoints';
import { graphqlPost, type GraphQLResult } from '../../api/client';
import { AniListSearchError } from '../errors';
import { getAniListToken } from '../../tauri/auth';

// ── Untrusted-JSON guards ─────────────────────────────────────────────────────
// The typed response shapes below are a compile-time promise only — the JSON
// AniList actually sends can be anything. Each search mapper narrows its row
// ONCE through a parse*Row guard and is written assertion-free from there; a
// row that fails the guard is skipped rather than allowed to throw mid-page.

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function rowsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

interface AniListFuzzyDate { year: number | null; month: number | null; day: number | null }

function fuzzyDate(value: unknown): AniListFuzzyDate | null {
  if (!isRecord(value)) return null;
  return { year: optionalNumber(value.year), month: optionalNumber(value.month), day: optionalNumber(value.day) };
}

// Page.pageInfo.hasNextPage, read defensively — anything but a literal true
// (missing pageInfo, a null, a string) means "no more pages".
function hasNextPageOf(page: UnknownRecord): boolean {
  return isRecord(page.pageInfo) && page.pageInfo.hasNextPage === true;
}

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

export interface AniListCharacterEdge {
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
  if (!firstPage.pageInfo?.hasNextPage) return [];

  const total = firstPage.pageInfo.total;
  const totalPages = total ? Math.ceil(total / perPage) : Infinity;

  const extra: E[] = [];
  let page = 2;
  while (page <= totalPages) {
    const next = await fetchPage(page);
    if (!next) break;
    if (Array.isArray(next.edges)) extra.push(...next.edges);
    if (!next.pageInfo?.hasNextPage) break;
    page++;
    if (page <= totalPages) await delay(150);
  }
  return extra;
}

// Deliberately does NOT wait on any extra character pages beyond the first
// (see DETAIL_QUERY's characters(perPage: 50) above) — a media page used to
// sit blank until a large-cast show's whole reparto finished paginating in,
// even though nothing about first-rendering the page actually needs more
// than what's already on the first page. Callers that want the rest fetch
// them separately in the background (see fetchAniListRemainingCharacters)
// once the page is already showing.
export async function fetchAniListDetail(id: number): Promise<AniListMediaDetail | null> {
  const data = await anilistPost<{ Media: AniListMediaDetail }>( DETAIL_QUERY, { id });
  return data?.Media ?? null;
}

// Walks whatever character pages come after the first one already shown —
// same sequential-with-delay pagination fetchAniListDetail used to do
// inline, just called separately so it can run after the page has already
// rendered instead of blocking it.
export async function fetchAniListRemainingCharacters(id: number, hasNextPage: boolean): Promise<AniListCharacterEdge[]> {
  if (!hasNextPage) return [];
  return fetchRemainingEdges<AniListCharacterEdge>(
    { pageInfo: { hasNextPage: true, total: null }, edges: [] },
    CHARACTERS_PER_PAGE,
    page => anilistPost<{ Media: { characters: AniListMediaDetail['characters'] } }>(CHARACTERS_QUERY, { id, page })
      .then(pageData => pageData?.Media?.characters ?? null),
  );
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

// The narrowed row shape every search mapper works from — only the fields
// actually read, each already validated by parseAniListMedia.
interface AniListMedia {
  id: number;
  format: string | null;
  title: { romaji: string | null; native: string | null };
  coverImage: { large: string | null } | null;
  startDate: AniListFuzzyDate | null;
  averageScore: number | null;
  genres: string[];
  // Only present on the *_ANIME query variants below (see RELATIONS_FIELD) —
  // used solely to detect "this result is a later season" for
  // isUnifySeasonsEnabled(), never for manga/lnovel search.
  relations?: { edges: Array<{ relationType: string | null; node: { type: string | null } }> };
}

// Only the envelope is typed; the rows inside Page stay `unknown` until a
// parse*Row guard has looked at each one.
interface AniListSearchData { Page?: unknown }

function parseAniListMedia(raw: unknown): AniListMedia | null {
  if (!isRecord(raw) || !isRecord(raw.title)) return null;
  const id = optionalNumber(raw.id);
  if (id === null) return null;
  const relationEdges = isRecord(raw.relations) ? rowsOf(raw.relations.edges) : null;
  return {
    id,
    format: optionalString(raw.format),
    title: { romaji: optionalString(raw.title.romaji), native: optionalString(raw.title.native) },
    coverImage: isRecord(raw.coverImage) ? { large: optionalString(raw.coverImage.large) } : null,
    startDate: fuzzyDate(raw.startDate),
    averageScore: optionalNumber(raw.averageScore),
    genres: stringList(raw.genres),
    relations: relationEdges
      ? {
        edges: relationEdges.filter(isRecord).map(edge => ({
          relationType: optionalString(edge.relationType),
          node: { type: isRecord(edge.node) ? optionalString(edge.node.type) : null },
        })),
      }
      : undefined,
  };
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

// Anime-only variants adding each result's own relations — the sole purpose
// is letting toSearchPage detect "this result has an ANIME PREQUEL, so it's
// a later season" when isUnifySeasonsEnabled() is on (see hasAnimePrequel).
// Never used for manga/lnovel search, which has no such concept.
const RELATIONS_FIELD = 'relations { edges { relationType node { id type } } }';

const SEARCH_QUERY_ANIME = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int, $isAdult: Boolean) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(search: $searchQuery, type: $type, isAdult: $isAdult, sort: SEARCH_MATCH) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
        ${RELATIONS_FIELD}
      }
    }
  }
`;

const SEARCH_QUERY_WITH_FORMAT_ANIME = `
  query Search($searchQuery: String!, $type: MediaType!, $page: Int, $format: MediaFormat!, $isAdult: Boolean) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(search: $searchQuery, type: $type, format: $format, isAdult: $isAdult, sort: SEARCH_MATCH) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
        ${RELATIONS_FIELD}
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

// Same relations-carrying idea as SEARCH_QUERY_ANIME above, for the no-query
// "top rated" browse tab.
const TOP_RATED_QUERY_ANIME = `
  query TopRated($type: MediaType!, $page: Int, $isAdult: Boolean, $startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt, $genre_in: [String]) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: $type, isAdult: $isAdult, sort: SCORE_DESC, startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser, genre_in: $genre_in) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
        ${RELATIONS_FIELD}
      }
    }
  }
`;

const TOP_RATED_QUERY_WITH_FORMAT_ANIME = `
  query TopRated($type: MediaType!, $page: Int, $format: MediaFormat!, $isAdult: Boolean, $startDate_greater: FuzzyDateInt, $startDate_lesser: FuzzyDateInt, $genre_in: [String]) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: $type, format: $format, isAdult: $isAdult, sort: SCORE_DESC, startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser, genre_in: $genre_in) {
        id format title { romaji native } coverImage { large }
        startDate { year month day } averageScore genres
        ${RELATIONS_FIELD}
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
    genres: media.genres,
  };
}

// True for any result that's a direct sequel of another anime — i.e. not
// the chain's own first/basic entry. Only ever meaningful on the *_ANIME
// query variants (see RELATIONS_FIELD); manga/lnovel results never carry
// `relations` at all, so this always reads false for them.
function hasAnimePrequel(media: AniListMedia): boolean {
  return !!media.relations?.edges.some(e => e.relationType === 'PREQUEL' && e.node.type === 'ANIME');
}

// Shared by searchAniList and topRatedAniList — both hit the same Page.media
// shape, just with a different sort/no search term.
function toSearchPage(ok: boolean, result: GraphQLResult<AniListSearchData> | null, mediaType: MediaType): SearchPage {
  if (!ok) {
    // Check for token expiration errors
    if (result?.errors?.some(e =>
      e.message?.includes('Unauthorized') ||
      e.message?.includes('expired') ||
      e.message?.includes('invalid')
    )) {
      throw new AniListSearchError('token_expired', 'AniList token has expired', 'anilist_token_expired');
    }
    // Check for other GraphQL errors
    if (result?.errors?.[0]) {
      throw new AniListSearchError('unknown', result.errors[0].message, 'anilist_search_failed');
    }
    throw new AniListSearchError('network_error', 'Failed to reach AniList', 'anilist_network_error');
  }
  const pageData = result?.data?.Page;
  if (!isRecord(pageData)) {
    // Check if there were errors even though ok was true (edge case)
    if (result?.errors?.length) {
      throw new AniListSearchError('unknown', result.errors[0].message, 'anilist_search_failed');
    }
    return { results: [], hasMore: false };
  }

  // AniList's MANGA type covers both manga and light novels — the 'lnovel'
  // caller filters to format: NOVEL explicitly, but the plain 'manga' caller
  // (no format filter, so it can still find ONE_SHOT/DOUJIN/etc alongside
  // regular manga) never excluded NOVEL, so the same work turned up twice:
  // once correctly under "lnovel", once again mislabeled "manga:{id}".
  // "Unificar temporadas" (Settings > Preferencias) wants search/browse to
  // surface only a chain's basic/first entry, not every season as its own
  // separate hit — so a later season (has its own PREQUEL back to an anime)
  // is dropped here. Off by default, and never applied to manga/lnovel,
  // which has no such per-season splitting to begin with.
  const rows = rowsOf(pageData.media)
    .map(parseAniListMedia)
    .filter((m): m is AniListMedia => m !== null);
  const media = mediaType === 'manga'
    ? rows.filter(m => m.format !== 'NOVEL')
    : mediaType === 'anime' && isUnifySeasonsEnabled()
    ? rows.filter(m => !hasAnimePrequel(m))
    : rows;

  return {
    results: media.map(m => mapAniListMediaToResult(m, mediaType)),
    hasMore: hasNextPageOf(pageData),
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
  // Try to use authenticated token if available (allows access to private lists/high rate limits)
  // Falls back to public search if no token
  const token = getAniListToken();
  const opts = token ? { signal, token } : { signal };

  const [a, b] = await Promise.all([
    graphqlPost<AniListSearchData>(API_ENDPOINTS.ANILIST, query, buildVariables(page * 2 - 1), opts),
    graphqlPost<AniListSearchData>(API_ENDPOINTS.ANILIST, query, buildVariables(page * 2), opts),
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
  const wantsRelations = anilistType === 'ANIME' && isUnifySeasonsEnabled();
  const query = wantsRelations
    ? (format ? SEARCH_QUERY_WITH_FORMAT_ANIME : SEARCH_QUERY_ANIME)
    : (format ? SEARCH_QUERY_WITH_FORMAT : SEARCH_QUERY);
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
  const wantsRelations = anilistType === 'ANIME' && isUnifySeasonsEnabled();
  const query = wantsRelations
    ? (format ? TOP_RATED_QUERY_WITH_FORMAT_ANIME : TOP_RATED_QUERY_ANIME)
    : (format ? TOP_RATED_QUERY_WITH_FORMAT : TOP_RATED_QUERY);
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

function parseAniListCharacterRow(raw: unknown): AniListCharacterSearch | null {
  if (!isRecord(raw) || !isRecord(raw.name)) return null;
  const id = optionalNumber(raw.id);
  const full = optionalString(raw.name.full);
  if (id === null || full === null) return null;
  return {
    id,
    name: {
      full,
      native: optionalString(raw.name.native),
      alternative: Array.isArray(raw.name.alternative) ? stringList(raw.name.alternative) : null,
    },
    image: isRecord(raw.image) ? { large: optionalString(raw.image.large) } : null,
  };
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
  const token = getAniListToken();
  const opts = token ? { signal, token } : { signal };

  const { ok, result } = await graphqlPost<AniListSearchData>(
    API_ENDPOINTS.ANILIST,
    SEARCH_CHARACTERS_QUERY,
    { searchQuery, page },
    opts,
  );

  if (!ok) return { results: [], hasMore: false };
  const pageData = result?.data?.Page;
  if (!isRecord(pageData)) return { results: [], hasMore: false };

  const chars = rowsOf(pageData.characters)
    .map(parseAniListCharacterRow)
    .filter((char): char is AniListCharacterSearch => char !== null);
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
  return { results, hasMore: hasNextPageOf(pageData) };
}

export interface AniListStaffSearchResult {
  id: number;
  name: string;
  nameNative: string | null;
  image: string | null;
}

interface AniListStaffSearchRow {
  id: number;
  name: { full: string; native: string | null };
  image: { large: string | null } | null;
}

function parseAniListStaffRow(raw: unknown): AniListStaffSearchRow | null {
  if (!isRecord(raw) || !isRecord(raw.name)) return null;
  const id = optionalNumber(raw.id);
  const full = optionalString(raw.name.full);
  if (id === null || full === null) return null;
  return {
    id,
    name: { full, native: optionalString(raw.name.native) },
    image: isRecord(raw.image) ? { large: optionalString(raw.image.large) } : null,
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
  const token = getAniListToken();
  const opts = token ? { signal, token } : { signal };

  const { ok, result } = await graphqlPost<AniListSearchData>(
    API_ENDPOINTS.ANILIST,
    SEARCH_STAFF_QUERY,
    { searchQuery, page },
    opts,
  );

  if (!ok) return { results: [], hasMore: false };
  const pageData = result?.data?.Page;
  if (!isRecord(pageData)) return { results: [], hasMore: false };

  const staff = rowsOf(pageData.staff)
    .map(parseAniListStaffRow)
    .filter((s): s is AniListStaffSearchRow => s !== null);
  return {
    results: staff.map(s => ({ id: s.id, name: s.name.full, nameNative: s.name.native, image: s.image?.large ?? null })),
    hasMore: hasNextPageOf(pageData),
  };
}

export async function findAniListStaffExactMatch(
  name: string,
  signal?: AbortSignal,
): Promise<AniListStaffSearchResult | null> {
  const clean = name.trim();
  if (!clean) return null;

  try {
    const { results } = await searchAniListStaff(clean, signal ?? new AbortController().signal);
    if (!results || results.length === 0) return null;

    const lower = clean.toLowerCase();
    const match = results.find(r => {
      const fullLower = (r.name || '').toLowerCase().trim();
      const nativeLower = (r.nameNative || '').toLowerCase().trim();
      return fullLower === lower || nativeLower === lower;
    });

    return match ?? null;
  } catch (err) {
    console.warn('[AniList] Staff exact match search error for:', clean, err);
    return null;
  }
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
      voiceActors?: Array<{
        id: number;
        name: { full: string; native: string | null; userPreferred: string };
        languageV2: string | null;
        image: { large: string | null; medium: string | null } | null;
        siteUrl: string | null;
      }>;
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

// The type:id key consumers use as this appearance's external_id — null for
// an edge whose node is missing either half (skipped, not thrown on).
function characterMediaEdgeKey(edge: unknown): string | null {
  if (!isRecord(edge) || !isRecord(edge.node)) return null;
  const type = optionalString(edge.node.type);
  const mediaId = optionalNumber(edge.node.id);
  return type !== null && mediaId !== null ? `${type.toLowerCase()}:${mediaId}` : null;
}

export async function fetchAniListCharacterDetail(id: number): Promise<AniListCharacterDetail | null> {
  // Page 1 also carries the character's own profile fields, so it has to be
  // fetched (and awaited) on its own before the remaining pages can be fanned
  // out (see fetchRemainingEdges).
  const firstData = await anilistPost<{ Character: AniListCharacterDetailPage }>(DETAIL_CHARACTER_QUERY, { id, mediaPage: 1 });
  const character = firstData?.Character ?? null;
  if (!character) return null;

  // A response whose media connection is missing or malformed is treated as
  // "no appearances" rather than allowed to throw on pageInfo/edges reads.
  const firstMediaPage: AniListCharacterDetailPage['media'] = isRecord(character.media) && Array.isArray(character.media.edges)
    ? character.media
    : { pageInfo: { hasNextPage: false, total: null }, edges: [] };

  const extraEdges = await fetchRemainingEdges(firstMediaPage, 50, page =>
    anilistPost<{ Character: AniListCharacterDetailPage }>(DETAIL_CHARACTER_QUERY, { id, mediaPage: page })
      .then(data => data?.Character?.media ?? null),
  );

  // De-duped by the same type:id key every consumer already uses as this
  // media's external_id — a page-boundary overlap (or AniList itself
  // occasionally returning the same node twice) used to surface as literal
  // duplicate "appearances" entries for every downstream reader
  // (character.astro, CharacterPrEditorModal.tsx).
  const seenMedia = new Set<string>();
  const allEdges = [...firstMediaPage.edges, ...extraEdges].filter(edge => {
    const key = characterMediaEdgeKey(edge);
    if (key === null || seenMedia.has(key)) return false;
    seenMedia.add(key);
    return true;
  });
  character.media = { pageInfo: firstMediaPage.pageInfo, edges: allEdges };
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


