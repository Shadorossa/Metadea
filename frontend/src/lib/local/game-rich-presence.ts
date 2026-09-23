// Pure pieces of the game Rich Presence: the console logo shown as Discord's
// small image, and the "state" line under "Playing <title>". Discord-facing
// literals stay English, like the rest of the presence strings.
import { COMPANIES } from './emulator-catalog';

// Discord needs a public URL: these are the square console icons published
// on the Pages site (metadea-web/share-pages/public/platforms/<id>.png).
export const PRESENCE_PLATFORM_ASSET_BASE = 'https://metadea.pages.dev/platforms/';
const PLATFORMS_WITH_PRESENCE_ASSET = new Set([
  'gamecube', 'ds', 'wii', '3ds', 'wiiu', 'switch',
  'ps1', 'ps2', 'psp', 'ps3', 'psvita', 'ps4', 'ps5',
]);

export const STEAM_ACHIEVEMENTS_REFRESH_MS = 5 * 60_000;
export const RETRO_ACHIEVEMENTS_REFRESH_MS = 2 * 60_000;

export interface AchievementCount {
  unlocked: number;
  total: number;
  /** RetroAchievements: every unlock was earned in hardcore mode. */
  hardcore?: boolean;
}

/** The console's icon URL for a ROM platform id, or undefined. */
export function platformPresenceImage(platformId?: string | null): string | undefined {
  if (!platformId || !PLATFORMS_WITH_PRESENCE_ASSET.has(platformId)) return undefined;
  return `${PRESENCE_PLATFORM_ASSET_BASE}${platformId}.png`;
}

/** "Nintendo DS" for `ds` (emulator-catalog names), or undefined. */
export function platformDisplayName(platformId?: string | null): string | undefined {
  if (!platformId) return undefined;
  for (const company of COMPANIES) {
    const platform = company.platforms.find(p => p.id === platformId);
    if (platform) return platform.name;
  }
  return undefined;
}

/** "melonDS" for `C:\Emus\melonDS\melonDS.exe`. */
export function emulatorNameFromExe(exePath?: string | null): string | undefined {
  if (!exePath) return undefined;
  const file = exePath.split(/[\\/]/).pop() ?? '';
  const stem = file.replace(/\.[^.]+$/, '');
  return stem || undefined;
}

export function formatAchievementsLine(count: AchievementCount): string {
  const line = `${count.unlocked} / ${count.total} achievements`;
  return count.hardcore ? `${line} · Hardcore` : line;
}

/**
 * The presence's second line: achievements when the game has any, else the
 * console and emulator for ROMs ("Nintendo DS · melonDS"), else nothing.
 */
export function buildGameStateLine(input: {
  achievements?: AchievementCount | null;
  platformName?: string | null;
  emulatorName?: string | null;
}): string {
  const { achievements, platformName, emulatorName } = input;
  if (achievements && achievements.total > 0) return formatAchievementsLine(achievements);
  if (platformName) return emulatorName ? `${platformName} · ${emulatorName}` : platformName;
  return '';
}

export function sameAchievementCount(a?: AchievementCount | null, b?: AchievementCount | null): boolean {
  if (!a || !b) return !a && !b;
  return a.unlocked === b.unlocked && a.total === b.total && !!a.hardcore === !!b.hardcore;
}

/** Throttle: a refresh is due once `intervalMs` passed since the last one. */
export function isRefreshDue(lastRefreshMs: number | null, nowMs: number, intervalMs: number): boolean {
  if (lastRefreshMs === null) return true;
  // A clock set backwards must not stall refreshes until it catches up.
  if (nowMs < lastRefreshMs) return true;
  return nowMs - lastRefreshMs >= intervalMs;
}
