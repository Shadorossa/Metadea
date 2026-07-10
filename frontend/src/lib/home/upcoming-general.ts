// "General" release calendar — every release across all connected APIs
// (AniList for anime/manga/light novels, TMDB for movies/series, IGDB for
// games) for the whole current month (1st through last day). Each source is
// queried with exactly one HTTP request regardless of how many titles it
// returns (AniList's sub-queries share one POST via GraphQL aliases; TMDB's
// movie/tv split is two separate REST resources so it takes two). Results
// are sorted by each source's own popularity metric rather than by date.
// When a source can't return literally everything (AniList's ongoing-anime
// episodes are spread across the month in date-range CHUNKS specifically so
// no single day gets starved — see the comment above CHUNKS below), what
// comes back is the most notable subset spread across the month rather
// than a date-ordered slice that only covers the first few days. Comics/
// books have no practical "upcoming releases" API in this stack, so
// they're intentionally not included.
import { API_ENDPOINTS } from '../api/endpoints';
import { graphqlPost, fetchJson } from '../api/client';
import { isAdultContentEnabled } from '../settings/preferences';
import { getTmdbAuth, buildPosterUrl, tmdbLocale } from '../search/providers/tmdb';
import { igdbUpcomingReleases } from '../tauri/igdb';
import { STORAGE_KEYS } from '../shared/storage-keys';
import type { UpcomingRelease } from '../profile/stats-calculators';

function fuzzyDateInt(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// toISOString() converts to UTC first, which shifts a local midnight Date
// back a day for any timezone ahead of UTC (e.g. CEST, UTC+2) — build the
// "YYYY-MM-DD" string from local date components instead.
function tmdbDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── AniList: anime + manga/light novels in a single POST via aliases ───────
// Two very different kinds of anime "release" both need covering: brand-new
// premieres (Media.startDate, animeQ/mangaQ below) and episodes of shows
// already airing (chunkQ0..N). The latter used to either pull raw
// AiringSchedule entries sorted soonest-first (front-loads coverage onto
// the first few days and leaves the rest of the month with nothing — this
// is what caused whole days like the 20th/26th/30th to come up empty), or
// read only each popular show's single nextAiringEpisode (same problem:
// one data point per show, clustered wherever "next" happens to fall).
// Splitting the month into CHUNKS equal date ranges and querying each
// range's own airingSchedules independently guarantees every part of the
// month gets its own slice of the perPage budget instead of the earliest
// days eating the whole thing.

interface AniListUpcomingMedia {
  id: number;
  type: 'ANIME' | 'MANGA';
  format: string | null;
  popularity: number | null;
  title: { romaji: string | null; english: string | null };
  coverImage: { large: string | null } | null;
  startDate: { year: number | null; month: number | null; day: number | null };
}

interface AniListAiringEntry {
  airingAt: number; // unix seconds
  media: {
    id: number;
    isAdult: boolean;
    popularity: number | null;
    title: { romaji: string | null; english: string | null };
    coverImage: { large: string | null } | null;
  };
}

const CHUNKS = 6; // ~5 days each for a 30-day month, 50/chunk = 300 total

function buildUpcomingQuery(): string {
  const chunkVars = Array.from({ length: CHUNKS }, (_, i) => `$c${i}s: Int, $c${i}e: Int`).join(', ');
  const chunkAliases = Array.from({ length: CHUNKS }, (_, i) => `
    chunkQ${i}: Page(page: 1, perPage: 50) {
      airingSchedules(airingAt_greater: $c${i}s, airingAt_lesser: $c${i}e, sort: TIME) {
        airingAt
        media { id isAdult popularity title { romaji english } coverImage { large } }
      }
    }
  `).join('\n');

  return `
    query Upcoming($start: FuzzyDateInt, $end: FuzzyDateInt, $isAdult: Boolean, ${chunkVars}) {
      animeQ: Page(page: 1, perPage: 50) {
        media(type: ANIME, startDate_greater: $start, startDate_lesser: $end, sort: POPULARITY_DESC, isAdult: $isAdult) {
          id type format popularity
          title { romaji english }
          coverImage { large }
          startDate { year month day }
        }
      }
      mangaQ: Page(page: 1, perPage: 50) {
        media(type: MANGA, startDate_greater: $start, startDate_lesser: $end, sort: POPULARITY_DESC, isAdult: $isAdult) {
          id type format popularity
          title { romaji english }
          coverImage { large }
          startDate { year month day }
        }
      }
      ${chunkAliases}
    }
  `;
}

const UPCOMING_QUERY = buildUpcomingQuery();

async function fetchAniListUpcoming(rangeStart: Date, rangeEnd: Date): Promise<UpcomingRelease[]> {
  // _greater/_lesser are exclusive, so shift the bounds out by a day to keep
  // this inclusive of both the 1st and the last day of the month.
  const start = fuzzyDateInt(new Date(rangeStart.getTime() - 86400000));
  const end = fuzzyDateInt(new Date(rangeEnd.getTime() + 86400000));
  const isAdult = isAdultContentEnabled() ? null : false;

  const chunkStartMs = rangeStart.getTime() - 1000;
  const chunkEndMs = rangeEnd.getTime() + 86400000; // through end of last day
  const chunkSizeMs = (chunkEndMs - chunkStartMs) / CHUNKS;
  const variables: Record<string, unknown> = { start, end, isAdult };
  for (let i = 0; i < CHUNKS; i++) {
    variables[`c${i}s`] = Math.round((chunkStartMs + i * chunkSizeMs) / 1000);
    variables[`c${i}e`] = Math.round((chunkStartMs + (i + 1) * chunkSizeMs) / 1000);
  }

  type ChunkPage = { airingSchedules: AniListAiringEntry[] };
  const { ok, result } = await graphqlPost<
    { animeQ?: { media: AniListUpcomingMedia[] }; mangaQ?: { media: AniListUpcomingMedia[] } }
    & Record<`chunkQ${number}`, ChunkPage | undefined>
  >(API_ENDPOINTS.ANILIST, UPCOMING_QUERY, variables).catch(() => ({ ok: false, status: 0, result: null }));

  if (!ok || !result?.data) {
    console.error('[calendar] AniList upcoming query failed', result?.errors ?? result);
    return [];
  }

  const data = result.data;
  const premieres = [...(data.animeQ?.media ?? []), ...(data.mangaQ?.media ?? [])];
  const showAdult = isAdultContentEnabled();

  // Keyed by title (type:id) only, not by date — each work should appear on
  // the calendar exactly once, not once per episode. Premieres are added
  // first (their startDate is the real release date), then chunks in
  // chronological order (0=earliest) with each chunk's own entries already
  // TIME-ascending, so "first occurrence wins" naturally lands on the
  // earliest qualifying date within the month for anything not already
  // claimed by a premiere.
  const seen = new Set<string>();
  const releases: UpcomingRelease[] = [];

  for (const m of premieres) {
    if (!m.startDate.year || !m.startDate.month || !m.startDate.day) continue;
    const type = m.type === 'ANIME' ? 'anime' : m.format === 'NOVEL' ? 'lnovel' : 'manga';
    const key = `${type}:${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { year, month, day } = m.startDate as { year: number; month: number; day: number };
    releases.push({
      day, month, year,
      releaseDate: new Date(year, month - 1, day),
      title: m.title.romaji || m.title.english || `#${m.id}`,
      type,
      cover: m.coverImage?.large || '',
      externalId: `${type}:${m.id}`,
      popularity: m.popularity ?? 0,
    });
  }

  for (let i = 0; i < CHUNKS; i++) {
    const entries = data[`chunkQ${i}`]?.airingSchedules ?? [];
    for (const entry of entries) {
      if (!showAdult && entry.media.isAdult) continue;
      const key = `anime:${entry.media.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = new Date(entry.airingAt * 1000);
      const year = d.getFullYear(), month = d.getMonth() + 1, day = d.getDate();
      releases.push({
        day, month, year,
        releaseDate: new Date(year, month - 1, day),
        title: entry.media.title.romaji || entry.media.title.english || `#${entry.media.id}`,
        type: 'anime',
        cover: entry.media.coverImage?.large || '',
        externalId: `anime:${entry.media.id}`,
        popularity: entry.media.popularity ?? 0,
      });
    }
  }

  return releases;
}

// ── TMDB: movies + series, two REST discover calls ──────────────────────────

interface TmdbDiscoverItem {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
}

async function fetchTmdbUpcoming(rangeStart: Date, rangeEnd: Date): Promise<UpcomingRelease[]> {
  const auth = await getTmdbAuth();
  if (!auth) {
    console.warn('[calendar] TMDB not configured (no api_key/access_token in Settings > Entorno) — skipping movies/series');
    return [];
  }

  const startStr = tmdbDateStr(rangeStart);
  const endStr = tmdbDateStr(rangeEnd);
  const locale = tmdbLocale();

  const buildUrl = (kind: 'movie' | 'tv', dateField: string, page: number) => {
    let url = `${API_ENDPOINTS.TMDB}/discover/${kind}?${dateField}.gte=${startStr}&${dateField}.lte=${endStr}` +
      `&sort_by=popularity.desc&language=${locale}&page=${page}`;
    if (auth.apiKey) url += `&api_key=${encodeURIComponent(auth.apiKey)}`;
    return url;
  };
  const headers: Record<string, string> = auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {};

  // TMDB's discover endpoint has a fixed page size (20) — fetch a few pages
  // per kind so a busy month isn't clipped to only the 20 most popular.
  const PAGES = 3;
  async function fetchKind(kind: 'movie' | 'tv', dateField: string): Promise<TmdbDiscoverItem[]> {
    const pages = await Promise.all(
      Array.from({ length: PAGES }, (_, i) =>
        fetchJson<{ results?: TmdbDiscoverItem[] }>(buildUrl(kind, dateField, i + 1), { headers })
      ),
    );
    return pages.flatMap(p => p?.results ?? []);
  }

  const [movies, series] = await Promise.all([
    fetchKind('movie', 'primary_release_date'),
    fetchKind('tv', 'first_air_date'),
  ]);

  const map = (items: TmdbDiscoverItem[], type: 'movie' | 'series'): UpcomingRelease[] =>
    items.flatMap(item => {
      const dateStr = item.release_date || item.first_air_date;
      if (!dateStr) return [];
      const [year, month, day] = dateStr.split('-').map(Number);
      if (!year || !month || !day) return [];
      return [{
        day, month, year,
        releaseDate: new Date(year, month - 1, day),
        title: item.title || item.name || `#${item.id}`,
        type,
        cover: buildPosterUrl(item.poster_path) || '',
        externalId: `${type}:${item.id}`,
        popularity: item.popularity ?? 0,
      }];
    });

  return [...map(movies, 'movie'), ...map(series, 'series')];
}

// ── IGDB: games, one request ─────────────────────────────────────────────────

async function fetchIgdbUpcoming(rangeStart: Date, rangeEnd: Date): Promise<UpcomingRelease[]> {
  const startUnix = Math.floor(rangeStart.getTime() / 1000);
  const endUnix = Math.floor(rangeEnd.getTime() / 1000) + 86399; // through end of last day
  const games = await igdbUpcomingReleases(startUnix, endUnix).catch(e => {
    console.warn('[calendar] IGDB not configured or request failed (Settings > Entorno) — skipping games', e);
    return [];
  });

  return games.flatMap(g => {
    if (!g.first_release_date) return [];
    const d = new Date(g.first_release_date * 1000);
    return [{
      day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear(),
      releaseDate: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
      title: g.name,
      type: 'game',
      cover: g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : '',
      externalId: `game:${g.id}`,
      popularity: g.hypes ?? 0,
    }];
  });
}

async function fetchGeneralUpcomingReleasesUncached(rangeStart: Date, rangeEnd: Date): Promise<UpcomingRelease[]> {
  const [anilist, tmdb, igdb] = await Promise.all([
    fetchAniListUpcoming(rangeStart, rangeEnd).catch(e => { console.error('[calendar] AniList upcoming failed', e); return []; }),
    fetchTmdbUpcoming(rangeStart, rangeEnd).catch(e => { console.error('[calendar] TMDB upcoming failed', e); return []; }),
    fetchIgdbUpcoming(rangeStart, rangeEnd).catch(e => { console.error('[calendar] IGDB upcoming failed', e); return []; }),
  ]);

  return [...anilist, ...tmdb, ...igdb].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
}

// ── localStorage cache ───────────────────────────────────────────────────────
// Keyed per calendar month so switching months (or a fresh install) doesn't
// see stale data, but reopening Home or a full page reload within the same
// day reuses the last fetch instead of re-hitting all three APIs. Not tied
// to any particular rangeStart/rangeEnd — it caches by month, independent of
// how "today" shifts the query boundaries.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Bump whenever the query range/logic changes meaningfully (e.g. the fix
// that extended coverage to earlier-this-month releases) — otherwise a
// cache written by older code sits well within CACHE_TTL_MS and keeps
// serving results that don't reflect the new behavior until it expires.
const CACHE_VERSION = 4;

interface SerializedRelease extends Omit<UpcomingRelease, 'releaseDate'> {
  releaseDate: string; // ISO — Date doesn't survive JSON.stringify/parse as-is
}

interface CacheEntry {
  version: number;
  savedAt: number;
  monthKey: string;
  releases: SerializedRelease[];
}

function monthKeyFor(rangeStart: Date): string {
  return `${rangeStart.getFullYear()}-${rangeStart.getMonth() + 1}`;
}

function readCache(monthKey: string): UpcomingRelease[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.homeCalendarGeneralCache);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.version !== CACHE_VERSION) return null;
    if (entry.monthKey !== monthKey) return null;
    if (Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry.releases.map(r => ({ ...r, releaseDate: new Date(r.releaseDate) }));
  } catch {
    return null;
  }
}

function writeCache(monthKey: string, releases: UpcomingRelease[]): void {
  try {
    const entry: CacheEntry = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      monthKey,
      releases: releases.map(r => ({ ...r, releaseDate: r.releaseDate.toISOString() })),
    };
    localStorage.setItem(STORAGE_KEYS.homeCalendarGeneralCache, JSON.stringify(entry));
  } catch {
    // Storage full/unavailable — cache is a pure optimization, safe to skip.
  }
}

// Fetches every source in parallel — one request per source — and merges
// the results. Sorted by each source's own popularity metric (descending)
// rather than by date, so within a day the most notable release leads; the
// day-bucketing itself (computeCalendarMonth) only cares about date, so this
// ordering carries through to what shows first in each day's popover.
// Result is cached in localStorage per calendar month (see CACHE_TTL_MS)
// so revisiting Home or reloading the page doesn't refetch every time.
// rangeStart/rangeEnd should be midnight of the 1st and the last day of the
// current month respectively.
export async function fetchGeneralUpcomingReleases(rangeStart: Date, rangeEnd: Date): Promise<UpcomingRelease[]> {
  const monthKey = monthKeyFor(rangeStart);
  const cached = readCache(monthKey);
  if (cached) return cached;

  const releases = await fetchGeneralUpcomingReleasesUncached(rangeStart, rangeEnd);
  writeCache(monthKey, releases);
  return releases;
}
