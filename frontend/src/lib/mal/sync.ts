// Save-time push to MyAnimeList, called from the AniList sync dispatcher
// (lib/media/anilist-sync.ts syncToAniList) after the local save already
// happened — so nothing here can block or fail that save. A type MAL does
// not track, a disconnected account or a work without a MAL id are silent
// skips; a real failure is logged and recorded in sync_state under the
// `mal:` provider key (never thrown).
import { malStatus, malUpdateAnime, malUpdateManga, type MalAnimeListUpdate, type MalMangaListUpdate } from '../tauri/mal';
import { markSynced, markSyncFailed } from '../tauri/sync-state';
import { resolveMalId } from '../player/mal-id';
import { isTauri } from '../tauri/bridge';
import { errorMessage } from '../errors/format-error';
import { buildMalAnimeUpdate, buildMalMangaUpdate, malKindForType, type MalSyncInput } from './mapping';

/** sync_state rows for MAL are keyed `mal:<external_id>`, so they never
 *  collide with the catalog's own resync bookkeeping for the same work. */
export const MAL_SYNC_STATE_PREFIX = 'mal:';

export function malSyncStateKey(externalId: string): string {
  return `${MAL_SYNC_STATE_PREFIX}${externalId}`;
}

export type MalSyncSkipReason = 'not_tauri' | 'unsupported_type' | 'not_connected' | 'no_mal_id';

export interface MalSyncResult {
  ok: boolean;
  skipped?: MalSyncSkipReason;
  error?: string;
}

export interface MalSyncDeps {
  isTauri: () => boolean;
  getStatus: () => Promise<{ connected: boolean }>;
  resolveMalId: (externalId: string) => Promise<number | null>;
  updateAnime: (malId: number, update: MalAnimeListUpdate) => Promise<void>;
  updateManga: (malId: number, update: MalMangaListUpdate) => Promise<void>;
  markSynced: (key: string) => Promise<void>;
  markSyncFailed: (key: string, error: string) => Promise<void>;
}

const defaultDeps: MalSyncDeps = {
  isTauri,
  getStatus: malStatus,
  resolveMalId,
  updateAnime: malUpdateAnime,
  updateManga: malUpdateManga,
  markSynced,
  markSyncFailed,
};

export async function syncToMal(input: MalSyncInput, deps: MalSyncDeps = defaultDeps): Promise<MalSyncResult> {
  if (!deps.isTauri()) return { ok: true, skipped: 'not_tauri' };
  const kind = malKindForType(input.type);
  if (!kind) return { ok: true, skipped: 'unsupported_type' };

  const connected = await deps.getStatus().then(status => status.connected, () => false);
  if (!connected) return { ok: true, skipped: 'not_connected' };

  const malId = await deps.resolveMalId(input.externalId);
  if (!malId) return { ok: true, skipped: 'no_mal_id' };

  const key = malSyncStateKey(input.externalId);
  try {
    if (kind === 'anime') await deps.updateAnime(malId, buildMalAnimeUpdate(input));
    else await deps.updateManga(malId, buildMalMangaUpdate(input));
  } catch (err) {
    const error = errorMessage(err);
    console.error(`MyAnimeList sync failed for ${input.externalId} (mal ${malId}):`, error);
    // Bookkeeping only; a failure to record the failure is not worth more noise.
    await deps.markSyncFailed(key, error).catch(() => {});
    return { ok: false, error };
  }
  await deps.markSynced(key).catch(() => {});
  return { ok: true };
}
