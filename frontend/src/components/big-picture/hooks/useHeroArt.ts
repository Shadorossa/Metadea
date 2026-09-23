import { useEffect, useState } from 'react';
import type { BigPictureItem } from '../../../lib/big-picture/categories';
import { createWallpaperCache, neighbourIndices, pickHeroArt, type HeroArt } from '../../../lib/big-picture/hero-art';
import { resolveWallpapers } from '../../../lib/tauri/wallpapers';
import { isTauri, wrapAssetUrl } from '../../../lib/tauri/bridge';

// Skimming the shelf must not look up (or swap to) the art of every tile
// passed over: the background follows once focus rests this long.
const HERO_SETTLE_MS = 180;
// Tiles either side whose art is resolved and decoded ahead of a press.
const PRELOAD_RADIUS = 2;

// One cache for the whole visit (the Rust side caches for 30 days anyway).
// Outside Tauri (a plain browser) there is nothing to resolve.
const wallpapers = createWallpaperCache(
  ids => (isTauri() ? resolveWallpapers(ids) : Promise.resolve([])),
  wrapAssetUrl,
);

function preload(url: string): void {
  const probe = new Image();
  probe.decoding = 'async';
  probe.src = url;
}

interface Settled {
  key: string;
  wallpaper: string | null;
  /** Its art as picked when focus settled (before any banner arrived). */
  art: HeroArt | null;
}

/** The PS5 skin's background for the focused item: its landscape wallpaper
 *  (resolve_wallpapers), else a banner, else the cover to blur. Follows
 *  focus after HERO_SETTLE_MS and preloads the neighbours' art. */
export function useHeroArt(
  items: readonly BigPictureItem[],
  focusIndex: number,
  extras: { key: string; banner: string | null } | null,
  enabled: boolean,
): HeroArt | null {
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    const item = items[focusIndex];
    if (!enabled || !item) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const around = [item, ...neighbourIndices(focusIndex, items.length, PRELOAD_RADIUS).map(i => items[i])];
      wallpapers.request(around.map(entry => entry.externalId)).then(() => {
        if (cancelled) return;
        const wallpaper = wallpapers.get(item.externalId) ?? null;
        setSettled({ key: item.key, wallpaper, art: pickHeroArt(item, { wallpaper }) });
        for (const neighbour of around.slice(1)) {
          const art = pickHeroArt(neighbour, { wallpaper: wallpapers.get(neighbour.externalId) });
          if (art) preload(art.url);
        }
      });
    }, HERO_SETTLE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [items, focusIndex, enabled]);

  if (!enabled || !settled) return null;
  // The settled item may have left the tab (a refresh, a tab switch):
  // keep showing its art until the new focus settles.
  const item = items.find(entry => entry.key === settled.key);
  if (!item) return settled.art;
  const banner = extras && extras.key === settled.key ? extras.banner : null;
  return pickHeroArt(item, { wallpaper: settled.wallpaper, banner });
}
