// Canonical release-status vocabulary every provider mapper (AniList, TMDB,
// IGDB) normalizes into before it reaches MediaPageData.status / gets
// persisted to media_catalog.status. AniList's own enum is used as the base
// since it already covers everything but one carve-out (IGDB's
// offline/delisted games, which don't have an equivalent anywhere else).
//
// Storing the canonical value (not each provider's raw string) is what lets
// needsResync() below, and the profile's "caught up" grouping, treat every
// media type the same way regardless of source.
export type CanonicalStatus =
  | 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS' | 'UNAVAILABLE';

export const STATUS_BADGE_CLASS: Partial<Record<CanonicalStatus, string>> = {
  RELEASING:        'media-badge--status-airing',
  NOT_YET_RELEASED: 'media-badge--status-upcoming',
};

const ANILIST_STATUS_MAP: Record<string, CanonicalStatus> = {
  FINISHED: 'FINISHED', RELEASING: 'RELEASING', NOT_YET_RELEASED: 'NOT_YET_RELEASED',
  CANCELLED: 'CANCELLED', HIATUS: 'HIATUS',
};
export function canonicalizeAniListStatus(raw: string | null | undefined): CanonicalStatus | undefined {
  return raw ? ANILIST_STATUS_MAP[raw] : undefined;
}

const TMDB_MOVIE_STATUS_MAP: Record<string, CanonicalStatus> = {
  Released: 'FINISHED',
  Canceled: 'CANCELLED',
  'In Production':   'NOT_YET_RELEASED',
  'Post Production': 'NOT_YET_RELEASED',
  Planned: 'NOT_YET_RELEASED',
  Rumored: 'NOT_YET_RELEASED',
};
const TMDB_TV_STATUS_MAP: Record<string, CanonicalStatus> = {
  Ended: 'FINISHED',
  'Returning Series': 'RELEASING',
  Canceled: 'CANCELLED',
  'In Production': 'NOT_YET_RELEASED',
  Planned: 'NOT_YET_RELEASED',
  Pilot: 'NOT_YET_RELEASED',
};
export function canonicalizeTmdbStatus(raw: string | null | undefined, isTv: boolean): CanonicalStatus | undefined {
  if (!raw) return undefined;
  return (isTv ? TMDB_TV_STATUS_MAP : TMDB_MOVIE_STATUS_MAP)[raw];
}

// IGDB's numeric release-status enum (no 1): 0 Released, 2 Alpha, 3 Beta,
// 4 Early Access, 5 Offline, 6 Cancelled, 7 Rumored, 8 Delisted.
const IGDB_STATUS_MAP: Record<number, CanonicalStatus> = {
  0: 'FINISHED',
  4: 'RELEASING',
  2: 'NOT_YET_RELEASED',
  3: 'NOT_YET_RELEASED',
  7: 'NOT_YET_RELEASED',
  6: 'CANCELLED',
  5: 'UNAVAILABLE',
  8: 'UNAVAILABLE',
};
export function canonicalizeIgdbStatus(raw: number | null | undefined): CanonicalStatus | undefined {
  return raw != null ? IGDB_STATUS_MAP[raw] : undefined;
}

// ── Resync cadence ──────────────────────────────────────────────────────────
// How often a media_catalog row is worth re-checking against its live
// provider, keyed by its own canonical status — a RELEASING show gains new
// episodes weekly, an unannounced one (NOT_YET_RELEASED) can flip to
// RELEASING any day, and a terminal status (FINISHED/CANCELLED/UNAVAILABLE)
// only needs an occasional check (e.g. IGDB attaching a new DLC/remaster to
// an already-finished game long after release) rather than the every-single-
// page-view resync this used to do unconditionally.
const RESYNC_INTERVAL_DAYS: Record<CanonicalStatus, number> = {
  RELEASING:        7,
  NOT_YET_RELEASED: 1,
  HIATUS:           30,
  FINISHED:         30,
  CANCELLED:        90,
  UNAVAILABLE:      90,
};
const DEFAULT_RESYNC_INTERVAL_DAYS = 30; // unknown/missing status

// Caps how far repeated failures push the interval out — a provider that's
// been down/erroring for weeks shouldn't stop ever being retried again.
const MAX_BACKOFF_MULTIPLIER = 8;

export function needsResync(entry: {
  status?: string | null;
  last_synced_at?: string | null;
  sync_failed_count?: number | null;
} | null | undefined): boolean {
  if (!entry) return true;
  if (!entry.last_synced_at) return true;

  const intervalDays = RESYNC_INTERVAL_DAYS[(entry.status ?? '') as CanonicalStatus] ?? DEFAULT_RESYNC_INTERVAL_DAYS;

  // Back off exponentially on repeated failures (1x, 2x, 4x, 8x, capped) —
  // a title whose provider keeps 404ing/erroring shouldn't retry on the
  // same weekly cadence as one that's actually working, but also shouldn't
  // be abandoned forever.
  const failures = entry.sync_failed_count ?? 0;
  const backoffMultiplier = failures > 0 ? Math.min(2 ** failures, MAX_BACKOFF_MULTIPLIER) : 1;

  const lastSynced = new Date(entry.last_synced_at).getTime();
  if (isNaN(lastSynced)) return true;

  return Date.now() - lastSynced > intervalDays * backoffMultiplier * 24 * 60 * 60 * 1000;
}

// A library entry counts as "caught up" (rather than plain "in progress")
// when its own progress has already reached everything a still-RELEASING
// work has aired/published so far — used by the profile library to bucket
// these separately instead of lumping them in with genuinely-behind entries.
export function isCaughtUpOnReleasing(
  libraryStatus: string | null | undefined,
  progress: number | null | undefined,
  catalogEntry: { status?: string | null; total_count?: number | null } | null | undefined,
): boolean {
  if (!catalogEntry || catalogEntry.status !== 'RELEASING') return false;
  if (!catalogEntry.total_count || catalogEntry.total_count <= 0) return false;
  const inProgress = libraryStatus === 'watching' || libraryStatus === 'reading' || libraryStatus === 'playing';
  if (!inProgress) return false;
  return (progress ?? 0) >= catalogEntry.total_count;
}
