// Launching an installed game or ROM from Local: the launch itself, the
// Discord/Now-playing presence and the playtime session. Rust owns the
// session (game_sessions.rs) and records the hours when the process exits;
// the presence follows it (game-session-state.ts). Shared by GameDetailPanel's Play button
// and Big Picture so both start a session exactly the same way.
import type { LocalGame } from '../tauri/local-library';
import { launchGame, startPlaytimeSession } from '../tauri/game-launch';
import { toMediumCover } from '../media/small-cover';
import { setGamePresence } from './discord-presence';
import { refreshGameSessionPresence } from './game-session-state';
import { launchDiscChoice } from './disc-choice';

export interface GameLaunchRequest {
  /** What actually runs (a season's source game, or the game itself). */
  target: LocalGame;
  /** Library/catalog id the session's playtime is logged against. */
  externalId: string;
  title: string;
  /** Candidate art for the presence; only an http(s) URL is used. */
  coverUrl?: string | null;
  /** Multi-disc games: the disc to boot (else the one last picked). */
  discPath?: string | null;
}

export function isExecutableInstall(game: LocalGame): boolean {
  return !!game.install_path?.toLowerCase().endsWith('.exe');
}

/** Launches `request.target`; resolves once the launch itself succeeded. */
export async function launchLocalGameSession(request: GameLaunchRequest): Promise<void> {
  const { target, externalId, title } = request;
  const isExe = isExecutableInstall(target);
  const romPlatform = isExe ? undefined : target.rom_platform;
  const disc = romPlatform ? launchDiscChoice(target, request.discPath) : null;
  const coverUrl = request.coverUrl && request.coverUrl.startsWith('http') ? request.coverUrl : null;
  await launchGame(target.launcher, target.app_id, target.install_path, romPlatform, externalId, title, coverUrl, disc);
  // ROMs are timed by the emulator session launch_game registered;
  // everything else by watching the launched process.
  if (romPlatform) {
    await refreshGameSessionPresence().catch(() => {});
    return;
  }
  if (target.install_path) {
    startPlaytimeSession(target.install_path, externalId, null, target.launcher, target.app_id, title, coverUrl)
      .then(refreshGameSessionPresence)
      .catch(() => {});
    return;
  }
  // Nothing Rust can watch (no install path): a page-local presence only.
  setGamePresence({
    title,
    startTime: Math.floor(Date.now() / 1000),
    coverUrl: coverUrl ? toMediumCover(coverUrl) : undefined,
    externalId,
  });
}
