import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CatalogSummary } from '../tauri/catalog';

const getCatalogEntriesByIds = vi.fn<(ids: string[]) => Promise<CatalogSummary[]>>();
vi.mock('../tauri/catalog', () => ({ getCatalogEntriesByIds: (ids: string[]) => getCatalogEntriesByIds(ids) }));

import { siblingIds, pickCatalogRowFor, readFeedCatalogRows, invalidateFeedCatalogRows } from './feed-catalog';

function row(id: string): CatalogSummary {
  return { external_id: id, title_main: id } as CatalogSummary;
}

beforeEach(() => {
  getCatalogEntriesByIds.mockReset();
  invalidateFeedCatalogRows();
});

describe('siblingIds', () => {
  it('adds the vnovel:/game: siblings of a numeric id, itself first', () => {
    expect(siblingIds('game:12')).toEqual(['game:12', 'vnovel:12']);
    expect(siblingIds('vnovel:12')).toEqual(['vnovel:12', 'game:12']);
    expect(siblingIds('anime:7')).toEqual(['anime:7', 'vnovel:7', 'game:7']);
  });

  it('leaves non-numeric or prefix-less ids alone', () => {
    expect(siblingIds('book:OL123W')).toEqual(['book:OL123W']);
    expect(siblingIds('plain')).toEqual(['plain']);
  });
});

describe('pickCatalogRowFor', () => {
  it('prefers the exact row, then a sibling, like get_catalog_entry', () => {
    const rows = new Map([['vnovel:5', row('vnovel:5')], ['game:6', row('game:6')]]);
    expect(pickCatalogRowFor('game:5', rows)?.external_id).toBe('vnovel:5');
    expect(pickCatalogRowFor('game:6', rows)?.external_id).toBe('game:6');
    expect(pickCatalogRowFor('game:7', rows)).toBeNull();
  });
});

describe('readFeedCatalogRows', () => {
  it('fetches unknown ids (plus siblings) in one batch and memoises them', async () => {
    getCatalogEntriesByIds.mockResolvedValueOnce([row('manga:1'), row('vnovel:2')]);
    const first = await readFeedCatalogRows(['manga:1', 'game:2', 'manga:1', 'anime:3']);
    expect(getCatalogEntriesByIds).toHaveBeenCalledTimes(1);
    expect(getCatalogEntriesByIds.mock.calls[0][0]).toEqual(expect.arrayContaining(['manga:1', 'game:2', 'vnovel:2', 'anime:3', 'vnovel:3', 'game:3']));
    expect(Object.keys(first).sort()).toEqual(['game:2', 'manga:1']);
    expect(first['game:2'].external_id).toBe('vnovel:2');

    // A second read (tab switch / revisit) only asks for what is new.
    getCatalogEntriesByIds.mockResolvedValueOnce([row('manga:9')]);
    const second = await readFeedCatalogRows(['manga:1', 'manga:9']);
    expect(getCatalogEntriesByIds).toHaveBeenCalledTimes(2);
    expect(getCatalogEntriesByIds.mock.calls[1][0]).toEqual(['manga:9', 'vnovel:9', 'game:9']);
    expect(Object.keys(second).sort()).toEqual(['manga:1', 'manga:9']);

    // Everything known: no IPC at all.
    await readFeedCatalogRows(['manga:1', 'manga:9', 'anime:3']);
    expect(getCatalogEntriesByIds).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight batch and does not retain a failed one', async () => {
    let resolve!: (rows: CatalogSummary[]) => void;
    getCatalogEntriesByIds.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const a = readFeedCatalogRows(['manga:1']);
    const b = readFeedCatalogRows(['manga:1', 'manga:2']);
    resolve([row('manga:1')]);
    getCatalogEntriesByIds.mockResolvedValueOnce([row('manga:2')]);
    await a;
    await b;
    expect(getCatalogEntriesByIds).toHaveBeenCalledTimes(2);
    expect(getCatalogEntriesByIds.mock.calls[1][0]).toEqual(['manga:2', 'vnovel:2', 'game:2']);

    invalidateFeedCatalogRows();
    getCatalogEntriesByIds.mockRejectedValueOnce(new Error('ipc'));
    expect(await readFeedCatalogRows(['manga:1'])).toEqual({});
    getCatalogEntriesByIds.mockResolvedValueOnce([row('manga:1')]);
    expect(Object.keys(await readFeedCatalogRows(['manga:1']))).toEqual(['manga:1']);
  });
});
