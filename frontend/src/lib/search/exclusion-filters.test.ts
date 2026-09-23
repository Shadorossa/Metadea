import { describe, expect, it, vi } from 'vitest';

vi.mock('../tauri/catalog', () => ({
  getBlockedExternalIds: vi.fn(async () => ['game:3', 'anime:9']),
  getReclassifiedExternalIds: vi.fn(async (ids: string[]) => ids.filter(id => id === 'game:2')),
}));

import { getReclassifiedExternalIds } from '../tauri/catalog';
import {
  aniListAdultVariable,
  EXCLUDED_LOCAL_FORMATS,
  isHiddenAdult,
  localCatalogVerdict,
  readBlockedIds,
  readReclassifiedIds,
  reclassifiableIds,
  titleHasEditionWord,
  withoutIds,
} from './exclusion-filters';

describe('local catalog rules', () => {
  it('matches edition words as whole words only', () => {
    expect(titleHasEditionWord('Skyrim Special Edition')).toBe(true);
    expect(titleHasEditionWord('Dark Souls: Remastered')).toBe(true);
    expect(titleHasEditionWord('Clair Obscur: Expedition 33')).toBe(false);
  });

  it('keeps DLC-like formats as extras and drops the rest of what search hides', () => {
    expect(localCatalogVerdict({ type: 'game', format: 'DLC', title: 'The Old Hunters' })).toBe('extra');
    expect(localCatalogVerdict({ type: 'game', format: 'BUNDLE', title: 'Trilogy' })).toBe('extra');
    expect(localCatalogVerdict({ type: 'game', format: 'REMASTER', title: 'X' })).toBe('exclude');
    expect(localCatalogVerdict({ type: 'game', format: 'PORT', title: 'X' })).toBe('exclude');
    expect(localCatalogVerdict({ type: 'game', format: null, title: 'Game: Definitive Edition' })).toBe('exclude');
    // The title rule is games / visual novels only.
    expect(localCatalogVerdict({ type: 'anime', format: 'TV', title: 'Collector Edition' })).toBe('keep');
    expect(localCatalogVerdict({ type: 'game', format: 'GAME', title: 'Elden Ring' })).toBe('keep');
  });

  // Search's local-catalog filter used to be these two inline predicates
  // (lib/search/index.ts); the shared verdict must keep exactly the same rows.
  it('keeps exactly the rows the former inline search filter kept', () => {
    const formerWords = ['edition', 'remaster', 'remastered', 'dlc'];
    const formerKeep = (type: string, format: string | null, title: string) =>
      (!format || !EXCLUDED_LOCAL_FORMATS.has(format))
      && ((type !== 'game' && type !== 'vnovel') || !title.split(/[^a-zA-Z0-9]+/).some(tok => formerWords.includes(tok.toLowerCase())));
    const rows: [string, string | null, string][] = [
      ['game', null, 'Elden Ring'], ['game', 'DLC', 'Shadow of the Erdtree'], ['game', 'REMAKE', 'Resident Evil 2'],
      ['game', 'EXPANDED_GAME', 'Persona 5 Royal'], ['game', 'MOD', 'Mod'], ['game', 'FORK', 'Fork'],
      ['game', null, 'Skyrim Anniversary Edition'], ['vnovel', null, 'Steins;Gate DLC Pack'], ['vnovel', 'VISUAL_NOVEL', 'Clannad'],
      ['anime', 'TV', 'Remastered Anime'], ['manga', 'MANGA', 'Deluxe Edition'], ['game', '', 'Expedition 33'],
      ['game', 'UPDATE', 'Patch'], ['movie', null, 'Director Edition'],
    ];
    for (const [type, format, title] of rows) {
      expect(localCatalogVerdict({ type, format, title }) === 'keep', `${type} ${format} ${title}`).toBe(formerKeep(type, format, title));
    }
  });
});

describe('adult content', () => {
  it('maps the setting to the AniList variable and to a row check', () => {
    expect(aniListAdultVariable(false)).toBe(false);
    // undefined, never null: AniList matches nothing for an explicit null.
    expect(aniListAdultVariable(true)).toBeUndefined();
    expect(JSON.stringify({ isAdult: aniListAdultVariable(true) })).toBe('{}');
    expect(isHiddenAdult(true, false)).toBe(true);
    expect(isHiddenAdult(true, true)).toBe(false);
    expect(isHiddenAdult(false, false)).toBe(false);
    expect(isHiddenAdult(undefined, false)).toBe(false);
  });
});

describe('id exclusions', () => {
  const rows = [{ id: 'game:1', type: 'game' }, { id: 'game:2', type: 'game' }, { id: 'game:3', type: 'game' }, { id: 'anime:9', type: 'anime' }, { id: 'vnovel:4', type: 'vnovel' }];

  it('drops ids in any set and returns a copy when none apply', () => {
    expect(withoutIds(rows, r => r.id, new Set(['game:3']), new Set(['anime:9'])).map(r => r.id)).toEqual(['game:1', 'game:2', 'vnovel:4']);
    const copy = withoutIds(rows, r => r.id, new Set());
    expect(copy).toEqual(rows);
    expect(copy).not.toBe(rows);
  });

  it('only asks about games and visual novels, and not at all when there are none', async () => {
    expect(reclassifiableIds(rows, r => r.type, r => r.id)).toEqual(['game:1', 'game:2', 'game:3', 'vnovel:4']);
    expect(await readReclassifiedIds(['game:1', 'game:2'])).toEqual(new Set(['game:2']));
    vi.mocked(getReclassifiedExternalIds).mockClear();
    expect(await readReclassifiedIds([])).toEqual(new Set());
    expect(getReclassifiedExternalIds).not.toHaveBeenCalled();
  });

  it('reads the blocked set, empty when the command fails', async () => {
    expect(await readBlockedIds()).toEqual(new Set(['game:3', 'anime:9']));
    const { getBlockedExternalIds } = await import('../tauri/catalog');
    vi.mocked(getBlockedExternalIds).mockRejectedValueOnce(new Error('no tauri'));
    expect(await readBlockedIds()).toEqual(new Set());
  });
});
