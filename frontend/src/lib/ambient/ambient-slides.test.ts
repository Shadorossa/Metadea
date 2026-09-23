import { describe, it, expect, vi } from 'vitest';
import {
  MAX_AMBIENT_SLIDES, collectAmbientSlides, hasWallpaperSource, isUsableWallpaper, rankAmbientWorks, shuffled, toWallpaper,
  type AmbientCatalogRow, type AmbientLibraryEntry, type AmbientWork, type WallpaperAnswer,
} from './ambient-slides';

function entry(id: string, patch: Partial<AmbientLibraryEntry> = {}): AmbientLibraryEntry {
  return { external_id: id, type: 'anime', status: 'planning', rating: null, is_favorite: 0, ...patch };
}

function row(id: string, patch: Partial<AmbientCatalogRow> = {}): AmbientCatalogRow {
  return { external_id: id, type: 'anime', title_main: `Title ${id}`, release_year: 2001, ...patch };
}

function work(id: string): AmbientWork {
  return { externalId: id, type: 'anime', title: `Title ${id}`, year: 2001 };
}

// Deterministic "random": keeps the input order.
const noShuffle = () => 0.999999;

function catalogOf(ids: string[]): Map<string, AmbientCatalogRow> {
  return new Map(ids.map(id => [id, row(id)]));
}

/** A resolver that knows a wallpaper for `withWallpaper` ids and records every call. */
function fakeResolver(withWallpaper: (id: string) => boolean, kind = 'backdrop') {
  const calls: string[][] = [];
  const resolve = vi.fn(async (ids: string[]): Promise<WallpaperAnswer[]> => {
    calls.push(ids);
    return ids.map(id => (withWallpaper(id)
      ? { external_id: id, url: `https://w/${id}.jpg`, kind }
      : { external_id: id, url: null, kind: null }));
  });
  return { resolve, calls };
}

describe('rankAmbientWorks', () => {
  it('orders favourites, then in-progress, then high-scored completed; the rest apart', () => {
    const entries = [
      entry('anime:1', { status: 'completed', rating: 5 }),
      entry('anime:2', { status: 'completed', rating: 9 }),
      entry('anime:3', { is_favorite: 1 }),
      entry('anime:4', { status: 'watching' }),
    ];
    const ranked = rankAmbientWorks(entries, catalogOf(entries.map(e => e.external_id)), noShuffle);
    expect(ranked.priority.map(w => w.externalId)).toEqual(['anime:3', 'anime:4', 'anime:2']);
    expect(ranked.rest.map(w => w.externalId)).toEqual(['anime:1']);
  });

  it('drops works without a wallpaper source, a catalog row or a title, and duplicates', () => {
    const catalog = new Map([
      ['movie:1', row('movie:1', { type: 'movie' })],
      ['book:2', row('book:2', { type: 'book' })],
      ['comic:3', row('comic:3', { type: 'comic' })],
      ['anime:4', row('anime:4', { title_main: null, title_english: null })],
    ]);
    const ranked = rankAmbientWorks(
      [entry('movie:1'), entry('movie:1'), entry('book:2'), entry('comic:3'), entry('anime:4'), entry('anime:5')],
      catalog,
    );
    expect([...ranked.priority, ...ranked.rest].map(w => w.externalId)).toEqual(['movie:1']);
  });

  it('maps the caption fields and carries no cover', () => {
    const { rest: [only] } = rankAmbientWorks([entry('movie:603')], new Map([['movie:603', row('movie:603', { type: 'movie', release_year: 1999, title_main: 'The Matrix' })]]));
    expect(only).toEqual({ externalId: 'movie:603', type: 'movie', title: 'The Matrix', year: 1999 });
  });
});

describe('wallpaper filters', () => {
  it('knows which work types can have a wallpaper', () => {
    for (const id of ['movie:1', 'series:1', 'game:1', 'vnovel:1', 'anime:1', 'manga:1']) expect(hasWallpaperSource(id)).toBe(true);
    for (const id of ['book:OL1W', 'comic:4050', 'local:x']) expect(hasWallpaperSource(id)).toBe(false);
  });

  it('keeps only landscape images at least 1280 px wide', () => {
    expect(isUsableWallpaper(1920, 1080)).toBe(true);
    expect(isUsableWallpaper(1280, 720)).toBe(true);
    expect(isUsableWallpaper(1900, 400)).toBe(true);
    expect(isUsableWallpaper(1279, 720)).toBe(false);
    expect(isUsableWallpaper(1000, 1500)).toBe(false);
    expect(isUsableWallpaper(1500, 1500)).toBe(false);
    expect(isUsableWallpaper(0, 0)).toBe(false);
  });

  it('accepts only the known kinds with a url', () => {
    expect(toWallpaper({ external_id: 'a', url: 'u', kind: 'banner' })).toEqual({ url: 'u', kind: 'banner' });
    expect(toWallpaper({ external_id: 'a', url: 'u', kind: 'cover' })).toBeNull();
    expect(toWallpaper({ external_id: 'a', url: null, kind: null })).toBeNull();
    expect(toWallpaper(undefined)).toBeNull();
  });
});

describe('collectAmbientSlides', () => {
  it('keeps only works with a wallpaper, fetching batches until the slideshow is full', async () => {
    const priority = Array.from({ length: 30 }, (_, i) => work(`anime:${i + 1}`));
    // Every third work has a wallpaper.
    const { resolve, calls } = fakeResolver(id => Number(id.split(':')[1]) % 3 === 0);
    const slides = await collectAmbientSlides({ priority, rest: [] }, resolve, { rng: noShuffle, max: 4, batchSize: 5 });
    expect(slides.map(s => s.work.externalId)).toEqual(['anime:3', 'anime:6', 'anime:9', 'anime:12']);
    // Stopped once four were found: 3 batches of 5, not all 30 ids.
    expect(calls).toHaveLength(3);
  });

  it('caps at MAX_AMBIENT_SLIDES by default', async () => {
    const priority = Array.from({ length: 70 }, (_, i) => work(`movie:${i + 1}`));
    const { resolve } = fakeResolver(() => true);
    expect(await collectAmbientSlides({ priority, rest: [] }, resolve)).toHaveLength(MAX_AMBIENT_SLIDES);
  });

  it('tops priority works up with the rest of the library only to the floor', async () => {
    const priority = [work('anime:1'), work('anime:2')];
    const rest = Array.from({ length: 20 }, (_, i) => work(`anime:${i + 10}`));
    const { resolve } = fakeResolver(() => true);
    const slides = await collectAmbientSlides({ priority, rest }, resolve, { rng: noShuffle, min: 5 });
    expect(slides.map(s => s.work.externalId)).toEqual(['anime:1', 'anime:2', 'anime:10', 'anime:11', 'anime:12']);
  });

  it('runs with just a few wallpapers when that is all there is', async () => {
    const priority = Array.from({ length: 12 }, (_, i) => work(`game:${i + 1}`));
    const { resolve } = fakeResolver(id => id === 'game:2' || id === 'game:7', 'artwork');
    const slides = await collectAmbientSlides({ priority, rest: [] }, resolve, { rng: noShuffle });
    expect(slides).toEqual([
      { work: work('game:2'), wallpaper: { url: 'https://w/game:2.jpg', kind: 'artwork' } },
      { work: work('game:7'), wallpaper: { url: 'https://w/game:7.jpg', kind: 'artwork' } },
    ]);
  });

  it('is empty with no wallpapers, no works, or a resolver that fails', async () => {
    const works = [work('movie:1'), work('movie:2')];
    expect(await collectAmbientSlides({ priority: works, rest: [] }, fakeResolver(() => false).resolve)).toEqual([]);
    const none = fakeResolver(() => true);
    expect(await collectAmbientSlides({ priority: [], rest: [] }, none.resolve)).toEqual([]);
    expect(none.calls).toHaveLength(0);
    const failing = vi.fn(async () => { throw new Error('offline'); });
    expect(await collectAmbientSlides({ priority: works, rest: [] }, failing)).toEqual([]);
  });

  it('shows each image once (seasons sharing one TMDB show) and respects the lookup budget', async () => {
    const shared = vi.fn(async (ids: string[]) => ids.map(id => ({ external_id: id, url: 'https://w/same.jpg', kind: 'backdrop' })));
    const slides = await collectAmbientSlides({ priority: [work('anime:1'), work('anime:2')], rest: [] }, shared);
    expect(slides.map(s => s.work.externalId)).toEqual(['anime:1']);

    const priority = Array.from({ length: 100 }, (_, i) => work(`movie:${i + 1}`));
    const { resolve, calls } = fakeResolver(() => false);
    await collectAmbientSlides({ priority, rest: [] }, resolve, { batchSize: 10, maxLookups: 25 });
    expect(calls.map(c => c.length)).toEqual([10, 10, 5]);
  });
});

describe('shuffled', () => {
  it('keeps every item and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffled(input, () => 0);
    expect(out.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
