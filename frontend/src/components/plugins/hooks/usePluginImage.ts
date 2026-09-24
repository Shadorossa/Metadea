import { useEffect, useState } from 'react';
import { fetchPluginImage } from '../../../lib/plugins/plugin-page-source';
import { imageDataUrl } from '../../../lib/plugins/plugin-results';
import { pluginHttpFetch } from '../../../lib/tauri/plugins';

// Covers in plugin search results: small, and often repeated while the user
// types, so the data: URLs are memoised for the page's lifetime (capped).
const cache = new Map<string, Promise<string>>();
const MAX_CACHED = 200;

function load(pluginId: string, url: string): Promise<string> {
  const key = `${pluginId}\n${url}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = fetchPluginImage(pluginHttpFetch, pluginId, { url });
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
    if (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return hit;
}

/** A plugin-provided image as a displayable URL (fetched through the plugin's allowlist). */
export function usePluginImage(pluginId: string, url: string | undefined): string | null {
  const inline = url ? imageDataUrl(url) : undefined;
  const [loaded, setLoaded] = useState<{ url: string; src: string } | null>(null);
  useEffect(() => {
    if (!url || inline) return;
    let alive = true;
    load(pluginId, url)
      .then(src => { if (alive) setLoaded({ url, src }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [pluginId, url, inline]);
  if (!url) return null;
  if (inline) return inline;
  return loaded?.url === url ? loaded.src : null;
}
