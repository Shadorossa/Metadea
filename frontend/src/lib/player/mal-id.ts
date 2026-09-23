// MyAnimeList id of a catalog work, for AniSkip and the MyAnimeList list
// sync (lib/mal). Metadea stores AniList ids (`anime:<anilistId>`,
// `manga:<anilistId>`, `lnovel:<anilistId>`); the MAL id is asked from
// AniList once and kept on the media_catalog row (src-tauri/src/aniskip.rs)
// so later episodes, rewatches and syncs never hit the network for it
// again. A work without a MAL counterpart resolves to null every time
// (nothing is persisted for it, the lookup is one cheap call).

import { fetchAniListMalId } from '../search/providers/anilist/detail';
import { getCatalogMalId, setCatalogMalId } from '../tauri/aniskip';

const inFlight = new Map<string, Promise<number | null>>();

// Every AniList-backed type has a MAL id space (light novels are manga
// there); anything else has no MAL mapping.
export function anilistBackedIdFromExternalId(externalId: string | null | undefined): number | null {
  const match = (externalId ?? '').match(/^(?:anime|manga|lnovel):(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function resolveMalId(externalId: string | null | undefined): Promise<number | null> {
  const anilistId = anilistBackedIdFromExternalId(externalId);
  if (!anilistId || !externalId) return Promise.resolve(null);
  const pending = inFlight.get(externalId);
  if (pending) return pending;
  const lookup = (async () => {
    const cached = await getCatalogMalId(externalId);
    if (cached) return cached;
    const fetched = await fetchAniListMalId(anilistId);
    if (fetched) await setCatalogMalId(externalId, fetched);
    return fetched;
  })().catch(err => {
    console.debug('MAL id lookup failed', err);
    return null;
  }).finally(() => inFlight.delete(externalId));
  inFlight.set(externalId, lookup);
  return lookup;
}
