// Creator completion index: how much of an author's or a company's body of
// work the user has finished. Pure — the pages hand in the works (external
// ids, types, release state) and the cached library/catalog rows
// (lib/profile/library-data-cache.ts); SagaCompletionBar's sibling for
// creators instead of sagas.
import type { Translations } from '../../i18n/types';
import { interpolate } from '../shared/text/interpolate';
import { isInProgressStatus } from './media-types';

export type CreatorKind = 'author' | 'company';

/** The user's relationship with one work, as the cards show it. */
export type WorkLibraryState = 'completed' | 'in_progress' | 'planned' | 'dropped' | 'missing';

export interface CreatorWorkRef {
  externalId: string;
  type: string;
  /** Known not to be out yet (provider data). */
  unreleased?: boolean;
  /** DLC / bundle / pack: only counted when the caller includes extras. */
  isExtra?: boolean;
}

export interface CreatorLibraryRow {
  status: string | null;
}

export interface CreatorCatalogRow {
  status?: string | null;
}

export interface CreatorCompletionOptions {
  includeExtras?: boolean;
  /** Catalog rows fill in the release state the provider didn't give. */
  catalogById?: ReadonlyMap<string, CreatorCatalogRow>;
}

export interface CreatorCompletion {
  completed: number;
  inProgress: number;
  planned: number;
  dropped: number;
  /** Counted works: released, deduplicated, extras only when included. */
  total: number;
  /** 0–100, completed over total. */
  percent: number;
  /** The one media type every counted work shares, or null when mixed. */
  singleType: string | null;
  unreleasedExcluded: number;
  extrasExcluded: number;
}

const UNRELEASED_CATALOG_STATUS = 'NOT_YET_RELEASED';

export function workLibraryState(row: CreatorLibraryRow | undefined): WorkLibraryState {
  const status = row?.status;
  if (!status) return 'missing';
  if (status === 'completed') return 'completed';
  // Paused is still a work the user is in the middle of.
  if (isInProgressStatus(status) || status === 'paused') return 'in_progress';
  if (status === 'planning') return 'planned';
  if (status === 'dropped') return 'dropped';
  return 'missing';
}

export function computeCreatorCompletion(
  works: readonly CreatorWorkRef[],
  libraryById: ReadonlyMap<string, CreatorLibraryRow>,
  options: CreatorCompletionOptions = {},
): CreatorCompletion {
  const result: CreatorCompletion = {
    completed: 0, inProgress: 0, planned: 0, dropped: 0, total: 0, percent: 0,
    singleType: null, unreleasedExcluded: 0, extrasExcluded: 0,
  };
  const types = new Set<string>();
  const seen = new Set<string>();

  for (const work of works) {
    if (seen.has(work.externalId)) continue;
    seen.add(work.externalId);

    const state = workLibraryState(libraryById.get(work.externalId));
    // Something the user already finished or started is out, whatever the
    // (possibly stale) provider data says.
    const engaged = state === 'completed' || state === 'in_progress' || state === 'dropped';
    if (work.isExtra && !options.includeExtras) { result.extrasExcluded++; continue; }
    const unreleased = work.unreleased || options.catalogById?.get(work.externalId)?.status === UNRELEASED_CATALOG_STATUS;
    if (unreleased && !engaged) { result.unreleasedExcluded++; continue; }

    result.total++;
    types.add(work.type);
    if (state === 'completed') result.completed++;
    else if (state === 'in_progress') result.inProgress++;
    else if (state === 'planned') result.planned++;
    else if (state === 'dropped') result.dropped++;
  }

  result.percent = result.total > 0 ? Math.round((result.completed / result.total) * 100) : 0;
  result.singleType = types.size === 1 ? [...types][0] : null;
  return result;
}

/** Hidden when the user has none of the creator's works in any list. */
export function isCreatorCompletionVisible(result: CreatorCompletion): boolean {
  return result.total > 0 && result.completed + result.inProgress + result.planned + result.dropped > 0;
}

type CompletionStrings = Translations['creator_completion'];

export function creatorCompletionHeadline(
  result: CreatorCompletion,
  kind: CreatorKind,
  name: string,
  strings: CompletionStrings,
): string {
  const vars = { completed: result.completed, total: result.total, name, percent: result.percent };
  const typed = (kind === 'author' ? strings.author_typed : strings.company_typed) as Record<string, string>;
  const template = (result.singleType && typed[result.singleType])
    || (kind === 'author' ? strings.author_mixed : strings.company_mixed);
  return interpolate(template, vars);
}

/** Tooltip lines: status breakdown, then what was left out and why. */
export function creatorCompletionDetails(result: CreatorCompletion, strings: CompletionStrings): string[] {
  const lines = [interpolate(strings.breakdown, {
    completed: result.completed, in_progress: result.inProgress, planned: result.planned,
  })];
  if (result.unreleasedExcluded > 0) lines.push(interpolate(strings.unreleased_not_counted, { count: result.unreleasedExcluded }));
  if (result.extrasExcluded > 0) lines.push(interpolate(strings.extras_not_counted, { count: result.extrasExcluded }));
  return lines;
}

/** 0–1 progress through an in-progress work, or null when its length is
 *  unknown (a game, or a catalog row without a count). */
export function workProgressRatio(
  row: { progress?: number | null } | undefined,
  totalCount: number | null | undefined,
): number | null {
  if (!row || !totalCount || totalCount <= 0) return null;
  const progress = Math.max(0, row.progress ?? 0);
  return Math.min(1, progress / totalCount);
}
