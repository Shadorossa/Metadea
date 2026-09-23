import { describe, it, expect, vi, beforeEach } from 'vitest';

// The whole "Reproducir" path for the built-in engine, with every IPC
// boundary mocked: startQueuePlayback must open the engine (player_open
// with the controls mode), raise the modal store the NowPlayingBar renders
// PlayerModal from, and on `player://ended` persist mpv's exact position.

const mocks = vi.hoisted(() => ({
  playerOpen: vi.fn(async (_request: Record<string, unknown>) => ({ work_name: 'Show', queue: [], episode_labels: [], titles: [] })),
  playerEngineAvailable: vi.fn(async () => true),
  playerStopClose: vi.fn(async () => {}),
  playerSetPause: vi.fn(async () => {}),
  playerNext: vi.fn(async () => {}),
  playerGetStatus: vi.fn(async () => null),
  saveResumePosition: vi.fn(async () => {}),
  getResumePosition: vi.fn(async () => 42.5),
  clearResumePosition: vi.fn(async () => {}),
  saveLibraryEntry: vi.fn(async (entry: unknown) => entry),
  deleteEpisodeHistoryEntry: vi.fn(async () => {}),
  deleteLibraryEntry: vi.fn(async () => {}),
  showEpisodeWatchedToast: vi.fn(async () => {}),
  endedHandlers: [] as Array<(payload: unknown) => void>,
  toastHandlers: [] as Array<(payload: unknown) => void>,
}));

vi.mock('../tauri', () => ({
  saveLibraryEntry: mocks.saveLibraryEntry,
  saveEpisodeHistoryEntry: vi.fn(async () => {}),
  addSequelToPlanning: vi.fn(async () => null),
  getEpisodeHistory: vi.fn(async () => [
    { id: 'older', external_id: 'anime-1', episode_number: 4, watched_at: '2026-01-01 10:00:00' },
    { id: 'newest', external_id: 'anime-1', episode_number: 4, watched_at: '2026-02-01 10:00:00' },
  ]),
  deleteEpisodeHistoryEntry: mocks.deleteEpisodeHistoryEntry,
  deleteLibraryEntry: mocks.deleteLibraryEntry,
}));
vi.mock('../tauri/resume-position', () => ({
  getResumePosition: mocks.getResumePosition,
  saveResumePosition: mocks.saveResumePosition,
  clearResumePosition: mocks.clearResumePosition,
}));
vi.mock('../tauri/player', () => ({
  playerOpen: mocks.playerOpen,
  playerEngineAvailable: mocks.playerEngineAvailable,
  playerStopClose: mocks.playerStopClose,
  playerSetPause: mocks.playerSetPause,
  playerNext: mocks.playerNext,
  playerGetStatus: mocks.playerGetStatus,
  listenPlayerStatus: vi.fn(async () => () => {}),
  listenPlayerTrackChanged: vi.fn(async () => () => {}),
  listenPlayerEnded: vi.fn(async (handler: (payload: unknown) => void) => {
    mocks.endedHandlers.push(handler);
    return () => {};
  }),
  showEpisodeWatchedToast: mocks.showEpisodeWatchedToast,
  listenToastAction: vi.fn(async (handler: (payload: unknown) => void) => {
    mocks.toastHandlers.push(handler);
    return () => {};
  }),
}));
vi.mock('../media/anilist-sync', () => ({ syncToAniList: vi.fn(async () => {}), isAniListType: () => false }));
vi.mock('../media/small-cover', () => ({ toMediumCover: (url: string) => url }));
vi.mock('./discord-presence', () => ({ setPlaybackPresence: vi.fn(), clearPlaybackPresence: vi.fn() }));
vi.mock('../../i18n/runtime', () => ({ getT: () => ({ player: { engine_unavailable: 'libmpv missing' } }) }));

// Vitest runs in node: the service announces marks with a window event, and
// the settings module reads a Storage.
const dispatchedEvents: string[] = [];
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { dispatchEvent: (event: { type: string }) => { dispatchedEvents.push(event.type); return true; } },
});
Object.defineProperty(globalThis, 'CustomEvent', {
  configurable: true,
  value: class { type: string; detail: unknown; constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; } },
});
const memoryStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStorage.set(key, String(value)); },
    removeItem: (key: string) => { memoryStorage.delete(key); },
    clear: () => { memoryStorage.clear(); },
  },
});

import { startQueuePlayback, playbackStore } from './playback-service';
import { closePlayerModal, playerModalStore } from '../player/player-modal-state';

const libraryEntry = {
  external_id: 'anime-1', type: 'anime', status: 'watching', progress: 0,
} as unknown as Parameters<typeof startQueuePlayback>[0]['libraryEntry'];

function target() {
  return {
    externalId: 'anime-1', type: 'anime', title: 'Show', cover: null, libraryEntry, totalCount: 12,
    queue: [
      { episodeNumber: 3, filePath: 'C:\\S\\e3.mkv', episodeTitle: 'Three' },
      { episodeNumber: 4, filePath: 'C:\\S\\e4.mkv' },
    ],
  };
}

describe('startQueuePlayback (internal engine)', () => {
  beforeEach(() => {
    localStorage.clear();
    dispatchedEvents.length = 0;
    closePlayerModal();
    // The service subscribes to player events once per module load, so
    // the captured `endedHandlers` are kept across tests on purpose.
    vi.clearAllMocks();
  });

  it('opens the engine with the queue, resume point and controls mode, then raises the modal', async () => {
    localStorage.setItem('metadea_player_controls_mode', 'docked');
    await startQueuePlayback(target());

    expect(mocks.playerOpen).toHaveBeenCalledTimes(1);
    const request = mocks.playerOpen.mock.calls[0][0];
    expect(request.queue).toEqual(['C:\\S\\e3.mkv', 'C:\\S\\e4.mkv']);
    expect(request.startSeconds).toBe(42.5);
    expect(request.workName).toBe('Show');
    expect(request.episodeLabels).toEqual(['S01E03', 'S01E04']);
    expect(request.titles).toEqual(['Three', '']);
    expect(request.overlay).toBe(false);
    expect(playerModalStore.get()).toBe(true);
    expect(playbackStore.get()?.queueIndex).toBe(0);
  });

  it('persists the exact position from player://ended and closes the modal', async () => {
    await startQueuePlayback(target());
    expect(mocks.endedHandlers.length).toBeGreaterThan(0);

    mocks.endedHandlers.forEach(handler => handler({
      reason: 'stopped', position_secs: 617.25, duration_secs: 1420, playlist_index: 0, path: 'C:\\S\\e3.mkv',
    }));

    expect(mocks.saveResumePosition).toHaveBeenCalledWith('anime-1', 3, 617.25);
    expect(mocks.saveLibraryEntry).not.toHaveBeenCalled();
    expect(playerModalStore.get()).toBe(false);
    expect(playbackStore.get()).toBeNull();
  });

  it('marks the episode watched instead when the engine stopped past 80 %', async () => {
    await startQueuePlayback(target());
    mocks.endedHandlers.forEach(handler => handler({
      reason: 'navigate', position_secs: 1300, duration_secs: 1420, playlist_index: 1, path: 'C:\\S\\e4.mkv',
    }));
    await Promise.resolve();

    expect(mocks.saveLibraryEntry).toHaveBeenCalledTimes(1);
    expect((mocks.saveLibraryEntry.mock.calls[0][0] as { progress: number }).progress).toBe(4);
    expect(mocks.saveResumePosition).not.toHaveBeenCalled();
  });

  it('shows the native Undo toast for the mark and reverts it on toast://action', async () => {
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    await startQueuePlayback(target());
    mocks.endedHandlers.forEach(handler => handler({
      reason: 'stopped', position_secs: 1300, duration_secs: 1420, playlist_index: 1, path: 'C:\\S\\e4.mkv',
    }));
    await flush();

    expect(mocks.showEpisodeWatchedToast).toHaveBeenCalledTimes(1);
    const [workName, label, token] = mocks.showEpisodeWatchedToast.mock.calls[0] as unknown as [string, string, number];
    expect(workName).toBe('Show');
    expect(label).toBe('S01E04');
    expect(mocks.toastHandlers.length).toBeGreaterThan(0);

    // A stale token is ignored; the live one reverts everything the mark did.
    mocks.toastHandlers.forEach(handler => handler({ action: 'undo', token: token + 1000 }));
    await flush();
    expect(mocks.saveLibraryEntry).toHaveBeenCalledTimes(1);

    mocks.toastHandlers.forEach(handler => handler({ action: 'undo', token }));
    await flush();
    expect(mocks.saveLibraryEntry).toHaveBeenCalledTimes(2);
    expect((mocks.saveLibraryEntry.mock.calls[1][0] as { progress: number; status: string })).toMatchObject({ progress: 0, status: 'watching' });
    expect(mocks.deleteEpisodeHistoryEntry).toHaveBeenCalledWith('newest');
    expect(mocks.saveResumePosition).toHaveBeenCalledWith('anime-1', 4, 1300);
    expect(mocks.deleteLibraryEntry).not.toHaveBeenCalled();
    // Mark and undo both tell open panels to refresh.
    expect(dispatchedEvents.filter(type => type === 'metadea:episode-marked')).toHaveLength(2);

    // Pressing Undo twice cannot revert twice.
    mocks.toastHandlers.forEach(handler => handler({ action: 'undo', token }));
    await flush();
    expect(mocks.saveLibraryEntry).toHaveBeenCalledTimes(2);
  });

  it('ignores a legacy "engine = vlc" preference and still opens the built-in player', async () => {
    localStorage.setItem('metadea_playback_engine', 'vlc');
    await startQueuePlayback(target());
    expect(mocks.playerOpen).toHaveBeenCalledTimes(1);
    expect(playerModalStore.get()).toBe(true);
  });

  it('rejects with the translated message when libmpv is unavailable, starting nothing', async () => {
    mocks.playerEngineAvailable.mockResolvedValueOnce(false);
    await expect(startQueuePlayback(target())).rejects.toThrow('libmpv missing');
    expect(mocks.playerOpen).not.toHaveBeenCalled();
    expect(playerModalStore.get()).toBe(false);
  });
});
