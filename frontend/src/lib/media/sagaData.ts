// Shared saga-chain + story-arcs loading, used by both SagaViewerModal (to
// render) and MediaPage (to prefetch as soon as a media page with a saga
// loads, instead of only starting the fetch once the user clicks the Saga
// button). Each loader memoizes its in-flight/resolved promise per key, so
// whichever caller asks first pays the fetch — the other just gets the same
// promise, already warm by the time the modal opens.
import { fetchAniListSaga, type SagaEntry } from '../anilist/saga';
import { compareByReleaseDate } from './mapper-utils';
import { reconstructSagaOrder } from './sagaGrouping';
import { getCachedSaga, saveCachedSaga, getSagaName, getMediaRelations } from '../tauri';
import { getCatalogEntry, type MediaCatalogEntry, type DbMediaRelation } from '../tauri/catalog';
import { getStoryArcsForMediaBatch, type StoryArc } from '../tauri/story-arcs';

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

  return orderedIds.map(id => {
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
    // Reconcile against real relations in the background — doesn't block
    // this result, just corrects a stale cache for the *next* load.
    reconstructFromRelations(externalId).then(fresh => {
      if (!fresh || sameOrder(fresh, cached!)) return;
      saveCachedSaga(fresh).catch(() => {});
    }).catch(err => console.warn('[Saga] Background reconcile failed:', err));
    return { entries: cached, sagaTitle, ok: true };
  }

  try {
    const sagaList = await reconstructFromRelations(externalId);
    if (sagaList) {
      saveCachedSaga(sagaList).catch(err => console.warn('[Saga] Failed to save to cache:', err));
      const sagaTitle = await loadSagaTitle(externalId);
      return { entries: sagaList, sagaTitle, ok: true };
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
      const sagaTitle = await loadSagaTitle(externalId);
      return { entries: result, sagaTitle, ok: true };
    }
  } catch {
    // falls through to ok: false below
  }

  return { entries: [], sagaTitle: '', ok: false };
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
