import { getAllLibraryEntries, getAllCatalogEntries, saveLibraryEntry, saveCatalogEntry, getAniListToken } from '../tauri';
import type { LibraryEntry } from '../tauri';
import { unifyGenres } from '../media/genre-unifier';
import type { MediaCatalogEntry } from '../tauri';
import { saveMediaCompanies } from '../tauri/companies';
import { ANIME_FORMAT_SET, MANGA_FORMAT_SET, ANILIST_TO_APP_STATUS } from '../constants/media';
import { API_ENDPOINTS } from '../api/endpoints';
import { graphqlPost } from '../api/client';

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
        studios { edges { isMain node { id name } } }
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

interface AniListFuzzyDate {
  year?: number;
  month?: number;
  day?: number;
}

interface AniListImportMediaItem {
  mediaId: number;
  status: string;
  score: number | null;
  progress: number | null;
  progressVolumes: number | null;
  startedAt: AniListFuzzyDate | null;
  completedAt: AniListFuzzyDate | null;
  notes: string | null;
  media: {
    id: number;
    type: string;
    format?: string;
    title: { romaji: string | null; english: string | null; native: string | null };
    coverImage: { large: string | null } | null;
    genres: string[];
    source: string | null;
    status: string | null;
    studios: { edges: { isMain: boolean; node: { id: number; name: string } }[] } | null;
  };
}

interface AniListImportPage {
  Page: {
    pageInfo: { hasNextPage: boolean; currentPage: number };
    mediaList: AniListImportMediaItem[];
  };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function fetchCurrentUserId(token: string): Promise<number | null> {
  const { ok, result } = await graphqlPost<{ Viewer: { id: number } }>(
    API_ENDPOINTS.ANILIST, CURRENT_USER_QUERY, undefined, { token },
  );
  if (!ok || result?.errors) return null;
  return result?.data?.Viewer?.id ?? null;
}

async function fetchAllPages(
  token: string,
  userId: number,
  anilistType: AniListMediaType,
  onProg: (p: ImportProgress) => void
): Promise<AniListImportMediaItem[]> {
  const result: AniListImportMediaItem[] = [];
  let page = 1;
  let hasNextPage = true;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  while (hasNextPage) {
    onProg({ current: page - 1, total: page, status: 'loading', message: `Descargando ${anilistType} página ${page}...` });
    const { ok, status, result: pageResult } = await graphqlPost<AniListImportPage>(
      API_ENDPOINTS.ANILIST, IMPORT_QUERY, { userId, type: anilistType, page }, { token },
    );
    if (!ok) throw new Error(pageResult?.errors?.[0]?.message || `HTTP ${status}`);
    if (pageResult?.errors) throw new Error(pageResult.errors[0]?.message || 'Unknown GraphQL error');
    result.push(...(pageResult?.data?.Page?.mediaList ?? []));
    hasNextPage = pageResult?.data?.Page?.pageInfo?.hasNextPage ?? false;
    page++;
    if (hasNextPage) await delay(2000);
  }
  return result;
}

async function fetchAniListItems(
  selectedFormats: string[],
  onProg: (p: ImportProgress) => void
): Promise<{ token: string; filteredList: AniListImportMediaItem[] } | { ok: false; error: string }> {
  const token = getAniListToken();
  if (!token) return { ok: false, error: 'No AniList token found' };

  onProg({ current: 0, total: 0, status: 'loading', message: 'Obteniendo usuario...' });
  const userId = await fetchCurrentUserId(token);
  if (!userId) return { ok: false, error: 'Could not get user ID' };

  const formatSet = new Set(selectedFormats);
  const needAnime = selectedFormats.some(f => ANIME_FORMAT_SET.has(f));
  const needManga = selectedFormats.some(f => MANGA_FORMAT_SET.has(f));

  const allItems: AniListImportMediaItem[] = [];
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

    const existingLibrary = await getAllLibraryEntries().catch(() => [] as LibraryEntry[]);
    const existingMap = new Map(existingLibrary.map(e => [e.external_id, e]));
    const catalogEntries = await getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]);
    const catalogMap = new Map(catalogEntries.map(e => [e.external_id, e]));

    let imported = 0;

    for (const mediaItem of filteredList) {
      const externalId = formatMediaId(mediaItem.media?.type ?? 'ANIME', mediaItem.media?.format, mediaItem.mediaId);

      if (existingMap.has(externalId)) {
        imported++;
        continue;
      }

      const entryType = mapMediaType(mediaItem.media?.type ?? 'ANIME', mediaItem.media?.format);
      const entry: LibraryEntry = {
        id: '',
        user_id: 'local',
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
        selected_platform: null,
        selected_version: null,
      };

      await saveLibraryEntry(entry).catch(console.error);

      if (!catalogMap.has(externalId)) {
        await saveCatalogEntry(buildCatalogEntry(externalId, entryType, mediaItem)).catch(console.error);
        await saveAniListStudios(externalId, entryType, mediaItem);
      }

      imported++;
      onProg({ current: imported, total: filteredList.length, status: 'importing', message: `${imported}/${filteredList.length}...` });
    }

    onProg({ current: filteredList.length, total: filteredList.length, status: 'done' });
    return { ok: true, imported };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    onProg({ current: 0, total: 0, status: 'error', message });
    return { ok: false, error: message };
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
    const catalogEntries = await getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]);
    const catalogMap = new Map(catalogEntries.map(e => [e.external_id, e]));

    let updated = 0;
    let added = 0;
    let done = 0;

    for (const mediaItem of filteredList) {
      const mediaType = mediaItem.media?.type ?? 'ANIME';
      const format = mediaItem.media?.format;
      const anilistId = mediaItem.mediaId;

      const importId = formatMediaId(mediaType, format, anilistId);
      const existing = existingMap.get(importId);

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
        const entry: LibraryEntry = {
          id: '',
          user_id: 'local',
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
          selected_platform: null,
          selected_version: null,
        };
        await saveLibraryEntry(entry).catch(console.error);
        if (!catalogMap.has(importId)) {
          await saveCatalogEntry(buildCatalogEntry(importId, entryType, mediaItem)).catch(console.error);
          await saveAniListStudios(importId, entryType, mediaItem);
        }
        added++;
      }

      done++;
      onProg({ current: done, total: filteredList.length, status: 'importing', message: `${done}/${filteredList.length}...` });
    }

    onProg({ current: filteredList.length, total: filteredList.length, status: 'done' });
    return { ok: true, updated, added };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    onProg({ current: 0, total: 0, status: 'error', message });
    return { ok: false, error: message };
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

// Must match the "type:id" scheme every other path in the app uses
// (search results, mediaService.ts, anilist-mapper.ts's own live-fetch
// ids, ...) — this used to build "anime_tv_123"-style ids instead, so a
// title imported here and the same title opened via search/browsing
// never matched: two separate catalog/library rows for the same work, and
// the underscore id had no ':' for parseExternalId to split on, so its
// numeric id parsed as NaN and the media page could never live-fetch it.
function formatMediaId(mediaType: string, format: string | undefined, anilistId: number): string {
  const baseType = anilistBaseType(mediaType, format);
  return `${baseType}:${anilistId}`;
}

function formatFuzzyDate(fuzzyDate: { year?: number; month?: number; day?: number } | null): string {
  if (!fuzzyDate || !fuzzyDate.year) return '';
  const year = fuzzyDate.year;
  // AniList uses 0 (not just null/undefined) to mean "unset" for month/day on a
  // partially-known date, so `?? 1` alone lets a 0 slip through as a literal "00".
  const month = String(fuzzyDate.month || 1).padStart(2, '0');
  const day = String(fuzzyDate.day || 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildCatalogEntry(externalId: string, entryType: string, mediaItem: AniListImportMediaItem): MediaCatalogEntry {
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
    created_at: now,
    updated_at: now,
  };
}

// Anime studios go into the same companies/media_by_company tables as
// IGDB's developer/publisher — namespaced under "anilist:" since AniList's
// studio ids and IGDB's company ids are independent numbering spaces that
// would otherwise collide in the shared companies table. Same isMain split
// as anilist-mapper.ts: the main animation studio is 'developer', every
// other credited company ("Producers" on AniList's own site) is 'publisher'.
async function saveAniListStudios(externalId: string, entryType: string, mediaItem: AniListImportMediaItem): Promise<void> {
  if (entryType !== 'anime') return;
  const edges = mediaItem.media?.studios?.edges ?? [];
  if (!edges.length) return;
  await saveMediaCompanies(externalId, edges.map(e => ({
    external_id: `company:anilist:${e.node.id}`,
    name: e.node.name,
    logo_url: null,
    role: e.isMain ? 'developer' : 'publisher',
  }))).catch(console.error);
}
