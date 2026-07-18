import { STORAGE_KEYS } from './storage-keys';

// A tiny local changelog of the shared community-catalog syncs (manual
// button in Settings > Entorno, and BaseLayout.astro's own once-a-day auto
// sync) — shown as the side panel next to the collaborative catalog editor
// (PrEditorModal) so "did anything change recently?" is answerable without
// digging through devtools console logs.
export interface CommunitySyncLogEntry {
  timestamp: number;
  changes: number;
}

const MAX_LOG_ENTRIES = 10;

export function recordCommunitySyncResult(changes: number): void {
  if (typeof window === 'undefined') return;
  try {
    const log = getCommunitySyncLog();
    log.unshift({ timestamp: Date.now(), changes });
    localStorage.setItem(STORAGE_KEYS.communityCatalogSyncLog, JSON.stringify(log.slice(0, MAX_LOG_ENTRIES)));
  } catch {
    // localStorage full/unavailable — this is a nicety, not worth surfacing.
  }
}

export function getCommunitySyncLog(): CommunitySyncLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.communityCatalogSyncLog);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
