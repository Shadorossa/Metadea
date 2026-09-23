// The media page's filler data (lib/tauri/anime-filler.ts): resolveChainFillerInfo
// loads the anime's PREQUEL/SEQUEL chain links in one call, auto-links the
// chain on the first visit (index match → fetch the show → verify offsets →
// store), and lets Rust refresh a linked show when it's due (airing: weekly;
// finished: never). Manual link edits live here too. The library-wide map
// the stats read synchronously is ./filler-store.ts.
//
// Everything degrades to "no data": an empty index, a backoff or offline
// just hides the filler UI.

import {
  ensureFillerShow, getFillerIndex, getFillerInfo, removeFillerLink, setFillerLink,
  type FillerIndexShow,
} from '../tauri/anime-filler';
import type { AnimeChainRow } from '../tauri/media-page';
import { readAnimeChainCached } from '../media/media-page-read-cache';
import type { FillerInfo } from './filler';
import { fillerRowsToMap as rowsToMap, notifyFillerInfoChanged } from './filler-store';
import { planChainFillerLinks, verifyPlannedLink, type FillerChainEntry } from './filler-match';

export { FILLER_INFO_CHANGED_EVENT, getLoadedFillerInfo, loadAllFillerInfo } from './filler-store';

// ── Show index ──────────────────────────────────────────────────────────────

let indexPromise: Promise<FillerIndexShow[]> | null = null;

export function loadFillerIndex(): Promise<FillerIndexShow[]> {
  if (!indexPromise) {
    const pending = getFillerIndex().then(shows => {
      if (shows.length === 0 && indexPromise === pending) indexPromise = null;
      return shows;
    });
    indexPromise = pending;
  }
  return indexPromise;
}

// ── Media page ──────────────────────────────────────────────────────────────

export interface ChainFillerEntry {
  externalId: string;
  titles: string[];
  totalCount: number;
  format?: string;
  airing: boolean;
  /** First episode of this entry in the page's chain-wide episode
   *  numbering (the unified-seasons list), minus one. */
  chainStart: number;
}

export interface ChainFillerState {
  /** Chain order (prequels first); just the entry itself outside a chain. */
  entries: ChainFillerEntry[];
  /** Filler info per linked entry that has fetched show data. */
  infos: Map<string, FillerInfo>;
  /** Stored links whose show has no data yet (fetch failed / backoff). */
  pendingSlugs: Map<string, string>;
}

function titlesOf(row: AnimeChainRow): string[] {
  const titles = [row.title_romaji, row.title_main, row.title_english, row.title_native]
    .filter((title): title is string => !!title?.trim());
  return [...new Set(titles)];
}

/** Same rule as anime-tmdb-match's chain offset: movies and one-off
 *  specials don't take part in the numbered TV run. */
function contributesToEpisodeRun(format: string | null | undefined, totalCount: number): boolean {
  const upper = format?.toUpperCase();
  return upper !== 'MOVIE' && !(upper === 'SPECIAL' && totalCount <= 1);
}

export function chainEntriesFromRows(rows: readonly AnimeChainRow[]): ChainFillerEntry[] {
  let chainStart = 0;
  return rows.map(row => {
    const totalCount = row.total_count ?? 0;
    const entry: ChainFillerEntry = {
      externalId: row.external_id,
      titles: titlesOf(row),
      totalCount,
      format: row.format ?? undefined,
      airing: row.status?.toUpperCase() === 'RELEASING',
      chainStart,
    };
    if (contributesToEpisodeRun(row.format, totalCount)) chainStart += totalCount;
    return entry;
  });
}

export interface ResolveFillerOptions {
  /** Titles of the page's own entry (used when it has no anime chain, e.g.
   *  a TMDB series). */
  titles: string[];
  totalCount: number;
  airing: boolean;
  format?: string;
}

const autoLinkAttempted = new Set<string>();

async function autoLinkChain(entries: ChainFillerEntry[], linked: ReadonlySet<string>): Promise<boolean> {
  const index = await loadFillerIndex();
  if (index.length === 0) return false;
  const chain: FillerChainEntry[] = entries.map(entry => ({
    externalId: entry.externalId, titles: entry.titles, totalCount: entry.totalCount, format: entry.format,
  }));
  const plans = planChainFillerLinks(chain, index).filter(plan => !linked.has(plan.externalId));
  if (plans.length === 0) return false;
  const bySlug = new Map<string, typeof plans>();
  for (const plan of plans) bySlug.set(plan.slug, [...(bySlug.get(plan.slug) ?? []), plan]);
  let stored = false;
  // One show at a time: Rust spaces the requests anyway, and a refusal
  // (backoff) makes every later call return from cache immediately.
  for (const [slug, slugPlans] of bySlug) {
    const airing = slugPlans.some(plan => entries.find(entry => entry.externalId === plan.externalId)?.airing);
    const show = await ensureFillerShow(slug, airing);
    if (!show) continue;
    for (const plan of slugPlans) {
      const entry = entries.find(candidate => candidate.externalId === plan.externalId);
      if (!entry || !verifyPlannedLink(plan, entry.totalCount, show.lastEpisode, entry.airing)) continue;
      await setFillerLink({ ...plan, manual: false });
      stored = true;
    }
  }
  return stored;
}

/**
 * Filler state for a media page: the chain (or the entry alone), each
 * linked entry's info, and a first-visit auto-link of the whole chain.
 */
export async function resolveChainFillerInfo(externalId: string, self: ResolveFillerOptions): Promise<ChainFillerState> {
  const rows = await readAnimeChainCached(externalId).catch(() => [] as AnimeChainRow[]);
  const entries = rows.length > 0
    ? chainEntriesFromRows(rows)
    : [{ externalId, titles: self.titles, totalCount: self.totalCount, format: self.format, airing: self.airing, chainStart: 0 }];
  const ids = entries.map(entry => entry.externalId);

  let infoRows = await getFillerInfo(ids);
  if (!autoLinkAttempted.has(externalId)) {
    autoLinkAttempted.add(externalId);
    const linked = new Set(infoRows.map(row => row.link.externalId));
    if (!linked.has(externalId) && await autoLinkChain(entries, linked).catch(() => false)) {
      infoRows = await getFillerInfo(ids);
      notifyFillerInfoChanged();
    }
  }

  // Let Rust refresh what's due (never fetched, or airing and a week old).
  const refreshed = new Map<string, boolean>();
  for (const row of infoRows) {
    const entry = entries.find(candidate => candidate.externalId === row.link.externalId);
    const airing = !!entry?.airing || !!row.show?.isAiring;
    if (row.show && !airing) continue;
    refreshed.set(row.link.slug, (refreshed.get(row.link.slug) ?? false) || airing);
  }
  if (refreshed.size > 0) {
    const before = new Map(infoRows.map(row => [row.link.slug, row.show?.fetchedAt ?? null]));
    let changed = false;
    for (const [slug, airing] of refreshed) {
      const show = await ensureFillerShow(slug, airing);
      if (show && show.fetchedAt !== before.get(slug)) changed = true;
    }
    if (changed) {
      infoRows = await getFillerInfo(ids);
      notifyFillerInfoChanged();
    }
  }

  const infos = rowsToMap(infoRows);
  const pendingSlugs = new Map<string, string>();
  for (const row of infoRows) if (!row.show) pendingSlugs.set(row.link.externalId, row.link.slug);
  return { entries, infos, pendingSlugs };
}

/** Offset suggested when the user picks `slug` by hand: where the earlier
 *  chain entries already linked to the same show end. */
export function suggestFillerOffset(state: ChainFillerState, externalId: string, slug: string): number {
  let offset = 0;
  for (const entry of state.entries) {
    if (entry.externalId === externalId) break;
    const info = state.infos.get(entry.externalId);
    if (info?.slug === slug) offset = info.episodeOffset + entry.totalCount;
  }
  return offset;
}

export async function saveManualFillerLink(externalId: string, slug: string, episodeOffset: number, airing: boolean): Promise<void> {
  await setFillerLink({ externalId, slug, episodeOffset: Math.max(0, Math.floor(episodeOffset)), confidence: 1, manual: true });
  await ensureFillerShow(slug, airing);
  notifyFillerInfoChanged();
}

export async function clearFillerLink(externalId: string): Promise<void> {
  await removeFillerLink(externalId);
  notifyFillerInfoChanged();
}

/** The popover's manual "Refresh" (a finished show is otherwise never
 *  refetched). Rust still honours the day-long backoff. */
export async function refreshFillerShow(slug: string, airing: boolean): Promise<void> {
  await ensureFillerShow(slug, airing, true);
  notifyFillerInfoChanged();
}

