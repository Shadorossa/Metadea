import { getAllLibraryEntries, getAllCatalogEntries, saveLibraryEntry, saveCatalogEntry } from '../tauri';
import { unifyGenres } from '../media/genre-unifier';
import type { MediaCatalogEntry } from '../tauri';
import { ANIME_FORMAT_SET, MANGA_FORMAT_SET, ANILIST_TO_APP_STATUS } from '../constants/media';

const ANILIST_API = 'https://graphql.anilist.co';

const IMPORT_QUERY = `
query GetMediaList($userId: Int, $type: MediaType, $page: Int) {
  Page(page: $page, perPage: 25) {
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
  Viewer { id name }
}`;

export interface ImportProgress {
  current: number;
  total: number;
  status: 'loading' | 'importing' | 'saving' | 'done' | 'error';
  message?: string;
}

type AniListMediaType = 'ANIME' | 'MANGA';


export async function importFromAniList(
  selectedFormats: string[],
  onProgress?: (progress: ImportProgress) => void
): Promise<{ ok: boolean; error?: string; imported?: number }> {
  const onProg = onProgress || (() => {});
  const formatSet = new Set(selectedFormats);

  const needAnime = selectedFormats.some(f => ANIME_FORMAT_SET.has(f));
  const needManga = selectedFormats.some(f => MANGA_FORMAT_SET.has(f));
  if (!needAnime && !needManga) return { ok: true, imported: 0 };

  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('metadea_anilist_token') : null;
    if (!token) return { ok: false, error: 'No AniList token found' };

    onProg({ current: 0, total: 0, status: 'loading', message: 'Obteniendo usuario...' });

    // Get current user ID
    const userRes = await fetch(ANILIST_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: CURRENT_USER_QUERY }),
    });

    const userData = await userRes.json() as any;

    if (!userRes.ok) {
      const errorMsg = userData?.errors?.[0]?.message || `HTTP ${userRes.status}`;
      return { ok: false, error: errorMsg };
    }

    if (userData?.errors) {
      return { ok: false, error: userData.errors[0]?.message || 'Unknown GraphQL error' };
    }

    const userId = userData?.data?.Viewer?.id;
    if (!userId) return { ok: false, error: 'Could not get user ID' };

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Fetch pages for each needed AniList type
    async function fetchAllPages(anilistType: AniListMediaType): Promise<any[]> {
      const result: any[] = [];
      let page = 1;
      let hasNextPage = true;
      while (hasNextPage) {
        onProg({ current: page - 1, total: page, status: 'loading', message: `Descargando ${anilistType} página ${page}...` });
        const pageRes = await fetch(ANILIST_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ query: IMPORT_QUERY, variables: { userId, type: anilistType, page } }),
        });
        const pageData = await pageRes.json() as any;
        if (!pageRes.ok) throw new Error(pageData?.errors?.[0]?.message || `HTTP ${pageRes.status}`);
        if (pageData?.errors) throw new Error(pageData.errors[0]?.message || 'Unknown GraphQL error');
        result.push(...(pageData?.data?.Page?.mediaList ?? []));
        hasNextPage = pageData?.data?.Page?.pageInfo?.hasNextPage ?? false;
        page++;
        if (hasNextPage) await delay(2000);
      }
      return result;
    }

    const allMediaList: any[] = [];
    if (needAnime) allMediaList.push(...await fetchAllPages('ANIME'));
    if (needManga) allMediaList.push(...await fetchAllPages('MANGA'));

    // Keep only items whose format is in the selected set
    const filteredList = allMediaList.filter(item => {
      const fmt = item.media?.format;
      return fmt && formatSet.has(fmt);
    });

    onProg({ current: 1, total: 1, status: 'importing', message: `Importando ${filteredList.length} items...` });

    // Get existing library and catalog
    const existingLibrary = await getAllLibraryEntries().catch(() => []);
    const catalogEntries = await getAllCatalogEntries().catch(() => []);
    const catalogMap = new Map(catalogEntries.map(e => [e.external_id, e]));

    let imported = 0;

    // Import each media
    for (const mediaItem of filteredList) {
      const anilistId = mediaItem.mediaId;
      const externalId = formatMediaId(mediaItem.media?.type ?? mediaType, mediaItem.media?.format, anilistId);

      // Check if already in library — skip if exists
      const existing = existingLibrary.find(i => i.external_id === externalId);
      if (existing) {
        imported++;
        continue;
      }

      // Build library entry with proper type format
      const entryType = mapMediaType(mediaItem.media?.type ?? mediaType, mediaItem.media?.format);
      const entry = {
        external_id: externalId,
        type: entryType,
        status: ANILIST_TO_APP_STATUS[mediaItem.status] ?? 'planning',
        rating: mediaItem.score && mediaItem.score > 0 ? mediaItem.score : 0,
        progress: mediaItem.progress ?? 0,
        progress_2: mediaItem.progressVolumes ?? 0,
        started_at: formatFuzzyDate(mediaItem.startedAt),
        finished_at: formatFuzzyDate(mediaItem.completedAt),
        notes: mediaItem.notes ?? '',
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isFavorite: false,
        isPlatinum: false,
        tags: [],
        minutes_spent: 0,
      };

      // Save to library
      await saveLibraryEntry(entry).catch(console.error);

      // Save to catalog if not already there
      const catalogEntry = catalogMap.get(externalId);
      if (!catalogEntry) {
        const now = new Date().toISOString();
        const newCatalogEntry = {
          id: externalId,
          external_id: externalId,
          type: entryType,
          format: mediaItem.media?.format ?? null,
          source: mediaItem.media?.source ?? null,
          title_main: mediaItem.media?.title?.romaji ?? mediaItem.media?.title?.english ?? mediaItem.media?.title?.native ?? null,
          title_romaji: mediaItem.media?.title?.romaji ?? null,
          title_native: mediaItem.media?.title?.native ?? null,
          synopsis: null,
          cover_url: mediaItem.media?.coverImage?.large ?? null,
          banners_csv: null,
          release_year: null,
          release_month: null,
          release_day: null,
          status: mediaItem.media?.status ?? null,
          ...(() => {
            const { core, tags } = unifyGenres(mediaItem.media?.genres ?? []);
            return {
              genres_csv:     core.join(',') || null,
              genres_tag_csv: tags.join(',') || null,
            };
          })(),
          score_avg: null,
          score_count: null,
          total_episodes: mediaItem.media?.type === 'ANIME' ? null : null,
          total_chapters: mediaItem.media?.type === 'MANGA' ? null : null,
          total_volumes: null,
          created_at: now,
          updated_at: now,
        };
        await saveCatalogEntry(newCatalogEntry).catch(console.error);
      }

      imported++;

      onProg({
        current: imported,
        total: filteredList.length,
        status: 'importing',
        message: `${imported}/${filteredList.length}...`,
      });
    }

    onProg({ current: filteredList.length, total: filteredList.length, status: 'done' });
    return { ok: true, imported };
  } catch (e: any) {
    onProg({
      current: 0,
      total: 0,
      status: 'error',
      message: e?.message ?? 'Unknown error',
    });
    return { ok: false, error: e?.message ?? 'Import failed' };
  }
}


function mapMediaType(mediaType: string, format?: string): string {
  const baseType = mediaType.toLowerCase();
  if (!format) return baseType;

  const formatNormalized = format.toLowerCase().replace(/\s+/g, '_');
  return `${baseType}_${formatNormalized}`;
}

function formatMediaId(mediaType: string, format: string | undefined, anilistId: number): string {
  // Format: anime_tv_166240, manga_ongoing_12345, novel_lightnovel_5678, etc.
  const baseType = mediaType.toLowerCase() === 'anime' ? 'anime'
    : mediaType.toLowerCase() === 'manga' ? 'manga'
    : 'novel'; // Default to novel for light novels, web novels, etc.

  if (!format) return `${baseType}_${anilistId}`;
  const formatNorm = format.toLowerCase().replace(/\s+/g, '');
  return `${baseType}_${formatNorm}_${anilistId}`;
}

function formatFuzzyDate(fuzzyDate: { year?: number; month?: number; day?: number } | null): string {
  if (!fuzzyDate || !fuzzyDate.year) return '';
  const year = fuzzyDate.year;
  const month = String(fuzzyDate.month ?? 1).padStart(2, '0');
  const day = String(fuzzyDate.day ?? 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
