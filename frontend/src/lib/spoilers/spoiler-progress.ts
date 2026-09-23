// Where the user is inside one work, and whether a numbered unit (episode,
// chapter, volume) lies past that point. Pure — tested in
// spoiler-progress.test.ts.

export type ProgressUnit = 'episodes' | 'chapters' | 'volumes';

export interface ProgressRow {
  status: string | null;
  /** Episodes (anime/series), chapters (manga) or volumes (light novels/books). */
  progress: number;
  /** Volumes, for manga. */
  progress_2?: number | null;
}

export const COMPLETED_STATUS = 'completed';

// Which library column counts which unit for each type.
const PRIMARY_UNIT_BY_TYPE: Record<string, ProgressUnit> = {
  anime: 'episodes',
  series: 'episodes',
  movie: 'episodes',
  manga: 'chapters',
  comic: 'chapters',
  lnovel: 'volumes',
  book: 'volumes',
};

export function primaryUnitForType(type: string): ProgressUnit | null {
  return PRIMARY_UNIT_BY_TYPE[type] ?? null;
}

/** How many `unit`s of the work the row says were consumed. Manga keeps
 *  chapters in `progress` and volumes in `progress_2`. */
export function consumedUnits(row: ProgressRow | undefined, type: string, unit: ProgressUnit): number {
  if (!row) return 0;
  const primary = primaryUnitForType(type);
  if (unit === 'volumes' && primary === 'chapters') return Math.max(0, row.progress_2 ?? 0);
  return Math.max(0, row.progress ?? 0);
}

/** True when unit `position` (1-based) has not been reached yet. A completed
 *  row has seen everything; an unknown position is never "ahead". */
export function isUnitAhead(position: number | null | undefined, row: ProgressRow | undefined, type: string, unit: ProgressUnit): boolean {
  if (row?.status === COMPLETED_STATUS) return false;
  if (position == null || !Number.isFinite(position)) return false;
  return position > consumedUnits(row, type, unit);
}

/** Whether a range that starts at `start` begins after the unit the user is
 *  on now (the one after the last consumed) — the "current" arc, the one
 *  that starts right at the next unit, stays visible. */
export function isRangeAhead(start: number | null | undefined, row: ProgressRow | undefined, type: string, unit: ProgressUnit): boolean {
  if (start == null) return false;
  return isUnitAhead(start - 1, row, type, unit);
}

export interface NumberedEpisode {
  external_id: string;
  episode_number: number;
}

/** Per work, how far its episode numbers are shifted from its own count:
 *  the unified season stream and some providers number later seasons
 *  absolutely (S2 listed from 25), while library progress counts from 1
 *  inside each work. A shift is only trusted when the first listed number
 *  lies past the work's own episode total — a list that merely misses its
 *  first episodes, or a work with no known total, keeps its numbers (which
 *  can only hide more, never less). */
export function episodeOffsets(
  episodes: readonly NumberedEpisode[],
  fallbackId: string,
  totalCountOf: (workId: string) => number | null | undefined,
): Map<string, number> {
  const minimum = new Map<string, number>();
  for (const episode of episodes) {
    if (!(episode.episode_number > 0)) continue;
    const id = episode.external_id || fallbackId;
    const current = minimum.get(id);
    if (current === undefined || episode.episode_number < current) minimum.set(id, episode.episode_number);
  }
  const offsets = new Map<string, number>();
  for (const [id, first] of minimum) {
    const total = totalCountOf(id);
    offsets.set(id, total != null && total > 0 && first > total ? Math.ceil(first) - 1 : 0);
  }
  return offsets;
}

/** The 1-based position of `episode` inside its own work; specials (listed
 *  with negative numbers) have none. */
export function episodePositionInWork(episode: NumberedEpisode, offsets: ReadonlyMap<string, number>, fallbackId: string): number | null {
  if (!(episode.episode_number > 0)) return null;
  return episode.episode_number - (offsets.get(episode.external_id || fallbackId) ?? 0);
}

/** ComicVine's `first_appeared_in_issue.issue_number` ("21", "3.5") against
 *  the user's volume/issue progress; unparseable numbers are never ahead. */
export function isIssueAhead(issueNumber: string | null | undefined, row: ProgressRow | undefined, type: string): boolean {
  const parsed = issueNumber == null ? NaN : parseFloat(issueNumber);
  if (!Number.isFinite(parsed)) return false;
  return isUnitAhead(parsed, row, type, type === 'comic' ? 'chapters' : 'volumes');
}
