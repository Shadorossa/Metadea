import type { LibraryEntry, CatalogSummary, DayJourney } from '../tauri';
import type { Translations } from '../../i18n';
import { isInProgressStatus } from '../media/media-types';
import { getNonEditionItems } from './stats-calculators';

// ── Duration rules ───────────────────────────────────────────────────────────
//
// One table for every "how long is one unit of this type" assumption the
// backlog estimate makes. `unit` is what the library entry's `progress`
// counts (and `total_count` on the catalog row) for that type:
//
//   anime/series  episode  — catalog `time_length` is the runtime in minutes
//                            of ONE episode (see getItemMinutes), fallback
//                            24 min anime / 45 min series.
//   movie         whole    — `time_length` is the full runtime, or 110 min.
//                            An anime/series row with format MOVIE is a
//                            movie too (AniList keeps them under type anime).
//   manga         chapter  — 8 min per chapter.
//   lnovel        volume   — 6 h per volume; progress_2/total_count_2 hold
//                            volumes (progress/total_count are chapters).
//   book          page     — 1.5 min per page when the page count is known,
//                            otherwise a flat 8 h.
//   comic         issue    — 20 min per issue.
//   game          hours    — the catalog never stores hours-to-beat for
//                            games (no mapper writes `time_length` for them,
//                            grep lib/media/mappers), so it is ignored and a
//                            flat 20 h is assumed; `progress` is hours played.
//   vnovel        hours    — `time_length` read as hours-to-read, or 30 h;
//                            `progress` is hours played.
//
// `fallbackUnits` is how many units a work is assumed to have when the
// catalog has no total (a still-releasing manga, an unlisted series...).
// Every entry that hits a fallback is counted in `missingDataCount`, which
// is what the "low confidence" flag is derived from.

interface UnitRule {
  kind: 'units' | 'whole' | 'hours';
  defaultUnitMinutes: number;
  fallbackUnits: number;
}

export const BACKLOG_TYPE_RULES: Readonly<Record<string, UnitRule>> = {
  anime:  { kind: 'units', defaultUnitMinutes: 24,  fallbackUnits: 12 },
  series: { kind: 'units', defaultUnitMinutes: 45,  fallbackUnits: 10 },
  movie:  { kind: 'whole', defaultUnitMinutes: 110, fallbackUnits: 1 },
  manga:  { kind: 'units', defaultUnitMinutes: 8,   fallbackUnits: 40 },
  lnovel: { kind: 'units', defaultUnitMinutes: 360, fallbackUnits: 1 },
  book:   { kind: 'units', defaultUnitMinutes: 1.5, fallbackUnits: 320 }, // 320 pages × 1.5 min = 8 h
  comic:  { kind: 'units', defaultUnitMinutes: 20,  fallbackUnits: 6 },
  game:   { kind: 'hours', defaultUnitMinutes: 20 * 60, fallbackUnits: 1 },
  vnovel: { kind: 'hours', defaultUnitMinutes: 30 * 60, fallbackUnits: 1 },
};

// Types the estimate has no duration model for (events, characters...).
function ruleFor(type: string): UnitRule | null {
  return BACKLOG_TYPE_RULES[type] ?? null;
}

// A type whose catalog `time_length` is the length of one unit (episode /
// whole movie / whole VN). Manga chapters, book pages, etc. have no stored
// duration, and games' time_length is not hours-to-beat.
function catalogMinutesPerUnit(type: string, catalog: CatalogSummary | undefined, isMovie: boolean): number | null {
  const len = catalog?.time_length;
  if (!len || len <= 0) return null;
  if (isMovie || type === 'anime' || type === 'series') return len;
  if (type === 'vnovel') return len * 60;
  return null;
}

// ── Backlog scope ────────────────────────────────────────────────────────────

export type BacklogScope = 'planning' | 'in_progress' | 'paused';

export const DEFAULT_BACKLOG_SCOPE: readonly BacklogScope[] = ['planning', 'in_progress'];

export interface BacklogOptions {
  scope?: readonly BacklogScope[];
}

function scopeOf(status: string | null | undefined): BacklogScope | null {
  const s = status ?? 'planning';
  if (s === 'planning') return 'planning';
  if (isInProgressStatus(s)) return 'in_progress';
  if (s === 'paused') return 'paused';
  return null;
}

// ── Per-item remaining minutes ───────────────────────────────────────────────

export interface ItemRemaining {
  minutes: number;
  usedFallback: boolean;
}

export function estimateItemRemaining(item: LibraryEntry, catalog: CatalogSummary | undefined): ItemRemaining | null {
  const isMovie = item.type === 'movie' || catalog?.format === 'MOVIE';
  const rule = isMovie ? BACKLOG_TYPE_RULES.movie : ruleFor(item.type);
  if (!rule) return null;

  const fromCatalog = catalogMinutesPerUnit(item.type, catalog, isMovie);
  const perUnit = fromCatalog ?? rule.defaultUnitMinutes;

  if (rule.kind === 'whole') {
    // A movie is one sitting: any logged progress means it has been seen.
    const done = (item.progress ?? 0) >= 1;
    return { minutes: done ? 0 : perUnit, usedFallback: fromCatalog === null };
  }

  if (rule.kind === 'hours') {
    const played = Math.max(0, item.progress ?? 0) * 60;
    // Games never carry a trustworthy duration in the catalog (see the
    // rules table), so they are always a guess.
    const usedFallback = item.type === 'game' || fromCatalog === null;
    return { minutes: Math.max(0, perUnit - played), usedFallback };
  }

  // Unit-counted work (episodes / chapters / volumes / pages / issues).
  const usesVolumes = item.type === 'lnovel';
  const total = usesVolumes ? catalog?.total_count_2 : catalog?.total_count;
  const progress = Math.max(0, (usesVolumes ? item.progress_2 : item.progress) ?? 0);
  const hasTotal = typeof total === 'number' && total > 0;
  const remainingUnits = hasTotal
    ? Math.max(0, total - progress)
    : Math.max(0, rule.fallbackUnits - progress);
  const usedFallback = !hasTotal || (fromCatalog === null && (item.type === 'anime' || item.type === 'series'));
  return { minutes: remainingUnits * perUnit, usedFallback };
}

// ── Aggregate ────────────────────────────────────────────────────────────────

export interface BacklogTypeEstimate {
  type: string;
  pendingCount: number;
  remainingMinutes: number;
  missingDataCount: number;
  lowConfidence: boolean;
}

export interface BacklogEstimate {
  byType: BacklogTypeEstimate[];
  total: BacklogTypeEstimate;
}

// More than half the pending works needed a default duration → the number
// is a guess, not a measurement.
function isLowConfidence(pending: number, missing: number): boolean {
  return pending > 0 && missing * 2 > pending;
}

export function estimateBacklog(
  items: readonly LibraryEntry[],
  catalogById: Map<string, CatalogSummary>,
  options: BacklogOptions = {},
): BacklogEstimate {
  const scope = new Set<BacklogScope>(options.scope ?? DEFAULT_BACKLOG_SCOPE);
  const buckets = new Map<string, BacklogTypeEstimate>();

  for (const item of getNonEditionItems([...items], catalogById)) {
    const itemScope = scopeOf(item.status);
    if (!itemScope || !scope.has(itemScope)) continue;
    const remaining = estimateItemRemaining(item, catalogById.get(item.external_id));
    if (!remaining || remaining.minutes <= 0) continue;

    const bucket = buckets.get(item.type) ?? { type: item.type, pendingCount: 0, remainingMinutes: 0, missingDataCount: 0, lowConfidence: false };
    bucket.pendingCount++;
    bucket.remainingMinutes += remaining.minutes;
    if (remaining.usedFallback) bucket.missingDataCount++;
    buckets.set(item.type, bucket);
  }

  const byType = [...buckets.values()]
    .map(b => ({ ...b, lowConfidence: isLowConfidence(b.pendingCount, b.missingDataCount) }))
    .sort((a, b) => b.remainingMinutes - a.remainingMinutes);

  const total = byType.reduce<BacklogTypeEstimate>((acc, b) => ({
    type: 'all',
    pendingCount: acc.pendingCount + b.pendingCount,
    remainingMinutes: acc.remainingMinutes + b.remainingMinutes,
    missingDataCount: acc.missingDataCount + b.missingDataCount,
    lowConfidence: false,
  }), { type: 'all', pendingCount: 0, remainingMinutes: 0, missingDataCount: 0, lowConfidence: false });
  total.lowConfidence = isLowConfidence(total.pendingCount, total.missingDataCount);

  return { byType, total };
}

// ── Pace ─────────────────────────────────────────────────────────────────────

export const DEFAULT_PACE_MINUTES_PER_WEEK = 10 * 60;
export const PACE_WINDOW_WEEKS = 4;
export const PACE_FALLBACK_WINDOW_WEEKS = 12;

export interface PaceEstimate {
  minutesPerWeek: number;
  // Weeks of history the figure was averaged over (0 = global default).
  weeks: number;
  lowConfidence: boolean;
  // Per-type average over the same window, only for types with activity.
  byType: Record<string, number>;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Minutes one journey event represents: its progress delta × the unit
// length of that work (same rules as the backlog itself), hours × 60 for
// games/VNs. Events without a numeric delta ('start', a bare 'complete'
// logged by hand) carry no measurable time and are skipped.
function eventMinutes(event: DayJourney['events'][number], catalog: CatalogSummary | undefined): number {
  const { progressStart, progressEnd } = event;
  if (typeof progressStart !== 'number' || typeof progressEnd !== 'number') return 0;
  const delta = progressEnd - progressStart;
  if (!(delta > 0)) return 0;
  const type = event.mediaType;
  const isMovie = type === 'movie' || catalog?.format === 'MOVIE';
  const rule = isMovie ? BACKLOG_TYPE_RULES.movie : ruleFor(type);
  if (!rule) return 0;
  if (rule.kind === 'hours') return delta * 60;
  if (rule.kind === 'whole') return catalogMinutesPerUnit(type, catalog, true) ?? rule.defaultUnitMinutes;
  const perUnit = catalogMinutesPerUnit(type, catalog, false) ?? rule.defaultUnitMinutes;
  return delta * perUnit;
}

function sumWindow(journey: readonly DayJourney[], catalogById: Map<string, CatalogSummary>, now: Date, weeks: number) {
  const from = now.getTime() - weeks * WEEK_MS;
  let total = 0;
  const byType: Record<string, number> = {};
  for (const day of journey) {
    for (const event of day.events ?? []) {
      const ts = Date.parse(event.timestamp);
      if (Number.isNaN(ts) || ts < from || ts > now.getTime()) continue;
      const minutes = eventMinutes(event, catalogById.get(event.externalId));
      if (minutes <= 0) continue;
      total += minutes;
      byType[event.mediaType] = (byType[event.mediaType] ?? 0) + minutes;
    }
  }
  return { total, byType };
}

export function estimatePace(
  journey: readonly DayJourney[],
  catalogById: Map<string, CatalogSummary>,
  now: Date = new Date(),
): PaceEstimate {
  for (const weeks of [PACE_WINDOW_WEEKS, PACE_FALLBACK_WINDOW_WEEKS]) {
    const { total, byType } = sumWindow(journey, catalogById, now, weeks);
    if (total <= 0) continue;
    const perType: Record<string, number> = {};
    for (const [type, minutes] of Object.entries(byType)) perType[type] = minutes / weeks;
    return {
      minutesPerWeek: total / weeks,
      weeks,
      lowConfidence: weeks !== PACE_WINDOW_WEEKS,
      byType: perType,
    };
  }
  return { minutesPerWeek: DEFAULT_PACE_MINUTES_PER_WEEK, weeks: 0, lowConfidence: true, byType: {} };
}

// ── Duration formatting / finish date ────────────────────────────────────────

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const MINUTES_PER_MONTH = 30 * MINUTES_PER_DAY;
const MINUTES_PER_YEAR = 365 * MINUTES_PER_DAY;

type DurationUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute';

const DURATION_UNITS: ReadonlyArray<{ unit: DurationUnit; minutes: number }> = [
  { unit: 'year', minutes: MINUTES_PER_YEAR },
  { unit: 'month', minutes: MINUTES_PER_MONTH },
  { unit: 'week', minutes: MINUTES_PER_WEEK },
  { unit: 'day', minutes: MINUTES_PER_DAY },
  { unit: 'hour', minutes: MINUTES_PER_HOUR },
  { unit: 'minute', minutes: 1 },
];

type DurationLabels = Translations['profile']['backlog'];

function unitLabel(labels: DurationLabels, unit: DurationUnit, n: number): string {
  const key = `duration_${unit}_${n === 1 ? 'one' : 'other'}` as const;
  return labels[key].replace('{n}', String(n));
}

/** "1 year 4 months", "3 weeks", "2 days", "59 min" — the two largest
 *  non-zero units, each floored, so the string never overstates. */
export function formatDuration(minutes: number, t: Translations): string {
  const labels = t.profile.backlog;
  let rest = Math.max(0, Math.floor(minutes));
  if (rest === 0) return labels.duration_zero;
  const parts: string[] = [];
  for (const { unit, minutes: size } of DURATION_UNITS) {
    if (parts.length === 2) break;
    if (parts.length === 0 && rest < size) continue;
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n > 0) parts.push(unitLabel(labels, unit, n));
    else if (parts.length > 0) break; // the unit right below the leading one is empty: stop, don't skip down further
  }
  return parts.join(' ');
}

/** The calendar date `remainingMinutes` of backlog runs out at
 *  `minutesPerWeek`; null when the pace is zero (never). */
export function estimateFinishDate(now: Date, remainingMinutes: number, minutesPerWeek: number): Date | null {
  if (!(minutesPerWeek > 0) || remainingMinutes < 0) return null;
  const weeks = remainingMinutes / minutesPerWeek;
  return new Date(now.getTime() + weeks * WEEK_MS);
}
