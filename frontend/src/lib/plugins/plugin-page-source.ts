// Plugin images for the UI: chapter pages for the reader (a ReaderPageSource)
// and covers in the "Read" tab. Remote images are fetched through
// plugin_http_fetch — so the plugin's host allowlist and headers apply and
// plain-http LAN servers work despite the page's CSP — and handed over as
// data: URLs. Inline data:image URLs from the plugin are used as they are.
import type { ReaderPageSource } from '../reader/page-source';
import type { PluginHttpRequest, PluginHttpResponse } from '../tauri/plugins';
import type { SourceImagePage } from './plugin-results';
import { imageDataUrl } from './plugin-results';

export type PluginFetch = (pluginId: string, request: PluginHttpRequest) => Promise<PluginHttpResponse>;

const MAGIC: Array<[number[], string]> = [
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
  [[0x52, 0x49, 0x46, 0x46], 'image/webp'],
];

/** image/* from the response header, else sniffed from the first bytes. */
export function imageMimeType(contentType: string | undefined, base64: string): string {
  const declared = contentType?.split(';')[0].trim().toLowerCase();
  if (declared?.startsWith('image/')) return declared;
  let head: number[] = [];
  try {
    head = Array.from(atob(base64.slice(0, 16)), c => c.charCodeAt(0));
  } catch {
    head = [];
  }
  const hit = MAGIC.find(([bytes]) => bytes.every((b, i) => head[i] === b));
  return hit ? hit[1] : 'image/jpeg';
}

export async function fetchPluginImage(fetcher: PluginFetch, pluginId: string, page: SourceImagePage): Promise<string> {
  const inline = imageDataUrl(page.url);
  if (inline) return inline;
  const response = await fetcher(pluginId, { url: page.url, headers: page.headers, responseType: 'base64', timeoutMs: 45_000 });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  return `data:${imageMimeType(response.headers['content-type'], response.body)};base64,${response.body}`;
}

const MAX_CACHED_PAGES = 24;

/** Reader pages of one plugin chapter; keeps the most recent pages decoded. */
export function pluginImagePageSource(fetcher: PluginFetch, pluginId: string, chapterKey: string, pages: SourceImagePage[]): ReaderPageSource {
  const cache = new Map<string, Promise<string>>();
  return {
    key: `plugin:${pluginId}:${chapterKey}`,
    listPages: async () => pages.map((_, index) => String(index)),
    resolvePage: token => {
      const hit = cache.get(token);
      if (hit) {
        cache.delete(token);
        cache.set(token, hit);
        return hit;
      }
      const page = pages[Number(token)];
      if (!page) return Promise.reject(new Error(`no page ${token}`));
      const pending = fetchPluginImage(fetcher, pluginId, page);
      pending.catch(() => cache.delete(token));
      cache.set(token, pending);
      while (cache.size > MAX_CACHED_PAGES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return pending;
    },
  };
}
