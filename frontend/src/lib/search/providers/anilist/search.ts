import type { MediaType, SearchPage, SearchFilters, SearchResult } from '../../types';
import { isUnifySeasonsEnabled } from '../../../storage/preferences';
import { aniListAdultVariable } from '../../exclusion-filters';
import { API_ENDPOINTS } from '../../../api/endpoints';
import { graphqlPost } from '../../../api/client';
import { isRecord, rowsOf, hasNextPageOf } from './json-guards';
import { searchRequestOptions } from './client';
import {
  SEARCH_QUERY, SEARCH_QUERY_WITH_FORMAT, SEARCH_QUERY_ANIME, SEARCH_QUERY_WITH_FORMAT_ANIME,
  TOP_RATED_QUERY, TOP_RATED_QUERY_WITH_FORMAT, TOP_RATED_QUERY_ANIME, TOP_RATED_QUERY_WITH_FORMAT_ANIME,
  SEARCH_CHARACTERS_QUERY, SEARCH_STAFF_QUERY,
} from './queries';
import {
  dateRangeFromFilters, toSearchPage, parseAniListCharacterRow, parseAniListStaffRow, mapAniListCharacterToResult,
} from './mappers';
import type { AniListSearchData, AniListCharacterSearch, AniListStaffSearchRow, AniListStaffSearchResult } from './types';

// AniList's own fixed genre list (GenreCollection) — stable for years, not
// worth a dedicated request to re-fetch on every mount just for a filter's
// checkbox list.
export const ANILIST_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Hentai',
  'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological',
  'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
];

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
  const opts = searchRequestOptions(signal);
  const fetchBoth = (o: typeof opts) => Promise.all([
    graphqlPost<AniListSearchData>(API_ENDPOINTS.ANILIST, query, buildVariables(page * 2 - 1), o),
    graphqlPost<AniListSearchData>(API_ENDPOINTS.ANILIST, query, buildVariables(page * 2), o),
  ]);

  let [a, b] = await fetchBoth(opts);
  // Search only reads public data: an expired or revoked AniList token
  // ("Invalid token", HTTP 400) must not blank it — retry anonymously.
  if (opts.token && [a, b].some(r => isRejectedToken(r.status, r.result))) {
    [a, b] = await fetchBoth({ signal });
  }
  const pageA = toSearchPage(a.ok, a.result, mediaType);
  const pageB = toSearchPage(b.ok, b.result, mediaType);
  return {
    results: [...pageA.results, ...pageB.results],
    hasMore: pageB.results.length > 0 ? pageB.hasMore : pageA.hasMore,
  };
}

/** AniList's answer to an expired/revoked/garbage bearer token. */
export function isRejectedToken(status: number, result: { errors?: { message?: string }[] } | null): boolean {
  if (status !== 400 && status !== 401) return false;
  return !!result?.errors?.some(e => /invalid token|unauthori[sz]ed|expired/i.test(e.message ?? ''));
}

/** One search request with the user's token, retried anonymously when
 *  AniList rejects that token (search only needs public data). */
async function postSearch<T>(query: string, variables: Record<string, unknown>, signal: AbortSignal) {
  const opts = searchRequestOptions(signal);
  const first = await graphqlPost<T>(API_ENDPOINTS.ANILIST, query, variables, opts);
  if (!opts.token || !isRejectedToken(first.status, first.result)) return first;
  return graphqlPost<T>(API_ENDPOINTS.ANILIST, query, variables, { signal });
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
  // isAdult: false. When enabled, omit the variable entirely (undefined, not
  // null — AniList matches nothing for an explicit null) so both adult and
  // non-adult results are returned.
  const isAdult = aniListAdultVariable();
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
  const isAdult = aniListAdultVariable();
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

export async function searchAniListCharacters(
  searchQuery: string,
  signal: AbortSignal,
  page = 1,
): Promise<SearchPage> {
  const { ok, result } = await postSearch<AniListSearchData>(SEARCH_CHARACTERS_QUERY, { searchQuery, page }, signal);

  if (!ok) return { results: [], hasMore: false };
  const pageData = result?.data?.Page;
  if (!isRecord(pageData)) return { results: [], hasMore: false };

  const chars = rowsOf(pageData.characters)
    .map(parseAniListCharacterRow)
    .filter((char): char is AniListCharacterSearch => char !== null);
  const results: SearchResult[] = chars.map(mapAniListCharacterToResult);
  return { results, hasMore: hasNextPageOf(pageData) };
}

// Voice actor picker (CharacterPrEditorModal) — AniList models a voice actor
// as Staff, same entity type as a work's director/writer/composer, just
// linked via Character.media.edges[].voiceActors instead of Media.staff.
export async function searchAniListStaff(
  searchQuery: string,
  signal: AbortSignal,
  page = 1,
): Promise<{ results: AniListStaffSearchResult[]; hasMore: boolean }> {
  const { ok, result } = await postSearch<AniListSearchData>(SEARCH_STAFF_QUERY, { searchQuery, page }, signal);

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
