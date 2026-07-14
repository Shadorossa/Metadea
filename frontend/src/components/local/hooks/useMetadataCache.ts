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
      const entries = Object.entries(pathCache);
      const converted = await Promise.all(
        entries.map(async ([appId, entry]) => {
          const urls: { cover?: string; banner?: string } = {};
          const promises: Promise<any>[] = [];
          
          if (entry.cover_path) {
            promises.push(
              pathToDataUrl(entry.cover_path).then(url => {
                if (url) urls.cover = url;
              })
            );
          }
          if (entry.banner_path) {
            promises.push(
              pathToDataUrl(entry.banner_path).then(url => {
                if (url) urls.banner = url;
              })
            );
          }
          
          await Promise.all(promises);
          return { appId, urls };
        })
      );

      const result: CoverCache = {};
      for (const item of converted) {
        if (Object.keys(item.urls).length > 0) {
          result[item.appId] = item.urls;
        }
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
