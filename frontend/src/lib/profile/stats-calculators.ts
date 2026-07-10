import type { getAllLibraryEntries, MediaCatalogEntry } from '../tauri';
import { isInProgressStatus, TYPE_LABELS } from '../constants/media';
import { dbRatingToStars5, type RatingSystem } from '../media/rating-utils';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

// ── Overview aggregates ─────────────────────────────────────────────────────

export interface OverviewAggregate {
  totalWorks: number;
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

export function getNonEditionItems(items: Items): Items {
  const childIds = getEditionChildIds(items);
  return items.filter(item => !childIds.has(item.external_id));
}

// Complement of getNonEditionItems: only the version-log child entries
// themselves — used where a stat wants to break those down separately
// instead of just excluding them.
export function getEditionItems(items: Items): Items {
  const childIds = getEditionChildIds(items);
  return items.filter(item => childIds.has(item.external_id));
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

export function computeOverviewAggregate(items: Items, catalogMap: Map<string, MediaCatalogEntry>): OverviewAggregate {
  const nonEditionItems = getNonEditionItems(items);
  const totalWorks = nonEditionItems.length;
  const totalMinutes = items.reduce((acc, item) => acc + getItemMinutes(item, catalogMap), 0);
  const totalHours = totalMinutes / 60;

  const ratedItems = nonEditionItems.filter(item => item.rating != null && item.rating > 0);
  const totalRating = ratedItems.reduce((acc, item) => acc + (item.rating || 0), 0);
  const avgScore = ratedItems.length > 0 ? (totalRating / ratedItems.length) : 0;

  const completed = nonEditionItems.filter(item => item.status === 'completed').length;
  const currently = nonEditionItems.filter(item => isInProgressStatus(item.status)).length;
  const paused = nonEditionItems.filter(item => item.status === 'paused').length;
  const dropped = nonEditionItems.filter(item => item.status === 'dropped').length;
  const planning = nonEditionItems.filter(item => item.status === 'planning').length;

  const totalDays = (totalHours / 24).toFixed(1);
  const avgPerWork = totalWorks > 0 ? (totalHours / totalWorks).toFixed(1) : '0.0';

  return { totalWorks, totalHours, totalDays, avgPerWork, ratedItems, avgScore, completed, currently, paused, dropped, planning };
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
  const nonEditionItems = getNonEditionItems(items);
  const byTypeMap = new Map<string, { count: number; minutes: number }>();

  for (const type of Object.keys(TYPE_LABELS)) {
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
  const nonEditionItems = getNonEditionItems(items);
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

export function computeCompletedByYear(items: Items, currentYear: number): YearEntry[] {
  const nonEditionItems = getNonEditionItems(items);
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
}

export function computeUpcomingPlanningReleases(
  items: Items,
  catalogMap: Map<string, MediaCatalogEntry>,
  todayDate: Date,
): UpcomingRelease[] {
  const releases = getNonEditionItems(items)
    .filter(item => item.status === 'planning')
    .map(item => {
      const entry = catalogMap.get(item.external_id);
      if (!entry) return null;

      const year = entry.release_year;
      const month = entry.release_month;
      const day = entry.release_day || 1;

      if (year && month) {
        const releaseDate = new Date(year, month - 1, day);
        if (releaseDate >= todayDate) {
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

  const days: CalendarDay[] = [];
  for (let day = 1; day <= totalDaysInMonth; day++) {
    days.push({ day, isToday: day === now.getDate(), releases: releasesByDay[day] || [] });
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
