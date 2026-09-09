import { useEffect, useState } from 'react';
import { getCachedCoversBatch } from '../../../lib/tauri';

// Bulk-checks which of these external_ids already have a cached cover on
// disk in one IPC call, instead of every LocalMediaCard racing its own
// get_cached_cover call at mount — mirrors Steam/GOG's own bulk
// read_metadata_index read (useMetadataCache.ts). A miss just isn't in the
// returned map; LocalMediaCard's own effect still handles those itself (an
// on-demand download, gated by its own viewport check).
export function useCoverCacheBatch(externalIds: string[]): Record<string, string> {
  const [hits, setHits] = useState<Record<string, string>>({});
  // Keyed on the sorted id set rather than the array reference, so a
  // reorder/refilter of the same underlying items (sorting, status-bucket
  // reshuffling) doesn't re-fire this — only an actual change in WHICH ids
  // are present does.
  const idsKey = externalIds.slice().sort().join('|');
  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    getCachedCoversBatch(idsKey.split('|'))
      .then(map => { if (!cancelled) setHits(prev => ({ ...prev, ...map })); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  return hits;
}
