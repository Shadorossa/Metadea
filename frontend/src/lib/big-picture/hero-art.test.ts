import { describe, expect, it, vi } from 'vitest';
import { createWallpaperCache, neighbourIndices, pickHeroArt } from './hero-art';

describe('pickHeroArt', () => {
  const game = { kind: 'game' as const, cover: 'cover.jpg', hero: 'banner.jpg' };
  const work = { kind: 'media' as const, cover: 'cover-m.jpg', hero: 'cover-full.jpg' };

  it('prefers a resolved wallpaper, then a catalog banner', () => {
    expect(pickHeroArt(game, { wallpaper: 'wall.jpg', banner: 'b.jpg' })).toEqual({ url: 'wall.jpg', kind: 'art' });
    expect(pickHeroArt(work, { wallpaper: null, banner: 'b.jpg' })).toEqual({ url: 'b.jpg', kind: 'art' });
  });

  it("uses a game's own banner as art", () => {
    expect(pickHeroArt(game)).toEqual({ url: 'banner.jpg', kind: 'art' });
  });

  it('falls back to the (largest) cover, to be blurred', () => {
    expect(pickHeroArt(work)).toEqual({ url: 'cover-full.jpg', kind: 'cover' });
    expect(pickHeroArt({ kind: 'game', cover: 'c.jpg', hero: 'c.jpg' })).toEqual({ url: 'c.jpg', kind: 'cover' });
    expect(pickHeroArt({ kind: 'game', cover: 'c.jpg', hero: null })).toEqual({ url: 'c.jpg', kind: 'cover' });
    expect(pickHeroArt({ kind: 'media', cover: null, hero: null })).toBeNull();
  });
});

describe('neighbourIndices', () => {
  it('lists the nearest tiles first, clamped to the row', () => {
    expect(neighbourIndices(5, 10, 2)).toEqual([6, 4, 7, 3]);
    expect(neighbourIndices(0, 10, 2)).toEqual([1, 2]);
    expect(neighbourIndices(9, 10, 2)).toEqual([8, 7]);
    expect(neighbourIndices(0, 1, 3)).toEqual([]);
  });
});

describe('createWallpaperCache', () => {
  it('resolves each id once, in one batch, and wraps the urls', async () => {
    const resolve = vi.fn(async (ids: string[]) => ids.map(id => ({ external_id: id, url: id === 'game:1' ? '/wall/1.jpg' : null })));
    const cache = createWallpaperCache(resolve, url => `asset:${url}`);
    expect(cache.get('game:1')).toBeUndefined();

    await Promise.all([cache.request(['game:1', 'game:2', null, 'game:1']), cache.request(['game:2'])]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(['game:1', 'game:2']);
    expect(cache.get('game:1')).toBe('asset:/wall/1.jpg');
    expect(cache.get('game:2')).toBeNull();

    await cache.request(['game:1', 'game:3']);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenLastCalledWith(['game:3']);
  });

  it('treats a failed lookup as "no wallpaper" without rejecting', async () => {
    const cache = createWallpaperCache(async () => { throw new Error('offline'); });
    await expect(cache.request(['anime:1'])).resolves.toBeUndefined();
    expect(cache.get('anime:1')).toBeNull();
  });

  it('skips the call when every id is already known', async () => {
    const resolve = vi.fn(async () => []);
    const cache = createWallpaperCache(resolve);
    await cache.request([]);
    await cache.request([undefined, null]);
    expect(resolve).not.toHaveBeenCalled();
  });
});
