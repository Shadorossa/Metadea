// The PS5 skin's full-bleed background (big-picture-skin.ts): which picture
// the focused item gets, which neighbours to warm up, and a small cache in
// front of `resolve_wallpapers` (the landscape art Ambient mode also uses —
// IGDB artworks, TMDB backdrops, AniList banners). Pure: the IPC call and
// the timers live in components/big-picture/hooks/useHeroArt.ts.
import type { BigPictureItem } from './categories';

export interface HeroArt {
  url: string;
  /** `art`: landscape key art shown sharp. `cover`: the portrait cover,
   *  shown blurred because it cannot fill a 16:9 screen. */
  kind: 'art' | 'cover';
}

export interface HeroArtSources {
  /** resolve_wallpapers' answer for the item (already a loadable URL). */
  wallpaper?: string | null;
  /** A work's wide banner from the catalog (useFocusedExtras). */
  banner?: string | null;
}

/** Best background for `item`: a resolved wallpaper, then a catalog banner,
 *  then a game's downloaded banner; otherwise the cover, to blur. */
export function pickHeroArt(
  item: Pick<BigPictureItem, 'kind' | 'hero' | 'cover'>,
  sources: HeroArtSources = {},
): HeroArt | null {
  if (sources.wallpaper) return { url: sources.wallpaper, kind: 'art' };
  if (sources.banner) return { url: sources.banner, kind: 'art' };
  // A game's hero is its launcher banner when one was downloaded; a work's
  // hero is only the full-size portrait cover.
  if (item.kind === 'game' && item.hero && item.hero !== item.cover) return { url: item.hero, kind: 'art' };
  const cover = item.hero ?? item.cover;
  return cover ? { url: cover, kind: 'cover' } : null;
}

/** Indices around `focus` (nearest first, right before left), within
 *  `[0, count)` — the tiles one press away get their art preloaded. */
export function neighbourIndices(focus: number, count: number, radius: number): number[] {
  const out: number[] = [];
  for (let step = 1; step <= radius; step += 1) {
    if (focus + step < count) out.push(focus + step);
    if (focus - step >= 0) out.push(focus - step);
  }
  return out;
}

export interface WallpaperAnswer {
  external_id: string;
  url: string | null;
}

export interface WallpaperCache {
  /** undefined: never asked. null: no wallpaper. */
  get(externalId: string | null | undefined): string | null | undefined;
  /** Resolves the ids not asked yet (one batch) and waits for those in
   *  flight. Never rejects: a failed lookup counts as "no wallpaper". */
  request(externalIds: readonly (string | null | undefined)[]): Promise<void>;
}

export function createWallpaperCache(
  resolve: (externalIds: string[]) => Promise<WallpaperAnswer[]>,
  wrap: (url: string) => string = url => url,
): WallpaperCache {
  const known = new Map<string, string | null>();
  const inFlight = new Map<string, Promise<void>>();
  return {
    get: externalId => (externalId ? known.get(externalId) : undefined),
    request: externalIds => {
      const ids = [...new Set(externalIds.filter((id): id is string => !!id))];
      const missing = ids.filter(id => !known.has(id) && !inFlight.has(id));
      if (missing.length > 0) {
        const batch = resolve(missing)
          .then(rows => {
            for (const row of rows) if (row.url) known.set(row.external_id, wrap(row.url));
          })
          .catch(() => {})
          .finally(() => {
            for (const id of missing) {
              if (!known.has(id)) known.set(id, null);
              inFlight.delete(id);
            }
          });
        for (const id of missing) inFlight.set(id, batch);
      }
      const waits = ids.map(id => inFlight.get(id)).filter((wait): wait is Promise<void> => !!wait);
      return Promise.all(waits).then(() => {});
    },
  };
}
