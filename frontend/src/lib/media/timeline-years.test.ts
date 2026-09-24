import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backfillYears, resetBackfilledYears } from './timeline-years';

beforeEach(() => resetBackfilledYears());

describe('backfillYears', () => {
  it('fills from the local catalog first, then AniList for what is left', async () => {
    const catalogYears = vi.fn(async () => new Map([['game:1', 2004]]));
    const anilistYears = vi.fn(async () => new Map([[20, 2002]]));
    const found = await backfillYears(
      [{ id: 'game:1', year: null }, { id: 'anime:20', year: null }, { id: 'anime:5', year: 1999 }],
      { catalogYears, anilistYears },
    );
    expect(found).toEqual(new Map([['game:1', 2004], ['anime:20', 2002]]));
    expect(catalogYears).toHaveBeenCalledWith(['game:1', 'anime:20']);
    expect(anilistYears).toHaveBeenCalledWith([20]);
  });

  it('remembers answers, including misses, for the session', async () => {
    const catalogYears = vi.fn(async () => new Map<string, number>());
    const anilistYears = vi.fn(async () => new Map<number, number>());
    const items = [{ id: 'anime:7', year: null }, { id: 'movie:3', year: null }];
    await backfillYears(items, { catalogYears, anilistYears });
    await backfillYears(items, { catalogYears, anilistYears });
    expect(catalogYears).toHaveBeenCalledTimes(1);
    expect(anilistYears).toHaveBeenCalledTimes(1);
  });
});
