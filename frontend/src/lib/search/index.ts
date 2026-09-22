import { searchAniList, searchAniListCharacters, searchAniListStaff, topRatedAniList } from './providers/anilist';
import { searchGames, searchGameBundles, searchGameExpandedEditions, searchGameRemasters } from './providers/igdb';
import { searchMovies, searchSeries, topRatedMovies, topRatedSeries }  from './providers/tmdb';
import { searchBooks }                 from './providers/openlibrary';
import { searchComics, searchComicVineCharacters } from './providers/comicvine';
import { searchApiSportsEvents, type ApiSportsDiscipline } from './providers/apisports';
import { MissingApiKeyError }          from './errors';
import { searchCatalog, getBlockedExternalIds, getReclassifiedExternalIds, type MediaCatalogEntry, type DbMediaRelation } from '../tauri/catalog';
import { parseCSV } from '../shared/string-utils';
import { dedupeByExternalId } from '../shared/dedupe';
import { searchCharactersDb, type CharacterEntry } from '../tauri/characters';
import { getCustomImagesMap, wrapAssetUrl, getMediaRelations, type FavoriteCustomImage } from '../tauri';
import { isUnifySeasonsEnabled } from '../settings/preferences';

export { MissingApiKeyError };
export { searchGameBundles, searchGameExpandedEditions, searchGameRemasters };

export type MediaType =
  | 'all' | 'anime' | 'manga' | 'lnovel' | 'game'
  | 'vnovel'  | 'movie' | 'series' | 'book' | 'comic' | 'event' | 'character' | 'staff';

/**
 * Subset of media_catalog columns available from search APIs.
 * Field names match the DB schema (camelCase mapping of snake_case columns).
 */
export interface SearchResult {
  /** Matches media_catalog.external_id — e.g. "anime:918" */
  externalId: string;
  /** Matches media_catalog.type */
  type: MediaType;
  /** Matches media_catalog.format — e.g. "TV", "OVA", "MANGA" */
  format: string;
  /** Matches media_catalog.source — which API provided this result */
  source: 'anilist' | 'igdb' | 'tmdb' | 'openlibrary' | 'comicvine' | 'apisports';
  /** Matches media_catalog.title_main — primary display title */
  titleMain: string;
  /** Matches media_catalog.title_romaji — romanised title (AniList only) */
  titleRomaji: string | null;
  /** Matches media_catalog.title_native — original script title (AniList only) */
  titleNative: string | null;
  /** Matches media_catalog.cover_url */
  coverUrl: string | null;
  /** Matches media_catalog.release_year */
  releaseYear: number | null;
  /** Matches media_catalog.release_month */
  releaseMonth: number | null;
  /** Matches media_catalog.release_day */
  releaseDay: number | null;
  /** Matches media_catalog.score_global — normalised to 0–10 */
  scoreGlobal: number | null;
  /** Author names — populated by OpenLibrary search, null for other providers */
  authorNames?: string[] | null;
  /** First author key e.g. "/authors/OL26320A" — OpenLibrary only */
  authorKey?: string | null;
  /** Genre names, when the provider's own search response already carries
   *  them at no extra request cost (AniList, IGDB, TMDB). Open Library and
   *  Comic Vine's search endpoints don't expose genre data, so this is
   *  always empty for book/comic results. */
  genres: string[];
}

// A "season" is a calendar quarter (3 months) — Winter/Spring/Summer/Fall,
// same grouping anime seasons already use, just applied uniformly across
// every media type via release month/year instead of being anime-specific.
export type SeasonId = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
export const SEASON_MONTHS: Record<SeasonId, [number, number]> = {
  WINTER: [1, 3],
  SPRING: [4, 6],
  SUMMER: [7, 9],
  FALL: [10, 12],
};

// Real server-side narrowing (a fresh 100-result page matching these
// criteria), not a client-side filter over whatever page was already
// fetched — season only takes effect together with a year (a season alone
// has no fixed year to anchor a date range to).
export interface SearchFilters {
  year?: number;
  season?: SeasonId;
  genres?: string[];
}

// One page of search results, capped at ~50 per provider (see each
// provider's own file) so a single search never has to wait on an unbounded
// "fetch every page until exhausted" loop before showing anything — that
// used to be the main reason results took so long to appear (IGDB and
// OpenLibrary both did this). `hasMore` tells the UI whether a "Load more"
// click is worth showing.
export interface SearchPage {
  results: SearchResult[];
  hasMore: boolean;
}

// Every type folded into the "all" tab — deliberately excludes 'character',
// which stays its own dedicated tab/result shape.
const ALL_SEARCH_TYPES: Exclude<MediaType, 'all'>[] = [
  'anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book', 'comic', 'event',
];

function fetchFromApi(
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
  const [anilistPage, comicvinePage, localEntries] = await Promise.all([
    searchAniListCharacters(searchQuery, signal, page).catch(() => ({ results: [], hasMore: false } as SearchPage)),
    searchComicVineCharacters(searchQuery, signal, page).catch(() => ({ results: [], hasMore: false } as SearchPage)),
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

// Same "not its own search hit" formats igdb_search excludes on the live
// side (Rust, igdb.rs) — a local catalog row can carry one of these (e.g.
// synced from the community catalog, or fetched before format tracking
// existed) and without this it'd not-so-quietly reappear here even though
// the live path was specifically made to hide it.
const EXCLUDED_LOCAL_FORMATS = new Set(['REMASTER', 'EXPANDED_GAME', 'UPDATE', 'DLC', 'MOD', 'PORT', 'FORK', 'BUNDLE']);

// Whole-word match only — mirrors name_has_edition_word in igdb.rs (same
// word list) so "Expedition 33" isn't caught by a plain "edition" substring
// check. Catches a locally-cataloged remaster/expanded-edition/DLC whose own
// `format` column is missing or wrong (e.g. an old import from before format
// tracking existed) — EXCLUDED_LOCAL_FORMATS above only helps when that
// column is actually correct.
const NON_GAME_NAME_WORDS = ['edition', 'remaster', 'remastered', 'dlc'];
function titleHasEditionWord(title: string): boolean {
  return title.split(/[^a-zA-Z0-9]+/).some(tok => NON_GAME_NAME_WORDS.includes(tok.toLowerCase()));
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
async function searchLocalCatalog(searchQuery: string, mediaType: Exclude<MediaType, 'all' | 'character' | 'staff'>): Promise<SearchResult[]> {
  const entries = await searchCatalog(searchQuery).catch(() => [] as MediaCatalogEntry[]);
  const filtered = entries
    .filter(e => e.type === mediaType)
    // Guards against stray rows whose external_id doesn't actually start
    // with "{type}:" (e.g. saved with a malformed id by an older, since-
    // fixed write path) — those would otherwise surface here with a broken
    // id that can't resolve to anything when picked.
    .filter(e => e.external_id.startsWith(`${e.type}:`))
    .filter(e => !e.format || !EXCLUDED_LOCAL_FORMATS.has(e.format))
    .filter(e => (mediaType !== 'game' && mediaType !== 'vnovel') || !titleHasEditionWord(e.title_main || ''));

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

async function searchOne(
  mediaType: Exclude<MediaType, 'all'>,
  searchQuery: string,
  signal: AbortSignal,
  page: number,
  eventDiscipline?: ApiSportsDiscipline | null,
): Promise<SearchPage> {
  const apiPromise = fetchFromApi(mediaType, searchQuery, signal, page, eventDiscipline);
  if (mediaType === 'character' || mediaType === 'staff' || page !== 1) return apiPromise;

  const [apiOutcome, localResults] = await Promise.all([
    apiPromise.then(p => ({ ok: true as const, page: p })).catch(err => ({ ok: false as const, err })),
    searchLocalCatalog(searchQuery, mediaType),
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
async function searchAll(searchQuery: string, signal: AbortSignal, page: number): Promise<SearchPage> {
  const settled = await Promise.allSettled(
    ALL_SEARCH_TYPES.map(type => searchOne(type, searchQuery, signal, page)),
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

// search_catalog (Rust) already excludes blocked_at rows for the local-
// catalog half of a result — but a live API hit for that same title has no
// idea it was blocked locally, so it'd still show up on its own.
async function filterBlocked(page: SearchPage): Promise<SearchPage> {
  const blocked = await getBlockedExternalIds().catch(() => [] as string[]);
  if (blocked.length === 0) return page;
  const blockedSet = new Set(blocked);
  return { ...page, results: page.results.filter(r => !blockedSet.has(r.externalId)) };
}

// game/vnovel are the only two types sharing an id space here (the same
// IGDB numeric id, just filed under whichever of the two this app's own
// catalog considers it to be) — a work reclassified from one to the other
// locally doesn't need an explicit block to stop showing under its old
// type: the live API (which has no idea we split IGDB's games into two
// buckets) still happily returns it there, but the local catalog already
// filing it under the other type is signal enough on its own.
async function filterReclassified(page: SearchPage): Promise<SearchPage> {
  const candidateIds = page.results
    .filter(r => r.type === 'game' || r.type === 'vnovel')
    .map(r => r.externalId);
  if (candidateIds.length === 0) return page;
  const reclassified = await getReclassifiedExternalIds(candidateIds).catch(() => [] as string[]);
  if (reclassified.length === 0) return page;
  const reclassifiedSet = new Set(reclassified);
  return { ...page, results: page.results.filter(r => !reclassifiedSet.has(r.externalId)) };
}

export async function search(
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
  page = 1,
  eventDiscipline?: ApiSportsDiscipline | null,
): Promise<SearchPage> {
  const page_ = mediaType === 'all'
    ? await searchAll(searchQuery, signal, page)
    : await searchOne(mediaType, searchQuery, signal, page, eventDiscipline);
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
