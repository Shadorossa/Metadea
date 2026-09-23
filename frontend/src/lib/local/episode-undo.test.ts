import { describe, it, expect, vi } from 'vitest';
import { pickHistoryRowToDelete, undoEpisodeMark, type EpisodeMarkSnapshot, type EpisodeUndoDeps } from './episode-undo';
import type { LibraryEntry } from '../tauri/library';

const previousEntry = {
  id: '1', user_id: 'local', external_id: 'anime-1', type: 'anime', status: 'watching', rating: 8, rating_2: null,
  progress: 1, progress_2: 0, minutes_spent: 0, is_favorite: 0, is_platinum: 0, tags: null, notes: 'n',
  added_at: null, updated_at: null, selected_platform: null, selected_version: null,
  started_at: '2026-01-01', finished_at: null,
} as unknown as LibraryEntry;

function deps(): EpisodeUndoDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    saveLibraryEntry: vi.fn(async entry => { calls.push('save'); return entry; }),
    getEpisodeHistory: vi.fn(async () => [
      { id: 'old', external_id: 'anime-1', episode_number: 2, watched_at: '2026-01-01 10:00:00' },
      { id: 'new', external_id: 'anime-1', episode_number: 2, watched_at: '2026-01-02 10:00:00' },
      { id: 'other', external_id: 'anime-1', episode_number: 3, watched_at: '2026-01-03 10:00:00' },
    ]),
    deleteEpisodeHistoryEntry: vi.fn(async () => { calls.push('delete-history'); }),
    saveResumePosition: vi.fn(async () => { calls.push('resume'); }),
    deleteLibraryEntry: vi.fn(async () => { calls.push('delete-sequel'); }),
    syncToAniList: vi.fn(async () => { calls.push('anilist'); }),
    dispatchEpisodeMarked: vi.fn(() => { calls.push('dispatch'); }),
  };
}

const snapshot: EpisodeMarkSnapshot = {
  externalId: 'anime-1', episodeNumber: 2, previousEntry, resumeSeconds: 1210.5,
  addedSequelExternalId: 'anime-2', anilistSynced: true,
};

describe('pickHistoryRowToDelete', () => {
  it('picks the newest row of that episode only', () => {
    const rows = [
      { id: 'a', external_id: 'x', episode_number: 2, watched_at: '2026-01-01 10:00:00' },
      { id: 'b', external_id: 'x', episode_number: 2, watched_at: '2026-01-05 10:00:00' },
      { id: 'c', external_id: 'x', episode_number: 5, watched_at: '2026-01-09 10:00:00' },
    ];
    expect(pickHistoryRowToDelete(rows, 2)?.id).toBe('b');
    expect(pickHistoryRowToDelete(rows, 9)).toBeNull();
  });
});

describe('undoEpisodeMark', () => {
  it('restores the entry, deletes the history row, resume point, sequel and re-syncs', async () => {
    const d = deps();
    const restored = await undoEpisodeMark(snapshot, d);

    expect(d.saveLibraryEntry).toHaveBeenCalledWith(previousEntry);
    expect(restored.progress).toBe(1);
    expect(restored.rating).toBe(8);
    expect(d.deleteEpisodeHistoryEntry).toHaveBeenCalledWith('new');
    expect(d.saveResumePosition).toHaveBeenCalledWith('anime-1', 2, 1210.5);
    expect(d.deleteLibraryEntry).toHaveBeenCalledWith('anime-2');
    expect(d.syncToAniList).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'anime-1', progress: 1, status: 'watching', startedAt: '2026-01-01', finishedAt: '' }));
    expect(d.dispatchEpisodeMarked).toHaveBeenCalledWith('anime-1', 2);
    expect(d.calls).toEqual(['save', 'delete-history', 'resume', 'delete-sequel', 'anilist', 'dispatch']);
  });

  it('skips what the mark did not do', async () => {
    const d = deps();
    await undoEpisodeMark({ ...snapshot, resumeSeconds: 0, addedSequelExternalId: null, anilistSynced: false }, d);
    expect(d.saveResumePosition).not.toHaveBeenCalled();
    expect(d.deleteLibraryEntry).not.toHaveBeenCalled();
    expect(d.syncToAniList).not.toHaveBeenCalled();
    expect(d.dispatchEpisodeMarked).toHaveBeenCalledTimes(1);
  });

  it('still dispatches when the history lookup fails', async () => {
    const d = deps();
    d.getEpisodeHistory = vi.fn(async () => { throw new Error('db'); });
    await undoEpisodeMark(snapshot, d);
    expect(d.deleteEpisodeHistoryEntry).not.toHaveBeenCalled();
    expect(d.dispatchEpisodeMarked).toHaveBeenCalledTimes(1);
  });
});
