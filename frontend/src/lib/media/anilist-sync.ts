import { ANILIST_TYPES, APP_TO_ANILIST_STATUS } from '../constants/media';
import { API_ENDPOINTS } from '../api/endpoints';
import { graphqlPost } from '../api/client';
import { isTauri, invoke } from '../tauri/core';
import { extractNumericId } from './mapper-utils';
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
query GetMediaListEntry($mediaId: Int!) {
  MediaList(mediaId: $mediaId) {
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

async function getAniListEntry(mediaId: number, token: string): Promise<AniListMediaListEntry | null> {
  try {
    const { ok, result } = await graphqlPost<{ MediaList: AniListMediaListEntry }>(
      API_ENDPOINTS.ANILIST, GET_ENTRY_QUERY, { mediaId }, { token },
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

  const mediaId = extractNumericId(params.externalId);
  if (!mediaId) return { ok: false, error: 'Invalid AniList ID' };

  const anilistStatus = APP_TO_ANILIST_STATUS[params.status] ?? null;

  const rawVars: AniListSyncVariables = {
    mediaId,
    status:          anilistStatus,
    score:           params.rating > 0 ? params.rating : null,
    progress:        params.progress > 0 ? params.progress : null,
    progressVolumes: params.progressVolumes > 0 ? params.progressVolumes : null,
    startedAt:       parseFuzzyDate(params.startedAt),
    completedAt:     parseFuzzyDate(params.finishedAt),
    notes:           params.notes.trim() || null,
  };

  // Check current state in AniList
  const currentEntry = await getAniListEntry(mediaId, token);

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
