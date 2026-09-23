import { describe, expect, it } from 'vitest';
import { animeSeasonBaseResolver, unifyTasteSeasons } from './taste-seasons';
import type { DbMediaRelation } from '../tauri/catalog';
import type { TasteCompatibility } from './taste-compatibility';

const rel = (a: string, b: string, type: string) => ({ media_external_id: a, related_media_external_id: b, relation_type: type, type_label: '' }) as DbMediaRelation;
// AoT: S1 (1) → S2 (2) → S3 (3); unrelated anime 9.
const relations = [rel('anime:1', 'anime:2', 'SEQUEL'), rel('anime:2', 'anime:1', 'PREQUEL'), rel('anime:3', 'anime:2', 'PREQUEL')];
const catalog = new Map([['anime:1', { release_year: 2013 }], ['anime:2', { release_year: 2017 }], ['anime:3', { release_year: 2018 }], ['anime:9', { release_year: 2020 }]]);

describe('animeSeasonBaseResolver', () => {
  it('maps every season to the first one', () => {
    const baseOf = animeSeasonBaseResolver(relations, catalog);
    expect(['anime:1', 'anime:2', 'anime:3'].map(baseOf)).toEqual(['anime:1', 'anime:1', 'anime:1']);
    expect(baseOf('anime:9')).toBe('anime:9');
    expect(baseOf('manga:2')).toBe('manga:2');
  });
});

describe('unifyTasteSeasons', () => {
  it('keeps one entry per anime, shown as its base', () => {
    const taste = {
      sharedFavorites: ['anime:3', 'anime:9', 'anime:2'],
      bothLoved: [{ external_id: 'anime:2', own: 9, their: 9 }, { external_id: 'anime:3', own: 8, their: 8 }],
      disagreements: [{ external_id: 'anime:9', own: 2, their: 9 }],
    } as unknown as TasteCompatibility;
    const out = unifyTasteSeasons(taste, relations, catalog);
    expect(out.sharedFavorites).toEqual(['anime:1', 'anime:9']);
    expect(out.bothLoved).toEqual([{ external_id: 'anime:1', own: 9, their: 9 }]);
    expect(out.disagreements).toEqual(taste.disagreements);
  });

  it('falls back to the season present when the base has no catalog row', () => {
    const noBase = new Map([['anime:2', { release_year: 2017 }], ['anime:3', { release_year: 2018 }]]);
    const taste = { sharedFavorites: ['anime:3', 'anime:2'], bothLoved: [], disagreements: [] } as unknown as TasteCompatibility;
    expect(unifyTasteSeasons(taste, relations, noBase).sharedFavorites).toEqual(['anime:3']);
  });
});
