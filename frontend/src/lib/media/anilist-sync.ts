import { ANILIST_TYPES, APP_TO_ANILIST_STATUS, ANILIST_TO_APP_STATUS } from '../constants/media';
import { API_ENDPOINTS } from '../api/endpoints';
import { graphqlPost } from '../api/client';
import { isTauri, invoke } from '../tauri/core';
import { parseExternalId } from './mapper-utils';
export type AniListSyncType = typeof ANILIST_TYPES[number];

export function isAniListType(type: string): type is AniListSyncType {
  const base = type.split('_')[0];
  return ANILIST_TYPES.includes(base as AniListSyncType);
}

type FuzzyDate = { year: number; month: number; day: number } | null;

// Matches GET_ENTRY_QUERY's selection set below.
interface AniListMediaListEntry {
  id: number;
  status: string | null;
  score: number | null;
  progress: number | null;
  progressVolumes: number | null;
  startedAt: FuzzyDate;
  completedAt: FuzzyDate;
  notes: string | null;
}

// Variables sent to SAVE_MUTATION — mirrors AniListMediaListEntry minus `id`,
// plus `mediaId` (the mutation's own required argument).
interface AniListSyncVariables {
  mediaId: number;
  status: string | null;
  score: number | null;
  progress: number | null;
  progressVolumes: number | null;
  startedAt: FuzzyDate;
  completedAt: FuzzyDate;
  notes: string | null;
}

function parseFuzzyDate(iso: string | null | undefined): FuzzyDate {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return null;
  return { year: y, month: m || 1, day: d || 1 };
}

async function getToken(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>('get_anilist_token');
  } catch {
    return null;
  }
}

const GET_ENTRY_QUERY = `
query GetMediaListEntry($mediaId: Int!, $userId: Int!) {
  MediaList(mediaId: $mediaId, userId: $userId) {
    id
    status
    score
    progress
    progressVolumes
    startedAt { year month day }
    completedAt { year month day }
    notes
  }
}`;

const VIEWER_QUERY = `query { Viewer { id mediaListOptions { scoreFormat } } }`;

type AniListScoreFormat = 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5' | 'POINT_3';

interface AniListViewer {
  id: number;
  scoreFormat: AniListScoreFormat;
}

// MediaList(mediaId: ...) without a userId scopes to nothing in particular —
// it isn't implicitly "my entry for this media" just because the request is
// authenticated, so a previous version of this query could resolve to some
// other list entry entirely (reported as "3-gatsu no Lion 2nd Season" pulling
// in unrelated data). The viewer (id + scoreFormat) is cached per token since
// neither changes mid-session and every AniList call here already needs both.
let cachedViewer: { token: string; viewer: AniListViewer } | null = null;

async function getViewer(token: string): Promise<AniListViewer | null> {
  if (cachedViewer?.token === token) return cachedViewer.viewer;
  const { ok, result } = await graphqlPost<{ Viewer: { id: number; mediaListOptions: { scoreFormat: AniListScoreFormat } } }>(
    API_ENDPOINTS.ANILIST, VIEWER_QUERY, undefined, { token },
  );
  const raw = ok ? result?.data?.Viewer : null;
  if (!raw) return null;
  const viewer: AniListViewer = { id: raw.id, scoreFormat: raw.mediaListOptions?.scoreFormat ?? 'POINT_10' };
  cachedViewer = { token, viewer };
  return viewer;
}

// AniList stores the score in whatever format the user picked in their list
// settings (100-point, 10-point, 5-star, 3-point smiley...) — Metadea always
// works in a flat 0-10 scale internally, so a raw AniList score needs
// converting both ways instead of being copied as-is. Previously a straight
// copy meant e.g. "4 stars" (AniList 5-star format, score=4) was read as a
// 0-10 rating of 4 (= 2 stars in Metadea's own 5-star display) instead of 8.
function anilistScoreToAppRating(score: number | null, format: AniListScoreFormat): number {
  if (!score) return 0;
  switch (format) {
    case 'POINT_100':       return score / 10;
    case 'POINT_5':         return score * 2;
    case 'POINT_3':         return score <= 1 ? 2 : score >= 3 ? 9 : 5.5;
    case 'POINT_10_DECIMAL':
    case 'POINT_10':
    default:                return score;
  }
}

function appRatingToAniListScore(rating: number, format: AniListScoreFormat): number | null {
  if (!rating) return null;
  switch (format) {
    case 'POINT_100':       return Math.round(rating * 10);
    case 'POINT_5':         return Math.round((rating / 2) * 2) / 2; // nearest half-star
    case 'POINT_3':         return rating <= 3.5 ? 1 : rating > 7 ? 3 : 2;
    case 'POINT_10_DECIMAL': return Math.round(rating * 10) / 10;
    case 'POINT_10':
    default:                return Math.round(rating);
  }
}

const SAVE_MUTATION = `
mutation SaveMediaListEntry(
  $mediaId: Int!
  $status: MediaListStatus
  $score: Float
  $progress: Int
  $progressVolumes: Int
  $startedAt: FuzzyDateInput
  $completedAt: FuzzyDateInput
  $notes: String
) {
  SaveMediaListEntry(
    mediaId: $mediaId
    status: $status
    score: $score
    progress: $progress
    progressVolumes: $progressVolumes
    startedAt: $startedAt
    completedAt: $completedAt
    notes: $notes
  ) {
    id
    mediaId
    status
    score
    progress
    progressVolumes
  }
}`;

export interface AniListSyncParams {
  externalId:      string;
  type:            string;
  status:          string;
  rating:          number;
  progress:        number;
  progressVolumes: number;
  startedAt:       string;
  finishedAt:      string;
  notes:           string;
}

export interface AniListSyncResult {
  ok:      boolean;
  error?:  string;
  skipped?: boolean; // true if no changes found, sync was not needed
}

function fuzzyDateToString(fd: { year: number; month: number; day: number } | null): string {
  if (!fd) return '';
  return `${fd.year}-${String(fd.month).padStart(2, '0')}-${String(fd.day).padStart(2, '0')}`;
}

async function getAniListEntry(mediaId: number, token: string, viewer: AniListViewer): Promise<AniListMediaListEntry | null> {
  try {
    const { ok, result } = await graphqlPost<{ MediaList: AniListMediaListEntry }>(
      API_ENDPOINTS.ANILIST, GET_ENTRY_QUERY, { mediaId, userId: viewer.id }, { token },
    );
    if (!ok) return null;
    return result?.data?.MediaList ?? null;
  } catch {
    return null;
  }
}

function hasChanges(current: AniListMediaListEntry | null, incoming: AniListSyncVariables): boolean {
  if (!current) return true; // New entry

  // Compare each field
  if (current.status !== (incoming.status ?? null)) return true;
  if (current.score !== (incoming.score ?? 0)) return true;
  if (current.progress !== (incoming.progress ?? 0)) return true;
  if (current.progressVolumes !== (incoming.progressVolumes ?? 0)) return true;
  if (fuzzyDateToString(current.startedAt) !== fuzzyDateToString(incoming.startedAt)) return true;
  if (fuzzyDateToString(current.completedAt) !== fuzzyDateToString(incoming.completedAt)) return true;
  if ((current.notes ?? '').trim() !== (incoming.notes ?? '')) return true;

  return false; // No changes
}

export async function syncToAniList(params: AniListSyncParams): Promise<AniListSyncResult> {
  if (!isAniListType(params.type)) return { ok: false, error: 'Type not supported' };

  const token = await getToken();
  if (!token) return { ok: false, error: 'No AniList token' };

  const mediaId = parseExternalId(params.externalId).id;
  if (!mediaId) return { ok: false, error: 'Invalid AniList ID' };

  const viewer = await getViewer(token);
  if (!viewer) return { ok: false, error: 'Could not resolve AniList viewer' };

  const anilistStatus = APP_TO_ANILIST_STATUS[params.status] ?? null;

  const rawVars: AniListSyncVariables = {
    mediaId,
    status:          anilistStatus,
    score:           appRatingToAniListScore(params.rating, viewer.scoreFormat),
    progress:        params.progress > 0 ? params.progress : null,
    progressVolumes: params.progressVolumes > 0 ? params.progressVolumes : null,
    startedAt:       parseFuzzyDate(params.startedAt),
    completedAt:     parseFuzzyDate(params.finishedAt),
    notes:           params.notes.trim() || null,
  };

  // Check current state in AniList
  const currentEntry = await getAniListEntry(mediaId, token, viewer);

  // If no changes, skip sync (but return ok to avoid error feedback)
  if (!hasChanges(currentEntry, rawVars)) {
    return { ok: true, skipped: true };
  }

  // Strip nulls — AniList rejects null for enum/Int fields declared as optional
  const variables = Object.fromEntries(
    Object.entries(rawVars).filter(([, v]) => v !== null && v !== undefined)
  );

  try {
    const { ok, status, result } = await graphqlPost(API_ENDPOINTS.ANILIST, SAVE_MUTATION, variables, { token });

    if (!ok) return { ok: false, error: `HTTP ${status}` };
    if (result?.errors?.length) return { ok: false, error: result.errors[0].message };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

interface AniListFetchedLog {
  status:          string;
  rating:          number;
  progress:        number;
  progressVolumes: number;
  startedAt:       string;
  finishedAt:      string;
  notes:           string;
}

export interface AniListFetchResult {
  ok:     boolean;
  error?: string;
  data?:  AniListFetchedLog;
}

// Pull side of the sync — lets the editor pre-fill a log from whatever the
// user already has tracked for this exact media on their AniList profile,
// for the (common) case where they logged progress there before this app
// knew about the entry.
export async function fetchAniListLogData(externalId: string, type: string): Promise<AniListFetchResult> {
  if (!isAniListType(type)) return { ok: false, error: 'Type not supported' };

  const token = await getToken();
  if (!token) return { ok: false, error: 'No AniList token' };

  const mediaId = parseExternalId(externalId).id;
  if (!mediaId) return { ok: false, error: 'Invalid AniList ID' };

  const viewer = await getViewer(token);
  if (!viewer) return { ok: false, error: 'Could not resolve AniList viewer' };

  const entry = await getAniListEntry(mediaId, token, viewer);
  if (!entry) return { ok: false, error: 'Not found on your AniList list' };

  return {
    ok: true,
    data: {
      status:          ANILIST_TO_APP_STATUS[entry.status ?? ''] ?? '',
      rating:          anilistScoreToAppRating(entry.score, viewer.scoreFormat),
      progress:        entry.progress ?? 0,
      progressVolumes: entry.progressVolumes ?? 0,
      startedAt:       fuzzyDateToString(entry.startedAt),
      finishedAt:      fuzzyDateToString(entry.completedAt),
      notes:           entry.notes ?? '',
    },
  };
}
