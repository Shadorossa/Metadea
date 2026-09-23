import { useEffect, useState } from 'react';
import { loadAmbientSlides } from '../../../lib/ambient/ambient-slide-source';
import { isUsableWallpaper, type AmbientSlide } from '../../../lib/ambient/ambient-slides';

/** How long each slide stays before the next fades in. */
export const SLIDE_MS = 12_000;
/** Crossfade length; matches ambient.css. */
export const CROSSFADE_MS = 2_000;
/** Ken Burns variants defined in ambient.css (.ambient-kb--0 … --3). */
const KEN_BURNS_VARIANTS = 4;
// A server that never answers must not freeze the slideshow.
const IMAGE_TIMEOUT_MS = 20_000;

export interface ShownSlide {
  key: number;
  slide: AmbientSlide;
  variant: number;
}

export interface AmbientSlideshow {
  /** Up to two layers: the one fading out below, the current one on top. */
  layers: ShownSlide[];
  /** Slides finished loading and no wallpaper could be shown (none found,
   *  offline): the screensaver is just the clock. */
  empty: boolean;
}

/** Runs the slideshow while mounted: loads the slides, preloads the next
 *  wallpaper while the current one shows, skips images that fail or turn out
 *  too small (isUsableWallpaper on the decoded size), and aborts every
 *  pending download on unmount. */
export function useAmbientSlideshow(): AmbientSlideshow {
  const [layers, setLayers] = useState<ShownSlide[]>([]);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timers = new Set<number>();
    const pending = new Set<HTMLImageElement>();
    const failed = new Set<string>();

    const later = (ms: number) => new Promise<void>(resolve => {
      const id = window.setTimeout(() => { timers.delete(id); resolve(); }, ms);
      timers.add(id);
    });

    const loadImage = (url: string) => new Promise<boolean>(resolve => {
      const img = new Image();
      img.decoding = 'async';
      pending.add(img);
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        pending.delete(img);
        resolve(ok);
      };
      const loaded = () => finish(isUsableWallpaper(img.naturalWidth, img.naturalHeight));
      img.onload = () => { img.decode().then(loaded, loaded); };
      img.onerror = () => finish(false);
      later(IMAGE_TIMEOUT_MS).then(() => finish(false));
      img.src = url;
    });

    // First slide from `start` on (wrapping) whose wallpaper loads.
    const prepare = async (slides: AmbientSlide[], start: number): Promise<number | null> => {
      for (let step = 0; step < slides.length; step++) {
        const index = (start + step) % slides.length;
        const { url } = slides[index].wallpaper;
        if (failed.has(url)) continue;
        if (await loadImage(url)) return index;
        if (cancelled) return null;
        failed.add(url);
      }
      return null;
    };

    const run = async () => {
      const slides = await loadAmbientSlides().catch(() => [] as AmbientSlide[]);
      if (cancelled) return;
      let key = 0;
      let next = prepare(slides, 0);
      for (;;) {
        const ready = await next;
        if (cancelled) return;
        if (ready === null) {
          if (key === 0) setEmpty(true);
          return;
        }
        key += 1;
        const shown: ShownSlide = { key, slide: slides[ready], variant: key % KEN_BURNS_VARIANTS };
        setLayers(previous => [...previous.slice(-1), shown]);
        // Once the crossfade is over the layer below is only a cost.
        later(CROSSFADE_MS + 200).then(() => { if (!cancelled) setLayers(previous => previous.slice(-1)); });
        next = prepare(slides, ready + 1);
        await later(SLIDE_MS);
        if (cancelled) return;
      }
    };
    run().catch(err => console.error('[Ambient] Slideshow failed', err));

    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      // Unload: abort whatever is still downloading.
      for (const img of pending) img.removeAttribute('src');
      pending.clear();
    };
  }, []);

  return { layers, empty };
}
