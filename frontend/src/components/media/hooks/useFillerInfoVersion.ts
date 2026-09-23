import { useEffect, useState } from 'react';
import { FILLER_INFO_CHANGED_EVENT, loadAllFillerInfo } from '../../../lib/anime/filler-store';

/** Loads the library-wide filler map (lib/anime/filler-store.ts) and returns
 *  a counter that changes whenever it (re)loads — a dependency for anything
 *  reading getLoadedFillerInfo for several entries at once. */
export function useFillerInfoVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void loadAllFillerInfo().then(() => {
        if (!cancelled) setVersion(value => value + 1);
      });
    };
    reload();
    window.addEventListener(FILLER_INFO_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(FILLER_INFO_CHANGED_EVENT, reload);
    };
  }, []);
  return version;
}
