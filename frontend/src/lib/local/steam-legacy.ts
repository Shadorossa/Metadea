import type { LocalGame } from '../tauri';

const LEGACY_SUFFIX = /\s*\(legacy\)\s*$/i;

function isSteamApp(game: LocalGame): boolean {
  return game.launcher === 'steam' && !!game.app_id;
}

function baseName(game: LocalGame): string | null {
  if (!isSteamApp(game)) return null;
  const name = game.name.replace(LEGACY_SUFFIX, '').trim();
  return name && name.toLocaleLowerCase() !== game.name.trim().toLocaleLowerCase()
    ? name.toLocaleLowerCase()
    : null;
}

/**
 * Finds a single exact Steam pair: `Title` and `Title (Legacy)`.
 * Ambiguous matches are left separate rather than guessed.
 */
export function findSteamLegacyVariant(game: LocalGame, games: readonly LocalGame[]): LocalGame | null {
  if (!isSteamApp(game)) return null;
  const ownLegacyBase = baseName(game);
  // The combined detail panel always represents the current release; don't
  // offer the current game again as a "Legacy" option if a legacy row was
  // opened indirectly from a status section.
  if (ownLegacyBase) return null;
  const title = game.name.trim().toLocaleLowerCase();
  const candidates = games.filter(candidate => {
    if (candidate === game || !isSteamApp(candidate)) return false;
    const candidateLegacyBase = baseName(candidate);
    return candidateLegacyBase === title;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

/** Keeps the current release as the sole card when its exact Legacy pair exists. */
export function collapseSteamLegacyPairs(games: readonly LocalGame[]): LocalGame[] {
  const legacyIds = new Set<string>();
  for (const game of games) {
    const legacyBase = baseName(game);
    if (!legacyBase) continue;
    const currentMatches = games.filter(candidate =>
      candidate !== game && isSteamApp(candidate) && !baseName(candidate) &&
      candidate.name.trim().toLocaleLowerCase() === legacyBase,
    );
    const legacyMatches = games.filter(candidate => baseName(candidate) === legacyBase);
    if (currentMatches.length === 1 && legacyMatches.length === 1 && game.app_id) {
      legacyIds.add(game.app_id);
    }
  }
  return games.filter(game => !game.app_id || !legacyIds.has(game.app_id));
}
