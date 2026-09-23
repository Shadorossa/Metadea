// Keeps the running game session's achievement count fresh on Discord:
// RetroAchievements (linked ROMs) every 2 min, Steam every 5 min, only while
// that session is the active presence. game-session-state.ts starts and
// stops it; discord-presence.ts ignores counts that did not change.
import { steamGetCachedAchievements, steamGetPlayerAchievements } from '../tauri/steam';
import { getRetroProgressSummary } from '../retro-achievements/retro-progress';
import { updateGameAchievements, type GamePresence } from './discord-presence';
import {
  isRefreshDue, RETRO_ACHIEVEMENTS_REFRESH_MS, STEAM_ACHIEVEMENTS_REFRESH_MS, type AchievementCount,
} from './game-rich-presence';

export type AchievementSource =
  | { kind: 'retro'; externalId: string }
  | { kind: 'steam'; appId: number };

/** Where a presence's achievements come from, if anywhere. */
export function achievementSourceFor(presence: GamePresence): AchievementSource | null {
  if (presence.romPlatform && presence.externalId) return { kind: 'retro', externalId: presence.externalId };
  if (presence.steamAppId && presence.steamAppId > 0) return { kind: 'steam', appId: presence.steamAppId };
  return null;
}

export function refreshIntervalFor(source: AchievementSource): number {
  return source.kind === 'steam' ? STEAM_ACHIEVEMENTS_REFRESH_MS : RETRO_ACHIEVEMENTS_REFRESH_MS;
}

async function readCount(source: AchievementSource, live: boolean): Promise<AchievementCount | null> {
  if (source.kind === 'retro') {
    const summary = await getRetroProgressSummary(source.externalId, live);
    return summary ? { unlocked: summary.unlocked, total: summary.total, hardcore: summary.hardcore } : null;
  }
  const data = live ? await steamGetPlayerAchievements(source.appId) : await steamGetCachedAchievements(source.appId);
  return data && data.total > 0 ? { unlocked: data.unlocked, total: data.total } : null;
}

const TICK_MS = 30_000;
let current: { sessionId: string; timer: ReturnType<typeof setInterval> } | null = null;

export function stopAchievementRefresh(): void {
  if (current) clearInterval(current.timer);
  current = null;
}

/** Starts refreshing for `presence`'s session (no-op when already running). */
export function startAchievementRefresh(presence: GamePresence): void {
  const sessionId = presence.sessionId;
  if (current && current.sessionId === sessionId) return;
  stopAchievementRefresh();
  const source = achievementSourceFor(presence);
  if (!sessionId || !source) return;
  const interval = refreshIntervalFor(source);
  let lastRefresh: number | null = Date.now();
  const apply = (live: boolean) => {
    readCount(source, live)
      .then(count => { if (count && current?.sessionId === sessionId) updateGameAchievements(sessionId, count); })
      .catch(() => {});
  };
  // Right away from cache (RA's Rust cache / Steam's last merge), then live.
  current = {
    sessionId,
    timer: setInterval(() => {
      const now = Date.now();
      if (!isRefreshDue(lastRefresh, now, interval)) return;
      lastRefresh = now;
      apply(true);
    }, TICK_MS),
  };
  apply(false);
}
