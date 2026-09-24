import { describe, expect, it } from 'vitest';
import { anilistIdOf, buildWorkContext, normalizeTitle, pickBestMatch } from './work-context';
import type { SourceSearchItem } from './plugin-results';

const work = buildWorkContext({
  externalId: 'manga:30013',
  type: 'manga',
  titleMain: 'Ōkami to Kōshinryō',
  titleEnglish: 'Spice & Wolf',
  titleRomaji: 'Ōkami to Kōshinryō',
  releaseYear: 2007,
  malId: 9115,
});

const item = (overrides: Partial<SourceSearchItem>): SourceSearchItem => ({ id: 'x', title: 'Other', type: 'manga', ...overrides });

describe('buildWorkContext', () => {
  it('dedupes titles and reads the AniList id', () => {
    expect(work.titles).toEqual(['Ōkami to Kōshinryō', 'Spice & Wolf']);
    expect(work.anilistId).toBe(30013);
    expect(anilistIdOf('book:OL1W')).toBeNull();
    expect(anilistIdOf('lnovel:12')).toBe(12);
  });
});

describe('pickBestMatch', () => {
  it('prefers an AniList id over a title', () => {
    const items = [item({ id: 'title', title: 'Spice and Wolf' }), item({ id: 'id', title: 'Something else', anilistId: 30013 })];
    expect(pickBestMatch(items, work)).toEqual({ item: items[1], reason: 'anilistId' });
  });

  it('falls back to the MAL id, then to a normalised title', () => {
    expect(pickBestMatch([item({ id: 'm', malId: 9115 })], work)?.reason).toBe('malId');
    const byTitle = pickBestMatch([item({ id: 'a', title: 'Okami to Koshinryo', type: 'lnovel' }), item({ id: 'b', title: 'OKAMI TO KOSHINRYO!' })], work);
    expect(byTitle).toEqual({ item: expect.objectContaining({ id: 'b' }), reason: 'title' });
    expect(normalizeTitle('Spice & Wolf')).toBe(normalizeTitle('spice and wolf'));
  });

  it('refuses a far-off year and unrelated titles', () => {
    expect(pickBestMatch([item({ title: 'Spice and Wolf', year: 2016 })], work)).toBeNull();
    expect(pickBestMatch([item({ title: 'Spice' })], work)).toBeNull();
  });
});
