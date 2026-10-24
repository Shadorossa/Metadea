// Steam's owned-games list (IPlayerService/GetOwnedGames, a Web API round
// trip) shared by Local (uninstalled games, playtime) and the profile's
// achievements tab. Kept in memory and in localStorage so both can paint
// from the last copy at once; refreshed at most hourly, or after a play
// session ('profile-achievements-changed', see markLocalSteamAchievementsStale).
import { steamGetOwnedGames, type SteamOwnedGame } from '../tauri';
import { STORAGE_KEYS } from '../storage/storage-keys';

export type OwnedSteamGame = Pick<SteamOwnedGame, 'appid' | 'name' | 'playtime_forever' | 'rtime_last_played'>;

interface StoredOwnedGames {
  savedAt: number;
  games: OwnedSteamGame[];
}

const OWNED_GAMES_REFRESH_MS = 60 * 60 * 1000;

let ownedGamesMemo: StoredOwnedGames | null = null;
let pendingFetch: Promise<OwnedSteamGame[] | null> | null = null;

/** The last stored list whatever its age, or null — never the network. */
export function readStoredSteamOwnedGames(): OwnedSteamGame[] | null {
  return readStored()?.games ?? null;
}

/** The stored list while it is fresh; otherwise a fetch, falling back to
 *  the stored copy (or null when there is none) if Steam doesn't answer. */
export async function loadSteamOwnedGames(): Promise<OwnedSteamGame[] | null> {
  const stored = readStored();
  if (stored && Date.now() - stored.savedAt < OWNED_GAMES_REFRESH_MS) return stored.games;
  pendingFetch ??= fetchOwnedGames().finally(() => { pendingFetch = null; });
  return pendingFetch;
}

function markOwnedGamesStale(): void {
  const stored = readStored();
  if (stored) ownedGamesMemo = { ...stored, savedAt: 0 };
}

if (typeof window !== 'undefined') {
  window.addEventListener('profile-achievements-changed', markOwnedGamesStale);
}

function readStored(): StoredOwnedGames | null {
  if (ownedGamesMemo) return ownedGamesMemo;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.steamOwnedGames) ?? 'null') as Partial<StoredOwnedGames> | null;
    if (parsed && typeof parsed.savedAt === 'number' && Array.isArray(parsed.games)) {
      ownedGamesMemo = { savedAt: parsed.savedAt, games: parsed.games };
    }
  } catch {
    // Unavailable or corrupt storage: the next load fetches the list.
  }
  return ownedGamesMemo;
}

async function fetchOwnedGames(): Promise<OwnedSteamGame[] | null> {
  const response = await steamGetOwnedGames().catch(() => null);
  if (!response) return readStored()?.games ?? null;
  const games = (response.games ?? [])
    .map(({ appid, name, playtime_forever, rtime_last_played }) => ({ appid, name, playtime_forever, rtime_last_played }));
  ownedGamesMemo = { savedAt: Date.now(), games };
  try {
    localStorage.setItem(STORAGE_KEYS.steamOwnedGames, JSON.stringify(ownedGamesMemo));
  } catch {
    // The in-memory copy still serves this session.
  }
  return games;
}
