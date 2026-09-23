import { searchAniList, searchAniListCharacters, searchAniListStaff, topRatedAniList } from './providers/anilist';
import { searchGames, searchGameBundles, searchGameExpandedEditions, searchGameRemasters } from './providers/igdb';
import { searchMovies, searchSeries, topRatedMovies, topRatedSeries }  from './providers/tmdb';
import { searchBooks }                 from './providers/openlibrary';
import { searchComics, searchComicVineCharacters } from './providers/comicvine';
import { searchApiSportsEvents, type ApiSportsDiscipline } from './providers/apisports';
import { MissingApiKeyError }          from './errors';
import { searchCatalog, type MediaCatalogEntry, type DbMediaRelation } from '../tauri/catalog';
import { localCatalogVerdict, readBlockedIds, readReclassifiedIds, reclassifiableIds, withoutIds } from './exclusion-filters';
import { parseCSV } from '../shared/text/string-utils';
import { dedupeByExternalId } from '../shared/collections/dedupe';
import { searchCharactersDb, type CharacterEntry } from '../tauri/characters';
import { getCustomImagesMap, wrapAssetUrl, getMediaRelations } from '../tauri';
import { isAdultContentEnabled, isUnifySeasonsEnabled } from '../storage/preferences';
import { isMediaTypeDisabled } from '../media/media-types';
import { SearchMemo, SEARCH_MEMO_TTL_MS, SEARCH_MEMO_MAX_ENTRIES } from './search-memo';

export { MissingApiKeyError };
export { searchGameBundles, searchGameExpandedEditions, searchGameRemasters };

export type { MediaType, SearchResult, SeasonId, SearchFilters, SearchPage } from './types';
export { SEASON_MONTHS } from './types';
import type { MediaType, SearchResult, SearchFilters, SearchPage } from './types';

// Every type folded into the "all" tab — deliberately excludes 'character',
// which stays its own dedicated tab/result shape.
const ALL_SEARCH_TYPES: Exclude<MediaType, 'all'>[] = [
  'anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book', 'comic', 'event',
];

// Only the external (provider) half of a search is memoised — the local
// catalog half is re-read every time (it's one cheap IPC call, and a row the
// user just added must show up immediately). The key carries every input
// that changes what a provider returns, including the two preferences the
// providers read on their own (adult filter, unified seasons), so toggling
// either in Settings never serves a page fetched under the other setting.
export const externalSearchMemo = new SearchMemo<SearchPage>({ ttlMs: SEARCH_MEMO_TTL_MS, maxEntries: SEARCH_MEMO_MAX_ENTRIES });

function externalSearchKey(
  mediaType: Exclude<MediaType, 'all'>,
  searchQuery: string,
  page: number,
  eventDiscipline?: ApiSportsDiscipline | null,
): string {
  const prefs = `${isAdultContentEnabled() ? 'adult' : 'safe'}:${isUnifySeasonsEnabled() ? 'unified' : 'seasons'}`;
  return `${mediaType}:${page}:${eventDiscipline ?? ''}:${prefs}:${searchQuery.trim().toLowerCase()}`;
}

// A memo hit (or a shared in-flight page) is handed out as a fresh copy —
// searchCharacters rewrites externalId/coverUrl on the rows it merges, and
// no caller should ever see another caller's edits.
function clonePage(page: SearchPage): SearchPage {
  return { results: page.results.map(r => ({ ...r })), hasMore: page.hasMore };
}

function memoExternal(key: string, run: (signal: AbortSignal) => Promise<SearchPage>, signal: AbortSignal): Promise<SearchPage> {
  return externalSearchMemo.fetch(key, run, signal).then(clonePage);
}

function fetchFromApi(
  mediaType: Exclude<MediaType, 'all'>,
  searchQuery: string,
  signal: AbortSignal,
  page: number,
  eventDiscipline?: ApiSportsDiscipline | null,
): Promise<SearchPage> {
  // Characters merge a local DB read and the user's custom images on top of
  // two providers — only those two are memoised (inside searchCharacters).
  if (mediaType === 'character') return fetchFromApiUncached(mediaType, searchQuery, signal, page, eventDiscipline);
  return memoExternal(
    externalSearchKey(mediaType, searchQuery, page, eventDiscipline),
    memoSignal => fetchFromApiUncached(mediaType, searchQuery, memoSignal, page, eventDiscipline),
    signal,
  );
}

function fetchFromApiUncached(
  mediaType: Exclude<MediaType, 'all'>,
  searchQuery: string,
  signal: AbortSignal,
  page: number,
  eventDiscipline?: ApiSportsDiscipline | null,
): Promise<SearchPage> {
  switch (mediaType) {
    case 'anime':     return searchAniList(searchQuery, 'ANIME', 'anime', signal, undefined, page);
    case 'manga':     return searchAniList(searchQuery, 'MANGA', 'manga', signal, undefined, page);
    case 'lnovel':    return searchAniList(searchQuery, 'MANGA', 'lnovel', signal, 'NOVEL', page);
    case 'game':      return searchGames(searchQuery, 'game', signal, page);
    case 'vnovel':    return searchGames(searchQuery, 'vnovel', signal, page);
    case 'movie':     return searchMovies(searchQuery, signal, page);
    case 'series':    return searchSeries(searchQuery, signal, page);
    case 'book':      return searchBooks(searchQuery, signal, page);
    case 'comic':     return searchComics(searchQuery, signal, page);
    case 'event':     return searchApiSportsEvents(searchQuery, signal, page, eventDiscipline);
    case 'character': return searchCharacters(searchQuery, signal, page);
    case 'staff':     return searchStaff(searchQuery, signal, page);
    default:          return Promise.resolve({ results: [], hasMore: false });
  }
}

// AniList staff only — no other provider has an equivalent searchable
// entity. Reuses the same person:a<id> id scheme quick search's staff
// results already link to (see QuickSearchOverlay.tsx), which the existing
// /author page already resolves via fetchAniListStaffDetail.
async function searchStaff(searchQuery: string, signal: AbortSignal, page: number): Promise<SearchPage> {
  const { results, hasMore } = await searchAniListStaff(searchQuery, signal, page);
  return {
    results: results.map(s => ({
      externalId: `person:a${s.id}`,
      type: 'staff' as MediaType,
      format: '',
      source: 'anilist' as const,
      titleMain: s.name,
      titleRomaji: null,
      titleNative: s.nameNative,
      coverUrl: s.image,
      releaseYear: null,
      releaseMonth: null,
      releaseDay: null,
      scoreGlobal: null,
      genres: [],
    })),
    hasMore,
  };
}

function inferCharacterSource(externalId: string): SearchResult['source'] {
  if (externalId.startsWith('character:co:') || externalId.startsWith('character:comicvine:')) return 'comicvine';
  if (externalId.startsWith('character:ms:') || externalId.startsWith('character:tmdb:')) return 'tmdb';
  return 'anilist';
}

function canonicalizeCharacterId(externalId: string): string {
  if (/^character:\d+$/.test(externalId)) {
    return `character:a:${externalId.slice('character:'.length)}`;
  }
  if (externalId.startsWith('character:comicvine:')) {
    return `character:co:${externalId.slice('character:comicvine:'.length)}`;
  }
  if (externalId.startsWith('character:tmdb:')) {
    return `character:ms:${externalId.slice('character:tmdb:'.length)}`;
  }
  return externalId;
}

function characterEntryToSearchResult(entry: CharacterEntry): SearchResult {
  const externalId = canonicalizeCharacterId(entry.external_id);
  return {
    externalId,
    type: 'character',
    format: '',
    source: inferCharacterSource(externalId),
    titleMain: entry.name,
    titleRomaji: null,
    titleNative: entry.name_native ?? null,
    coverUrl: entry.image_url ?? null,
    releaseYear: entry.dob_year ?? null,
    releaseMonth: entry.dob_month ?? null,
    releaseDay: entry.dob_day ?? null,
    scoreGlobal: null,
    genres: [],
  };
}

async function searchCharacters(searchQuery: string, signal: AbortSignal, page: number): Promise<SearchPage> {
  const emptyPage = (): SearchPage => ({ results: [], hasMore: false });
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const [anilistPage, comicvinePage, localEntries] = await Promise.all([
    memoExternal(`character:anilist:${page}:${normalizedQuery}`, s => searchAniListCharacters(searchQuery, s, page), signal).catch(emptyPage),
    memoExternal(`character:comicvine:${page}:${normalizedQuery}`, s => searchComicVineCharacters(searchQuery, s, page), signal).catch(emptyPage),
    page === 1 ? searchCharactersDb(searchQuery).catch(() => [] as CharacterEntry[]) : Promise.resolve([] as CharacterEntry[]),
  ]);

  const localResults: SearchResult[] = localEntries.map(characterEntryToSearchResult);
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  for (const r of localResults) {
    if (!seen.has(r.externalId)) {
      seen.add(r.externalId);
      merged.push(r);
    }
  }

  for (const r of [...anilistPage.results, ...comicvinePage.results]) {
    r.externalId = canonicalizeCharacterId(r.externalId);
    const existing = merged.find(m => m.externalId === r.externalId);
    if (existing) {
      if (!existing.coverUrl && r.coverUrl) {
        existing.coverUrl = r.coverUrl;
      }
    } else if (!seen.has(r.externalId)) {
      seen.add(r.externalId);
      merged.push(r);
    }
  }

  const customMap = await getCustomImagesMap().catch(() => null);
  if (customMap && customMap.size > 0) {
    for (const item of merged) {
      const custom = customMap.get(item.externalId);
      if (custom) {
        item.coverUrl = wrapAssetUrl(custom.image_url);
      }
    }
  }

  return {
    results: merged,
    hasMore: anilistPage.hasMore || comicvinePage.hasMore,
  };
}

function catalogEntryToSearchResult(entry: MediaCatalogEntry): SearchResult {
  return {
    externalId: entry.external_id,
    type: entry.type as MediaType,
    format: entry.format || '',
    source: (entry.source as SearchResult['source']) || 'igdb',
    titleMain: entry.title_main || entry.external_id,
    titleRomaji: entry.title_romaji ?? null,
    titleNative: entry.title_native ?? null,
    coverUrl: entry.cover_url ?? null,
    releaseYear: entry.release_year ?? null,
    releaseMonth: entry.release_month ?? null,
    releaseDay: entry.release_day ?? null,
    scoreGlobal: entry.score_global ?? null,
    genres: parseCSV(entry.genres_csv),
  };
}

// True when this local anime already has its own PREQUEL edge in
// media_relations — same "later season" test toSearchPage's
// hasAnimePrequel runs against a live AniList result, just reading the
// local relation graph instead of a fetched `relations` field.
async function hasLocalAnimePrequel(externalId: string): Promise<boolean> {
  const rels = await getMediaRelations(externalId).catch(() => [] as DbMediaRelation[]);
  return rels.some(r => r.relation_type === 'PREQUEL' && r.related_media_external_id.startsWith('anime:'));
}

// Local catalog entries the live API doesn't surface (IGDB's normal search
// filters out titles missing a cover or with an unusual category — see
// AdminAddSearch's unfiltered search, used precisely to find and add those)
// still deserve to be findable afterward through the regular search, once
// they're already in the local catalog. Not paginated — only checked on
// page 1, merged in without overriding an API hit for the same id (the live
// result is generally fresher/richer).
//
// `catalogEntries` is the one search_catalog read shared by every type of an
// "all" search (it isn't type-filtered on the Rust side, so the ten per-type
// calls this used to make all returned the same rows).
async function searchLocalCatalog(
  catalogEntries: Promise<MediaCatalogEntry[]>,
  mediaType: Exclude<MediaType, 'all' | 'character' | 'staff'>,
): Promise<SearchResult[]> {
  const entries = await catalogEntries;
  const filtered = entries
    .filter(e => e.type === mediaType)
    // Guards against stray rows whose external_id doesn't actually start
    // with "{type}:" (e.g. saved with a malformed id by an older, since-
    // fixed write path) — those would otherwise surface here with a broken
    // id that can't resolve to anything when picked.
    .filter(e => e.external_id.startsWith(`${e.type}:`))
    // Excluded formats and "... Edition" games (lib/search/exclusion-filters.ts).
    .filter(e => localCatalogVerdict({ type: mediaType, format: e.format, title: e.title_main }) === 'keep');

  // "Unificar temporadas" hides later seasons from the live AniList path
  // (see toSearchPage's hasAnimePrequel) — without this, any season already
  // saved to the local catalog (browsing it once persists it) would keep
  // reappearing here, since this local-only path never went through that
  // live-fetched `relations` field at all.
  if (mediaType !== 'anime' || !isUnifySeasonsEnabled()) {
    return filtered.map(catalogEntryToSearchResult);
  }
  const hasPrequelFlags = await Promise.all(filtered.map(e => hasLocalAnimePrequel(e.external_id)));
  return filtered.filter((_, i) => !hasPrequelFlags[i]).map(catalogEntryToSearchResult);
}

function apiSportsCompetitionKey(result: SearchResult): string | null {
  const match = /^event:apisports:(football|basketball):(\d+)(?::|$)/.exec(result.externalId);
  return match ? `${match[1]}:${match[2]}` : null;
}

function competitionTitle(title: string): string {
  return title.replace(/\s+-\s+(?:\d{4}(?:[-/]\d{2,4})?|\d{2,4}[-/]\d{2,4})$/, '').trim();
}

// Search results are a view over leagues and their seasons, not new user-list
// records. With unified seasons enabled the provider already returns a league
// container; collapse any locally catalogued sibling seasons into that same
// container too.
function mergeUnifiedEventResults(apiResults: SearchResult[], localResults: SearchResult[], hasMore: boolean): SearchPage {
  const apiLeagueKeys = new Set(apiResults.map(apiSportsCompetitionKey).filter((key): key is string => !!key));
  const apiIds = new Set(apiResults.map(result => result.externalId));
  const localGroups = new Map<string, SearchResult[]>();
  const localExtras: SearchResult[] = [];

  for (const result of localResults) {
    const key = apiSportsCompetitionKey(result);
    if (!key) {
      if (!apiIds.has(result.externalId)) localExtras.push(result);
      continue;
    }
    const group = localGroups.get(key) ?? [];
    group.push(result);
    localGroups.set(key, group);
  }

  const localCompetitions = [...localGroups.entries()]
    .filter(([key]) => !apiLeagueKeys.has(key))
    .map(([, seasons]) => {
      const representative = [...seasons].sort((a, b) => (b.releaseYear ?? -Infinity) - (a.releaseYear ?? -Infinity))[0];
      const key = apiSportsCompetitionKey(representative)!;
      const [sport, leagueId] = key.split(':');
      return {
        ...representative,
        externalId: `event:apisports:${sport}:${leagueId}`,
        format: 'Season',
        titleMain: competitionTitle(representative.titleMain),
        releaseYear: null,
        releaseMonth: null,
        releaseDay: null,
      };
    });

  return { results: [...apiResults, ...localExtras, ...localCompetitions], hasMore };
}

// Local-catalog rows as they'd appear in the final page (already blocked-
// filtered by search_catalog itself), handed to the caller as soon as the
// local read settles — typically well before the providers answer — so the
// grid can show them right away. The final page still lists them after the
// provider hits exactly as before; the UI sorts by date/score, so what's
// already on screen keeps its place as the rest merges in.
function localPreview(
  mediaType: Exclude<MediaType, 'all' | 'character' | 'staff'>,
  localResults: SearchResult[],
): SearchResult[] {
  if (mediaType === 'event' && isUnifySeasonsEnabled()) {
    return mergeUnifiedEventResults([], localResults, false).results;
  }
  return localResults;
}

async function searchOne(
  mediaType: Exclude<MediaType, 'all'>,
  searchQuery: string,
  signal: AbortSignal,
  page: number,
  eventDiscipline: ApiSportsDiscipline | null | undefined,
  catalogEntries: Promise<MediaCatalogEntry[]> | null,
  onLocalResults?: (results: SearchResult[]) => void,
): Promise<SearchPage> {
  const apiPromise = fetchFromApi(mediaType, searchQuery, signal, page, eventDiscipline);
  if (mediaType === 'character' || mediaType === 'staff' || page !== 1) return apiPromise;

  const localPromise = searchLocalCatalog(
    catalogEntries ?? searchCatalog(searchQuery).catch(() => [] as MediaCatalogEntry[]),
    mediaType,
  );
  if (onLocalResults) {
    localPromise.then(local => {
      if (signal.aborted || local.length === 0) return;
      onLocalResults(localPreview(mediaType, local));
    }, () => {});
  }

  const [apiOutcome, localResults] = await Promise.all([
    apiPromise.then(p => ({ ok: true as const, page: p })).catch(err => ({ ok: false as const, err })),
    localPromise,
  ]);

  if (!apiOutcome.ok) {
    // Preserve existing error surfacing (e.g. MissingApiKeyError prompts the
    // user to add an API key) when there's nothing else to show — but a
    // local-only hit is still a valid result even if the live provider
    // couldn't be reached.
    if (localResults.length === 0) throw apiOutcome.err;
    if (mediaType === 'event' && isUnifySeasonsEnabled()) {
      return mergeUnifiedEventResults([], localResults, false);
    }
    return { results: localResults, hasMore: false };
  }

  if (mediaType === 'event' && isUnifySeasonsEnabled()) {
    return mergeUnifiedEventResults(apiOutcome.page.results, localResults, apiOutcome.page.hasMore);
  }

  const seen = new Set(apiOutcome.page.results.map(r => r.externalId));
  const extraLocal = localResults.filter(r => !seen.has(r.externalId));
  return { results: [...apiOutcome.page.results, ...extraLocal], hasMore: apiOutcome.page.hasMore };
}

// Fans out to every provider in parallel and merges what comes back. A
// provider missing its API key (IGDB, TMDB) rejects with MissingApiKeyError
// instead of silently contributing zero results — that's swallowed here as
// long as *something* else came back, and only surfaced (as a combined
// MissingApiKeyError) when literally nothing did, so the UI can tell "no
// matches" apart from "can't search these types at all yet".
async function searchAll(
  searchQuery: string,
  signal: AbortSignal,
  page: number,
  onLocalResults?: (results: SearchResult[]) => void,
): Promise<SearchPage> {
  const catalogEntries = page === 1 ? searchCatalog(searchQuery).catch(() => [] as MediaCatalogEntry[]) : null;
  const settled = await Promise.allSettled(
    ALL_SEARCH_TYPES
      .filter(type => !isMediaTypeDisabled(type))
      .map(type => searchOne(type, searchQuery, signal, page, undefined, catalogEntries, onLocalResults)),
  );

  const results: SearchResult[] = [];
  let hasMore = false;
  const missingKeyProviders = new Set<string>();
  let sawOtherError = false;

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value.results);
      hasMore = hasMore || outcome.value.hasMore;
      continue;
    }
    const reason = outcome.reason;
    if (reason instanceof MissingApiKeyError) {
      reason.providers.forEach(p => missingKeyProviders.add(p));
    } else if (reason instanceof Error && reason.name === 'AbortError') {
      // The whole search was cancelled (new query/type) — propagate
      // immediately instead of reporting a misleading "missing keys" or
      // "generic error" state for a request nobody cares about anymore.
      throw reason;
    } else {
      sawOtherError = true;
    }
  }

  if (results.length === 0 && missingKeyProviders.size > 0 && !sawOtherError) {
    throw new MissingApiKeyError([...missingKeyProviders]);
  }

  return { results: dedupeByExternalId(results), hasMore };
}

// Blocked entries (lib/search/exclusion-filters.ts readBlockedIds).
async function filterBlocked(page: SearchPage): Promise<SearchPage> {
  const blocked = await readBlockedIds();
  if (blocked.size === 0) return page;
  return { ...page, results: withoutIds(page.results, r => r.externalId, blocked) };
}

// game/vnovel are the only two types sharing an id space here (the same
// IGDB numeric id, just filed under whichever of the two this app's own
// catalog considers it to be) — a work reclassified from one to the other
// locally doesn't need an explicit block to stop showing under its old
// type: the live API (which has no idea we split IGDB's games into two
// buckets) still happily returns it there, but the local catalog already
// filing it under the other type is signal enough on its own.
async function filterReclassified(page: SearchPage): Promise<SearchPage> {
  const candidateIds = reclassifiableIds(page.results, r => r.type, r => r.externalId);
  if (candidateIds.length === 0) return page;
  const reclassified = await readReclassifiedIds(candidateIds);
  if (reclassified.size === 0) return page;
  return { ...page, results: withoutIds(page.results, r => r.externalId, reclassified) };
}

export interface SearchOptions {
  /** Called (possibly once per type on an "all" search) with the local
   *  catalog rows matching the query as soon as they're read, before any
   *  provider has answered. Never called after the returned page settles,
   *  nor after `signal` aborts. Page 1 only. */
  onLocalResults?: (results: SearchResult[]) => void;
}

export async function search(
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
  page = 1,
  eventDiscipline?: ApiSportsDiscipline | null,
  options: SearchOptions = {},
): Promise<SearchPage> {
  const page_ = mediaType === 'all'
    ? await searchAll(searchQuery, signal, page, options.onLocalResults)
    : await searchOne(mediaType, searchQuery, signal, page, eventDiscipline, null, options.onLocalResults);
  if (mediaType === 'character' || mediaType === 'staff') return page_;
  return filterReclassified(await filterBlocked(page_));
}

export async function searchAnimeAndSeries(
  searchQuery: string,
  mediaType: 'all' | 'anime' | 'series',
  signal: AbortSignal,
  limit = 60,
): Promise<SearchResult[]> {
  const searchType = async (type: 'anime' | 'series') =>
    search(searchQuery, type, signal)
      .then(page => page.results)
      .catch(() => [] as SearchResult[]);

  if (mediaType === 'anime' || mediaType === 'series') {
    return (await searchType(mediaType)).slice(0, limit);
  }

  const [animeResults, seriesResults] = await Promise.all([
    searchType('anime'),
    searchType('series'),
  ]);
  return [...seriesResults, ...animeResults].slice(0, limit);
}

function fetchTopRatedFromApi(
  mediaType: Exclude<MediaType, 'all' | 'character' | 'staff' | 'book' | 'comic'>,
  signal: AbortSignal,
  page: number,
  filters?: SearchFilters,
): Promise<SearchPage> {
  switch (mediaType) {
    case 'anime':  return topRatedAniList('ANIME', 'anime', signal, undefined, page, filters);
    case 'manga':  return topRatedAniList('MANGA', 'manga', signal, undefined, page, filters);
    case 'lnovel': return topRatedAniList('MANGA', 'lnovel', signal, 'NOVEL', page, filters);
    // IGDB's own search command already treats an empty query as "browse,
    // sorted by rating" (see igdb.rs) — no separate function needed.
    case 'game':   return searchGames('', 'game', signal, page, filters);
    case 'vnovel': return searchGames('', 'vnovel', signal, page, filters);
    case 'movie':  return topRatedMovies(signal, page, filters);
    case 'series': return topRatedSeries(signal, page, filters);
    case 'event':  return Promise.resolve({ results: [], hasMore: false });
  }
}

// No text query — a type tab shows its top 50 by rating instead of
// staying blank until you type. Books and Comics have no such browse mode
// in their own APIs (OpenLibrary rejects anything under 3 real characters
// outright, even a wildcard; Comic Vine's /search/ endpoint is relevance-
// only with no sort option) — those two, plus 'all' and 'character', just
// return empty here and keep the existing empty-until-typed behavior.
export async function topRated(mediaType: MediaType, signal: AbortSignal, page = 1, filters?: SearchFilters): Promise<SearchPage> {
  if (mediaType === 'all' || mediaType === 'character' || mediaType === 'staff' || mediaType === 'book' || mediaType === 'comic' || mediaType === 'event') {
    return { results: [], hasMore: false };
  }
  return filterReclassified(await filterBlocked(await fetchTopRatedFromApi(mediaType, signal, page, filters)));
}
