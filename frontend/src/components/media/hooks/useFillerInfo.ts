import { useEffect, useState } from 'react';
import type { FillerInfo } from '../../../lib/anime/filler';
import { FILLER_INFO_CHANGED_EVENT, getLoadedFillerInfo, loadAllFillerInfo } from '../../../lib/anime/filler-store';

/** Filler info of one library entry from the bulk, visit-cached load
 *  (lib/anime/filler-store.ts) — re-rendering when a link or show changes. */
export function useFillerInfo(externalId: string | null | undefined): FillerInfo | undefined {
  const [, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void loadAllFillerInfo().then(() => {
        if (!cancelled) setVersion(version => version + 1);
      });
    };
    reload();
    window.addEventListener(FILLER_INFO_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(FILLER_INFO_CHANGED_EVENT, reload);
    };
  }, []);
  return externalId ? getLoadedFillerInfo(externalId) : undefined;
}
