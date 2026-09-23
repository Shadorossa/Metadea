// Home's "Airing today" card: what from the library comes out on today's
// local date — day granularity, no times. The source is the same per-day
// data the Home calendar's "Para ti" mode shows in today's cell (the
// planning releases computeUpcomingPlanningReleases returns), so the card
// and the calendar always agree. Only when the calendar has nothing for
// today does it fall back to the weekly AniList check's schedule
// (lib/notifications/library-release-notifications.ts: each tracked
// anime's next episode), projected at most one week, since a show whose
// next airing is further away is probably on break. Pure — tested in
// airing-today.test.ts.

export interface AiringScheduleEntry {
  externalId: string;
  /** Unix seconds of the next episode as of the last check. */
  airingAt: number;
  episode: number;
}

export interface DatedRelease {
  externalId: string;
  releaseDate: Date;
  title: string;
  cover: string;
}

export interface AiringTodayRow {
  externalId: string;
  title: string;
  coverUrl: string | null;
  /** Known only from the airing schedule; null for a calendar premiere. */
  episode: number | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Projection limit: the stored next airing itself, or one week on from it.
const MAX_WEEKS_AHEAD = 1;

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The episode number of `entry` that airs on `now`'s local date, if any
 *  (its stored next airing, or the one a week later). */
export function projectToDay(entry: AiringScheduleEntry, now: Date): number | null {
  for (let week = 0; week <= MAX_WEEKS_AHEAD; week++) {
    if (sameLocalDay(new Date(entry.airingAt * 1000 + week * WEEK_MS), now)) return entry.episode + week;
  }
  return null;
}

/** Today's rows, by title. `lookup` supplies a schedule entry's title/cover
 *  and returns null for a work no longer in the library, which drops it. */
export function airingToday(
  schedule: readonly AiringScheduleEntry[],
  releases: readonly DatedRelease[],
  now: Date,
  lookup: (externalId: string) => { title: string; coverUrl: string | null } | null,
): AiringTodayRow[] {
  const episodeToday = new Map<string, number>();
  for (const entry of schedule) {
    const episode = projectToDay(entry, now);
    if (episode !== null) episodeToday.set(entry.externalId, episode);
  }

  const calendarToday = releases.filter(release => sameLocalDay(release.releaseDate, now));
  const rows: AiringTodayRow[] = calendarToday.length > 0
    ? calendarToday.map(release => ({
      externalId: release.externalId,
      title: release.title,
      coverUrl: release.cover || null,
      episode: episodeToday.get(release.externalId) ?? null,
    }))
    : [...episodeToday].flatMap(([externalId, episode]) => {
      const meta = lookup(externalId);
      return meta ? [{ externalId, ...meta, episode }] : [];
    });

  const seen = new Set<string>();
  return rows
    .filter(row => !seen.has(row.externalId) && seen.add(row.externalId))
    .sort((a, b) => a.title.localeCompare(b.title));
}
