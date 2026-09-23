import { useCallback, useState } from 'react';
import type { LocalFolderEntry } from '../../../lib/tauri';
import { useAsyncResource } from '../../shared/hooks/useAsyncResource';
import { findTaggedPathRecursive, type TaggedMatch } from '../../../lib/local/folder-match';
import type { LocalMediaItem } from './useLocalMediaEntries';

export interface DeepTagScan {
  deepTagMatch: TaggedMatch | null;
  deepTagSearchComplete: boolean;
  // Bumped after a successful "Localizar" rename to force the deep-tag scan
  // to re-check — a nested rename usually doesn't change anything
  // rootEntries/matchedFolder/rootFileMatch would pick up on their own.
  rescan: () => void;
}

// A "[external_id]"-tagged folder/file anywhere under rootFolder, found by
// a bounded recursive scan — covers a work whose folder ended up nested
// (e.g. two levels under the category root) instead of a direct child of
// it, which the root-level-only matchedFolder/rootFileMatch fast paths
// can't see. Only runs once normal matching has already failed, since
// it's a multi-round-trip scan not worth paying for on every open.
export function useDeepTagScan(
  item: LocalMediaItem,
  rootFolder: string | undefined,
  matchedFolder: LocalFolderEntry | null,
  rootFileMatch: LocalFolderEntry | null,
): DeepTagScan {
  const [deepScanNonce, setDeepScanNonce] = useState(0);
  const rescan = useCallback(() => setDeepScanNonce(n => n + 1), []);

  const { value, loading } = useAsyncResource<TaggedMatch | null>(
    () => (!rootFolder || matchedFolder || rootFileMatch)
      ? Promise.resolve(null)
      : findTaggedPathRecursive(rootFolder, item.externalId).catch(() => null),
    [rootFolder, matchedFolder, rootFileMatch, item.externalId, deepScanNonce],
    null,
  );

  // The old effect cleared the match before every re-check, so a stale hit
  // never leaks across an item/folder change while the new scan runs.
  return { deepTagMatch: loading ? null : value, deepTagSearchComplete: !loading, rescan };
}
