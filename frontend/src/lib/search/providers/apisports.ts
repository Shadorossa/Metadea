import { readEnvConfig } from '../../tauri/env';
import { API_ENDPOINTS } from '../../api/endpoints';
import { fetchJson } from '../../api/client';
import { MissingApiKeyError } from '../errors';
import { getT } from '../../../i18n/client';
import type { MediaPageData } from '../../media/types';
import type { SearchPage, SearchResult } from '../index';
import { isUnifySeasonsEnabled } from '../../settings/preferences';
import { API_SPORTS_EVENT_BANNER_COLOR } from '../../media/constants';
import {
  getApiSportsEventMatches,
  saveApiSportsEventMatches,
  saveApiSportsEventSeasons,
  type ApiSportsEventMatchRow,
  type ApiSportsEventSeasonRow,
} from '../../tauri/misc-commands';

export type ApiSportsDiscipline = 'football' | 'basketball';
type ApiSport = ApiSportsDiscipline;
type ApiSportsObject = Record<string, any>;
type ApiSportsEnvelope = { response?: unknown[]; errors?: Record<string, unknown> | unknown[] };

interface SeasonInfo {
  id: string;
  label: string;
  current: boolean;
  year: number | null;
}

interface LeagueInfo {
  id: string;
  name: string;
  logo: string | null;
  sport: ApiSport;
  country: string | null;
  seasons: SeasonInfo[];
}

export interface EventMatch {
  id: string;
  date: string | null;
  time: string | null;
  home: string | null;
  away: string | null;
  homeScore: string | number | null;
  awayScore: string | number | null;
  image: string | null;
  venue: string | null;
  status: string | null;
}

const API_PRODUCTS: Record<ApiSport, { baseUrl: string; label: string; route: 'fixtures' | 'games' }> = {
  football: { baseUrl: API_ENDPOINTS.APISPORTS_FOOTBALL, label: 'Football', route: 'fixtures' },
  basketball: { baseUrl: API_ENDPOINTS.APISPORTS_BASKETBALL, label: 'Basketball', route: 'games' },
};
const searchCache = new Map<string, { results: SearchResult[]; fetchedAt: number }>();
const matchCache = new Map<string, { matches: EventMatch[]; fetchedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const EVENT_MATCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
const EVENT_BANNER_COLOR = API_SPORTS_EVENT_BANNER_COLOR;

async function apiKey(): Promise<string> {
  const key = (await readEnvConfig()).apisports_api_key?.trim();
  if (!key) throw new MissingApiKeyError(['apisports']);
  return key;
}

async function request<T>(sport: ApiSport, path: string, key: string, signal?: AbortSignal): Promise<T | null> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const response = await fetchJson<T>(`${API_PRODUCTS[sport].baseUrl}/${path}`, {
    headers: { 'x-apisports-key': key },
    signal,
    timeoutMs: 12000,
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return response;
}

function responseRows(response: ApiSportsEnvelope | null): ApiSportsObject[] {
  return Array.isArray(response?.response) ? response.response.filter((row): row is ApiSportsObject => !!row && typeof row === 'object') : [];
}

function hasApiErrors(response: ApiSportsEnvelope | null): boolean {
  if (!response) return true;
  if (Array.isArray(response.errors)) return response.errors.length > 0;
  return !!response.errors && Object.keys(response.errors).length > 0;
}

function isRecentSync(timestamp: string | null | undefined): boolean {
  if (!timestamp) return false;
  const normalized = timestamp.includes('T') ? timestamp : `${timestamp.replace(' ', 'T')}Z`;
  const syncedAt = Date.parse(normalized);
  return Number.isFinite(syncedAt) && Date.now() - syncedAt < EVENT_MATCH_CACHE_TTL_MS;
}

function seasonRow(
  league: LeagueInfo,
  season: SeasonInfo,
  seasonNumber: number,
): ApiSportsEventSeasonRow {
  return {
    externalId: externalId(league.sport, league.id, season.id),
    competitionExternalId: competitionExternalId(league.sport, league.id),
    seasonKey: season.id,
    seasonNumber,
    name: season.label,
    coverUrl: league.logo,
    airDate: season.year ? `${season.year}-01-01` : null,
    isCurrent: season.current,
    matchesSyncedAt: null,
  };
}

function matchFromStorage(match: ApiSportsEventMatchRow): EventMatch {
  return { ...match };
}

function matchForStorage(match: EventMatch): ApiSportsEventMatchRow {
  return {
    ...match,
    homeScore: match.homeScore == null ? null : String(match.homeScore),
    awayScore: match.awayScore == null ? null : String(match.awayScore),
  };
}

function seasonInfo(raw: unknown): SeasonInfo | null {
  const season = typeof raw === 'string' || typeof raw === 'number'
    ? { year: raw }
    : (raw && typeof raw === 'object' ? raw as ApiSportsObject : null);
  if (!season) return null;
  const rawId = season.year ?? season.season ?? season.strSeason;
  if (rawId == null || String(rawId).trim() === '') return null;
  const id = String(rawId).trim();
  const startYear = String(season.start ?? '').match(/\b(?:19|20|21)\d{2}\b/)?.[0];
  const endYear = String(season.end ?? '').match(/\b(?:19|20|21)\d{2}\b/)?.[0];
  const label = startYear && endYear && startYear !== endYear ? `${startYear}-${endYear}` : id;
  const parsedYear = Number(startYear ?? id.match(/\b(?:19|20|21)\d{2}\b/)?.[0]);
  return {
    id,
    label,
    current: season.current === true || season.current === 1 || season.current === 'true',
    year: Number.isFinite(parsedYear) ? parsedYear : null,
  };
}

function leagueInfo(raw: ApiSportsObject, sport: ApiSport): LeagueInfo | null {
  // Football wraps details under `league`/`country`; Basketball returns them
  // at the top level. Accept both shapes at this boundary and keep the rest of
  // Metadea independent from the provider-specific response differences.
  const league = raw.league && typeof raw.league === 'object' ? raw.league : raw;
  const id = league.id ?? raw.id;
  const name = league.name ?? raw.name;
  if (id == null || !name) return null;
  const seasonsRaw = raw.seasons ?? league.seasons ?? raw.season ?? [];
  const seasons = (Array.isArray(seasonsRaw) ? seasonsRaw : [seasonsRaw])
    .map(seasonInfo)
    .filter((season): season is SeasonInfo => !!season);
  const country = raw.country && typeof raw.country === 'object' ? raw.country.name : raw.country;
  return {
    id: String(id),
    name: String(name),
    logo: typeof league.logo === 'string' ? league.logo : null,
    sport,
    country: country ? String(country) : null,
    seasons,
  };
}

function competitionExternalId(sport: ApiSport, leagueId: string): string {
  return `event:apisports:${sport}:${leagueId}`;
}

function externalId(sport: ApiSport, leagueId: string, season: string): string {
  return `event:apisports:${sport}:${leagueId}:${encodeURIComponent(season)}`;
}

function parseExternalId(rawId: string): { sport: ApiSport; leagueId: string; seasonId: string | null } | null {
  const match = /^event:apisports:(football|basketball):(\d+)(?::(.+))?$/.exec(rawId);
  if (!match) return null;
  let seasonId = match[3] ?? null;
  if (seasonId) {
    try { seasonId = decodeURIComponent(seasonId); } catch { /* Keep the stored segment. */ }
  }
  return { sport: match[1] as ApiSport, leagueId: match[2], seasonId };
}

function resultFor(league: LeagueInfo, season: SeasonInfo, unified = false): SearchResult {
  const id = unified ? competitionExternalId(league.sport, league.id) : externalId(league.sport, league.id, season.id);
  const sportLabel = API_PRODUCTS[league.sport].label;
  return {
    externalId: id,
    type: 'event',
    format: 'Season',
    source: 'apisports',
    // A unified search result opens the competition container; its season
    // cards are the only entries that can be added to the user list.
    titleMain: unified ? league.name : `${league.name} - ${season.label}`,
    titleRomaji: null,
    titleNative: null,
    coverUrl: league.logo,
    releaseYear: unified ? null : season.year,
    releaseMonth: null,
    releaseDay: null,
    scoreGlobal: null,
    genres: [sportLabel],
  };
}

async function searchSport(query: string, sport: ApiSport, key: string, signal: AbortSignal): Promise<SearchResult[]> {
  const unified = isUnifySeasonsEnabled();
  const cacheKey = `${sport}:${unified ? 'unified' : 'seasons'}:${query.toLocaleLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < SEARCH_CACHE_TTL_MS) return cached.results;

  const response = await request<ApiSportsEnvelope>(sport, `leagues?search=${encodeURIComponent(query)}`, key, signal);
  const leagues = responseRows(response)
    .map(row => leagueInfo(row, sport))
    .filter((league): league is LeagueInfo => !!league);
  const results = leagues.flatMap(league => {
    if (!unified) return league.seasons.map(season => resultFor(league, season));
    const representative = league.seasons.find(season => season.current)
      ?? [...league.seasons].sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || b.id.localeCompare(a.id))[0];
    return representative ? [resultFor(league, representative, true)] : [];
  });
  if (response) searchCache.set(cacheKey, { results, fetchedAt: Date.now() });
  return results;
}

export async function searchApiSportsEvents(
  query: string,
  signal: AbortSignal,
  page = 1,
  discipline?: ApiSportsDiscipline | null,
): Promise<SearchPage> {
  const searchText = query.trim();
  // Keep Event searches local-only unless the user explicitly selects one
  // discipline; never fan out to every API-Sports product by default.
  if (!discipline || page > 1 || searchText.length < 2) return { results: [], hasMore: false };
  const key = await apiKey();
  const sportResults = await searchSport(searchText, discipline, key, signal).catch(error => {
    if (signal.aborted) throw error;
    console.warn(`[API-Sports] ${discipline} search failed`, error);
    return [];
  });
  const seen = new Set<string>();
  const results = sportResults.filter(result => {
    if (seen.has(result.externalId)) return false;
    seen.add(result.externalId);
    return true;
  }).slice(0, 100);
  return { results, hasMore: false };
}

function eventDateParts(value: unknown, fallbackTime?: unknown): { date: string | null; time: string | null } {
  const raw = typeof value === 'string' ? value : '';
  if (raw.includes('T')) {
    const [date, dateTime = ''] = raw.split('T');
    return { date: date || null, time: dateTime.slice(0, 5) || null };
  }
  const time = typeof fallbackTime === 'string' && fallbackTime ? fallbackTime.slice(0, 5) : null;
  return { date: raw.slice(0, 10) || null, time };
}

function normalizeMatch(raw: ApiSportsObject, sport: ApiSport): EventMatch | null {
  if (sport === 'football') {
    const fixture = raw.fixture ?? {};
    const teams = raw.teams ?? {};
    const goals = raw.goals ?? {};
    const parts = eventDateParts(fixture.date);
    const id = fixture.id ?? raw.id;
    if (id == null) return null;
    return {
      id: String(id),
      ...parts,
      home: teams.home?.name ?? null,
      away: teams.away?.name ?? null,
      homeScore: goals.home ?? null,
      awayScore: goals.away ?? null,
      image: teams.home?.logo ?? null,
      venue: fixture.venue?.name ?? null,
      status: fixture.status?.short ?? fixture.status?.long ?? null,
    };
  }

  const teams = raw.teams ?? {};
  const scores = raw.scores ?? {};
  const parts = eventDateParts(raw.date, raw.time);
  const id = raw.id ?? raw.game?.id;
  if (id == null) return null;
  return {
    id: String(id),
    ...parts,
    home: teams.home?.name ?? null,
    away: teams.away?.name ?? null,
    homeScore: scores.home?.total ?? scores.home?.points ?? null,
    awayScore: scores.away?.total ?? scores.away?.points ?? null,
    image: teams.home?.logo ?? null,
    venue: typeof raw.arena === 'string' ? raw.arena : raw.venue?.name ?? null,
    status: raw.status?.short ?? raw.status?.long ?? null,
  };
}

export async function fetchApiSportsSeasonMatches(rawId: string, force = false): Promise<EventMatch[]> {
  const parsed = parseExternalId(rawId);
  // A competition is a container. Matches always belong to one real season
  // and are intentionally never aggregated onto the unified page.
  if (!parsed?.seasonId) return [];
  const cached = matchCache.get(rawId);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.matches;

  const localCache = await getApiSportsEventMatches(rawId).catch(() => ({ syncedAt: null, matches: [] }));
  const localMatches = localCache.matches.map(matchFromStorage);
  if (!force && isRecentSync(localCache.syncedAt)) {
    matchCache.set(rawId, { matches: localMatches, fetchedAt: Date.now() });
    return localMatches;
  }

  let key: string;
  try {
    key = await apiKey();
  } catch (error) {
    // A saved season remains useful when the API key has been removed or is
    // temporarily unavailable. Only surface the missing-key error on a
    // season that has never been synchronized locally.
    if (localCache.syncedAt || localMatches.length > 0) return localMatches;
    throw error;
  }
  const product = API_PRODUCTS[parsed.sport];
  const params = new URLSearchParams({ league: parsed.leagueId, season: parsed.seasonId });
  const response = await request<ApiSportsEnvelope>(parsed.sport, `${product.route}?${params.toString()}`, key);
  if (hasApiErrors(response)) {
    // Do not write an empty list for quota/coverage/network errors: that would
    // turn a temporary failure into a persistent false "no matches" result.
    if (localCache.syncedAt || localMatches.length > 0) return localMatches;
    return [];
  }
  const matches = responseRows(response)
    .map(row => normalizeMatch(row, parsed.sport))
    .filter((match): match is EventMatch => !!match)
    .sort((a, b) => `${a.date ?? ''} ${a.time ?? ''}`.localeCompare(`${b.date ?? ''} ${b.time ?? ''}`));
  await saveApiSportsEventMatches(rawId, matches.map(matchForStorage)).catch(error => {
    console.warn('[API-Sports] Could not persist season matches locally', error);
  });
  matchCache.set(rawId, { matches, fetchedAt: Date.now() });
  return matches;
}

export async function fetchApiSportsEvent(rawId: string): Promise<MediaPageData | null> {
  const parsed = parseExternalId(rawId);
  if (!parsed) return null;
  const key = await apiKey();
  const leagueResponse = await request<ApiSportsEnvelope>(parsed.sport, `leagues?id=${encodeURIComponent(parsed.leagueId)}`, key);
  const row = responseRows(leagueResponse)[0];
  const league = row ? leagueInfo(row, parsed.sport) : null;
  if (!league) return null;

  const sportLabel = API_PRODUCTS[parsed.sport].label;
  const sourceUrl = `https://api-sports.io/sports/${parsed.sport}`;
  if (!parsed.seasonId) {
    const orderedSeasons = [...league.seasons].sort(
      (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || b.id.localeCompare(a.id),
    );
    const seasons = orderedSeasons.map((season, index) => ({
      seasonNumber: league.seasons.length - index,
      externalId: externalId(league.sport, league.id, season.id),
      name: season.label,
      coverUrl: league.logo,
      airDate: season.year ? `${season.year}-01-01` : null,
    }));
    await saveApiSportsEventSeasons(orderedSeasons.map((season, index) =>
      seasonRow(league, season, league.seasons.length - index)
    )).catch(error => {
      console.warn('[API-Sports] Could not persist competition seasons locally', error);
    });
    return {
      externalId: rawId,
      type: 'event',
      titleMain: league.name,
      cover: league.logo || undefined,
      bannerImage: undefined,
      bannerColor: EVENT_BANNER_COLOR,
      statusLabel: undefined,
      statusClass: undefined,
      genreDots: sportLabel,
      metaLines: [sportLabel, league.country].filter((part): part is string => !!part),
      dateBadge: undefined,
      description: undefined,
      stats: [{ label: getT().media.stat_seasons, value: String(seasons.length) }],
      characters: [],
      relations: [],
      progressStatus: 'watching',
      progressLabel: getT().media.progress_in_progress,
      format: 'Season',
      source: 'apisports',
      sourceUrl,
      status: league.seasons.some(season => season.current) ? 'RELEASING' : undefined,
      totalCount_2: seasons.length,
      seasons,
    };
  }

  const season = league.seasons.find(item => item.id === parsed.seasonId);
  if (!season) return null;
  const orderedSeasons = [...league.seasons]
    .sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || b.id.localeCompare(a.id));
  const seasonIndex = orderedSeasons.findIndex(item => item.id === season.id);
  await saveApiSportsEventSeasons([seasonRow(league, season, league.seasons.length - seasonIndex)]).catch(error => {
    console.warn('[API-Sports] Could not persist season metadata locally', error);
  });
  const matches = await fetchApiSportsSeasonMatches(rawId);
  const translatedMatches = getT().media.stat_matches;
  return {
    externalId: rawId,
    type: 'event',
    titleMain: `${league.name} - ${season.label}`,
    cover: league.logo || undefined,
    bannerImage: undefined,
    bannerColor: EVENT_BANNER_COLOR,
    statusLabel: undefined,
    statusClass: undefined,
    genreDots: sportLabel,
    metaLines: [sportLabel, league.country].filter((part): part is string => !!part),
    dateBadge: season.label,
    description: undefined,
    stats: [{ label: translatedMatches, value: String(matches.length) }],
    characters: [],
    relations: [],
    progressStatus: 'watching',
    progressLabel: getT().media.progress_in_progress,
    format: 'Season',
    source: 'apisports',
    sourceUrl,
    releaseYear: season.year ?? undefined,
    status: season.current ? 'RELEASING' : undefined,
    totalCount: matches.length,
  };
}

// Kept as a compatibility alias for callers built before competition pages
// existed. It now resolves either a competition or one of its seasons.
export const fetchApiSportsSeason = fetchApiSportsEvent;
