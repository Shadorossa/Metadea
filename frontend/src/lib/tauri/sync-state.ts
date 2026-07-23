import { tauriCmd, tauriRun } from './core';

// Single source of truth for staleness/resync bookkeeping across every
// entity — media_catalog included as of db.rs migration 32. media-status.ts's
// needsResync() reads this shape regardless of what kind of entity it is.
export interface SyncStateEntry {
  external_id: string;
  last_synced_at?: string | null;
  sync_failed_count?: number | null;
  last_sync_error?: string | null;
}

export async function getSyncState(externalId: string): Promise<SyncStateEntry | null> {
  return tauriCmd<SyncStateEntry | null>('get_sync_state', null, { externalId });
}

export async function getSyncStates(externalIds: string[]): Promise<SyncStateEntry[]> {
  if (externalIds.length === 0) return [];
  return tauriCmd<SyncStateEntry[]>('get_sync_states', [], { externalIds });
}

export async function markSynced(externalId: string): Promise<void> {
  return tauriRun('mark_synced', { externalId });
}

export async function markSyncFailed(externalId: string, error: string): Promise<void> {
  return tauriRun('mark_sync_failed', { externalId, error });
}

// Direct write of all 3 fields — used where the caller needs finer control
// than mark_synced's fixed "reset to 0"/mark_sync_failed's fixed "+1" shapes,
// e.g. mediaService.ts widening the backoff even on a successful fetch that
// brought no new data (not just genuine errors).
export async function setSyncState(
  externalId: string,
  lastSyncedAt: string | null,
  syncFailedCount: number | null,
  lastSyncError: string | null,
): Promise<void> {
  return tauriRun('set_sync_state', { externalId, lastSyncedAt, syncFailedCount, lastSyncError });
}
