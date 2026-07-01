import { getAllLibraryEntries, getAllCatalogEntries, saveLibraryEntry, saveCatalogEntry } from '../tauri';
import type { LibraryEntry } from '../tauri';
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

// ── Shared helpers ────────────────────────────────────────────────────────────

function getToken(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('metadea_anilist_token') : null;
}

async function fetchCurrentUserId(token: string): Promise<number | null> {
  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ query: CURRENT_USER_QUERY }),
  });
  const data = await res.json() as any;
  if (!res.ok || data?.errors) return null;
  return data?.data?.Viewer?.id ?? null;
}

async function fetchAllPages(
  token: string,
  userId: number,
  anilistType: AniListMediaType,
  onProg: (p: ImportProgress) => void
): Promise<any[]> {
  const result: any[] = [];
  let page = 1;
  let hasNextPage = true;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
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

async function fetchAniListItems(
  selectedFormats: string[],
  onProg: (p: ImportProgress) => void
): Promise<{ token: string; filteredList: any[] } | { ok: false; error: string }> {
  const token = getToken();
  if (!token) return { ok: false, error: 'No AniList token found' };

  onProg({ current: 0, total: 0, status: 'loading', message: 'Obteniendo usuario...' });
  const userId = await fetchCurrentUserId(token);
  if (!userId) return { ok: false, error: 'Could not get user ID' };

  const formatSet = new Set(selectedFormats);
  const needAnime = selectedFormats.some(f => ANIME_FORMAT_SET.has(f));
  const needManga = selectedFormats.some(f => MANGA_FORMAT_SET.has(f));

  const allItems: any[] = [];
  if (needAnime) allItems.push(...await fetchAllPages(token, userId, 'ANIME', onProg));
  if (needManga) allItems.push(...await fetchAllPages(token, userId, 'MANGA', onProg));

  const filteredList = allItems.filter(item => {
    const fmt = item.media?.format;
    return fmt && formatSet.has(fmt);
  });

  return { token, filteredList };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function importFromAniList(
  selectedFormats: string[],
  onProgress?: (progress: ImportProgress) => void
): Promise<{ ok: boolean; error?: string; imported?: number }> {
  const onProg = onProgress || (() => {});
  if (!selectedFormats.some(f => ANIME_FORMAT_SET.has(f)) && !selectedFormats.some(f => MANGA_FORMAT_SET.has(f))) {
    return { ok: true, imported: 0 };
  }

  try {
    const fetched = await fetchAniListItems(selectedFormats, onProg);
    if ('ok' in fetched) return fetched;
    const { filteredList } = fetched;

    onProg({ current: 1, total: 1, status: 'importing', message: `Importando ${filteredList.length} items...` });

    const existingLibrary = await getAllLibraryEntries().catch(() => [] as any[]);
    const existingMap = new Map(existingLibrary.map((e: any) => [e.external_id, e]));
    const catalogEntries = await getAllCatalogEntries().catch(() => [] as any[]);
    const catalogMap = new Map(catalogEntries.map((e: any) => [e.external_id, e]));

    let imported = 0;

    for (const mediaItem of filteredList) {
      const externalId = formatMediaId(mediaItem.media?.type ?? 'ANIME', mediaItem.media?.format, mediaItem.mediaId);

      if (existingMap.has(externalId)) {
        imported++;
        continue;
      }

      const entryType = mapMediaType(mediaItem.media?.type ?? 'ANIME', mediaItem.media?.format);
      const entry = {
        external_id: externalId,
        type: entryType,
        status: ANILIST_TO_APP_STATUS[mediaItem.status] ?? 'planning',
        rating: mediaItem.score && mediaItem.score > 0 ? mediaItem.score : null,
        progress: mediaItem.progress ?? 0,
        progress_2: mediaItem.progressVolumes ?? 0,
        started_at: formatFuzzyDate(mediaItem.startedAt) || null,
        finished_at: formatFuzzyDate(mediaItem.completedAt) || null,
        notes: mediaItem.notes ?? null,
        added_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_favorite: 0,
        is_platinum: 0,
        tags: [],
        minutes_spent: 0,
      };

      await saveLibraryEntry(entry as any).catch(console.error);

      if (!catalogMap.has(externalId)) {
        await saveCatalogEntry(buildCatalogEntry(externalId, entryType, mediaItem)).catch(console.error);
      }

      imported++;
      onProg({ current: imported, total: filteredList.length, status: 'importing', message: `${imported}/${filteredList.length}...` });
    }

    onProg({ current: filteredList.length, total: filteredList.length, status: 'done' });
    return { ok: true, imported };
  } catch (e: any) {
    onProg({ current: 0, total: 0, status: 'error', message: e?.message ?? 'Unknown error' });
    return { ok: false, error: e?.message ?? 'Import failed' };
  }
}

export async function syncFromAniList(
  selectedFormats: string[],
  onProgress?: (progress: ImportProgress) => void
): Promise<{ ok: boolean; error?: string; updated?: number; added?: number }> {
  const onProg = onProgress || (() => {});
  if (!selectedFormats.some(f => ANIME_FORMAT_SET.has(f)) && !selectedFormats.some(f => MANGA_FORMAT_SET.has(f))) {
    return { ok: true, updated: 0, added: 0 };
  }

  try {
    const fetched = await fetchAniListItems(selectedFormats, onProg);
    if ('ok' in fetched) return fetched;
    const { filteredList } = fetched;

    onProg({ current: 0, total: filteredList.length, status: 'importing', message: `Sincronizando ${filteredList.length} items...` });

    const existingLibrary = await getAllLibraryEntries().catch(() => [] as LibraryEntry[]);
    const existingMap = new Map(existingLibrary.map(e => [e.external_id, e]));
    const catalogEntries = await getAllCatalogEntries().catch(() => [] as any[]);
    const catalogMap = new Map(catalogEntries.map((e: any) => [e.external_id, e]));

    let updated = 0;
    let added = 0;
    let done = 0;

    for (const mediaItem of filteredList) {
      const mediaType = mediaItem.media?.type ?? 'ANIME';
      const format = mediaItem.media?.format;
      const anilistId = mediaItem.mediaId;

      // Try both ID formats: import format (e.g. anime_tv_123) and mapper format (e.g. anime:123)
      const importId = formatMediaId(mediaType, format, anilistId);
      const baseType = anilistBaseType(mediaType, format);
      const mapperId = `${baseType}:${anilistId}`;
      const existing = existingMap.get(importId) ?? existingMap.get(mapperId);

      const newStatus = ANILIST_TO_APP_STATUS[mediaItem.status] ?? 'planning';
      const newRating = mediaItem.score && mediaItem.score > 0 ? (mediaItem.score as number) : null;
      const newProgress = mediaItem.progress ?? 0;
      const newProgress2 = mediaItem.progressVolumes ?? 0;
      const newStartedAt = formatFuzzyDate(mediaItem.startedAt) || null;
      const newFinishedAt = formatFuzzyDate(mediaItem.completedAt) || null;
      const newNotes = mediaItem.notes ?? null;

      if (existing) {
        const changed =
          existing.status !== newStatus ||
          (existing.rating ?? null) !== newRating ||
          existing.progress !== newProgress ||
          existing.progress_2 !== newProgress2 ||
          (existing.started_at ?? null) !== newStartedAt ||
          (existing.finished_at ?? null) !== newFinishedAt ||
          (existing.notes ?? null) !== newNotes;

        if (changed) {
          await saveLibraryEntry({
            ...existing,
            status: newStatus,
            rating: newRating,
            progress: newProgress,
            progress_2: newProgress2,
            started_at: newStartedAt,
            finished_at: newFinishedAt,
            notes: newNotes,
          }).catch(console.error);
          updated++;
        }
      } else {
        const entryType = mapMediaType(mediaType, format);
        const entry = {
          external_id: importId,
          type: entryType,
          status: newStatus,
          rating: newRating,
          progress: newProgress,
          progress_2: newProgress2,
          started_at: newStartedAt,
          finished_at: newFinishedAt,
          notes: newNotes,
          added_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_favorite: 0,
          is_platinum: 0,
          tags: [],
          minutes_spent: 0,
        };
        await saveLibraryEntry(entry as any).catch(console.error);
        if (!catalogMap.has(importId)) {
          await saveCatalogEntry(buildCatalogEntry(importId, entryType, mediaItem)).catch(console.error);
        }
        added++;
      }

      done++;
      onProg({ current: done, total: filteredList.length, status: 'importing', message: `${done}/${filteredList.length}...` });
    }

    onProg({ current: filteredList.length, total: filteredList.length, status: 'done' });
    return { ok: true, updated, added };
  } catch (e: any) {
    onProg({ current: 0, total: 0, status: 'error', message: e?.message ?? 'Unknown error' });
    return { ok: false, error: e?.message ?? 'Sync failed' };
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function anilistBaseType(mediaType: string, format?: string): string {
  if (mediaType.toUpperCase() === 'ANIME') return 'anime';
  if (format?.toUpperCase() === 'NOVEL') return 'lnovel';
  return 'manga';
}

function mapMediaType(mediaType: string, format?: string): string {
  return anilistBaseType(mediaType, format);
}

function formatMediaId(mediaType: string, format: string | undefined, anilistId: number): string {
  const baseType = anilistBaseType(mediaType, format);
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

function buildCatalogEntry(externalId: string, entryType: string, mediaItem: any): any {
  const now = new Date().toISOString();
  const { core, tags } = unifyGenres(mediaItem.media?.genres ?? []);
  return {
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
    genres_csv: core.join(',') || null,
    genres_tag_csv: tags.join(',') || null,
    score_avg: null,
    score_count: null,
    total_episodes: null,
    total_chapters: null,
    total_volumes: null,
    created_at: now,
    updated_at: now,
  };
}
