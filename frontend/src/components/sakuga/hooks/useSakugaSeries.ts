import { useEffect, useState } from 'react';
import { getCachedSakugaArtists, resolveSakugaSeries, type SakugaTag } from '../../../lib/tauri/sakuga';
import { sakugaSeriesTitles } from '../../../lib/sakuga/sakuga-paging';

interface SeriesInput {
  externalId: string;
  type: string;
  titleMain?: string;
  titleRomaji?: string;
  titleEnglish?: string;
}

/** The anime's Sakugabooru series tag when it has posts; null otherwise
 *  (not an anime, no tag, or not resolvable right now). */
export function useSakugaSeries(data: SeriesInput): SakugaTag | null {
  const titlesKey = data.type === 'anime' ? sakugaSeriesTitles(data).join('\n') : '';
  const key = titlesKey ? `${data.externalId}\n${titlesKey}` : '';
  const [result, setResult] = useState<{ key: string; tag: SakugaTag | null }>({ key: '', tag: null });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const [externalId, ...titles] = key.split('\n');
    void resolveSakugaSeries(externalId, titles).then(found => {
      if (!cancelled) setResult({ key, tag: found && found.count > 0 ? found : null });
    });
    return () => { cancelled = true; };
  }, [key]);

  return result.key === key ? result.tag : null;
}

/** Staff id → artist tag for members already resolved (no requests), read
 *  each time `enabled` turns on (e.g. on switching to the staff tab). */
export function useCachedSakugaArtists(staffIds: readonly string[], enabled: boolean): Record<string, string> {
  const key = enabled ? staffIds.join('\n') : '';
  const [result, setResult] = useState<{ key: string; tags: Record<string, string> }>({ key: '', tags: {} });
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void getCachedSakugaArtists(key.split('\n')).then(tags => {
      if (!cancelled) setResult({ key, tags });
    });
    return () => { cancelled = true; };
  }, [key]);
  return result.key === key ? result.tags : {};
}
