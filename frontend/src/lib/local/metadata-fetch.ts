// "Obtener metadatos" orchestration: one igdb_fetch_metadata_batch call for
// every pending game (see igdb/batch.rs — ten games per IGDB request, a
// not-found memo, cover/banner downloads a few at a time) followed by the
// Steam achievements downloads, paced at the Steam Web API's ~1 request/s.
// LocalLibrary used to run a 3-way pool of igdbGetCoverBySteamId calls, each
// costing up to six IGDB requests and a Steam store lookup on its own.

import { RateLimiter } from '../api/rate-limiter';
import { errorMessage, parseAppError } from '../errors/format-error';
import { invalidateLocalGameReads, invalidateLocalSteamAchievements } from './local-read-cache';
import {
  igdbFetchMetadataBatch, igdbCancelMetadataBatch, listenMetadataProgress, steamAchievementsDownload,
  type IgdbBatchGameRequest, type IgdbBatchGameResult,
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
  // "Retry skipped games": ask IGDB again for games the not-found memo skips.
  retryNotFound?: boolean;
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

export interface MetadataCandidateGame {
  name: string;
  launcher: string;
  app_id?: string;
  rom_platform?: string | null;
}

// The games "Download metadata" works on: Steam, GOG and ROMs with an id,
// minus those whose cover AND banner the index already has (unless Steam
// achievements were asked for too). Empty means everything is up to date.
export function selectPendingMetadataGames(
  games: MetadataCandidateGame[],
  index: Record<string, { cover_path?: string; banner_path?: string } | undefined>,
  options: Pick<MetadataFetchOptions, 'doBasic' | 'doAchievements'>,
): MetadataFetchGame[] {
  return games.flatMap(g => {
    const appId = g.app_id;
    if (!appId || !(g.launcher === 'steam' || g.launcher === 'gog' || !!g.rom_platform)) return [];
    const cached = index[appId];
    const basicDone = !options.doBasic || !!(cached?.cover_path && cached?.banner_path);
    const achievementsRelevant = options.doAchievements && g.launcher === 'steam';
    return !basicDone || achievementsRelevant ? [{ app_id: appId, name: g.name, launcher: g.launcher, rom_platform: g.rom_platform }] : [];
  });
}

export function toBatchRequest(game: MetadataFetchGame): IgdbBatchGameRequest {
  return { app_id: game.app_id, game_name: game.name, launcher: game.launcher, rom_platform: game.rom_platform ?? null };
}

export function cancelMetadataFetch(): Promise<void> {
  return igdbCancelMetadataBatch().catch(() => {});
}

export interface MetadataFetchSummary {
  done: number;
  cached: number;
  notFound: number;
  skipped: number;
  failed: number;
  achievementsFailed: number;
}

export interface MetadataFetchOutcome {
  // The batch command's own rejection (E_IGDB_KEYS_MISSING, E_IGDB_AUTH,
  // E_IGDB_NETWORK, E_METADATA_DB_BUSY, …): the basic step fetched nothing.
  // Shown through formatAppError, never just logged.
  error: string | null;
  summary: MetadataFetchSummary;
}

export function emptySummary(): MetadataFetchSummary {
  return { done: 0, cached: 0, notFound: 0, skipped: 0, failed: 0, achievementsFailed: 0 };
}

export function summarizeBatch(results: IgdbBatchGameResult[], summary: MetadataFetchSummary = emptySummary()): MetadataFetchSummary {
  const next = { ...summary };
  for (const r of results) {
    if (r.status === 'done') next.done++;
    else if (r.status === 'cached') next.cached++;
    else if (r.status === 'not_found') next.notFound++;
    else if (r.status === 'skipped') next.skipped++;
    else if (r.status === 'error') next.failed++;
  }
  return next;
}

// The codes that mean "fix your IGDB keys": the modal links to Settings ›
// Environment for them.
export function errorNeedsIgdbKeys(error: string | null): boolean {
  const code = error ? parseAppError(error)?.code : null;
  return code === 'E_IGDB_KEYS_MISSING' || code === 'E_IGDB_AUTH';
}

// Whether the run ends on a summary instead of closing: an error, or games
// that did not get their metadata and the user should hear why.
export function outcomeNeedsAttention(outcome: MetadataFetchOutcome): boolean {
  const s = outcome.summary;
  return outcome.error !== null || s.notFound > 0 || s.skipped > 0 || s.failed > 0 || s.achievementsFailed > 0;
}

export async function runMetadataFetch(
  games: MetadataFetchGame[],
  options: MetadataFetchOptions,
  onProgress: (progress: MetadataFetchProgress) => void,
  isCancelled: () => boolean,
): Promise<MetadataFetchOutcome> {
  const total = games.length;
  const phases = metadataPhases(options);
  let basicDone = 0;
  let achievementsDone = 0;
  let error: string | null = null;
  let summary = emptySummary();
  const report = (currentName: string) => onProgress({ total, current: combinedProgress(basicDone, achievementsDone, phases, total), currentName });

  if (options.doBasic && !isCancelled()) {
    const unlisten = await listenMetadataProgress(progress => {
      basicDone = progress.current;
      report(progress.current_name);
    });
    try {
      const results = await igdbFetchMetadataBatch(games.map(toBatchRequest), options.retryNotFound ?? false);
      summary = summarizeBatch(results, summary);
      basicDone = total;
    } catch (err) {
      error = errorMessage(err);
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
    // The modal's Cancel is checked before and after every rate-limit wait.
    for (const game of games) {
      if (isCancelled()) break;
      if (game.launcher !== 'steam') { achievementsDone++; continue; }
      report(game.name);
      await steamWebApiRateLimiter.acquire('background');
      if (isCancelled()) break;
      try {
        await steamAchievementsDownload(game.app_id);
      } catch (err) {
        summary.achievementsFailed++;
        console.error('[META] achievements', game.app_id, err);
      }
      invalidateLocalSteamAchievements(Number(game.app_id));
      achievementsDone++;
      report(game.name);
    }
  }

  return { error, summary };
}
