// The game presence (Discord Rich Presence, the Now-playing strip, Big
// Picture's dimmer) mirrors the Rust session registry
// (src-tauri/src/game_sessions.rs). Every navigation reloads the page and its
// module state, so each page load asks Rust for the running sessions and
// restores the presence with the session's own start time: the Discord timer
// keeps counting and the presence survives navigation. Playtime is recorded
// by Rust; this module only refreshes the library views when it was.
import {
  getActiveGameSessions, listenGameSessionsChanged, listenGameSessionEnded, type ActiveGameSession,
} from '../tauri/game-launch';
import { toMediumCover } from '../media/small-cover';
import { setGamePresence, clearGamePresence, getGamePresence, type GamePresence } from './discord-presence';
import { emulatorNameFromExe, platformDisplayName } from './game-rich-presence';
import { startAchievementRefresh, stopAchievementRefresh } from './game-achievement-refresh';
import { emitSessionEnded } from '../plugins/host-events';

export function presenceFromSession(session: ActiveGameSession): GamePresence {
  const cover = session.cover_url && session.cover_url.startsWith('http') ? toMediumCover(session.cover_url) : undefined;
  const steamAppId = session.launcher === 'steam' ? Number(session.app_id) : NaN;
  return {
    title: session.title,
    coverUrl: cover,
    startTime: session.started_unix,
    externalId: session.external_id || undefined,
    installPath: session.install_path || undefined,
    romPlatform: session.platform || undefined,
    platformName: platformDisplayName(session.platform),
    emulatorName: session.platform ? emulatorNameFromExe(session.exe_path) : undefined,
    steamAppId: Number.isInteger(steamAppId) && steamAppId > 0 ? steamAppId : undefined,
    sessionId: session.session_id,
  };
}

/**
 * The presence to show for `sessions` (newest first): a presence to set,
 * `null` to clear, or `undefined` to leave the current one alone (same
 * session and start time, or a local-only presence with no session).
 */
export function nextGamePresence(
  sessions: ActiveGameSession[],
  current: GamePresence | null,
): GamePresence | null | undefined {
  const newest = sessions[0];
  if (!newest) return current?.sessionId ? null : undefined;
  const next = presenceFromSession(newest);
  if (!current || current.sessionId !== next.sessionId) return next;
  if (current.startTime === next.startTime) return undefined;
  // A store launcher's game just started: same session, new start time.
  return { ...next, achievements: current.achievements };
}

export function applyGameSessions(sessions: ActiveGameSession[]): void {
  const next = nextGamePresence(sessions, getGamePresence());
  if (next === undefined) return;
  if (next === null) {
    stopAchievementRefresh();
    clearGamePresence();
    return;
  }
  setGamePresence(next);
  startAchievementRefresh(next);
}

/** Re-reads the registry now (after a launch, instead of waiting for the event). */
export async function refreshGameSessionPresence(): Promise<void> {
  applyGameSessions(await getActiveGameSessions());
}

let initialized = false;

/** Once per page load (BaseLayout): restore, then follow the registry. */
export function initGameSessionPresence(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  listenGameSessionsChanged(applyGameSessions).catch(() => {
    initialized = false;
  });
  listenGameSessionEnded(({ external_id, recorded }) => {
    emitSessionEnded({ externalId: external_id, kind: 'play' });
    // Same event saveLibraryEntry fires: every library view re-reads.
    if (recorded) window.dispatchEvent(new CustomEvent('refresh-profile-library'));
  }).catch(() => {});
  refreshGameSessionPresence().catch(() => {});
}
