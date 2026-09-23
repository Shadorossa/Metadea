import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyWork } from '../../../lib/tauri/company-catalog';
import type { CompanyExclusionContext } from '../../../lib/company/company-works';
import { readBlockedIds, readReclassifiedIds, reclassifiableIds } from '../../../lib/search/exclusion-filters';
import { isAdultContentEnabled } from '../../../lib/storage/preferences';

const EMPTY: ReadonlySet<string> = new Set();

function readShowAdult(): boolean {
  try {
    return isAdultContentEnabled();
  } catch {
    return false;
  }
}

// What Search would hide among a company's works: blocked catalog entries
// (read once) and game/vnovel ids reclassified locally (asked for as the
// works stream in, each id once), plus the user's adult-content setting.
// Until the reads answer the sets are empty — nothing is hidden early.
export function useSearchExclusions(works: readonly CompanyWork[] | null, source: string): CompanyExclusionContext {
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(EMPTY);
  const [reclassified, setReclassified] = useState<ReadonlySet<string>>(EMPTY);
  const [showAdult] = useState(readShowAdult);
  const asked = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    readBlockedIds().then(ids => {
      if (mounted.current && ids.size > 0) setBlocked(ids);
    });
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!works) return;
    const fresh = reclassifiableIds(works, w => w.media_type, w => w.external_id).filter(id => !asked.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach(id => asked.current.add(id));
    readReclassifiedIds(fresh).then(found => {
      if (mounted.current && found.size > 0) setReclassified(prev => new Set([...prev, ...found]));
    });
  }, [works]);

  return useMemo(() => ({ blocked, reclassified, showAdult, source }), [blocked, reclassified, showAdult, source]);
}
