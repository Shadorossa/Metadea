import { useState, useEffect } from 'react';
import { readMetadataIndex, pathToDataUrl, type MetaEntry } from '../../../lib/tauri';
import type { CoverCache } from '../details/GameDetailPanel';

export function useMetadataCache() {
  const [pathCache,  setPathCache]  = useState<Record<string, MetaEntry>>({});
  const [coverCache, setCoverCache] = useState<CoverCache>({});

  useEffect(() => {
    readMetadataIndex()
      .then(setPathCache)
      .catch(err => console.error('[useMetadataCache] Failed to load:', err));
  }, []);

  useEffect(() => {
    const convert = async () => {
      const result: CoverCache = {};
      for (const [appId, entry] of Object.entries(pathCache)) {
        const urls: { cover?: string; banner?: string } = {};
        if (entry.cover_path) {
          const url = await pathToDataUrl(entry.cover_path);
          if (url) urls.cover = url;
        }
        if (entry.banner_path) {
          const url = await pathToDataUrl(entry.banner_path);
          if (url) urls.banner = url;
        }
        if (Object.keys(urls).length > 0) result[appId] = urls;
      }
      setCoverCache(result);
    };
    convert();
  }, [pathCache]);

  const refresh = async () => {
    try {
      const index = await readMetadataIndex();
      setPathCache(index);
    } catch {}
  };

  return { pathCache, coverCache, refresh };
}
