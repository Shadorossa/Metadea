// Shared saga-chain + story-arcs loading, used by both SagaViewerModal (to
// render) and MediaPage (to prefetch as soon as a media page with a saga
// loads, instead of only starting the fetch once the user clicks the Saga
// button). Each loader memoizes its in-flight/resolved promise per key, so
// whichever caller asks first pays the fetch — the other just gets the same
// promise, already warm by the time the modal opens.
import { fetchAniListSaga, type SagaEntry } from '../anilist/saga';
import { compareByReleaseDate } from './mapper-utils';
import { reconstructSagaOrder, filterToSequelChain } from './sagaGrouping';
import { getCachedSaga, saveCachedSaga, getSagaName, getMediaRelations } from '../tauri';
import { getCatalogEntry, getBlockedExternalIds, type MediaCatalogEntry, type DbMediaRelation } from '../tauri/catalog';
import { getStoryArcsForMediaBatch, type StoryArc } from '../tauri/story-arcs';
import { fetchMediaData } from './mediaService';

export interface SagaChainResult {
  entries: SagaEntry[];
  sagaTitle: string;
  ok: boolean; // false if externalId isn't part of any multi-entry saga
}

export interface SagaArcsResult {
  arcs: StoryArc[];
  arcItemMeta: Record<string, { title: string; cover: string | null }>;
}

const chainCache = new Map<string, Promise<SagaChainResult>>();
const arcsCache = new Map<string, Promise<SagaArcsResult>>();

async function reconstructFromRelations(externalId: string): Promise<SagaEntry[] | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  const transitiveIds = await invoke<string[]>('get_transitive_relation_ids', { mediaExternalId: externalId }).catch(() => [] as string[]);
  if (transitiveIds.length <= 1) return null;

  const entriesData = await Promise.all(
    transitiveIds.map(async id => ({ id, entry: await getCatalogEntry(id).catch(() => null) }))
  );
  const validEntries = entriesData.filter(
    (x): x is { id: string; entry: MediaCatalogEntry } => x.entry !== null,
  );

  validEntries.sort((a, b) => compareByReleaseDate(
    { ...a.entry, id: a.id },
    { ...b.entry, id: b.id }
  ));

  const byId = new Map(validEntries.map(x => [x.id, x.entry]));
  const dateOrderedIds = validEntries.map(x => x.id);
  const relsByIndex: DbMediaRelation[][] = await Promise.all(
    dateOrderedIds.map(id => getMediaRelations(id).catch(() => [] as DbMediaRelation[]))
  );
  const orderedIds = reconstructSagaOrder(dateOrderedIds, relsByIndex);

  // get_transitive_relation_ids' closure includes ALTERNATIVE-linked entries
  // (uncut/TV cuts, alternate edits) too — real for PrEditorModal's own
  // Concept Group clustering, but not a real season for Temporadas/
  // unifyAnimeSeasons, which must only ever show true PREQUEL/SEQUEL chain
  // members. Filtered here (after ordering, not before) so it doesn't
  // interfere with reconstructSagaOrder's own ALTERNATIVE-aware tie-break.
  const chainIds = new Set(filterToSequelChain(dateOrderedIds, relsByIndex, externalId));
  const finalIds = orderedIds.filter(id => chainIds.has(id));
  if (finalIds.length <= 1) return null;

  return finalIds.map(id => {
    const entry = byId.get(id)!;
    return {
      externalId: id,
      title: entry.title_main || id,
      cover: entry.cover_url || null,
      format: entry.format || null,
      mediaType: entry.type || 'game',
      year: entry.release_year ?? null,
      month: entry.release_month ?? null,
      day: entry.release_day ?? null,
    };
  });
}

const sameOrder = (a: SagaEntry[], b: SagaEntry[]) =>
  a.length === b.length && a.every((e, i) => e.externalId === b[i].externalId);

// blocked_at (PrEditorModal's "bloquear" action) already documents "saga
// chains" as one of the places a blocked entry must stay hidden from — this
// is that filter, applied once here so every consumer (MediaPage's
// Temporadas tab, SagaViewerModal, MediaEditorModal's season tabs) gets it
// for free instead of re-filtering independently. Display-only: doesn't
// touch the underlying media_relations edges, so reconstructFromRelations'
// own graph walk (and the background reconciliation above) still sees the
// real chain — a blocked entry just never reaches the caller.
async function filterBlockedSagaEntries(entries: SagaEntry[]): Promise<SagaEntry[]> {
  if (entries.length === 0) return entries;
  const blockedIds = await getBlockedExternalIds().catch(() => [] as string[]);
  const blocked = new Set(blockedIds);
  return entries.filter(e => !blocked.has(e.externalId) && e.format?.trim().toUpperCase() !== 'SUMMARY');
}

async function loadSagaTitle(externalId: string): Promise<string> {
  try {
    return (await getSagaName(externalId)) || '';
  } catch (err) {
    console.warn('[Saga] Failed to load custom saga name:', err);
    return '';
  }
}

async function fetchSagaChain(externalId: string): Promise<SagaChainResult> {
  const numericId = parseInt(externalId.slice(externalId.indexOf(':') + 1), 10);
  if (!numericId) return { entries: [], sagaTitle: '', ok: false };

  let cached: SagaEntry[] | null = null;
  try {
    cached = await getCachedSaga(externalId);
  } catch (err) {
    console.warn('[Saga] Failed to read from cache:', err);
  }

  if (cached && cached.length > 0) {
    const sagaTitle = await loadSagaTitle(externalId);
    // Reconcile against real relations before answering — reconstructFromRelations
    // is pure local DB reads (no network in the common case), so this stays
    // fast, and it's what actually fixes an order that went stale before a
    // relation edge existed locally yet (or before an ordering bug like this
    // one got fixed) — deferring it to a "background" pass that only wrote
    // its result for the *next* load meant a stale order could keep showing
    // indefinitely, since nothing ever prompts a second visit on its own.
    const fresh = await reconstructFromRelations(externalId).catch(err => {
      console.warn('[Saga] Reconcile failed, using cache as-is:', err);
      return null;
    });
    if (fresh && !sameOrder(fresh, cached)) {
      saveCachedSaga(fresh).catch(() => {});
      return { entries: await filterBlockedSagaEntries(fresh), sagaTitle, ok: true };
    }
    return { entries: await filterBlockedSagaEntries(cached), sagaTitle, ok: true };
  }

  try {
    const sagaList = await reconstructFromRelations(externalId);
    if (sagaList) {
      saveCachedSaga(sagaList).catch(err => console.warn('[Saga] Failed to save to cache:', err));
      const sagaTitle = await loadSagaTitle(externalId);
      return { entries: await filterBlockedSagaEntries(sagaList), sagaTitle, ok: true };
    }
  } catch (err) {
    console.warn('[Saga] Failed to load transitive relations:', err);
  }

  if (!externalId.startsWith('anime:') && !externalId.startsWith('manga:')) {
    return { entries: [], sagaTitle: '', ok: false };
  }

  try {
    const result = await fetchAniListSaga(numericId);
    if (result.length > 0) {
      saveCachedSaga(result).catch(err => console.warn('[Saga] Failed to save to cache:', err));
      // This branch only ever runs when reconstructFromRelations found
      // nothing locally — i.e. media_relations has no real PREQUEL/SEQUEL
      // rows for this chain yet, just AniList's own live relations (which
      // fetchAniListSaga read directly from AniList, not from our DB). The
      // saveCachedSaga above only warms the sagas/saga_relations *display*
      // cache — refineSagaGroups and everything else that walks the
      // canonical chain still reads media_relations, not that cache. So
      // this fetches+persists each member's own relations through the same
      // trusted merge pipeline fetchMediaData already uses on every page
      // visit, staggered to be gentle on AniList's rate limit, instead of
      // waiting for someone to eventually open each season's own page.
      persistChainRelationsInBackground(result);
      const sagaTitle = await loadSagaTitle(externalId);
      return { entries: await filterBlockedSagaEntries(result), sagaTitle, ok: true };
    }
  } catch {
    // falls through to ok: false below
  }

  return { entries: [], sagaTitle: '', ok: false };
}

// Fire-and-forget — never awaited by a caller, since the chain itself
// (already fetched live from AniList above) is already good enough to show
// immediately. This just backfills media_relations for next time, plus for
// anyone reading the local relation graph in the meantime (the library
// grid's saga grouping, useMediaNeighbors, seasonResolve.ts's file
// matching, ...).
const CHAIN_PERSIST_STAGGER_MS = 400;

function persistChainRelationsInBackground(entries: SagaEntry[]): void {
  (async () => {
    for (const entry of entries) {
      await fetchMediaData(entry.externalId).catch(err =>
        console.warn(`[Saga] Failed to persist relations for ${entry.externalId}:`, err));
      await new Promise(resolve => setTimeout(resolve, CHAIN_PERSIST_STAGGER_MS));
    }
  })();
}

export function loadSagaChain(externalId: string): Promise<SagaChainResult> {
  let cached = chainCache.get(externalId);
  if (!cached) {
    cached = fetchSagaChain(externalId);
    chainCache.set(externalId, cached);
    // A failed load shouldn't stick around and permanently short-circuit a
    // retry (e.g. transient IPC hiccup) — only successful chains stay cached.
    cached.then(r => { if (!r.ok) chainCache.delete(externalId); }).catch(() => chainCache.delete(externalId));
  }
  return cached;
}

async function fetchSagaArcs(entries: SagaEntry[]): Promise<SagaArcsResult> {
  const arcs = await getStoryArcsForMediaBatch(entries.map(e => e.externalId)).catch(() => [] as StoryArc[]);

  const knownIds = new Set(entries.map(e => e.externalId));
  const missingIds = new Set<string>();
  for (const arc of arcs) {
    for (const item of arc.items) {
      if (!knownIds.has(item.media_external_id)) missingIds.add(item.media_external_id);
    }
  }
  if (missingIds.size === 0) return { arcs, arcItemMeta: {} };

  const metaEntries = await Promise.all(
    [...missingIds].map(async id => [id, await getCatalogEntry(id).catch(() => null)] as const)
  );
  const arcItemMeta: Record<string, { title: string; cover: string | null }> = {};
  for (const [id, entry] of metaEntries) {
    if (entry) arcItemMeta[id] = { title: entry.title_main || id, cover: entry.cover_url || null };
  }
  return { arcs, arcItemMeta };
}

function arcsCacheKey(entries: SagaEntry[]): string {
  return entries.map(e => e.externalId).sort().join(',');
}

export function loadSagaArcs(entries: SagaEntry[]): Promise<SagaArcsResult> {
  if (entries.length === 0) return Promise.resolve({ arcs: [], arcItemMeta: {} });
  const key = arcsCacheKey(entries);
  let cached = arcsCache.get(key);
  if (!cached) {
    cached = fetchSagaArcs(entries);
    arcsCache.set(key, cached);
  }
  return cached;
}

// Fire-and-forget: warms both caches for a media page as soon as it's known
// to have a saga, so by the time the user opens SagaViewerModal, the chain
// and its arcs are already resolved (or at least already in flight).
export function prefetchSagaData(externalId: string): void {
  loadSagaChain(externalId).then(chain => {
    if (chain.ok) loadSagaArcs(chain.entries).catch(() => {});
  }).catch(() => {});
}
