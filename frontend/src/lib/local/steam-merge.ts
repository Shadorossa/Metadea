import { scanAllGames, steamGetOwnedGames, readEnvConfig } from '../tauri';
import type { LocalGame, SteamOwnedGame } from '../tauri';

/**
 * Returns all local games enriched with Steam playtime.
 * If a Steam API key is configured:
 *   - Adds playtime_minutes + last_played to installed Steam games
 *   - Appends uninstalled Steam games (installed = false)
 * Without API key: plain local scan.
 */
export async function scanGamesWithSteam(): Promise<LocalGame[]> {
  const [localGames, cfg] = await Promise.all([
    scanAllGames(),
    readEnvConfig().catch(() => ({})),
  ]);

  if (!cfg.steam_api_key) return localGames;

  const steamData = await steamGetOwnedGames();
  if (!steamData?.games) return localGames;

  const steamGames: SteamOwnedGame[] = steamData.games;

  // Build lookup by app_id for installed Steam games
  const installedIds = new Set(
    localGames
      .filter(g => g.launcher === 'steam' && g.app_id)
      .map(g => Number(g.app_id))
  );

  // Enrich installed games with playtime
  const enriched = localGames.map(game => {
    if (game.launcher !== 'steam' || !game.app_id) return game;
    const steamEntry = steamGames.find(s => String(s.appid) === game.app_id);
    if (!steamEntry) return game;
    return {
      ...game,
      playtime_minutes: steamEntry.playtime_forever,
      last_played: steamEntry.rtime_last_played ?? undefined,
    };
  });

  // Blocklist for tools/redistributables from the Steam Web API
  const blockedAppIds = new Set([228980, 993090, 388080, 250820, 1113010, 1054830]);
  const isBlockedName = (name: string) => {
    const lower = name.toLowerCase();
    return lower.includes('redistributable') ||
           lower.includes('dedicated server') ||
           lower.includes('steamworks') ||
           lower.includes('steamvr');
  };

  // Append uninstalled Steam games
  const uninstalled: LocalGame[] = steamGames
    .filter(s => !installedIds.has(s.appid) && !blockedAppIds.has(s.appid) && !isBlockedName(s.name))
    .map(s => ({
      name: s.name,
      launcher: 'steam' as const,
      app_id: String(s.appid),
      install_path: undefined,
      playtime_minutes: s.playtime_forever,
      last_played: s.rtime_last_played ?? undefined,
      installed: false,
    }));

  return [...enriched, ...uninstalled];
}
