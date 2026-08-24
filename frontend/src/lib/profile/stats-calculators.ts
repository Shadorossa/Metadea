import type { getAllLibraryEntries, MediaCatalogEntry, DbMediaRelation } from '../tauri';
import { isInProgressStatus, ALL_MEDIA_TYPES, SUB_WORK_FORMATS } from '../constants/media';
import { dbRatingToStars5, type RatingSystem } from '../media/rating-utils';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

// ── Overview aggregates ─────────────────────────────────────────────────────

export interface OverviewAggregate {
  totalWorks: number;
  totalSeasons: number;
  totalHours: number;
  totalDays: string;
  avgPerWork: string;
  ratedItems: Items;
  avgScore: number;
  completed: number;
  currently: number;
  paused: number;
  dropped: number;
  planning: number;
  // Completed works broken down by type, and (within that) by sub-work
  // format (a series' season, a game's remaster, ...) — see
  // groupSagaChains' own comment for why anime/series seasons need their
  // own saga-relation-based grouping instead of a simple format tag.
  completedByType: Record<string, number>;
  completedSubBreakdownByType: Record<string, Record<string, number>>;
}

// A "version log" is a library entry created to track one specific edition/
// platform of a work (e.g. tracking "Skyrim Special Edition" time separately
// from the base "Skyrim" entry). Its own external_id shows up in the parent
// entry's `selected_version` list — exclude those from any stat that counts
// or buckets *works*, so the same conceptual work isn't counted twice.
function getEditionChildIds(items: Items): Set<string> {
  const childIds = new Set<string>();
  for (const item of items) {
    if (item.selected_version) {
      for (const id of item.selected_version.split(',')) {
        childIds.add(id);
      }
    }
  }
  return childIds;
}

// Formats that describe a sub-unit of a work rather than a standalone work
// of their own — a TV/anime season, a game update, a single comic issue, or
// one episode of a bundled VN (e.g. Umineko no Naku Koro ni's episodes,
// IGDB game_type 6). Unlike REMAKE/REMASTER/etc. (linked to their base via
// the version-log system's `selected_version`), these are identified purely
// by their own catalog format tag — no linking needed, since there's no
// "pick which season/update/issue/episode this belongs to" UI, each is just
// its own library entry tagged with one of these formats. Still counted in
// every stat computed from the full `items` list (hours played, completed-
// by-year, etc.) — only excluded from the ones that count/bucket *works*
// (totalWorks, completed/currently/paused/dropped/planning), so a bundle's
// episodes don't inflate "obras completadas" beyond the bundle itself.
function isSubWorkItem(item: Items[number], childIds: Set<string>, catalogMap?: Map<string, MediaCatalogEntry>): boolean {
  if (childIds.has(item.external_id)) return true;
  if (catalogMap) {
    const format = catalogMap.get(item.external_id)?.format;
    if (format && SUB_WORK_FORMATS.has(format)) return true;
  }
  return false;
}

export function getNonEditionItems(items: Items, catalogMap?: Map<string, MediaCatalogEntry>): Items {
  const childIds = getEditionChildIds(items);
  return items.filter(item => !isSubWorkItem(item, childIds, catalogMap));
}

// Complement of getNonEditionItems: only the sub-work entries themselves
// (edition/version-log children, seasons, updates, comic issues) — used
// where a stat wants to break those down separately instead of just
// excluding them.
export function getEditionItems(items: Items, catalogMap?: Map<string, MediaCatalogEntry>): Items {
  const childIds = getEditionChildIds(items);
  return items.filter(item => isSubWorkItem(item, childIds, catalogMap));
}

// Same types library-grouping.ts's refineSagaGroups groups on the library
// grid (games/movies/series get real or curated SEQUEL/PREQUEL rows too).
const SAGA_GROUPABLE_TYPES = new Set(['anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series']);
const SAGA_RELATION_TYPES = new Set(['SEQUEL', 'SECUELA', 'PREQUEL', 'PRECUELA', 'ALTERNATIVE']);

// Anime/series seasons are SUB_WORK_FORMATS' one real gap: AniList/TMDB have
// no "this is season N of X" format tag the way IGDB's SEASON/ISSUE-style
// values give getNonEditionItems for games/comics — every season is just its
// own independent Media entry, connected to its neighbors only via SEQUEL/
// PREQUEL relation edges. Without this, e.g. Gintama's 8 owned TV seasons
// each counted as a fully separate completed anime instead of one franchise.
//
// Catalog-wide walk (not just relations between owned entries), so owning
// season 1 and 3 but not 2 still merges them — same technique
// refineSagaGroups uses for the library grid, simplified here: no edition-
// redirect/bundle-suppression, just "which owned items share a saga chain."
// Returns only real multi-member chains (a lone owned entry with no owned
// relatives has nothing to merge with and isn't included).
export function groupSagaChains(
  items: Items,
  relations: DbMediaRelation[],
  catalogMap: Map<string, MediaCatalogEntry>,
): Map<string, string[]> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    return cur;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const rel of relations) {
    if (!rel.media_external_id || !SAGA_RELATION_TYPES.has(rel.relation_type)) continue;
    const a = rel.media_external_id;
    const b = rel.related_media_external_id;
    const typeA = catalogMap.get(a)?.type;
    const typeB = catalogMap.get(b)?.type;
    if (typeA && !SAGA_GROUPABLE_TYPES.has(typeA)) continue;
    if (typeB && !SAGA_GROUPABLE_TYPES.has(typeB)) continue;
    union(a, b);
  }

  const groups = new Map<string, string[]>();
  for (const item of items) {
    const id = item.external_id;
    if (!parent.has(id)) continue;
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }
  for (const [root, ids] of [...groups]) {
    if (ids.length < 2) groups.delete(root);
  }
  return groups;
}

// media_catalog.time_length is the runtime in minutes of one unit of the
// work — one episode for anime/series, the whole thing for a movie. Anime/
// series log "progress" as episode count (see getProgressConfig in
// MediaEditorModal), so minutes_spent on those entries is a flat
// progress*60 that ignores real episode length entirely. Recompute from the
// catalog here instead of trusting the stored value, so both new and
// already-imported/logged entries get correct hours without a migration.
const DEFAULT_EPISODE_MINUTES = 24;

export function getItemMinutes(item: Items[number], catalogMap: Map<string, MediaCatalogEntry>): number {
  if (item.type === 'anime' || item.type === 'series') {
    const perEpisodeMinutes = catalogMap.get(item.external_id)?.time_length || DEFAULT_EPISODE_MINUTES;
    return item.progress * perEpisodeMinutes;
  }
  return item.minutes_spent || 0;
}

// Single source of truth for every "how many works" stat shown across the
// profile (the Overview tab's stats bar + its "?" tooltip, and the Stats
// tab) — used to live as two separate, independently-drifting counting
// loops (render-overview.ts had its own copy), which is how totalWorks
// ended up saga-aware in one place and not the other.
export function computeOverviewAggregate(
  items: Items,
  catalogMap: Map<string, MediaCatalogEntry>,
  relations: DbMediaRelation[],
): OverviewAggregate {
  const nonEditionItems = getNonEditionItems(items, catalogMap);

  // Anime/series seasons have no format tag marking them as sub-works the
  // way games/comics do (see groupSagaChains' own comment) — collapsed here
  // via their SEQUEL/PREQUEL relations instead, so e.g. Gintama's 8 owned TV
  // seasons count as 1 completed anime + 8 "Temporada" entries in the
  // breakdown, not 8 separate completed anime.
  const sagaChains = groupSagaChains(nonEditionItems, relations, catalogMap);
  const chainedIds = new Set<string>();
  for (const ids of sagaChains.values()) for (const id of ids) chainedIds.add(id);
  const itemById = new Map(nonEditionItems.map(i => [i.external_id, i]));

  let completed = 0, currently = 0, paused = 0, dropped = 0, planning = 0;
  const completedByType: Record<string, number> = {};
  const completedSubBreakdownByType: Record<string, Record<string, number>> = {};
  const addToSubBreakdown = (type: string, format: string, count = 1) => {
    const byFormat = completedSubBreakdownByType[type] ?? (completedSubBreakdownByType[type] = {});
    byFormat[format] = (byFormat[format] ?? 0) + count;
  };
  const tallyStatus = (item: Items[number]) => {
    const s = item.status ?? 'planning';
    if (s === 'completed') { completed++; completedByType[item.type] = (completedByType[item.type] ?? 0) + 1; }
    else if (isInProgressStatus(s)) currently++;
    else if (s === 'paused') paused++;
    else if (s === 'planning') planning++;
    else if (s === 'dropped') dropped++;
  };

  for (const item of nonEditionItems) {
    if (chainedIds.has(item.external_id)) continue; // handled per-chain below
    tallyStatus(item);
  }

  // Which of the 5 stat buckets a raw status falls into — used below to
  // check whether every member of a saga chain agrees on the same bucket
  // (mirrors tallyStatus's own branching so a chain and a standalone item
  // are always classified the same way).
  const statusBucket = (status: string | null | undefined): 'completed' | 'currently' | 'paused' | 'dropped' | 'planning' => {
    const s = status ?? 'planning';
    if (s === 'completed') return 'completed';
    if (isInProgressStatus(s)) return 'currently';
    if (s === 'paused') return 'paused';
    if (s === 'dropped') return 'dropped';
    return 'planning';
  };

  for (const ids of sagaChains.values()) {
    const members = ids.map(id => itemById.get(id)!).filter(Boolean);
    const firstBucket = members.length > 0 ? statusBucket(members[0].status) : null;
    // A saga chain collapses to 1 "obra" whenever every member agrees on the
    // same bucket — whether that's everyone finished, everyone still on the
    // to-watch pile, everyone mid-watch, everyone paused, or everyone
    // dropped. Only a chain genuinely split across buckets (some seasons
    // watched, others not) falls back to counting each member on its own.
    const allSameBucket = firstBucket !== null && members.every(m => statusBucket(m.status) === firstBucket);
    if (allSameBucket && firstBucket === 'completed') {
      // The whole franchise reads as finished — 1 anime, N seasons, not N
      // separate completed anime. "Temporada" only makes sense for anime/
      // series (TV entries) — a manga/movie/game saga's own entries are
      // full separate works of their own, not seasons of one broadcast, so
      // those get the generic sequel/prequel label instead.
      const chainType = members[0].type;
      const subFormat = (chainType === 'anime' || chainType === 'series') ? 'SEASON' : 'CONTINUATION';
      completed++;
      completedByType[chainType] = (completedByType[chainType] ?? 0) + 1;
      addToSubBreakdown(chainType, subFormat, members.length);
    } else if (allSameBucket) {
      if (firstBucket === 'currently') currently++;
      else if (firstBucket === 'paused') paused++;
      else if (firstBucket === 'dropped') dropped++;
      else planning++;
    } else {
      // Still mid-franchise (some seasons watched, others not) — no single
      // status represents the whole chain yet, so count each member on its
      // own the same as an unrelated standalone work would be.
      for (const m of members) tallyStatus(m);
    }
  }

  // Completed sub-works don't count as their own "work", but the info isn't
  // thrown away — tallied by the base type they belong to (a game's remake/
  // remaster/update, a comic's issue, ...) so the "?" tooltip can show each
  // breakdown nested under its own type instead of everything getting
  // lumped under "Videojuegos" regardless of which type it actually came from.
  for (const item of getEditionItems(items, catalogMap)) {
    if (item.status !== 'completed') continue;
    const format = catalogMap.get(item.external_id)?.format || 'GAME';
    addToSubBreakdown(item.type, format);
  }

  // Every saga chain (regardless of completion) collapses to 1 "obra" here
  // too — same reasoning as the completed count above, just not gated on
  // status: Gintama is 1 work whether you've finished all 8 seasons or are
  // 3 episodes into season 1.
  const totalWorks = nonEditionItems.length - chainedIds.size + sagaChains.size;

  const totalSeasons = items.filter(item => {
    const entry = catalogMap.get(item.external_id);
    return entry?.format === 'SEASON';
  }).length;

  const totalMinutes = items.reduce((acc, item) => acc + getItemMinutes(item, catalogMap), 0);
  const totalHours = totalMinutes / 60;

  const ratedItems = nonEditionItems.filter(item => item.rating != null && item.rating > 0);
  const totalRating = ratedItems.reduce((acc, item) => acc + (item.rating || 0), 0);
  const avgScore = ratedItems.length > 0 ? (totalRating / ratedItems.length) : 0;

  const totalDays = (totalHours / 24).toFixed(1);
  const avgPerWork = totalWorks > 0 ? (totalHours / totalWorks).toFixed(1) : '0.0';

  return {
    totalWorks, totalSeasons, totalHours, totalDays, avgPerWork, ratedItems, avgScore,
    completed, currently, paused, dropped, planning,
    completedByType, completedSubBreakdownByType,
  };
}

// ── Time spent by media type ────────────────────────────────────────────────

export interface TypeBreakdownEntry {
  type: string;
  count: number;
  hours: number;
}

// Every media type is always represented in the breakdown, even with zero
// logged works, so the "time by category" block always shows the full
// two-column list instead of only whichever types happen to be in the library.
export function computeTypeBreakdown(items: Items, catalogMap: Map<string, MediaCatalogEntry>): TypeBreakdownEntry[] {
  const nonEditionItems = getNonEditionItems(items, catalogMap);
  const byTypeMap = new Map<string, { count: number; minutes: number }>();

  for (const type of ALL_MEDIA_TYPES) {
    byTypeMap.set(type, { count: 0, minutes: 0 });
  }

  for (const item of nonEditionItems) {
    const val = byTypeMap.get(item.type) || { count: 0, minutes: 0 };
    val.count++;
    byTypeMap.set(item.type, val);
  }

  for (const item of items) {
    const val = byTypeMap.get(item.type) || { count: 0, minutes: 0 };
    val.minutes += getItemMinutes(item, catalogMap);
    byTypeMap.set(item.type, val);
  }

  return Array.from(byTypeMap.entries())
    .map(([type, val]) => ({ type, count: val.count, hours: Number((val.minutes / 60).toFixed(1)) }))
    .sort((a, b) => b.hours - a.hours);
}

// ── Genre breakdown ──────────────────────────────────────────────────────────

export function computeTopGenres(items: Items, catalogMap: Map<string, MediaCatalogEntry>, limit = 10): [string, number][] {
  const nonEditionItems = getNonEditionItems(items, catalogMap);
  const genreCount: Record<string, number> = {};
  for (const item of nonEditionItems) {
    const entry = catalogMap.get(item.external_id);
    if (!entry?.genres_csv) continue;
    for (const g of entry.genres_csv.split(',')) {
      const genre = g.trim();
      if (genre) genreCount[genre] = (genreCount[genre] ?? 0) + 1;
    }
  }
  return Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

// ── Score distribution (bucketed per the active rating system) ─────────────
// Ratings are always stored on the DB's 0-10 scale, but the buckets shown to
// the user need to match whichever display system they picked — 1-5 stars,
// 1-10 (integer or decimal), or the 3 emoji moods — not the raw DB scale.

export interface ScoreBucket {
  label: string;
  count: number;
}

export function computeScoreDistribution(ratedItems: Items, system: RatingSystem): ScoreBucket[] {
  if (system === '5-star') {
    // Stars are logged in half-star increments (RatingInput's StarRating —
    // DB value v*2-1 or v*2 for v in 1..5, i.e. DB 1,2,3,...,10 = stars
    // 0.5,1,1.5,...,5) — so the distribution needs 10 buckets, not 5, or
    // every half-star rating would get rounded into a whole-star bucket.
    // Rounds to the nearest half-star rather than requiring an exact match,
    // so a rating logged under a different system (e.g. a 7.3 from 10-dec)
    // still lands in a sensible bucket instead of being dropped entirely.
    const buckets = Array.from({ length: 10 }, (_, i) => (i + 1) / 2);
    return buckets.map(star => ({
      label: `${star}★`,
      count: ratedItems.filter(i => {
        const rounded = Math.min(5, Math.max(0.5, Math.round(dbRatingToStars5(i.rating ?? 0) * 2) / 2));
        return rounded === star;
      }).length,
    }));
  }

  if (system === '3-emoji') {
    const moods: { key: 'sad' | 'neutral' | 'happy'; emoji: string }[] = [
      { key: 'sad', emoji: '😞' }, { key: 'neutral', emoji: '😐' }, { key: 'happy', emoji: '😊' },
    ];
    return moods.map(({ key, emoji }) => ({
      label: emoji,
      count: ratedItems.filter(i => {
        const rating = i.rating ?? 0;
        const mood = rating <= 3.5 ? 'sad' : rating > 7 ? 'happy' : 'neutral';
        return mood === key;
      }).length,
    }));
  }

  // '10-dec' and '10': whole-number buckets 1 through 10
  const buckets = Array.from({ length: 10 }, (_, i) => i + 1);
  return buckets.map(n => ({
    label: String(n),
    count: ratedItems.filter(i => Math.min(10, Math.max(1, Math.round(i.rating ?? 0))) === n).length,
  }));
}

// ── Completed by year ────────────────────────────────────────────────────────

export interface YearEntry {
  year: number;
  count: number;
}

export function computeCompletedByYear(items: Items, currentYear: number, catalogMap?: Map<string, MediaCatalogEntry>): YearEntry[] {
  const nonEditionItems = getNonEditionItems(items, catalogMap);
  const byYear: Record<number, number> = {};
  for (const item of nonEditionItems) {
    if (item.status !== 'completed') continue;
    const year = parseInt((item.finished_at ?? item.updated_at ?? '').slice(0, 4), 10);
    if (year > 2000 && year <= currentYear) byYear[year] = (byYear[year] ?? 0) + 1;
  }
  return Object.entries(byYear)
    .map(([y, c]) => ({ year: parseInt(y, 10), count: c }))
    .sort((a, b) => a.year - b.year);
}

// ── Upcoming releases (planning items with a known future release date) ────

export interface UpcomingRelease {
  day: number;
  month: number;
  year: number;
  releaseDate: Date;
  title: string;
  type: string;
  cover: string;
  externalId: string;
  // Only set for the Home calendar's "General" (API-driven) view — each
  // source's own popularity metric (AniList follower count, TMDB popularity
  // score, IGDB hype count), used to order same-day releases. Absent for
  // "Para ti" (the user's own library) since it isn't meaningful there.
  popularity?: number;
}

export function computeUpcomingPlanningReleases(
  items: Items,
  catalogMap: Map<string, MediaCatalogEntry>,
  minDate: Date, // lower bound; pass the 1st of the month to include earlier-this-month releases, not just today onward
): UpcomingRelease[] {
  const releases = getNonEditionItems(items, catalogMap)
    .filter(item => item.status === 'planning')
    .map(item => {
      const entry = catalogMap.get(item.external_id);
      if (!entry) return null;

      const year = entry.release_year;
      const month = entry.release_month;
      const day = entry.release_day || 1;

      if (year && month) {
        const releaseDate = new Date(year, month - 1, day);
        if (releaseDate >= minDate) {
          return {
            day, month, year, releaseDate,
            title: entry.title_main || entry.external_id,
            type: entry.type,
            cover: entry.cover_url || '',
            externalId: item.external_id,
          };
        }
      }
      return null;
    })
    .filter(Boolean) as UpcomingRelease[];

  releases.sort((a, b) => a.releaseDate.getTime() - b.releaseDate.getTime());
  return releases;
}

// ── Release calendar grid for the current month ─────────────────────────────

export interface CalendarDay {
  day: number;
  isToday: boolean;
  releases: UpcomingRelease[];
}

export function computeCalendarMonth(
  upcomingReleases: UpcomingRelease[],
  now: Date,
  currentYear: number,
  currentMonth: number, // 0-indexed
): { days: CalendarDay[]; startOffset: number } {
  const releasesByDay: Record<number, UpcomingRelease[]> = {};
  for (const r of upcomingReleases) {
    if (r.year === currentYear && r.month === (currentMonth + 1)) {
      if (!releasesByDay[r.day]) releasesByDay[r.day] = [];
      releasesByDay[r.day].push(r);
    }
  }

  const totalDaysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sunday, 1 = Monday
  const startOffset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  // Also checks year/month, not just the day-of-month number — otherwise
  // navigating the calendar to a different month (see CalendarSection's
  // month arrows) would wrongly highlight whatever day happens to share
  // today's day-of-month number as "today".
  const isCurrentMonth = currentYear === now.getFullYear() && currentMonth === now.getMonth();
  const days: CalendarDay[] = [];
  for (let day = 1; day <= totalDaysInMonth; day++) {
    days.push({ day, isToday: isCurrentMonth && day === now.getDate(), releases: releasesByDay[day] || [] });
  }

  return { days, startOffset };
}

// ── Activity heatmap (last 196 days) ────────────────────────────────────────

export interface HeatmapCell {
  date: Date;
  dateKey: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export function computeActivityHeatmap(journey: { date: string; events?: unknown[] }[], daysBack = 195, totalDays = 196): HeatmapCell[] {
  const activityMap: Record<string, number> = {};
  for (const day of journey) {
    activityMap[day.date] = (day.events || []).length;
  }

  const startDay = new Date();
  startDay.setDate(startDay.getDate() - daysBack);

  const cells: HeatmapCell[] = [];
  for (let i = 0; i < totalDays; i++) {
    const curDate = new Date(startDay);
    curDate.setDate(curDate.getDate() + i);
    const dateKey = curDate.toISOString().split('T')[0];
    const count = activityMap[dateKey] || 0;

    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (count > 0 && count <= 2) level = 1;
    else if (count > 2 && count <= 4) level = 2;
    else if (count > 4 && count <= 6) level = 3;
    else if (count > 6) level = 4;

    cells.push({ date: curDate, dateKey, count, level });
  }
  return cells;
}
