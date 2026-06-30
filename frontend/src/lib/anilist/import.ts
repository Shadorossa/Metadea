import { getAllLibraryEntries, getAllCatalogEntries, saveLibraryEntry, invoke } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';

const ANILIST_API = 'https://graphql.anilist.co';

const IMPORT_QUERY = `
query GetMediaList($userId: Int, $type: MediaType, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage currentPage }
    mediaList(userId: $userId, type: $type) {
      mediaId
      status
      score
      progress
      progressVolumes
      startedAt { year month day }
      completedAt { year month day }
      notes
      media {
        id
        type
        format
        title { romaji english native }
        coverImage { large }
        genres
        source
        status
      }
    }
  }
}`;

const CURRENT_USER_QUERY = `
query {
  Viewer { id username }
}`;

export interface ImportProgress {
  current: number;
  total: number;
  status: 'loading' | 'importing' | 'saving' | 'done' | 'error';
  message?: string;
}

type MediaType = 'ANIME' | 'MANGA';

export async function importFromAniList(
  mediaType: 'anime' | 'manga',
  onProgress: (progress: ImportProgress) => void
): Promise<{ ok: boolean; error?: string; imported?: number }> {
  try {
    const token = await invoke<string | null>('get_anilist_token').catch(() => null);
    if (!token) return { ok: false, error: 'No AniList token found' };

    onProgress({ current: 0, total: 0, status: 'loading', message: 'Obteniendo usuario...' });

    // Get current user ID
    const userRes = await fetch(ANILIST_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: CURRENT_USER_QUERY }),
    });

    if (!userRes.ok) return { ok: false, error: 'Failed to get user info' };

    const userData = await userRes.json() as { data?: { Viewer?: { id: number; username: string } } };
    const userId = userData.data?.Viewer?.id;
    if (!userId) return { ok: false, error: 'Could not get user ID' };

    const anilistMediaType: MediaType = mediaType === 'anime' ? 'ANIME' : 'MANGA';
    const allMediaList: any[] = [];
    let page = 1;
    let hasNextPage = true;

    // Fetch all pages
    while (hasNextPage) {
      onProgress({ current: page - 1, total: page, status: 'loading', message: `Descargando página ${page}...` });

      const pageRes = await fetch(ANILIST_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: IMPORT_QUERY,
          variables: { userId, type: anilistMediaType, page },
        }),
      });

      if (!pageRes.ok) return { ok: false, error: `HTTP ${pageRes.status} on page ${page}` };

      const pageData = await pageRes.json() as { data?: { Page?: { pageInfo?: { hasNextPage: boolean }; mediaList?: any[] } } };
      const pageInfo = pageData.data?.Page?.pageInfo;
      const mediaList = pageData.data?.Page?.mediaList ?? [];

      allMediaList.push(...mediaList);
      hasNextPage = pageInfo?.hasNextPage ?? false;
      page++;
    }

    onProgress({ current: 1, total: 1, status: 'importing', message: `Importando ${allMediaList.length} items...` });

    // Get existing library and catalog
    const existingLibrary = await getAllLibraryEntries().catch(() => []);
    const catalogEntries = await getAllCatalogEntries().catch(() => []);
    const catalogMap = new Map(catalogEntries.map(e => [e.external_id, e]));

    let imported = 0;

    // Import each media
    for (const mediaItem of allMediaList) {
      const anilistId = mediaItem.mediaId;
      const externalId = `anilist:${anilistId}`;

      // Check if already in library
      const existing = existingLibrary.find(i => i.external_id === externalId);

      // Build library entry
      const entry = {
        external_id: externalId,
        type: mediaItem.media?.type?.toLowerCase() ?? mediaType,
        status: mapAniListStatus(mediaItem.status),
        rating: mediaItem.score && mediaItem.score > 0 ? (mediaItem.score / 10) * 10 : 0,
        progress: mediaItem.progress ?? 0,
        progressCount2: mediaItem.progressVolumes ?? 0,
        started_at: formatFuzzyDate(mediaItem.startedAt),
        finished_at: formatFuzzyDate(mediaItem.completedAt),
        notes: mediaItem.notes ?? '',
        added_at: existing?.added_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isFavorite: existing?.isFavorite ?? false,
        isPlatinum: existing?.isPlatinum ?? false,
        tags: existing?.tags ?? [],
        minutes_spent: existing?.minutes_spent ?? 0,
      };

      await saveLibraryEntry(externalId, entry).catch(console.error);
      imported++;

      onProgress({
        current: imported,
        total: allMediaList.length,
        status: 'importing',
        message: `${imported}/${allMediaList.length}...`,
      });
    }

    onProgress({ current: allMediaList.length, total: allMediaList.length, status: 'done' });
    return { ok: true, imported };
  } catch (e: any) {
    onProgress({
      current: 0,
      total: 0,
      status: 'error',
      message: e?.message ?? 'Unknown error',
    });
    return { ok: false, error: e?.message ?? 'Import failed' };
  }
}

function mapAniListStatus(anilistStatus: string): string {
  const map: Record<string, string> = {
    CURRENT: 'watching',
    PLANNING: 'planning',
    COMPLETED: 'completed',
    PAUSED: 'paused',
    DROPPED: 'dropped',
  };
  return map[anilistStatus] ?? 'planning';
}

function formatFuzzyDate(fuzzyDate: { year?: number; month?: number; day?: number } | null): string {
  if (!fuzzyDate || !fuzzyDate.year) return '';
  const year = fuzzyDate.year;
  const month = String(fuzzyDate.month ?? 1).padStart(2, '0');
  const day = String(fuzzyDate.day ?? 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
