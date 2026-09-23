import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActiveGameSession } from '../tauri/game-launch';
import type { GamePresence } from './discord-presence';

const presence = vi.hoisted(() => ({ current: null as GamePresence | null, set: vi.fn(), clear: vi.fn() }));
vi.mock('./discord-presence', () => ({
  getGamePresence: () => presence.current,
  setGamePresence: (game: GamePresence) => { presence.current = game; presence.set(game); },
  clearGamePresence: () => { presence.current = null; presence.clear(); },
}));
vi.mock('./game-achievement-refresh', () => ({ startAchievementRefresh: vi.fn(), stopAchievementRefresh: vi.fn() }));
vi.mock('../tauri/game-launch', () => ({
  getActiveGameSessions: vi.fn(async () => []),
  listenGameSessionsChanged: vi.fn(async () => () => {}),
  listenGameSessionEnded: vi.fn(async () => () => {}),
}));
vi.mock('../media/small-cover', () => ({ toMediumCover: (url: string) => url }));

import { applyGameSessions, nextGamePresence, presenceFromSession } from './game-session-state';

function session(overrides: Partial<ActiveGameSession> = {}): ActiveGameSession {
  return {
    session_id: 's1', external_id: 'game:1', title: 'Pokémon Platinum', cover_url: 'https://img/cover.jpg',
    platform: 'ds', launcher: 'local', app_id: null, install_path: 'C:/Roms/plat.nds',
    exe_path: 'C:/Emus/melonDS/melonDS.exe', pids: [10], started_unix: 1_700_000_000,
    last_heartbeat_unix: 1_700_000_060, running: true, paused_seconds: 0, paused_since: null,
    ...overrides,
  };
}

beforeEach(() => {
  presence.current = null;
  presence.set.mockClear();
  presence.clear.mockClear();
});

describe('presence restore from active sessions', () => {
  it('restores the newest session with its original start time after a page load', () => {
    applyGameSessions([session()]);
    expect(presence.set).toHaveBeenCalledOnce();
    expect(presence.current).toMatchObject({
      title: 'Pokémon Platinum', startTime: 1_700_000_000, externalId: 'game:1', romPlatform: 'ds',
      platformName: 'Nintendo DS', emulatorName: 'melonDS', sessionId: 's1',
    });
  });

  it('reads the Steam app id for Steam sessions only', () => {
    expect(presenceFromSession(session({ platform: null, launcher: 'steam', app_id: '620' })).steamAppId).toBe(620);
    expect(presenceFromSession(session({ platform: null, launcher: 'epic', app_id: '620' })).steamAppId).toBeUndefined();
  });

  it('leaves the same session alone and keeps achievements across a start-time update', () => {
    const current = { ...presenceFromSession(session()), achievements: { unlocked: 2, total: 9 } };
    expect(nextGamePresence([session()], current)).toBeUndefined();
    expect(nextGamePresence([session({ started_unix: 1_700_000_100 })], current))
      .toMatchObject({ startTime: 1_700_000_100, achievements: { unlocked: 2, total: 9 } });
  });

  it('clears a session presence when the list empties, but not a page-local one', () => {
    applyGameSessions([session()]);
    applyGameSessions([]);
    expect(presence.clear).toHaveBeenCalledOnce();

    presence.current = { title: 'Local only', startTime: 1 };
    expect(nextGamePresence([], presence.current)).toBeUndefined();
  });
});
