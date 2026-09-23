// Pure translations between Metadea's library vocabulary and
// MyAnimeList's (list statuses, scores, dates, progress counters) — both
// directions: the save-time sync (sync.ts) builds MAL payloads from a
// library entry, the import (import.ts) turns MAL list rows into the
// AniList-shaped items the shared AniList importer already knows how to
// merge. No IO here; everything is unit-tested with plain values.
import type {
  MalAnimeListUpdate, MalAnimeStatus, MalListItem, MalListKind, MalMangaListUpdate, MalMangaStatus,
} from '../tauri/mal';
import type { AniListImportMediaItem, AniListImportMedia } from '../anilist/import';
import { dbRatingToTenPointInt } from '../media/rating-utils';

/** Which MAL list a Metadea media type lives on; null for everything MAL
 *  does not track (games, movies, series, books, comics, visual novels…),
 *  which the sync skips silently. Light novels are manga on MAL. */
export function malKindForType(type: string | null | undefined): MalListKind | null {
  const base = (type ?? '').split('_')[0];
  if (base === 'anime') return 'anime';
  if (base === 'manga' || base === 'lnovel') return 'manga';
  return null;
}

// App status → MAL status. The empty app status ("no status yet") sends no
// status at all; MAL keeps whatever it has (or defaults a new entry).
export const APP_TO_MAL_ANIME_STATUS: Record<string, MalAnimeStatus> = {
  planning:  'plan_to_watch',
  watching:  'watching',
  reading:   'watching',
  completed: 'completed',
  paused:    'on_hold',
  dropped:   'dropped',
};

export const APP_TO_MAL_MANGA_STATUS: Record<string, MalMangaStatus> = {
  planning:  'plan_to_read',
  watching:  'reading',
  reading:   'reading',
  completed: 'completed',
  paused:    'on_hold',
  dropped:   'dropped',
};

// MAL status → the AniList MediaListStatus the shared importer maps to an
// app status (ANILIST_TO_APP_STATUS in media-types.ts), so both imports
// agree on what e.g. "on hold" becomes locally.
export const MAL_TO_ANILIST_STATUS: Record<string, string> = {
  watching:      'CURRENT',
  reading:       'CURRENT',
  completed:     'COMPLETED',
  on_hold:       'PAUSED',
  dropped:       'DROPPED',
  plan_to_watch: 'PLANNING',
  plan_to_read:  'PLANNING',
};

/** The library fields the sync needs — a subset of AniListSyncParams, so
 *  the same object the AniList sync receives can be handed over as-is. */
export interface MalSyncInput {
  externalId:      string;
  type:            string;
  status:          string;
  rating:          number;
  progress:        number;
  progressVolumes: number;
  startedAt:       string;
  finishedAt:      string;
  /** Reconsumption counter (user_library.reconsumption_count) → MAL's
   *  num_times_rewatched / num_times_reread. Left out when untracked. */
  repeat?:         number;
  /** A re-run in progress (user_library.reconsuming) → is_rewatching /
   *  is_rereading. Left out entirely when the caller doesn't track it, so
   *  MAL keeps its own flag. */
  reconsuming?:    boolean;
}

/** `YYYY-MM-DD` or nothing — MAL rejects any other shape, and a partial
 *  local date is better left alone than sent wrong. */
export function toMalDate(iso: string | null | undefined): string | undefined {
  const value = (iso ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export function appRatingToMalScore(rating: number | null | undefined): number {
  return dbRatingToTenPointInt(rating);
}

export function buildMalAnimeUpdate(input: MalSyncInput): MalAnimeListUpdate {
  const update: MalAnimeListUpdate = {
    score: appRatingToMalScore(input.rating),
    num_watched_episodes: Math.max(0, Math.floor(input.progress || 0)),
  };
  const status = APP_TO_MAL_ANIME_STATUS[input.status];
  if (status) update.status = status;
  const startDate = toMalDate(input.startedAt);
  if (startDate) update.start_date = startDate;
  const finishDate = toMalDate(input.finishedAt);
  if (finishDate) update.finish_date = finishDate;
  if (input.reconsuming !== undefined) update.is_rewatching = input.reconsuming;
  if (typeof input.repeat === 'number') update.num_times_rewatched = Math.max(0, Math.floor(input.repeat));
  return update;
}

export function buildMalMangaUpdate(input: MalSyncInput): MalMangaListUpdate {
  const update: MalMangaListUpdate = {
    score: appRatingToMalScore(input.rating),
    num_chapters_read: Math.max(0, Math.floor(input.progress || 0)),
    num_volumes_read: Math.max(0, Math.floor(input.progressVolumes || 0)),
  };
  const status = APP_TO_MAL_MANGA_STATUS[input.status];
  if (status) update.status = status;
  const startDate = toMalDate(input.startedAt);
  if (startDate) update.start_date = startDate;
  const finishDate = toMalDate(input.finishedAt);
  if (finishDate) update.finish_date = finishDate;
  if (input.reconsuming !== undefined) update.is_rereading = input.reconsuming;
  if (typeof input.repeat === 'number') update.num_times_reread = Math.max(0, Math.floor(input.repeat));
  return update;
}

// ── Import direction ──────────────────────────────────────────────────────────

/** MAL dates can be partial (`2019`, `2019-04`); the importer's fuzzy date
 *  fills the missing parts with 1, like AniList's own partial dates. */
export function malDateToFuzzy(date: string | null | undefined): { year: number; month?: number; day?: number } | null {
  const match = (date ?? '').match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  if (!year) return null;
  return { year, month: match[2] ? Number(match[2]) : undefined, day: match[3] ? Number(match[3]) : undefined };
}

/** A MAL list row plus the AniList media it was matched to, in the shape
 *  the shared AniList importer merges (lib/anilist/import.ts). MAL has no
 *  notes, so `notes` is left undefined and the merge keeps the local ones. */
export function malListItemToImportItem(item: MalListItem, media: AniListImportMedia): AniListImportMediaItem {
  return {
    mediaId: media.id,
    status: MAL_TO_ANILIST_STATUS[item.status] ?? 'PLANNING',
    score: item.score > 0 ? item.score : null,
    progress: item.progress,
    progressVolumes: item.progress_volumes,
    startedAt: malDateToFuzzy(item.start_date),
    completedAt: malDateToFuzzy(item.finish_date),
    media,
  };
}

/** For a catalog row that already knows its MAL id, the import needs no
 *  AniList round-trip: this is the minimal media stub the merge accepts
 *  (id + type/format drive the external id and library type; a row that
 *  exists never has its catalog entry rebuilt). */
export function importMediaStubForKnownRow(externalId: string, mediaType: string): AniListImportMedia | null {
  const colon = externalId.indexOf(':');
  const id = Number(externalId.slice(colon + 1));
  if (colon === -1 || !Number.isInteger(id) || id <= 0) return null;
  const base = mediaType.split('_')[0];
  const type = base === 'anime' ? 'ANIME' : 'MANGA';
  return {
    id,
    type,
    format: base === 'lnovel' ? 'NOVEL' : undefined,
    title: { romaji: null, english: null, native: null },
    coverImage: null,
    genres: [],
    status: null,
    studios: null,
  };
}
