import { useEffect, useState } from 'react';
import { getSakugaPosts, type SakugaPostPage } from '../../../lib/tauri/sakuga';
import { isAdultContentEnabled } from '../../../lib/storage/preferences';

export interface SakugaPageView {
  /** The requested page once it has arrived (null: failed or nothing). */
  data: SakugaPostPage | null;
  loading: boolean;
  /** The last page that arrived for these tags, while the next one loads. */
  last: SakugaPostPage | null;
}

/** One page (`limit` clips, most voted first) of the posts carrying all of
 *  `tags`, fetched when the page or its size changes (cached in Rust). */
export function useSakugaPage(tags: readonly string[] | null, page: number, limit: number): SakugaPageView {
  const tagsKey = tags ? tags.join(' ') : '';
  const key = tagsKey && limit > 0 ? `${tagsKey}|${page}|${limit}` : '';
  const [result, setResult] = useState<{ key: string; tagsKey: string; page: SakugaPostPage | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const [joined, pageNo, size] = key.split('|');
    void getSakugaPosts(joined.split(' '), Number(pageNo), Number(size), isAdultContentEnabled()).then(fetched => {
      if (!cancelled) setResult({ key, tagsKey: joined, page: fetched });
    });
    return () => { cancelled = true; };
  }, [key]);

  const fresh = !!result && result.key === key;
  return {
    data: fresh ? result.page : null,
    loading: !!key && !fresh,
    last: result && result.tagsKey === tagsKey ? result.page : null,
  };
}
