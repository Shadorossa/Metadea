import { isInProgressStatus } from '../media/media-types';

// Stable string identity for "which in-progress entries exist" — the only
// input LibrarySection's Local-playability detection actually depends on
// changing. Keying that effect on this (instead of the library/catalog
// object references) means a resynced catalog row or a same-content
// re-fetch doesn't re-run every read_routes / scan_folder_contents /
// scan_all_games round trip again.
export function buildInProgressIdsKey(items: ReadonlyArray<{ external_id: string; status: string | null }> | null): string {
  if (!items) return '';
  const ids: string[] = [];
  for (const item of items) {
    if (isInProgressStatus(item.status)) ids.push(item.external_id);
  }
  return ids.sort().join('|');
}
