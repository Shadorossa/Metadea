// "General" release calendar — every upcoming release across all connected
// APIs (AniList for anime/manga/light novels, TMDB for movies/series, IGDB
// for games), from today through the end of the current month. Each source
// is queried with exactly one HTTP request regardless of how many titles it
// returns (AniList's two media types share one POST via GraphQL aliases;
// TMDB's movie/tv split is two separate REST resources so it takes two).
// Comics/books have no practical "upcoming releases" API in this stack, so
// they're intentionally not included.
import { API_ENDPOINTS } from '../api/endpoints';
import { graphqlPost, fetchJson } from '../api/client';
import { isAdultContentEnabled } from '../settings/preferences';
import { getTmdbAuth, buildPosterUrl, tmdbLocale } from '../search/providers/tmdb';
import { igdbUpcomingReleases } from '../tauri/igdb';
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
// Two very different kinds of anime "release" both need covering here:
// brand-new premieres (queried by Media.startDate, animeQ/mangaQ below) and
// individual episodes of shows already airing (queried by AiringSchedule,
// airQ1..N) — startDate alone only ever caught the former, which is why
// ongoing/continuing anime never showed up at all. AiringSchedule has no
// per-media cap in range, so AIRING_PAGES pages (sorted soonest-first) are
// pulled in the same POST via more aliases — still one HTTP request, just a
// bigger one — trading full-month completeness for solid near-term coverage.

interface AniListUpcomingMedia {
  id: number;
  type: 'ANIME' | 'MANGA';
  format: string | null;
  title: { romaji: string | null; english: string | null };
  coverImage: { large: string | null } | null;
  startDate: { year: number | null; month: number | null; day: number | null };
}

interface AniListAiringEntry {
  airingAt: number; // unix seconds
  episode: number;
  media: {
    id: number;
    isAdult: boolean;
    title: { romaji: string | null; english: string | null };
    coverImage: { large: string | null } | null;
  };
}

const AIRING_PAGES = 6; // 6 × 50 = 300 nearest-upcoming episodes

function buildUpcomingQuery(): string {
  const airingAliases = Array.from({ length: AIRING_PAGES }, (_, i) => `
    airQ${i + 1}: Page(page: ${i + 1}, perPage: 50) {
      airingSchedules(airingAt_greater: $airStart, airingAt_lesser: $airEnd, sort: TIME) {
        airingAt episode
        media { id isAdult title { romaji english } coverImage { large } }
      }
    }
  `).join('\n');

  return `
    query Upcoming($start: FuzzyDateInt, $end: FuzzyDateInt, $airStart: Int, $airEnd: Int, $isAdult: Boolean) {
      animeQ: Page(page: 1, perPage: 50) {
        media(type: ANIME, startDate_greater: $start, startDate_lesser: $end, sort: START_DATE, isAdult: $isAdult) {
          id type format
          title { romaji english }
          coverImage { large }
          startDate { year month day }
        }
      }
      mangaQ: Page(page: 1, perPage: 50) {
        media(type: MANGA, startDate_greater: $start, startDate_lesser: $end, sort: START_DATE, isAdult: $isAdult) {
          id type format
          title { romaji english }
          coverImage { large }
          startDate { year month day }
        }
      }
      ${airingAliases}
    }
  `;
}

const UPCOMING_QUERY = buildUpcomingQuery();

async function fetchAniListUpcoming(rangeStart: Date, rangeEnd: Date): Promise<UpcomingRelease[]> {
  // _greater/_lesser are exclusive, so shift the bounds out by a day/second
  // to keep this inclusive of both "today" and the last day of the month.
  const start = fuzzyDateInt(new Date(rangeStart.getTime() - 86400000));
  const end = fuzzyDateInt(new Date(rangeEnd.getTime() + 86400000));
  const airStart = Math.floor(rangeStart.getTime() / 1000) - 1;
  const airEnd = Math.floor(rangeEnd.getTime() / 1000) + 86400;
  const showAdult = isAdultContentEnabled();
  const isAdult = showAdult ? null : false;

  type AiringPage = { airingSchedules: AniListAiringEntry[] };
  const variables: Record<string, unknown> = { start, end, airStart, airEnd, isAdult };

  const { ok, result } = await graphqlPost<
    { animeQ?: { media: AniListUpcomingMedia[] }; mangaQ?: { media: AniListUpcomingMedia[] } }
    & Record<`airQ${number}`, AiringPage | undefined>
  >(API_ENDPOINTS.ANILIST, UPCOMING_QUERY, variables).catch(() => ({ ok: false, status: 0, result: null }));

  if (!ok || !result?.data) {
    console.error('[calendar] AniList upcoming query failed', result?.errors ?? result);
    return [];
  }

  const data = result.data;
  const premieres = [...(data.animeQ?.media ?? []), ...(data.mangaQ?.media ?? [])];

  const seen = new Set<string>();
  const releases: UpcomingRelease[] = [];

  for (const m of premieres) {
    if (!m.startDate.year || !m.startDate.month || !m.startDate.day) continue;
    const type = m.type === 'ANIME' ? 'anime' : m.format === 'NOVEL' ? 'lnovel' : 'manga';
    const { year, month, day } = m.startDate as { year: number; month: number; day: number };
    const key = `${type}:${m.id}:${year}-${month}-${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    releases.push({
      day, month, year,
      releaseDate: new Date(year, month - 1, day),
      title: m.title.romaji || m.title.english || `#${m.id}`,
      type,
      cover: m.coverImage?.large || '',
      externalId: `${type}:${m.id}`,
    });
  }

  for (let i = 1; i <= AIRING_PAGES; i++) {
    const entries = data[`airQ${i}`]?.airingSchedules ?? [];
    for (const entry of entries) {
      if (!showAdult && entry.media.isAdult) continue;
      const d = new Date(entry.airingAt * 1000);
      const year = d.getFullYear(), month = d.getMonth() + 1, day = d.getDate();
      const key = `anime:${entry.media.id}:${year}-${month}-${day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      releases.push({
        day, month, year,
        releaseDate: new Date(year, month - 1, day),
        title: entry.media.title.romaji || entry.media.title.english || `#${entry.media.id}`,
        type: 'anime',
        cover: entry.media.coverImage?.large || '',
        externalId: `anime:${entry.media.id}`,
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
      `&sort_by=${dateField}.asc&language=${locale}&page=${page}`;
    if (auth.apiKey) url += `&api_key=${encodeURIComponent(auth.apiKey)}`;
    return url;
  };
  const headers: Record<string, string> = auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {};

  // TMDB's discover endpoint has a fixed page size (20) — fetch a few pages
  // per kind so a busy month isn't clipped to only the first 20 movies/series.
  const PAGES = 3;
  async function fetchKind(kind: 'movie' | 'tv', dateField: string): Promise<TmdbDiscoverItem[]> {
    const pages = await Promise.all(
      Array.from({ length: PAGES }, (_, i) =>
        fetchJson<{ results?: TmdbDiscoverItem[]; total_pages?: number }>(buildUrl(kind, dateField, i + 1), { headers })
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
    }];
  });
}

// Fetches every source in parallel — one request per source — and merges
// the results sorted by release date. rangeStart/rangeEnd should be midnight
// of "today" and midnight of the last day of the current month respectively.
export async function fetchGeneralUpcomingReleases(rangeStart: Date, rangeEnd: Date): Promise<UpcomingRelease[]> {
  const [anilist, tmdb, igdb] = await Promise.all([
    fetchAniListUpcoming(rangeStart, rangeEnd).catch(e => { console.error('[calendar] AniList upcoming failed', e); return []; }),
    fetchTmdbUpcoming(rangeStart, rangeEnd).catch(e => { console.error('[calendar] TMDB upcoming failed', e); return []; }),
    fetchIgdbUpcoming(rangeStart, rangeEnd).catch(e => { console.error('[calendar] IGDB upcoming failed', e); return []; }),
  ]);

  return [...anilist, ...tmdb, ...igdb].sort((a, b) => a.releaseDate.getTime() - b.releaseDate.getTime());
}
