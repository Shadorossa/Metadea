import { scanAllGames, readEnvConfig, getHiddenLocalGames, type EnvConfig, type HiddenGameKey } from '../tauri';
import type { LocalGame } from '../tauri';
import { loadSteamOwnedGames, readStoredSteamOwnedGames, type OwnedSteamGame } from './steam-owned-games';

/**
 * Returns all local games enriched with Steam playtime.
 * If a Steam API key is configured:
 *   - Adds playtime_minutes + last_played to installed Steam games
 *   - Appends uninstalled Steam games (installed = false)
 * Without API key: plain local scan.
 * `force` re-walks every launcher on the Rust side (see scanAllGames).
 *
 * The local scan never waits on Steam's Web API: `onPartial` gets it as
 * soon as it is ready — merged with the stored owned-games list when there
 * is one (lib/local/steam-owned-games.ts) — and the promise resolves with
 * the list merged against the refreshed owned games.
 */
export async function scanGamesWithSteam(
  force = false,
  onPartial?: (games: LocalGame[]) => void,
): Promise<LocalGame[]> {
  const hiddenPromise = getHiddenLocalGames().catch((): HiddenGameKey[] => []);
  const [localGames, cfg] = await Promise.all([
    scanAllGames(force),
    readEnvConfig().catch((): EnvConfig => ({})),
  ]);

  if (!cfg.steam_api_key) return localGames;

  const ownedPromise = loadSteamOwnedGames();
  const hidden = await hiddenPromise;
  const stored = readStoredSteamOwnedGames();
  onPartial?.(stored ? mergeSteamOwnedGames(localGames, stored, hidden) : localGames);

  const owned = await ownedPromise;
  return owned ? mergeSteamOwnedGames(localGames, owned, hidden) : localGames;
}

// Blocklist for tools/redistributables from the Steam Web API
const BLOCKED_APP_IDS = new Set([228980, 993090, 388080, 250820, 1113010, 1054830]);

function isBlockedName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('redistributable') ||
         lower.includes('dedicated server') ||
         lower.includes('steamworks') ||
         lower.includes('steamvr');
}

export function mergeSteamOwnedGames(localGames: LocalGame[], steamGames: OwnedSteamGame[], hidden: HiddenGameKey[]): LocalGame[] {
  // scanAllGames() already filters its own output against
  // local_hidden_games (see remove_local_game) — but the "uninstalled"
  // Steam games appended below never go through scan_all_games at all,
  // they're built straight from the Web API list. Without checking
  // them against the same hidden set here, "Eliminar de la lista" on any
  // owned-but-uninstalled Steam game silently came right back on the very
  // next scan/reload.
  const hiddenKeys = new Set(hidden.map(h => `${h.launcher}:${h.link_key}`));
  const isHidden = (g: LocalGame) => hiddenKeys.has(`${g.launcher}:${g.app_id ?? g.install_path ?? g.name}`);

  const steamByAppId = new Map(steamGames.map(s => [String(s.appid), s]));

  // Build lookup by app_id for installed Steam games
  const installedIds = new Set(
    localGames
      .filter(g => g.launcher === 'steam' && g.app_id)
      .map(g => Number(g.app_id))
  );

  // Enrich installed games with playtime
  const enriched = localGames.map(game => {
    if (game.launcher !== 'steam' || !game.app_id) return game;
    const steamEntry = steamByAppId.get(game.app_id);
    if (!steamEntry) return game;
    return {
      ...game,
      playtime_minutes: steamEntry.playtime_forever,
      last_played: steamEntry.rtime_last_played ?? undefined,
    };
  });

  // Append uninstalled Steam games
  const uninstalled: LocalGame[] = steamGames
    .filter(s => !installedIds.has(s.appid) && !BLOCKED_APP_IDS.has(s.appid) && !isBlockedName(s.name))
    .map(s => ({
      name: s.name,
      launcher: 'steam' as const,
      app_id: String(s.appid),
      install_path: undefined,
      playtime_minutes: s.playtime_forever,
      last_played: s.rtime_last_played ?? undefined,
      installed: false,
    }))
    .filter(g => !isHidden(g));

  return [...enriched, ...uninstalled];
}
