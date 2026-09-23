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

import {
  combinedProgress, metadataPhases, runMetadataFetch, toBatchRequest, steamWebApiRateLimiter,
  selectPendingMetadataGames, errorNeedsIgdbKeys, outcomeNeedsAttention,
} from './metadata-fetch';

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

describe('selectPendingMetadataGames', () => {
  const games = [
    { name: 'Done', launcher: 'steam', app_id: '1' },
    { name: 'Cover only', launcher: 'gog', app_id: 'g' },
    { name: 'ROM', launcher: 'local', app_id: 'rom', rom_platform: 'snes' },
    { name: 'Epic', launcher: 'epic', app_id: 'e' },
    { name: 'No id', launcher: 'steam' },
  ];
  const index = { '1': { cover_path: 'c', banner_path: 'b' }, g: { cover_path: 'c' } };

  it('is empty when every game already has its cover and banner', () => {
    expect(selectPendingMetadataGames([games[0], games[3], games[4]], index, { doBasic: true, doAchievements: false })).toEqual([]);
  });

  it('keeps Steam, GOG and ROM games missing art, and Steam games for achievements', () => {
    expect(selectPendingMetadataGames(games, index, { doBasic: true, doAchievements: false }).map(g => g.app_id)).toEqual(['g', 'rom']);
    expect(selectPendingMetadataGames(games, index, { doBasic: false, doAchievements: true }).map(g => g.app_id)).toEqual(['1']);
  });
});

describe('runMetadataFetch outcomes', () => {
  const steamGame = { app_id: '1', name: 'A', launcher: 'steam' };

  it('surfaces a rejected batch as the outcome error instead of only logging it', async () => {
    const unlisten = vi.fn();
    mocks.listenMetadataProgress.mockImplementation(async () => unlisten);
    mocks.igdbFetchMetadataBatch.mockRejectedValue('E_IGDB_KEYS_MISSING');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const outcome = await runMetadataFetch([steamGame], { doBasic: true, doAchievements: false }, () => {}, () => false);
      expect(outcome.error).toBe('E_IGDB_KEYS_MISSING');
      expect(errorNeedsIgdbKeys(outcome.error)).toBe(true);
      expect(outcomeNeedsAttention(outcome)).toBe(true);
      expect(unlisten).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps a thrown Error message and only points to the keys for key/auth codes', async () => {
    mocks.igdbFetchMetadataBatch.mockRejectedValue(new Error('Tauri not available'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const outcome = await runMetadataFetch([steamGame], { doBasic: true, doAchievements: false }, () => {}, () => false);
      expect(outcome.error).toBe('Tauri not available');
      expect(errorNeedsIgdbKeys(outcome.error)).toBe(false);
      expect(errorNeedsIgdbKeys('E_IGDB_AUTH: Twitch auth failed (HTTP 400)')).toBe(true);
      expect(errorNeedsIgdbKeys('E_IGDB_NETWORK: timeout')).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('counts the batch results and passes the retry flag through', async () => {
    mocks.igdbFetchMetadataBatch.mockResolvedValue([
      { app_id: '1', status: 'done', cover_path: 'c', error: null },
      { app_id: '2', status: 'cached', cover_path: 'c', error: null },
      { app_id: '3', status: 'skipped', cover_path: null, error: null },
      { app_id: '4', status: 'not_found', cover_path: null, error: 'x' },
      { app_id: '5', status: 'error', cover_path: null, error: 'x' },
    ]);
    const outcome = await runMetadataFetch([steamGame], { doBasic: true, doAchievements: false, retryNotFound: true }, () => {}, () => false);
    expect(mocks.igdbFetchMetadataBatch.mock.calls[0][1]).toBe(true);
    expect(outcome).toEqual({ error: null, summary: { done: 1, cached: 1, notFound: 1, skipped: 1, failed: 1, achievementsFailed: 0 } });
    expect(outcomeNeedsAttention(outcome)).toBe(true);
  });

  it('a clean run needs no attention; an empty list never reaches the batch as work', async () => {
    mocks.igdbFetchMetadataBatch.mockResolvedValue([{ app_id: '1', status: 'done', cover_path: 'c', error: null }]);
    const clean = await runMetadataFetch([steamGame], { doBasic: true, doAchievements: false }, () => {}, () => false);
    expect(outcomeNeedsAttention(clean)).toBe(false);

    mocks.igdbFetchMetadataBatch.mockResolvedValue([]);
    const empty = await runMetadataFetch([], { doBasic: true, doAchievements: true }, () => {}, () => false);
    expect(empty.error).toBeNull();
    expect(outcomeNeedsAttention(empty)).toBe(false);
    expect(mocks.steamAchievementsDownload).not.toHaveBeenCalled();
  });

  it('counts failed achievement downloads instead of swallowing them', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.steamAchievementsDownload.mockRejectedValue('boom');
      const run = runMetadataFetch([steamGame], { doBasic: false, doAchievements: true }, () => {}, () => false);
      // The shared limiter may still hold an earlier test's fake-clock hits.
      await vi.advanceTimersByTimeAsync(15_000);
      const outcome = await run;
      expect(outcome.summary.achievementsFailed).toBe(1);
      expect(outcomeNeedsAttention(outcome)).toBe(true);
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('a run cancelled before it starts sends nothing', async () => {
    const outcome = await runMetadataFetch([steamGame], { doBasic: true, doAchievements: true }, () => {}, () => true);
    expect(mocks.igdbFetchMetadataBatch).not.toHaveBeenCalled();
    expect(mocks.steamAchievementsDownload).not.toHaveBeenCalled();
    expect(outcome.error).toBeNull();
  });
});
