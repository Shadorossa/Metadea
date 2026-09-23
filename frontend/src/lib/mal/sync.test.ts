import { describe, it, expect, vi } from 'vitest';
import { syncToMal, malSyncStateKey, type MalSyncDeps } from './sync';
import type { MalSyncInput } from './mapping';

const input: MalSyncInput = {
  externalId: 'anime:21', type: 'anime', status: 'completed', rating: 9, progress: 1100, progressVolumes: 0,
  startedAt: '2010-04-01', finishedAt: '2026-09-01',
};

function deps(overrides: Partial<MalSyncDeps> = {}): MalSyncDeps {
  return {
    isTauri: () => true,
    getStatus: vi.fn(async () => ({ connected: true })),
    resolveMalId: vi.fn(async () => 21),
    updateAnime: vi.fn(async () => {}),
    updateManga: vi.fn(async () => {}),
    markSynced: vi.fn(async () => {}),
    markSyncFailed: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('syncToMal', () => {
  it('pushes an anime entry in MAL vocabulary and records the success', async () => {
    const d = deps();
    const result = await syncToMal(input, d);
    expect(result).toEqual({ ok: true });
    expect(d.updateAnime).toHaveBeenCalledWith(21, {
      status: 'completed', score: 9, num_watched_episodes: 1100, start_date: '2010-04-01', finish_date: '2026-09-01',
    });
    expect(d.updateManga).not.toHaveBeenCalled();
    expect(d.markSynced).toHaveBeenCalledWith(malSyncStateKey('anime:21'));
    expect(d.markSyncFailed).not.toHaveBeenCalled();
  });

  it('routes manga and light novels to the manga list', async () => {
    const d = deps({ resolveMalId: vi.fn(async () => 2) });
    await syncToMal({ ...input, externalId: 'lnovel:5', type: 'lnovel', status: 'reading', progress: 3, progressVolumes: 1 }, d);
    expect(d.updateManga).toHaveBeenCalledWith(2, expect.objectContaining({ status: 'reading', num_chapters_read: 3, num_volumes_read: 1 }));
    expect(d.updateAnime).not.toHaveBeenCalled();
  });

  it('skips types MAL does not track without even asking the status', async () => {
    for (const type of ['game', 'movie', 'series', 'book', 'comic', 'vnovel']) {
      const d = deps();
      expect(await syncToMal({ ...input, type }, d)).toEqual({ ok: true, skipped: 'unsupported_type' });
      expect(d.getStatus).not.toHaveBeenCalled();
    }
  });

  it('skips silently when not connected, when the status call fails or outside Tauri', async () => {
    const disconnected = deps({ getStatus: vi.fn(async () => ({ connected: false })) });
    expect(await syncToMal(input, disconnected)).toEqual({ ok: true, skipped: 'not_connected' });
    expect(disconnected.resolveMalId).not.toHaveBeenCalled();

    const broken = deps({ getStatus: vi.fn(async () => { throw new Error('ipc'); }) });
    expect(await syncToMal(input, broken)).toEqual({ ok: true, skipped: 'not_connected' });

    const browser = deps({ isTauri: () => false });
    expect(await syncToMal(input, browser)).toEqual({ ok: true, skipped: 'not_tauri' });
    expect(browser.getStatus).not.toHaveBeenCalled();
  });

  it('skips a work without a MAL counterpart and never touches sync_state', async () => {
    const d = deps({ resolveMalId: vi.fn(async () => null) });
    expect(await syncToMal(input, d)).toEqual({ ok: true, skipped: 'no_mal_id' });
    expect(d.updateAnime).not.toHaveBeenCalled();
    expect(d.markSynced).not.toHaveBeenCalled();
    expect(d.markSyncFailed).not.toHaveBeenCalled();
  });

  it('records a failed push under the mal: key and never throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({
      updateAnime: vi.fn(async () => { throw 'E_MAL_API: 500 boom'; }),
      markSyncFailed: vi.fn(async () => { throw new Error('db locked'); }),
    });
    const result = await syncToMal(input, d);
    expect(result).toEqual({ ok: false, error: 'E_MAL_API: 500 boom' });
    expect(d.markSyncFailed).toHaveBeenCalledWith('mal:anime:21', 'E_MAL_API: 500 boom');
    expect(d.markSynced).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
