// Loads everything a ShareLayout draws: covers, the avatar, the logo, plus
// the live theme's palette and fonts.
//
// A canvas that has drawn a cross-origin image without CORS approval can no
// longer be exported, so remote covers never go into an <img> directly:
// fetch_image_data_url downloads them on the Rust side and hands back a
// data: URL. Local files go through the asset protocol (which answers with
// CORS headers) and are requested with crossOrigin="anonymous". Anything
// that still comes back tainted is dropped and drawn as a placeholder, so
// one bad cover cannot break the whole export.
import { fetchImageDataUrl } from '../tauri/share-image';
import { wrapAssetUrl } from '../tauri/bridge';
import { readShareFonts, readSharePalette } from './share-palette';
import type { ShareImageAssets, ShareLayout } from './share-image-types';

export const SHARE_IMAGE_CONCURRENCY = 6;
export const SHARE_LOGO_PATH = '/metadea-logo.png';

export type ShareImageLoader = (src: string) => Promise<HTMLImageElement | null>;

export type ShareImageSourceKind = 'remote' | 'inline' | 'asset' | 'local';

/** How a source is fetched: `remote` through Rust, `inline` (data:/blob:)
 *  as-is, `asset` with CORS, and anything else is a file path served by the
 *  asset protocol. */
export function classifyImageSource(src: string): ShareImageSourceKind {
  const value = src.trim();
  if (value.startsWith('data:') || value.startsWith('blob:')) return 'inline';
  if (value.startsWith('asset:')) return 'asset';
  if (/^https?:\/\/(asset|ipc)\.localhost\//i.test(value)) return 'asset';
  if (/^(https?:)?\/\//i.test(value)) return 'remote';
  return 'local';
}

export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function loadElement(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

/** False when drawing `img` would taint the canvas. */
function isExportable(img: HTMLImageElement): boolean {
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext('2d');
    if (!ctx) return true;
    ctx.drawImage(img, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

async function loadOne(src: string): Promise<HTMLImageElement | null> {
  try {
    let img: HTMLImageElement;
    switch (classifyImageSource(src)) {
      case 'remote': {
        const url = src.startsWith('//') ? `https:${src}` : src;
        const dataUrl = await fetchImageDataUrl(url);
        if (!dataUrl) return null;
        img = await loadElement(dataUrl, false);
        break;
      }
      case 'inline':
        img = await loadElement(src, false);
        break;
      case 'asset':
        img = await loadElement(src, true);
        break;
      case 'local':
        img = await loadElement(wrapAssetUrl(src), true);
        break;
    }
    return isExportable(img) ? img : null;
  } catch {
    return null;
  }
}

/** A loader with its own cache: one per export, so a cover repeated across
 *  tiers is fetched once and nothing outlives the export. */
export function createShareImageLoader(load: ShareImageLoader = loadOne): ShareImageLoader {
  const cache = new Map<string, Promise<HTMLImageElement | null>>();
  return src => {
    let pending = cache.get(src);
    if (!pending) {
      pending = load(src);
      cache.set(src, pending);
    }
    return pending;
  };
}

/** Unique image sources of a layout, in paint order. */
export function layoutImageSources(layout: ShareLayout): string[] {
  const seen = new Set<string>();
  for (const el of layout.elements) {
    if (el.kind === 'image' && el.src) seen.add(el.src);
  }
  return [...seen];
}

export async function loadShareImageAssets(layout: ShareLayout, loader: ShareImageLoader = createShareImageLoader()): Promise<ShareImageAssets> {
  const sources = layoutImageSources(layout);
  const [loaded, logo, fonts] = await Promise.all([
    mapWithConcurrency(sources, SHARE_IMAGE_CONCURRENCY, loader),
    // Bundled with the app, so same-origin: no proxy, no CORS.
    loadElement(SHARE_LOGO_PATH, false).catch(() => null),
    readShareFonts(),
  ]);
  const images = new Map<string, CanvasImageSource | null>();
  sources.forEach((src, i) => images.set(src, loaded[i]));
  return { palette: readSharePalette(), fonts, images, logo };
}
