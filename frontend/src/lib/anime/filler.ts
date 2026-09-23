// Filler-aware episode arithmetic for anime (data: AnimeFillerList.com via
// src-tauri/src/anime_filler, loaded by ./filler-data.ts).
//
// Numbering. AnimeFillerList numbers a show absolutely across its whole run
// ("Bleach 1–366"); a catalog entry covers a slice of that run starting at
// `episodeOffset + 1` (Fairy Tail (2014) starts at 176). Everything here
// takes and returns the ENTRY's own episode numbers — the number library
// progress stores and AniList/MAL sync sends — and converts internally.
//
// "Filler: Skipped" (library_entry.skip_filler = 1) never changes what is
// stored: progress stays the real episode number. It only changes what is
// shown and counted: the effective total drops the entry's filler episodes
// (mixed canon/filler counts as canon), displayed progress counts the canon
// episodes up to the stored one, and completion triggers at the last
// canon/mixed episode.
//
// Every function accepts `info` = null/undefined and then behaves exactly as
// if filler data did not exist, so call sites can route through here
// unconditionally.

import type { FillerInfoRow } from '../tauri/anime-filler';

export type FillerKind = 'manga_canon' | 'anime_canon' | 'filler' | 'mixed';

export interface FillerInfo {
  externalId: string;
  slug: string;
  /** AnimeFillerList's show title. */
  title: string;
  /** AnimeFillerList number of the entry's episode 1, minus one. */
  episodeOffset: number;
  manual: boolean;
  confidence: number;
  /** Highest AnimeFillerList episode number known for the show. */
  lastEpisode: number;
  isAiring: boolean;
  fetchedAt: number | null;
  /** Absolute number → category, for every episode that isn't manga canon. */
  kinds: ReadonlyMap<number, FillerKind>;
  /** Absolute filler numbers, ascending. */
  fillerAbsolute: readonly number[];
}

/** The library-entry fields the helpers read. */
export interface FillerEntryLike {
  skip_filler?: number | null;
  progress?: number | null;
}

type MaybeInfo = FillerInfo | null | undefined;

export function toFillerInfo(row: FillerInfoRow): FillerInfo | null {
  const show = row.show;
  if (!show || show.lastEpisode <= 0) return null;
  const kinds = new Map<number, FillerKind>();
  for (const n of show.animeCanon) kinds.set(n, 'anime_canon');
  for (const n of show.filler) kinds.set(n, 'filler');
  for (const n of show.mixed) kinds.set(n, 'mixed');
  return {
    externalId: row.link.externalId,
    slug: row.link.slug,
    title: show.title,
    episodeOffset: Math.max(0, row.link.episodeOffset),
    manual: row.link.manual,
    confidence: row.link.confidence,
    lastEpisode: show.lastEpisode,
    isAiring: show.isAiring,
    fetchedAt: show.fetchedAt,
    kinds,
    fillerAbsolute: [...show.filler].sort((a, b) => a - b),
  };
}

/** Category of the entry's episode `episode`; null when AnimeFillerList
 *  doesn't list it (beyond its data, or not a whole episode). */
export function fillerKindOf(info: MaybeInfo, episode: number): FillerKind | null {
  if (!info || !Number.isInteger(episode) || episode < 1) return null;
  const absolute = info.episodeOffset + episode;
  if (absolute > info.lastEpisode) return null;
  return info.kinds.get(absolute) ?? 'manga_canon';
}

export function isFillerEpisode(info: MaybeInfo, episode: number): boolean {
  return fillerKindOf(info, episode) === 'filler';
}

/** Filler episodes among the entry's episodes `from..to` (inclusive). */
export function countFillerBetween(info: MaybeInfo, from: number, to: number): number {
  if (!info || to < from) return 0;
  const lo = info.episodeOffset + Math.max(1, Math.ceil(from));
  const hi = info.episodeOffset + Math.floor(to);
  let count = 0;
  for (const n of info.fillerAbsolute) {
    if (n > hi) break;
    if (n >= lo) count++;
  }
  return count;
}

/** The entry's own episode span: its total when known, else what
 *  AnimeFillerList lists past the offset. */
function entrySpan(info: FillerInfo, total: number | null | undefined): number {
  if (total && total > 0) return total;
  return Math.max(0, info.lastEpisode - info.episodeOffset);
}

/** Filler episodes inside the entry (episodes 1..total). */
export function entryFillerCount(info: MaybeInfo, total: number | null | undefined): number {
  if (!info) return 0;
  return countFillerBetween(info, 1, entrySpan(info, total));
}

/** Whether the editor's "Watched with filler" checkbox applies at all. */
export function entryHasFiller(info: MaybeInfo, total: number | null | undefined): boolean {
  return entryFillerCount(info, total) > 0;
}

export function skipsFiller(entry: FillerEntryLike | null | undefined, info: MaybeInfo, total?: number | null): boolean {
  return !!entry && entry.skip_filler === 1 && entryHasFiller(info, total);
}

/** Total to display/count against: the catalog total, minus the entry's
 *  filler when it is set to Skipped. Unknown totals stay unknown. */
export function effectiveEpisodeTotal(
  entry: FillerEntryLike | null | undefined,
  info: MaybeInfo,
  total: number | null | undefined,
): number | null {
  if (!total || total <= 0) return total ?? null;
  if (!skipsFiller(entry, info, total)) return total;
  return total - entryFillerCount(info, total);
}

/** Progress to display: the stored (real) episode number, or — when
 *  Skipped — how many canon/mixed episodes lie at or below it. */
export function effectiveProgress(
  entry: FillerEntryLike | null | undefined,
  info: MaybeInfo,
  total?: number | null,
): number {
  const progress = Math.max(0, entry?.progress ?? 0);
  if (!skipsFiller(entry, info, total)) return progress;
  return Math.max(0, progress - countFillerBetween(info, 1, progress));
}

/**
 * The inverse of effectiveProgress for a Skipped entry: the stored (real)
 * episode number of the entry's `canonProgress`-th canon/mixed episode, so a
 * canon count typed in the editor is saved as the absolute episode AniList/MAL
 * sync expects. 0 for 0; clamped to the entry's last canon/mixed episode (or
 * `total`) when the count exceeds what the entry has. Episodes past
 * AnimeFillerList's data count as canon. Without data it returns the count.
 */
export function absoluteFromCanonProgress(canonProgress: number, info: MaybeInfo, total: number | null | undefined): number {
  const target = Math.max(0, Math.floor(canonProgress));
  const limit = total && total > 0 ? total : Number.POSITIVE_INFINITY;
  if (target === 0) return 0;
  if (!info) return Math.min(target, limit);
  const listed = Math.max(0, info.lastEpisode - info.episodeOffset);
  let canon = 0;
  let lastCanon = 0;
  for (let episode = 1; episode <= Math.min(listed, limit); episode++) {
    if (isFillerEpisode(info, episode)) continue;
    canon++;
    lastCanon = episode;
    if (canon === target) return episode;
  }
  if (listed >= limit) return lastCanon || limit;
  // Past the listed episodes every episode is canon.
  return Math.min(listed + (target - canon), limit);
}

/** The editor's "Watched with filler" checkbox → library_entry.skip_filler
 *  (unchecked = Skipped). */
export function skipFillerFromWatchedWithFiller(watchedWithFiller: boolean): 0 | 1 {
  return watchedWithFiller ? 0 : 1;
}

export interface SeasonFillerCount {
  entry: FillerEntryLike | null | undefined;
  info: MaybeInfo;
  total: number | null | undefined;
}

/**
 * A unified season chain's general totals: each season's effective total
 * and displayed progress (its own skip_filler and filler data), summed.
 * Seasons with an unknown total add nothing to the total.
 */
export function sumEffectiveSeasons(seasons: readonly SeasonFillerCount[]): { total: number; progress: number } {
  let total = 0;
  let progress = 0;
  for (const season of seasons) {
    total += effectiveEpisodeTotal(season.entry, season.info, season.total) ?? 0;
    progress += effectiveProgress(season.entry, season.info, season.total);
  }
  return { total, progress };
}

/** The entry's last canon or mixed episode (1..total); 0 when every
 *  episode is filler. */
export function lastCanonEpisode(info: MaybeInfo, total: number): number {
  for (let episode = total; episode >= 1; episode--) {
    if (!isFillerEpisode(info, episode)) return episode;
  }
  return 0;
}

/** The stored progress at which the entry counts as finished: the total,
 *  or when Skipped its last canon/mixed episode. Null when unknown. */
export function completionEpisode(
  entry: FillerEntryLike | null | undefined,
  info: MaybeInfo,
  total: number | null | undefined,
): number | null {
  if (!total || total <= 0) return null;
  if (!skipsFiller(entry, info, total)) return total;
  return lastCanonEpisode(info, total) || total;
}

export function isEffectivelyComplete(
  entry: FillerEntryLike | null | undefined,
  info: MaybeInfo,
  total: number | null | undefined,
): boolean {
  const threshold = completionEpisode(entry, info, total);
  return threshold != null && (entry?.progress ?? 0) >= threshold;
}

export interface NextCanonEpisode {
  /** The entry's next canon/mixed episode, or null when only filler (or
   *  nothing) remains up to `total`. */
  episode: number | null;
  /** Filler episodes jumped over to get there. */
  skipped: number;
}

/**
 * For the player's "Next canon episode: 220 (skipping 84 filler)" prompt.
 * `currentAbsolute` is the entry's real (unadjusted) episode number — the
 * one library progress stores and the player plays — not a filler-adjusted
 * count. Without data, or when the next episode is already canon, returns
 * `{ episode: current + 1, skipped: 0 }`. Past AnimeFillerList's data the
 * next episode is treated as canon (it simply isn't listed yet), unless
 * `total` says it doesn't exist.
 */
export function nextCanonEpisode(currentAbsolute: number, info: MaybeInfo, total?: number | null): NextCanonEpisode {
  const limit = total && total > 0 ? total : Number.POSITIVE_INFINITY;
  let episode = Math.max(0, Math.floor(currentAbsolute)) + 1;
  let skipped = 0;
  while (episode <= limit && isFillerEpisode(info, episode)) {
    skipped++;
    episode++;
  }
  return { episode: episode <= limit ? episode : null, skipped };
}

export interface SeasonEpisodeCount {
  season_number: number;
  episode_count: number;
}

/** TMDB season + episode → absolute episode number via cumulative season
 *  counts (season 0 / specials have none). */
export function seasonEpisodeToAbsolute(
  seasons: readonly SeasonEpisodeCount[],
  season: number,
  episode: number,
): number | null {
  if (season < 1 || episode < 1) return null;
  let before = 0;
  for (const s of seasons) {
    if (s.season_number >= 1 && s.season_number < season) before += Math.max(0, s.episode_count);
  }
  return before + episode;
}
