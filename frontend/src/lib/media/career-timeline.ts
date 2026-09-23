// Career timeline of an author or a company (components/shared/
// CareerTimeline.tsx): works grouped into year columns along a horizontal
// axis, decade separators, the "masterpiece" threshold and the summary
// line. Pure — the page hands in its already filtered works.
import type { Translations } from '../../i18n/types';
import { interpolate } from '../shared/text/interpolate';

/** Works scored this high (app's 0–10 scale, scoreGlobal) get the halo. */
export const MASTERPIECE_SCORE = 8;

export function isMasterpiece(score: number | null | undefined): boolean {
  return typeof score === 'number' && Number.isFinite(score) && score >= MASTERPIECE_SCORE;
}

export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

export interface TimelineColumn<T> {
  /** `y1994`, or `unknown` for the undated bucket. */
  key: string;
  /** null for the undated bucket, always last. */
  year: number | null;
  decade: number | null;
  /** First column of its decade: the axis draws a separator before it. */
  decadeStart: boolean;
  works: T[];
}

/** Year columns, oldest first, only years with works (compact), undated
 *  works in one last bucket. Works keep their input order within a year. */
export function groupTimeline<T>(works: readonly T[], yearOf: (work: T) => number | null | undefined): TimelineColumn<T>[] {
  const byYear = new Map<number, T[]>();
  const undated: T[] = [];
  for (const work of works) {
    const year = yearOf(work);
    if (typeof year !== 'number' || !Number.isFinite(year)) {
      undated.push(work);
      continue;
    }
    const bucket = byYear.get(year);
    if (bucket) bucket.push(work);
    else byYear.set(year, [work]);
  }
  const columns: TimelineColumn<T>[] = [];
  let lastDecade: number | null = null;
  for (const [year, bucket] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const decade = decadeOf(year);
    columns.push({ key: `y${year}`, year, decade, decadeStart: decade !== lastDecade, works: bucket });
    lastDecade = decade;
  }
  if (undated.length > 0) columns.push({ key: 'unknown', year: null, decade: null, decadeStart: true, works: undated });
  return columns;
}

export interface TimelineLayoutOptions {
  /** Cover width plus the gap after it. */
  slotWidth: number;
  /** Most covers stacked in one sub-column before a year widens. */
  maxRows: number;
  /** Extra space before the first column of a decade. */
  decadeGap: number;
  /** Space between two year columns. */
  columnGap: number;
}

export interface PositionedColumn<T> extends TimelineColumn<T> {
  x: number;
  width: number;
  /** Sub-columns this year spreads over (ceil(works / rows)). */
  lanes: number;
}

export interface TimelineLayout<T> {
  columns: PositionedColumn<T>[];
  totalWidth: number;
  /** Covers stacked in the tallest column (the axis height). */
  rows: number;
}

/** Fixed x positions for every column, so the scroller can render only the
 *  visible ones without anything moving (no layout shift). */
export function layoutTimeline<T>(columns: readonly TimelineColumn<T>[], options: TimelineLayoutOptions): TimelineLayout<T> {
  const tallest = columns.reduce((max, column) => Math.max(max, column.works.length), 0);
  const rows = Math.max(1, Math.min(options.maxRows, tallest));
  let x = 0;
  const positioned = columns.map((column, i) => {
    if (i > 0) x += options.columnGap;
    if (column.decadeStart && i > 0) x += options.decadeGap;
    const lanes = Math.max(1, Math.ceil(column.works.length / rows));
    const width = lanes * options.slotWidth;
    const placed: PositionedColumn<T> = { ...column, x, width, lanes };
    x += width;
    return placed;
  });
  return { columns: positioned, totalWidth: x, rows };
}

/** Columns overlapping [start, end) — the virtualised window. */
export function visibleColumns<T>(layout: TimelineLayout<T>, start: number, end: number): PositionedColumn<T>[] {
  return layout.columns.filter(column => column.x + column.width >= start && column.x <= end);
}

export interface TimelineSummary {
  firstYear: number | null;
  lastYear: number | null;
  masterpieces: number;
  /** Decade with the most masterpieces (most works when none has any);
   *  ties go to the one with more works, then the earlier one. */
  peakDecade: number | null;
}

export function timelineSummary<T>(
  works: readonly T[],
  yearOf: (work: T) => number | null | undefined,
  scoreOf: (work: T) => number | null | undefined,
): TimelineSummary {
  let firstYear: number | null = null;
  let lastYear: number | null = null;
  let masterpieces = 0;
  const decades = new Map<number, { works: number; masterpieces: number }>();
  for (const work of works) {
    const great = isMasterpiece(scoreOf(work));
    if (great) masterpieces++;
    const year = yearOf(work);
    if (typeof year !== 'number' || !Number.isFinite(year)) continue;
    firstYear = firstYear == null ? year : Math.min(firstYear, year);
    lastYear = lastYear == null ? year : Math.max(lastYear, year);
    const decade = decadeOf(year);
    const entry = decades.get(decade) ?? { works: 0, masterpieces: 0 };
    entry.works++;
    if (great) entry.masterpieces++;
    decades.set(decade, entry);
  }
  let peakDecade: number | null = null;
  let best: { works: number; masterpieces: number } | null = null;
  for (const [decade, entry] of [...decades.entries()].sort((a, b) => a[0] - b[0])) {
    const better = !best
      || entry.masterpieces > best.masterpieces
      || (entry.masterpieces === best.masterpieces && entry.works > best.works);
    if (better) {
      best = entry;
      peakDecade = decade;
    }
  }
  return { firstYear, lastYear, masterpieces, peakDecade };
}

type TimelineStrings = Pick<
  Translations['creator_completion'],
  'timeline_active' | 'timeline_active_single' | 'timeline_masterpieces' | 'timeline_masterpiece_one' | 'timeline_peak' | 'timeline_decade'
>;

export function decadeLabel(decade: number, strings: Pick<TimelineStrings, 'timeline_decade'>): string {
  return interpolate(strings.timeline_decade, { decade });
}

/** "Active 1994–2022", "12 masterpieces", "peak decade: 2010s" — the parts
 *  that apply, for the line above the timeline. */
export function timelineSummaryParts(summary: TimelineSummary, strings: TimelineStrings): string[] {
  const parts: string[] = [];
  if (summary.firstYear != null && summary.lastYear != null) {
    parts.push(summary.firstYear === summary.lastYear
      ? interpolate(strings.timeline_active_single, { year: summary.firstYear })
      : interpolate(strings.timeline_active, { from: summary.firstYear, to: summary.lastYear }));
  }
  if (summary.masterpieces > 0) {
    parts.push(summary.masterpieces === 1
      ? strings.timeline_masterpiece_one
      : interpolate(strings.timeline_masterpieces, { count: summary.masterpieces }));
  }
  if (summary.peakDecade != null && summary.firstYear != null && decadeOf(summary.firstYear) !== decadeOf(summary.lastYear ?? summary.firstYear)) {
    parts.push(interpolate(strings.timeline_peak, { decade: decadeLabel(summary.peakDecade, strings) }));
  }
  return parts;
}
