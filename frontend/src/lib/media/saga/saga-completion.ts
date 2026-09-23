// Pure completion arithmetic for SagaCompletionBar (components/media/saga):
// given the saga viewer's own panels, the user's library rows and the
// catalog rows it already has cached, how much of the saga has the user
// actually finished — as a plain count when every member is the same kind of
// work, or as a unit-weighted percentage when the saga mixes types.
import type { SagaEntry } from '../../anilist/saga';
import type { Translations } from '../../../i18n/types';
import { interpolate } from '../../shared/text/interpolate';

export type SagaUnitLabel = 'episodes' | 'chapters' | 'volumes' | 'issues' | 'works';

export interface SagaCompletionLibraryRow {
  status: string | null;
  progress: number;
  progress_2?: number;
}

export interface SagaCompletionCatalogRow {
  type: string;
  status?: string | null;
  release_year?: number | null;
  total_count: number | null;
  total_count_2?: number | null;
}

export interface SagaTypeCompletion {
  completed: number;
  total: number;
  consumedUnits: number;
  totalUnits: number;
  percentUnits: number;
  unitLabel: SagaUnitLabel;
}

export interface SagaCompletionResult {
  completedCount: number;
  totalCount: number;
  /** 0–100, consumed units over total units across every counted member. */
  weightedPercent: number;
  byType: Record<string, SagaTypeCompletion>;
  unitLabel: SagaUnitLabel;
  /** Members left out of the denominator because they are not out yet. */
  upcomingCount: number;
  /** Whether at least one counted member has a library row at all. */
  hasLibraryEntries: boolean;
}

export interface SagaCompletionOptions {
  currentYear?: number;
}

export const COMPLETED_STATUS = 'completed';
const UNRELEASED_CATALOG_STATUS = 'NOT_YET_RELEASED';

// Which library column is the "unit" for each type; anything not listed is a
// single work (a game, a movie, a visual novel) that is either done or not.
const UNIT_LABEL_BY_TYPE: Record<string, SagaUnitLabel> = {
  anime: 'episodes',
  series: 'episodes',
  manga: 'chapters',
  comic: 'issues',
  lnovel: 'volumes',
  book: 'volumes',
};

export function unitLabelForType(type: string): SagaUnitLabel {
  return UNIT_LABEL_BY_TYPE[type] ?? 'works';
}

interface MemberUnits {
  type: string;
  completed: boolean;
  consumed: number;
  total: number;
  hasLibraryRow: boolean;
}

function isUpcoming(entry: SagaEntry, catalog: SagaCompletionCatalogRow | undefined, currentYear: number): boolean {
  if (catalog?.status === UNRELEASED_CATALOG_STATUS) return true;
  const year = catalog?.release_year ?? entry.year;
  return year != null && year > currentYear;
}

function entryUnits(
  entry: SagaEntry,
  library: SagaCompletionLibraryRow | undefined,
  catalog: SagaCompletionCatalogRow | undefined,
): MemberUnits {
  const type = catalog?.type ?? entry.mediaType;
  const completed = library?.status === COMPLETED_STATUS;
  const totalCount = unitLabelForType(type) === 'works' ? null : catalog?.total_count ?? null;
  // Unknown totals collapse to a single all-or-nothing unit — a half-watched
  // series with no episode count would otherwise weigh nothing at all.
  if (totalCount == null || totalCount <= 0) {
    return { type, completed, consumed: completed ? 1 : 0, total: 1, hasLibraryRow: !!library };
  }
  const progress = Math.max(0, Math.min(library?.progress ?? 0, totalCount));
  return { type, completed, consumed: completed ? totalCount : progress, total: totalCount, hasLibraryRow: !!library };
}

// A panel with several entries is one work shown in alternative cuts or
// editions (see loadSagaAlternativeGroups); it counts once, through whichever
// edition the user got furthest with.
function panelUnits(
  panel: SagaEntry[],
  libraryById: ReadonlyMap<string, SagaCompletionLibraryRow>,
  catalogById: ReadonlyMap<string, SagaCompletionCatalogRow>,
): MemberUnits {
  const candidates = panel.map(entry => entryUnits(entry, libraryById.get(entry.externalId), catalogById.get(entry.externalId)));
  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    const bestRatio = best.consumed / best.total;
    const candidateRatio = candidate.consumed / candidate.total;
    if (candidate.completed && !best.completed) best = candidate;
    else if (candidate.completed === best.completed && candidateRatio > bestRatio) best = candidate;
  }
  return { ...best, hasLibraryRow: candidates.some(candidate => candidate.hasLibraryRow) };
}

export function computeSagaCompletion(
  members: readonly SagaEntry[][],
  libraryById: ReadonlyMap<string, SagaCompletionLibraryRow>,
  catalogById: ReadonlyMap<string, SagaCompletionCatalogRow>,
  options: SagaCompletionOptions = {},
): SagaCompletionResult {
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const byType: Record<string, SagaTypeCompletion> = {};
  let completedCount = 0;
  let totalCount = 0;
  let consumedUnits = 0;
  let totalUnits = 0;
  let upcomingCount = 0;
  let hasLibraryEntries = false;

  for (const panel of members) {
    if (panel.length === 0) continue;
    if (panel.every(entry => isUpcoming(entry, catalogById.get(entry.externalId), currentYear))) {
      upcomingCount++;
      continue;
    }
    const units = panelUnits(panel, libraryById, catalogById);
    const bucket = byType[units.type] ??= {
      completed: 0, total: 0, consumedUnits: 0, totalUnits: 0, percentUnits: 0, unitLabel: unitLabelForType(units.type),
    };
    bucket.total++;
    bucket.totalUnits += units.total;
    bucket.consumedUnits += units.consumed;
    if (units.completed) bucket.completed++;
    totalCount++;
    totalUnits += units.total;
    consumedUnits += units.consumed;
    if (units.completed) completedCount++;
    if (units.hasLibraryRow) hasLibraryEntries = true;
  }

  for (const bucket of Object.values(byType)) {
    bucket.percentUnits = percentOf(bucket.consumedUnits, bucket.totalUnits);
  }

  const types = Object.keys(byType);
  return {
    completedCount,
    totalCount,
    weightedPercent: percentOf(consumedUnits, totalUnits),
    byType,
    unitLabel: types.length === 1 ? byType[types[0]].unitLabel : 'works',
    upcomingCount,
    hasLibraryEntries,
  };
}

function percentOf(consumed: number, total: number): number {
  return total > 0 ? Math.round((consumed / total) * 100) : 0;
}

export const SAGA_COMPLETION_MIN_PERCENT = 1;

/** The bar only earns its space once the user is meaningfully into the saga. */
export function isSagaCompletionVisible(result: SagaCompletionResult): boolean {
  return result.hasLibraryEntries && result.weightedPercent > SAGA_COMPLETION_MIN_PERCENT;
}

type SagaCompletionStrings = Translations['media']['saga_completion'];

function typeLabel(strings: SagaCompletionStrings, type: string): string {
  const labels: Record<string, string> = strings.types;
  return labels[type] ?? type;
}

/** "4 of 7 games" when every member is the same type, otherwise the percent
 *  form naming every type the saga spans. */
export function pickHeadline(result: SagaCompletionResult, strings: SagaCompletionStrings): string {
  const types = Object.keys(result.byType);
  if (types.length === 1) {
    return interpolate(strings.count, {
      completed: result.completedCount,
      total: result.totalCount,
      type: typeLabel(strings, types[0]),
    });
  }
  return interpolate(strings.percent, {
    percent: result.weightedPercent,
    types: types.map(type => typeLabel(strings, type)).join(', '),
  });
}

export function describeTypeBreakdown(result: SagaCompletionResult, strings: SagaCompletionStrings): string[] {
  return Object.entries(result.byType).map(([type, bucket]) => interpolate(strings.breakdown, {
    type: typeLabel(strings, type),
    completed: bucket.completed,
    total: bucket.total,
    percent: bucket.percentUnits,
  }));
}
