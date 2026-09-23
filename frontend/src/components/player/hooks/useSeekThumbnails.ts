import { useCallback, useEffect, useRef, useState } from 'react';
import { getSeekThumbnailsEnabled } from '../../../lib/player/player-settings';
import {
  exactFrameKey, frameIndexFor, isCloseEnough, nearestAvailableFrame, spriteStyle, spriteTile, type ThumbnailGrid,
} from '../../../lib/player/seek-preview';
import { wrapAssetUrl } from '../../../lib/tauri/bridge';
import {
  listenPlayerThumbnail, listenPlayerThumbnailsReady, playerThumbnailAt, playerThumbnailsStart, type ThumbnailFrame,
  type ThumbnailManifest, type Unlisten,
} from '../../../lib/tauri/player';

interface SpriteSource {
  sheets: string[];
  columns: number;
  rows: number;
  missing: Set<number>;
}

interface ThumbnailData {
  // The file this data belongs to: anything else reads as EMPTY, so a
  // file change needs no synchronous reset.
  path: string | null;
  available: boolean;
  key: string | null;
  grid: ThumbnailGrid | null;
  frames: Map<number, string>;
  sprite: SpriteSource | null;
  exact: Map<number, string>;
  // True while the background job runs (on-demand frames are possible).
  generating: boolean;
}

export interface SeekPreviewImage {
  backgroundImage: string;
  backgroundSize?: string;
  backgroundPosition?: string;
}

export interface SeekThumbnails {
  /** False: previews are off or unavailable for this file (streams, no libmpv). */
  available: boolean;
  grid: ThumbnailGrid | null;
  /** The best image for `secs` right now, or null (show the skeleton). */
  imageFor: (secs: number, displayWidth: number, displayHeight: number) => SeekPreviewImage | null;
  /** Whether nothing close to `secs` exists yet (worth an on-demand frame). */
  needsExact: (secs: number) => boolean;
  requestExact: (secs: number) => void;
}

const EMPTY: ThumbnailData = {
  path: null, available: false, key: null, grid: null, frames: new Map(), sprite: null, exact: new Map(), generating: false,
};

function gridOf(source: ThumbnailFrame | ThumbnailManifest): ThumbnailGrid {
  return { intervalSecs: source.intervalSecs, count: source.count, tileWidth: source.tileWidth, tileHeight: source.tileHeight };
}

function spriteOf(manifest: ThumbnailManifest, sheets: string[]): SpriteSource {
  return { sheets: sheets.map(wrapAssetUrl), columns: manifest.columns, rows: manifest.rows, missing: new Set(manifest.missing) };
}

// Frames for the seek-bar hover preview of the file at `path`: a cached
// sprite when one exists, otherwise frames streamed by the background
// thumbnailer (src-tauri/src/player/thumbnails) as they are decoded.
export function useSeekThumbnails(path: string | null): SeekThumbnails {
  const [enabled] = useState(getSeekThumbnailsEnabled);
  const [stored, setData] = useState<ThumbnailData>(EMPTY);
  const data = stored.path === path ? stored : EMPTY;
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(new Set<number>());

  useEffect(() => {
    keyRef.current = null;
    inFlight.current.clear();
    if (!enabled || !path) return;
    let disposed = false;
    const unlisteners: Unlisten[] = [];
    // Frames that arrive before `start` has told us the key.
    const early: ThumbnailFrame[] = [];

    const addFrames = (frames: ThumbnailFrame[]) => {
      if (frames.length === 0) return;
      setData(previous => {
        if (previous.path !== path) return previous;
        const next = new Map(previous.frames);
        frames.forEach(frame => next.set(frame.index, frame.dataUrl));
        return { ...previous, grid: previous.grid ?? gridOf(frames[0]), frames: next };
      });
    };

    const keep = (promise: Promise<Unlisten>) => {
      promise.then(unlisten => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      }).catch(err => console.error('Thumbnail event subscription failed', err));
    };
    keep(listenPlayerThumbnail(frame => {
      if (keyRef.current === null) early.push(frame);
      else if (frame.key === keyRef.current) addFrames([frame]);
    }));
    keep(listenPlayerThumbnailsReady(ready => {
      if (ready.key !== keyRef.current) return;
      setData(previous => (previous.path !== path ? previous : {
        ...previous, grid: gridOf(ready.manifest), generating: false, sprite: spriteOf(ready.manifest, ready.sheets),
      }));
    }));

    playerThumbnailsStart(path).then(result => {
      if (disposed) return;
      if (result.state === 'unavailable') return;
      keyRef.current = result.key;
      const base = { ...EMPTY, path, available: true, key: result.key };
      if (result.state === 'cached') {
        setData({ ...base, grid: gridOf(result.manifest), sprite: spriteOf(result.manifest, result.sheets) });
        return;
      }
      setData({ ...base, generating: true });
      addFrames([...result.frames, ...early.filter(frame => frame.key === result.key)]);
    }).catch(err => console.error('Seek-bar thumbnails failed to start', err));

    return () => {
      disposed = true;
      unlisteners.forEach(unlisten => unlisten());
    };
  }, [enabled, path]);

  const has = useCallback(
    (index: number) => data.frames.has(index) || (data.sprite !== null && index < (data.grid?.count ?? 0) && !data.sprite.missing.has(index)),
    [data],
  );

  const imageFor = useCallback((secs: number, displayWidth: number, displayHeight: number): SeekPreviewImage | null => {
    const grid = data.grid;
    const exact = data.exact.get(exactFrameKey(secs));
    if (!grid) return exact ? { backgroundImage: `url("${exact}")` } : null;
    const target = frameIndexFor(secs, grid.intervalSecs, grid.count);
    const nearest = nearestAvailableFrame(target, has, grid.count);
    if (exact && !isCloseEnough(nearest, target)) return { backgroundImage: `url("${exact}")` };
    if (nearest === null) return null;
    const frame = data.frames.get(nearest);
    if (frame) return { backgroundImage: `url("${frame}")` };
    if (!data.sprite) return null;
    const tile = spriteTile(nearest, data.sprite.columns, data.sprite.rows);
    const sheet = data.sprite.sheets[tile.sheet];
    if (!sheet) return null;
    return { backgroundImage: `url("${sheet}")`, ...spriteStyle(tile, data.sprite.columns, displayWidth, displayHeight) };
  }, [data, has]);

  const needsExact = useCallback((secs: number) => {
    if (!data.generating || !data.key || data.exact.has(exactFrameKey(secs))) return false;
    const grid = data.grid;
    if (!grid) return true;
    const target = frameIndexFor(secs, grid.intervalSecs, grid.count);
    return !isCloseEnough(nearestAvailableFrame(target, has, grid.count), target);
  }, [data, has]);

  const requestExact = useCallback((secs: number) => {
    const key = data.key;
    const slot = exactFrameKey(secs);
    if (!key || inFlight.current.has(slot)) return;
    inFlight.current.add(slot);
    playerThumbnailAt(key, slot)
      .then(url => {
        if (!url || keyRef.current !== key) return;
        setData(previous => {
          if (previous.key !== key) return previous;
          const exact = new Map(previous.exact);
          exact.set(slot, url);
          return { ...previous, exact };
        });
      })
      .catch(err => console.error('On-demand thumbnail failed', err))
      .finally(() => inFlight.current.delete(slot));
  }, [data.key]);

  return { available: enabled && data.available, grid: data.grid, imageFor, needsExact, requestExact };
}
