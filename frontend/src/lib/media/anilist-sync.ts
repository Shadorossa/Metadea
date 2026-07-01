const ANILIST_API = 'https://graphql.anilist.co';

import { ANILIST_TYPES, APP_TO_ANILIST_STATUS } from '../constants/media';
export type AniListSyncType = typeof ANILIST_TYPES[number];

export function isAniListType(type: string): type is AniListSyncType {
  const base = type.split('_')[0];
  return ANILIST_TYPES.includes(base as AniListSyncType);
}

type FuzzyDate = { year: number; month: number; day: number } | null;

function parseFuzzyDate(iso: string | null | undefined): FuzzyDate {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return null;
  return { year: y, month: m || 1, day: d || 1 };
}

function extractAniListId(externalId: string): number | null {
  const parts = externalId.split(':');
  const id = parseInt(parts[1] ?? '', 10);
  return isNaN(id) ? null : id;
}

async function getToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const tauri = (window as any).__TAURI__;
  if (!tauri) return null;
  try {
    if (tauri.core?.invoke) return await tauri.core.invoke('get_anilist_token');
    const { invoke } = await import(/* @vite-ignore */ '@tauri-apps/api/core');
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

async function getAniListEntry(mediaId: number, token: string): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(ANILIST_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: GET_ENTRY_QUERY, variables: { mediaId } }),
    });

    if (!res.ok) return null;
    const json = await res.json() as { data?: { MediaList: any } };
    return json.data?.MediaList ?? null;
  } catch {
    return null;
  }
}

function hasChanges(current: Record<string, any> | null, incoming: Record<string, unknown>): boolean {
  if (!current) return true; // New entry

  // Compare each field
  if (current.status !== (incoming.status ?? null)) return true;
  if (current.score !== (incoming.score ?? 0)) return true;
  if (current.progress !== (incoming.progress ?? 0)) return true;
  if (current.progressVolumes !== (incoming.progressVolumes ?? 0)) return true;
  if (fuzzyDateToString(current.startedAt) !== (incoming.startedAt ? fuzzyDateToString(incoming.startedAt as any) : '')) return true;
  if (fuzzyDateToString(current.completedAt) !== (incoming.completedAt ? fuzzyDateToString(incoming.completedAt as any) : '')) return true;
  if ((current.notes ?? '').trim() !== (incoming.notes ?? '')) return true;

  return false; // No changes
}

export async function syncToAniList(params: AniListSyncParams): Promise<AniListSyncResult> {
  if (!isAniListType(params.type)) return { ok: false, error: 'Type not supported' };

  const token = await getToken();
  if (!token) return { ok: false, error: 'No AniList token' };

  const mediaId = extractAniListId(params.externalId);
  if (!mediaId) return { ok: false, error: 'Invalid AniList ID' };

  const anilistStatus = APP_TO_ANILIST_STATUS[params.status] ?? null;

  const rawVars: Record<string, unknown> = {
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
    const res = await fetch(ANILIST_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: SAVE_MUTATION, variables }),
    });

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const json = await res.json() as { errors?: Array<{ message: string }> };
    if (json.errors?.length) return { ok: false, error: json.errors[0].message };

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Network error' };
  }
}
