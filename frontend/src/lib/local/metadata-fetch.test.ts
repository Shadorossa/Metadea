import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  igdbFetchMetadataBatch: vi.fn(),
  igdbCancelMetadataBatch: vi.fn(),
  listenMetadataProgress: vi.fn(),
  steamAchievementsDownload: vi.fn(),
}));

vi.mock('../tauri', () => ({
  igdbFetchMetadataBatch: mocks.igdbFetchMetadataBatch,
  igdbCancelMetadataBatch: mocks.igdbCancelMetadataBatch,
  listenMetadataProgress: mocks.listenMetadataProgress,
  steamAchievementsDownload: mocks.steamAchievementsDownload,
}));
vi.mock('../dom/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../i18n/runtime', () => ({ getT: () => ({ settings: {} }) }));

import { combinedProgress, metadataPhases, runMetadataFetch, toBatchRequest, steamWebApiRateLimiter } from './metadata-fetch';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listenMetadataProgress.mockImplementation(async () => () => {});
  mocks.igdbFetchMetadataBatch.mockResolvedValue([]);
  mocks.steamAchievementsDownload.mockResolvedValue(undefined);
});

describe('progress arithmetic', () => {
  it('counts games, never steps, and never overshoots the total', () => {
    expect(metadataPhases({ doBasic: true, doAchievements: true })).toBe(2);
    expect(combinedProgress(3, 0, 2, 10)).toBe(1);
    expect(combinedProgress(10, 10, 2, 10)).toBe(10);
    expect(combinedProgress(7, 0, 1, 7)).toBe(7);
    expect(combinedProgress(99, 99, 2, 10)).toBe(10);
    expect(combinedProgress(1, 1, 0, 10)).toBe(0);
  });

  it('maps a pending game to the batch request shape', () => {
    expect(toBatchRequest({ app_id: '1', name: 'G', launcher: 'steam' })).toEqual({ app_id: '1', game_name: 'G', launcher: 'steam', rom_platform: null });
  });
});

describe('runMetadataFetch', () => {
  it('sends the whole list as one batch and relays its progress events', async () => {
    let emit: ((p: { total: number; current: number; current_name: string }) => void) | null = null;
    mocks.listenMetadataProgress.mockImplementation(async (cb: typeof emit) => { emit = cb; return () => {}; });
    mocks.igdbFetchMetadataBatch.mockImplementation(async () => { emit?.({ total: 2, current: 1, current_name: 'A' }); return []; });
    const seen: { current: number; currentName: string }[] = [];
    await runMetadataFetch(
      [{ app_id: '1', name: 'A', launcher: 'steam' }, { app_id: 'g', name: 'B', launcher: 'gog' }],
      { doBasic: true, doAchievements: false },
      p => seen.push({ current: p.current, currentName: p.currentName }),
      () => false,
    );
    expect(mocks.igdbFetchMetadataBatch).toHaveBeenCalledTimes(1);
    expect(mocks.igdbFetchMetadataBatch.mock.calls[0][0]).toHaveLength(2);
    expect(seen[0]).toEqual({ current: 1, currentName: 'A' });
    expect(mocks.steamAchievementsDownload).not.toHaveBeenCalled();
  });

  it('downloads achievements for Steam games only, through the Steam budget, and stops on cancel', async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      mocks.steamAchievementsDownload.mockImplementation(async (appId: string) => { if (appId === '2') cancelled = true; });
      const run = runMetadataFetch(
        [{ app_id: 'g', name: 'G', launcher: 'gog' }, { app_id: '1', name: 'A', launcher: 'steam' }, { app_id: '2', name: 'B', launcher: 'steam' }, { app_id: '3', name: 'C', launcher: 'steam' }],
        { doBasic: false, doAchievements: true },
        () => {},
        () => cancelled,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await run;
      expect(mocks.igdbFetchMetadataBatch).not.toHaveBeenCalled();
      expect(mocks.steamAchievementsDownload.mock.calls.map(c => c[0])).toEqual(['1', '2']);
      expect(steamWebApiRateLimiter.pending).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
