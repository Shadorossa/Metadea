import { describe, expect, it, vi } from 'vitest';
import {
  matchCoverSize,
  createTextlessCoverStore,
  isTextlessEligibleId,
  selectDisplayCover,
  textlessScopeAllows,
  textlessFromRow,
  TEXTLESS_DISABLED,
} from './textless-covers';
import type { TextlessCoverRow } from '../tauri/textless-covers';
import type { TextlessCoverScope } from '../storage/preferences';

const ORIGINAL = 'https://image.tmdb.org/t/p/w500/original.jpg';
const MANUAL = 'https://cdn.example/manual.webp';
const POSTER = { url: 'https://image.tmdb.org/t/p/w500/clean.jpg', kind: 'poster' as const };
const ART = { url: 'https://images.igdb.com/igdb/image/upload/t_720p/art.jpg', kind: 'art' as const };

describe('selectDisplayCover precedence (manual > textless > original)', () => {
  it('never replaces a manual cover with the textless one', () => {
    expect(selectDisplayCover({ original: MANUAL, manual: MANUAL, textless: POSTER, enabled: true }))
      .toEqual({ src: MANUAL, textless: false, cropped: false });
    // A card that had no src of its own still shows the manual pick.
    expect(selectDisplayCover({ original: null, manual: MANUAL, textless: POSTER, enabled: true }).src).toBe(MANUAL);
  });

  it('uses the textless version over the original when enabled', () => {
    expect(selectDisplayCover({ original: ORIGINAL, manual: null, textless: POSTER, enabled: true }))
      .toEqual({ src: POSTER.url, textless: true, cropped: false });
    expect(selectDisplayCover({ original: ORIGINAL, manual: null, textless: ART, enabled: true }))
      .toEqual({ src: ART.url, textless: true, cropped: true });
  });

  it('keeps the original when disabled, unknown or known to have none', () => {
    expect(selectDisplayCover({ original: ORIGINAL, manual: null, textless: POSTER, enabled: false }).src).toBe(ORIGINAL);
    expect(selectDisplayCover({ original: ORIGINAL, manual: null, textless: undefined, enabled: true }).src).toBe(ORIGINAL);
    expect(selectDisplayCover({ original: ORIGINAL, manual: null, textless: null, enabled: true }))
      .toEqual({ src: ORIGINAL, textless: false, cropped: false });
    expect(selectDisplayCover({ original: '', manual: null, textless: null, enabled: true }).src).toBeNull();
  });
});

describe('isTextlessEligibleId', () => {
  it('accepts only TMDB films/series and IGDB games/VNs', () => {
    for (const id of ['movie:603', 'series:1396', 'game:1942', 'vnovel:7']) expect(isTextlessEligibleId(id)).toBe(true);
    for (const id of ['anime:21', 'manga:30013', 'book:OL1W', 'series:1396:season:2', 'movie:0', '', null, undefined]) {
      expect(isTextlessEligibleId(id)).toBe(false);
    }
  });
});

describe('textlessFromRow', () => {
  it('maps a resolved row and treats anything incomplete as none', () => {
    expect(textlessFromRow({ external_id: 'game:1', url: ART.url, kind: 'art' })).toEqual(ART);
    expect(textlessFromRow({ external_id: 'game:1', url: null, kind: null })).toBeNull();
    expect(textlessFromRow({ external_id: 'game:1', url: ART.url, kind: null })).toBeNull();
  });
});

function setup(options: { enabled?: boolean; scope?: TextlessCoverScope; rows?: (ids: string[]) => TextlessCoverRow[]; fail?: boolean } = {}) {
  let enabled = options.enabled ?? true;
  let scope: TextlessCoverScope = options.scope ?? 'all';
  const flushes: Array<() => void> = [];
  const resolve = vi.fn(async (ids: string[]) => {
    if (options.fail) throw new Error('E_NETWORK');
    return options.rows ? options.rows(ids) : [];
  });
  const store = createTextlessCoverStore({
    resolve,
    readEnabled: () => enabled,
    readScope: () => scope,
    readManual: () => ({ 'movie:9': MANUAL }),
    schedule: flush => { flushes.push(flush); },
  });
  const runFlush = async () => {
    for (const flush of flushes.splice(0)) flush();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    store,
    resolve,
    runFlush,
    setEnabled: (v: boolean) => { enabled = v; },
    setScope: (v: TextlessCoverScope) => { scope = v; },
  };
}

describe('textless cover store', () => {
  it('batches every id requested in one pass into a single resolve call', async () => {
    const { store, resolve, runFlush } = setup({
      rows: ids => ids.map(id => (id === 'movie:1' ? { external_id: id, ...POSTER } : { external_id: id, url: null, kind: null })),
    });
    store.request('movie:1');
    store.request('game:2');
    store.request('movie:1');
    store.request('anime:3');
    expect(store.snapshot('movie:1')).toBeUndefined();
    await runFlush();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(['movie:1', 'game:2']);
    expect(store.snapshot('movie:1')).toEqual(POSTER);
    // Negative answers are remembered: no second request for them.
    expect(store.snapshot('game:2')).toBeNull();
    store.request('game:2');
    await runFlush();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the setting is off, and notifies when it turns on', async () => {
    const { store, resolve, runFlush, setEnabled } = setup({ enabled: false });
    const listener = vi.fn();
    store.subscribe(listener);
    store.request('movie:1');
    await runFlush();
    expect(resolve).not.toHaveBeenCalled();
    expect(store.snapshot('movie:1')).toBe(TEXTLESS_DISABLED);
    setEnabled(true);
    store.refreshEnabled();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.snapshot('movie:1')).toBeUndefined();
  });

  it('only covers the works in the chosen scope, and follows scope changes', async () => {
    const { store, resolve, runFlush, setScope } = setup({ scope: 'games' });
    store.request('movie:1');
    store.request('game:2');
    await runFlush();
    expect(resolve).toHaveBeenCalledWith(['game:2']);
    expect(store.snapshot('movie:1')).toBe(TEXTLESS_DISABLED);
    setScope('screen');
    store.refreshEnabled();
    expect(store.snapshot('game:2')).toBe(TEXTLESS_DISABLED);
    expect(store.snapshot('movie:1')).toBeUndefined();
  });

  it('remembers a failed batch as "none" for the session instead of retrying in a loop', async () => {
    const { store, resolve, runFlush } = setup({ fail: true });
    store.request('movie:1');
    await runFlush();
    expect(store.snapshot('movie:1')).toBeNull();
    store.request('movie:1');
    await runFlush();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('reads manual covers once and re-reads them after a change', () => {
    const readManual = vi.fn(() => ({ 'movie:9': MANUAL }));
    const store = createTextlessCoverStore({ resolve: async () => [], readEnabled: () => true, readManual, schedule: () => {} });
    expect(store.manualCover('movie:9')).toBe(MANUAL);
    expect(store.manualCover('movie:1')).toBeNull();
    expect(readManual).toHaveBeenCalledTimes(1);
    store.refreshManualCovers();
    store.manualCover('movie:9');
    expect(readManual).toHaveBeenCalledTimes(2);
  });
});

describe('matchCoverSize', () => {
  it('uses the small size when the card shows a small cover', () => {
    expect(matchCoverSize('https://image.tmdb.org/t/p/w500/a.jpg', 'https://image.tmdb.org/t/p/w185/orig.jpg'))
      .toBe('https://image.tmdb.org/t/p/w185/a.jpg');
    expect(matchCoverSize('https://images.igdb.com/igdb/image/upload/t_720p/x.jpg', 'https://images.igdb.com/igdb/image/upload/t_cover_small/co1.jpg'))
      .toBe('https://images.igdb.com/igdb/image/upload/t_cover_small/x.jpg');
  });

  it('uses the medium size when the card shows a medium cover', () => {
    expect(matchCoverSize('https://image.tmdb.org/t/p/w500/a.jpg', 'https://image.tmdb.org/t/p/w342/orig.jpg'))
      .toBe('https://image.tmdb.org/t/p/w342/a.jpg');
  });

  it('keeps the full size for full-size originals and unknown hosts', () => {
    expect(matchCoverSize('https://image.tmdb.org/t/p/w500/a.jpg', 'https://image.tmdb.org/t/p/original/o.jpg'))
      .toBe('https://image.tmdb.org/t/p/w500/a.jpg');
    expect(matchCoverSize('https://image.tmdb.org/t/p/w500/a.jpg', null)).toBe('https://image.tmdb.org/t/p/w500/a.jpg');
  });
});

describe('textlessScopeAllows', () => {
  it('splits films/series from games/visual novels', () => {
    expect(textlessScopeAllows('all', 'movie:1')).toBe(true);
    expect(textlessScopeAllows('all', 'game:1')).toBe(true);
    expect(textlessScopeAllows('screen', 'series:1')).toBe(true);
    expect(textlessScopeAllows('screen', 'vnovel:1')).toBe(false);
    expect(textlessScopeAllows('games', 'vnovel:1')).toBe(true);
    expect(textlessScopeAllows('games', 'movie:1')).toBe(false);
  });
});
