// "Obtener metadatos" orchestration: one igdb_fetch_metadata_batch call for
// every pending game (see igdb/batch.rs — ten games per IGDB request, a
// not-found memo, cover/banner downloads a few at a time) followed by the
// Steam achievements downloads, paced at the Steam Web API's ~1 request/s.
// LocalLibrary used to run a 3-way pool of igdbGetCoverBySteamId calls, each
// costing up to six IGDB requests and a Steam store lookup on its own.

import { RateLimiter } from '../api/rate-limiter';
import { invalidateLocalGameReads, invalidateLocalSteamAchievements } from './local-read-cache';
import {
  igdbFetchMetadataBatch, igdbCancelMetadataBatch, listenMetadataProgress, steamAchievementsDownload,
  type IgdbBatchGameRequest,
} from '../tauri';

export interface MetadataFetchGame {
  app_id: string;
  name: string;
  launcher: string;
  rom_platform?: string | null;
}

export interface MetadataFetchOptions {
  doBasic: boolean;
  doAchievements: boolean;
}

export interface MetadataFetchProgress {
  total: number;
  current: number;
  currentName: string;
}

// Steam's Web API: the achievements download is two requests per game
// (player progress + schema), so one call per second keeps a whole library
// well under the 100k/day key quota and out of its burst throttling.
export const steamWebApiRateLimiter = new RateLimiter({ maxRequests: 1, windowMs: 1_000 });

export function metadataPhases(options: MetadataFetchOptions): number {
  return (options.doBasic ? 1 : 0) + (options.doAchievements ? 1 : 0);
}

// The modal still counts GAMES ("3 / 20"), not steps: with both phases
// selected a game is halfway done after its IGDB step, so the shown count
// is the games' worth of finished steps, never past the total.
export function combinedProgress(basicDone: number, achievementsDone: number, phases: number, total: number): number {
  if (phases <= 0 || total <= 0) return 0;
  return Math.min(total, Math.floor((basicDone + achievementsDone) / phases));
}

export function toBatchRequest(game: MetadataFetchGame): IgdbBatchGameRequest {
  return { app_id: game.app_id, game_name: game.name, launcher: game.launcher, rom_platform: game.rom_platform ?? null };
}

export function cancelMetadataFetch(): Promise<void> {
  return igdbCancelMetadataBatch().catch(() => {});
}

export async function runMetadataFetch(
  games: MetadataFetchGame[],
  options: MetadataFetchOptions,
  onProgress: (progress: MetadataFetchProgress) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const total = games.length;
  const phases = metadataPhases(options);
  let basicDone = 0;
  let achievementsDone = 0;
  const report = (currentName: string) => onProgress({ total, current: combinedProgress(basicDone, achievementsDone, phases, total), currentName });

  if (options.doBasic && !isCancelled()) {
    const unlisten = await listenMetadataProgress(progress => {
      basicDone = progress.current;
      report(progress.current_name);
    });
    try {
      await igdbFetchMetadataBatch(games.map(toBatchRequest));
      basicDone = total;
    } catch (err) {
      console.error('[META]', err);
    } finally {
      unlisten();
      // The batch rewrote info.json for every game it resolved.
      invalidateLocalGameReads();
    }
  }

  if (options.doAchievements) {
    // Achievements stay Steam-only (Steam's own Web API — GOG Galaxy has
    // its own separate achievements system this doesn't talk to at all).
    for (const game of games) {
      if (isCancelled()) break;
      if (game.launcher !== 'steam') { achievementsDone++; continue; }
      report(game.name);
      await steamWebApiRateLimiter.acquire('background');
      if (isCancelled()) break;
      await steamAchievementsDownload(game.app_id).catch(() => {});
      invalidateLocalSteamAchievements(Number(game.app_id));
      achievementsDone++;
      report(game.name);
    }
  }
}
