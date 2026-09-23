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
  endedHandlers: [] as Array<(payload: unknown) => void>,
}));

vi.mock('../tauri', () => ({
  saveLibraryEntry: mocks.saveLibraryEntry,
  saveEpisodeHistoryEntry: vi.fn(async () => {}),
  addSequelToPlanning: vi.fn(async () => {}),
}));
vi.mock('../tauri/resume-position', () => ({
  getResumePosition: mocks.getResumePosition,
  saveResumePosition: mocks.saveResumePosition,
  clearResumePosition: mocks.clearResumePosition,
}));
vi.mock('../tauri/anime-local', () => ({
  playFileWithVlc: vi.fn(async () => {}),
  getVlcPlaybackStatus: vi.fn(async () => null),
  sendVlcCommand: vi.fn(async () => {}),
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
}));
vi.mock('../media/anilist-sync', () => ({ syncToAniList: vi.fn(async () => {}), isAniListType: () => false }));
vi.mock('../media/small-cover', () => ({ toMediumCover: (url: string) => url }));
vi.mock('./discord-presence', () => ({ setPlaybackPresence: vi.fn(), clearPlaybackPresence: vi.fn() }));
vi.mock('../dom/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../i18n/runtime', () => ({ getT: () => ({ player: { engine_unavailable_fallback: 'fallback' } }) }));

// Vitest runs in node: give the settings module a Storage to read.
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
    expect(playbackStore.get()?.engine).toBe('internal');
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

  it('falls back to VLC when libmpv is unavailable', async () => {
    mocks.playerEngineAvailable.mockResolvedValueOnce(false);
    await startQueuePlayback(target());
    expect(mocks.playerOpen).not.toHaveBeenCalled();
    expect(playbackStore.get()?.engine).toBe('vlc');
    expect(playerModalStore.get()).toBe(false);
  });
});
