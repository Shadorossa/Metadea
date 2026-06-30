const ANILIST_API = 'https://graphql.anilist.co';

const ANILIST_TYPES = ['anime', 'manga', 'novel'] as const;
export type AniListSyncType = typeof ANILIST_TYPES[number];

export function isAniListType(type: string): type is AniListSyncType {
  return ANILIST_TYPES.includes(type as AniListSyncType);
}

const STATUS_MAP: Record<string, string | null> = {
  planning:   'PLANNING',
  watching:   'CURRENT',
  reading:    'CURRENT',
  completed:  'COMPLETED',
  paused:     'PAUSED',
  dropped:    'DROPPED',
  '':         null,
};

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
  ok:     boolean;
  error?: string;
}

export async function syncToAniList(params: AniListSyncParams): Promise<AniListSyncResult> {
  if (!isAniListType(params.type)) return { ok: false, error: 'Type not supported' };

  const token = await getToken();
  if (!token) return { ok: false, error: 'No AniList token' };

  const mediaId = extractAniListId(params.externalId);
  if (!mediaId) return { ok: false, error: 'Invalid AniList ID' };

  const anilistStatus = STATUS_MAP[params.status] ?? null;

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
