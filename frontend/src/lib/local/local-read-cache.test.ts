import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMediaRelationsForEditor: vi.fn(),
  getLibraryEntry: vi.fn(),
  getEpisodeHistory: vi.fn(),
  getAnilistPreSequelChecked: vi.fn(),
  getCatalogEntryForEditor: vi.fn(),
  getBaseEditionCandidatesForRedirect: vi.fn(),
  scanFolderContents: vi.fn(),
  findTaggedPath: vi.fn(),
  getCatalogEntriesFullByIds: vi.fn(),
  igdbGetGameDetail: vi.fn(),
  getMediaCompanies: vi.fn(),
  readGameInfo: vi.fn(),
  steamGetPlayerAchievements: vi.fn(),
  steamGetCachedAchievements: vi.fn(),
  getCatalogEntry: vi.fn(),
}));

vi.mock('../tauri', () => ({
  getMediaRelationsForEditor: mocks.getMediaRelationsForEditor,
  getLibraryEntry: mocks.getLibraryEntry,
  getEpisodeHistory: mocks.getEpisodeHistory,
  getAnilistPreSequelChecked: mocks.getAnilistPreSequelChecked,
  getCatalogEntryForEditor: mocks.getCatalogEntryForEditor,
  getBaseEditionCandidatesForRedirect: mocks.getBaseEditionCandidatesForRedirect,
  scanFolderContents: mocks.scanFolderContents,
  findTaggedPath: mocks.findTaggedPath,
  getCatalogEntriesFullByIds: mocks.getCatalogEntriesFullByIds,
  igdbGetGameDetail: mocks.igdbGetGameDetail,
  getMediaCompanies: mocks.getMediaCompanies,
  readGameInfo: mocks.readGameInfo,
  steamGetPlayerAchievements: mocks.steamGetPlayerAchievements,
  steamGetCachedAchievements: mocks.steamGetCachedAchievements,
  steamLang: () => 'english',
  // lib/media/port-redirect's own default reads (unused here: the cache
  // hands it the memoised readers).
  getCatalogEntry: mocks.getCatalogEntry,
}));
vi.mock('../tauri/catalog', () => ({ getCatalogEntry: mocks.getCatalogEntry }));

import {
  beginLocalVisit, endLocalVisit, isLocalVisitActive, invalidateLocalFolderReads, invalidateLocalEpisodeHistory,
  readLocalRelationsForEditor, readLocalCatalogEntry, readLocalFolderContents, readLocalTaggedPath,
  readLocalFullCatalogEntries, readLocalEpisodeHistory, readLocalIgdbGameDetail,
  readLocalGameInfo, invalidateLocalGameReads, invalidateLocalSteamAchievements,
  loadLocalSteamAchievements, prefetchLocalSteamAchievements, isSteamAchievementsCacheFresh, sameSteamAchievements,
  STEAM_ACHIEVEMENTS_FRESH_MS, markLocalSteamAchievementsStale,
  readLocalPortRedirect, readLocalCatalogEntryPastRedirect,
} from './local-read-cache';

beforeEach(() => {
  vi.resetAllMocks();
  endLocalVisit();
  mocks.getMediaRelationsForEditor.mockResolvedValue([]);
  mocks.getCatalogEntry.mockResolvedValue(null);
  mocks.scanFolderContents.mockResolvedValue([]);
  mocks.getEpisodeHistory.mockResolvedValue([]);
  mocks.igdbGetGameDetail.mockResolvedValue({ id: 1, name: 'G' });
  mocks.readGameInfo.mockResolvedValue({ app_id: '10', name: 'Game' });
  mocks.steamGetPlayerAchievements.mockResolvedValue({ unlocked: 1, total: 2, list: [], fetched_at: nowSec() });
  mocks.steamGetCachedAchievements.mockResolvedValue(null);
  mocks.getCatalogEntryForEditor.mockResolvedValue(null);
  mocks.getBaseEditionCandidatesForRedirect.mockResolvedValue([]);
});

describe('local-read-cache', () => {
  it('passes every read straight through outside a visit', async () => {
    expect(isLocalVisitActive()).toBe(false);
    await readLocalRelationsForEditor('anime:1');
    await readLocalRelationsForEditor('anime:1');
    expect(mocks.getMediaRelationsForEditor).toHaveBeenCalledTimes(2);
  });

  it('memoises each id once for the visit and forgets it when the visit ends', async () => {
    beginLocalVisit();
    await Promise.all([readLocalRelationsForEditor('anime:1'), readLocalRelationsForEditor('anime:1'), readLocalCatalogEntry('anime:1')]);
    await readLocalCatalogEntry('anime:1');
    expect(mocks.getMediaRelationsForEditor).toHaveBeenCalledTimes(1);
    expect(mocks.getCatalogEntry).toHaveBeenCalledTimes(1);
    endLocalVisit();
    beginLocalVisit();
    await readLocalRelationsForEditor('anime:1');
    expect(mocks.getMediaRelationsForEditor).toHaveBeenCalledTimes(2);
  });

  it('never retains a rejected read', async () => {
    beginLocalVisit();
    mocks.getMediaRelationsForEditor.mockRejectedValueOnce(new Error('ipc'));
    await expect(readLocalRelationsForEditor('anime:2')).rejects.toThrow('ipc');
    await readLocalRelationsForEditor('anime:2');
    expect(mocks.getMediaRelationsForEditor).toHaveBeenCalledTimes(2);
  });

  it('drops folder listings and tagged walks together on invalidateLocalFolderReads', async () => {
    beginLocalVisit();
    mocks.findTaggedPath.mockResolvedValue({ abs_path: 'C:/Anime/x [anime-1]', is_dir: true });
    await readLocalFolderContents('C:/Anime');
    await readLocalFolderContents('C:/Anime');
    const tagged = await readLocalTaggedPath('C:/Anime', 'anime:1');
    await readLocalTaggedPath('C:/Anime', 'anime:1');
    expect(tagged).toEqual({ absPath: 'C:/Anime/x [anime-1]', isDir: true });
    expect(mocks.findTaggedPath).toHaveBeenCalledWith('C:/Anime', '[anime-1]', 3);
    expect(mocks.scanFolderContents).toHaveBeenCalledTimes(1);
    expect(mocks.findTaggedPath).toHaveBeenCalledTimes(1);
    invalidateLocalFolderReads();
    await readLocalFolderContents('C:/Anime');
    await readLocalTaggedPath('C:/Anime', 'anime:1');
    expect(mocks.scanFolderContents).toHaveBeenCalledTimes(2);
    expect(mocks.findTaggedPath).toHaveBeenCalledTimes(2);
  });

  it('fetches the full rows a visit has not seen in one batch and reuses them', async () => {
    beginLocalVisit();
    mocks.getCatalogEntriesFullByIds.mockResolvedValue([{ external_id: 'anime:1', type: 'anime', banners_csv: 'b' }]);
    const first = await readLocalFullCatalogEntries(['anime:1', 'anime:2']);
    expect(first.get('anime:1')?.banners_csv).toBe('b');
    expect(first.get('anime:2')).toBeNull();
    mocks.getCatalogEntriesFullByIds.mockResolvedValue([{ external_id: 'anime:3', type: 'anime' }]);
    const second = await readLocalFullCatalogEntries(['anime:1', 'anime:3']);
    expect(mocks.getCatalogEntriesFullByIds).toHaveBeenCalledTimes(2);
    expect(mocks.getCatalogEntriesFullByIds).toHaveBeenLastCalledWith(['anime:3']);
    expect(second.get('anime:1')?.banners_csv).toBe('b');
    expect(second.get('anime:3')?.external_id).toBe('anime:3');
  });

  it('episode history can be dropped for one id, and the IGDB detail is served once per visit', async () => {
    beginLocalVisit();
    await readLocalEpisodeHistory('anime:1');
    invalidateLocalEpisodeHistory('anime:1');
    await readLocalEpisodeHistory('anime:1');
    expect(mocks.getEpisodeHistory).toHaveBeenCalledTimes(2);
    await readLocalIgdbGameDetail(7);
    await readLocalIgdbGameDetail(7);
    expect(mocks.igdbGetGameDetail).toHaveBeenCalledTimes(1);
  });

  it('serves a game info.json once per visit until invalidated', async () => {
    beginLocalVisit();
    await Promise.all([readLocalGameInfo('10'), readLocalGameInfo('10')]);
    expect(mocks.readGameInfo).toHaveBeenCalledTimes(1);
    invalidateLocalGameReads();
    await readLocalGameInfo('10');
    expect(mocks.readGameInfo).toHaveBeenCalledTimes(2);
  });

  it('walks a PORT redirect over the memoised rows, one editor read per id', async () => {
    beginLocalVisit();
    mocks.getCatalogEntryForEditor.mockImplementation(async (id: string) =>
      id === 'game:1' ? { external_id: 'game:1', format: 'PORT' } : id === 'game:2' ? { external_id: 'game:2', format: 'MAIN_GAME' } : null);
    mocks.getBaseEditionCandidatesForRedirect.mockImplementation(async (id: string) => id === 'game:1' ? ['game:2'] : []);

    expect(await readLocalPortRedirect('game:1')).toBe('game:2');
    expect(await readLocalPortRedirect('game:1')).toBe('game:2');
    expect(await readLocalCatalogEntryPastRedirect('game:1')).toEqual({ external_id: 'game:1', format: 'PORT' });
    expect(mocks.getCatalogEntryForEditor).toHaveBeenCalledTimes(2);
    expect(mocks.getBaseEditionCandidatesForRedirect).toHaveBeenCalledTimes(1);

    endLocalVisit();
    expect(await readLocalPortRedirect('game:1')).toBe('game:2');
    expect(mocks.getCatalogEntryForEditor).toHaveBeenCalledTimes(4);
  });
});

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const achievement = (apiname: string, achieved: number) => ({ apiname, achieved, unlocktime: 0, name: apiname, icon: '' });

describe('Steam achievements cache freshness', () => {
  const now = 1_700_000_000_000;
  const sec = (ms: number) => Math.floor(ms / 1000);

  it('trusts a copy younger than the TTL', () => {
    expect(isSteamAchievementsCacheFresh(sec(now - 60_000), now)).toBe(true);
    expect(isSteamAchievementsCacheFresh(sec(now - STEAM_ACHIEVEMENTS_FRESH_MS), now)).toBe(false);
  });

  it('refuses a missing, future-dated, force-invalidated or pre-session copy', () => {
    expect(isSteamAchievementsCacheFresh(undefined, now)).toBe(false);
    expect(isSteamAchievementsCacheFresh(sec(now + 60_000), now)).toBe(false);
    expect(isSteamAchievementsCacheFresh(sec(now - 60_000), now, now - 30_000)).toBe(false);
    expect(isSteamAchievementsCacheFresh(sec(now - 60_000), now, 0, sec(now - 30_000))).toBe(false);
    expect(isSteamAchievementsCacheFresh(sec(now - 60_000), now, 0, sec(now - 120_000))).toBe(true);
  });

  it('ignores fetched_at when comparing results', () => {
    const a = { unlocked: 1, total: 2, list: [achievement('A', 1), achievement('B', 0)], fetched_at: 1 };
    expect(sameSteamAchievements(a, { ...a, fetched_at: 2 })).toBe(true);
    expect(sameSteamAchievements(a, { ...a, unlocked: 2, list: [achievement('A', 1), achievement('B', 1)] })).toBe(false);
  });
});

describe('loadLocalSteamAchievements', () => {
  const stale = () => ({ unlocked: 0, total: 1, list: [achievement('A', 0)], fetched_at: nowSec() - 3600 });
  const fresh = () => ({ unlocked: 0, total: 1, list: [achievement('A', 0)], fetched_at: nowSec() - 60 });

  it('paints the disk copy first, then swaps in a changed live result', async () => {
    beginLocalVisit();
    mocks.steamGetCachedAchievements.mockResolvedValue(stale());
    const live = { unlocked: 1, total: 1, list: [achievement('A', 1)], fetched_at: nowSec() };
    mocks.steamGetPlayerAchievements.mockResolvedValue(live);
    const seen: unknown[] = [];
    await loadLocalSteamAchievements(10, data => seen.push(data));
    expect(seen).toEqual([stale(), live]);
  });

  it('keeps the disk copy when the live result is the same', async () => {
    beginLocalVisit();
    mocks.steamGetCachedAchievements.mockResolvedValue(stale());
    mocks.steamGetPlayerAchievements.mockResolvedValue({ ...stale(), fetched_at: nowSec() });
    const onData = vi.fn();
    await loadLocalSteamAchievements(10, onData);
    expect(onData).toHaveBeenCalledTimes(1);
    expect(mocks.steamGetPlayerAchievements).toHaveBeenCalledTimes(1);
  });

  it('skips the live request while the disk copy is fresh, unless a session ended since', async () => {
    beginLocalVisit();
    mocks.steamGetCachedAchievements.mockResolvedValue(fresh());
    await loadLocalSteamAchievements(10, () => {});
    expect(mocks.steamGetPlayerAchievements).not.toHaveBeenCalled();

    await loadLocalSteamAchievements(10, () => {}, { lastPlayedSec: nowSec() - 30 });
    expect(mocks.steamGetPlayerAchievements).toHaveBeenCalledTimes(1);
  });

  it('reopening within a visit reuses the live result without another read', async () => {
    beginLocalVisit();
    await loadLocalSteamAchievements(10, () => {});
    const onData = vi.fn();
    await loadLocalSteamAchievements(10, onData);
    expect(mocks.steamGetCachedAchievements).toHaveBeenCalledTimes(1);
    expect(mocks.steamGetPlayerAchievements).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledTimes(1);

    invalidateLocalSteamAchievements(10);
    await loadLocalSteamAchievements(10, () => {});
    expect(mocks.steamGetCachedAchievements).toHaveBeenCalledTimes(2);
  });

  it('reports null when there is neither a disk copy nor a live result', async () => {
    beginLocalVisit();
    mocks.steamGetPlayerAchievements.mockResolvedValue(null);
    const onData = vi.fn();
    await loadLocalSteamAchievements(10, onData);
    expect(onData).toHaveBeenCalledWith(null);
  });

  it('prefetch warms only the disk read, and only during a visit', async () => {
    prefetchLocalSteamAchievements(10);
    expect(mocks.steamGetCachedAchievements).not.toHaveBeenCalled();
    beginLocalVisit();
    mocks.steamGetCachedAchievements.mockResolvedValue(fresh());
    prefetchLocalSteamAchievements(10);
    await loadLocalSteamAchievements(10, () => {});
    expect(mocks.steamGetCachedAchievements).toHaveBeenCalledTimes(1);
    expect(mocks.steamGetPlayerAchievements).not.toHaveBeenCalled();
  });
  // Last on purpose: the stale mark is module state that outlives visits.
  it('refreshes after a play session even when fresh', async () => {
    beginLocalVisit();
    mocks.steamGetCachedAchievements.mockResolvedValue({ ...fresh(), fetched_at: nowSec() - 5 });
    markLocalSteamAchievementsStale();
    await loadLocalSteamAchievements(10, () => {});
    expect(mocks.steamGetPlayerAchievements).toHaveBeenCalledTimes(1);
  });
});
