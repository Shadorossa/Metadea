import { useState, useEffect, useMemo } from 'react';
import { readMetadataIndex, wrapAssetUrl, type MetaEntry } from '../../../lib/tauri';
import type { CoverCache } from '../details/GameDetailPanel';

// Covers/banners are served straight off disk via Tauri's asset:// protocol
// (wrapAssetUrl -> convertFileSrc), so building coverCache is a synchronous
// string transform — no IPC round trip per image. Previously this awaited
// pathToDataUrl() (read + base64-encode + IPC) for every cached cover and
// banner, which meant a full round trip per image on every load of the
// local games page.
export function useMetadataCache() {
  const [pathCache,  setPathCache]  = useState<Record<string, MetaEntry>>({});

  useEffect(() => {
    readMetadataIndex()
      .then(setPathCache)
      .catch(err => console.error('[useMetadataCache] Failed to load:', err));
  }, []);

  const coverCache = useMemo(() => {
    const result: CoverCache = {};
    for (const [appId, entry] of Object.entries(pathCache)) {
      const urls: { cover?: string; banner?: string } = {};
      if (entry.cover_path)  urls.cover  = wrapAssetUrl(entry.cover_path);
      if (entry.banner_path) urls.banner = wrapAssetUrl(entry.banner_path);
      if (Object.keys(urls).length > 0) result[appId] = urls;
    }
    return result;
  }, [pathCache]);

  const refresh = async () => {
    try {
      const index = await readMetadataIndex();
      setPathCache(index);
    } catch {}
  };

  return { pathCache, coverCache, refresh };
}
