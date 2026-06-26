import { fetchAniListDetail } from '../search/providers/anilist';
import { fetchOpenLibWork, fetchOpenLibAuthor } from '../search/providers/openlibrary';
import { mapAniListToMedia } from './anilist-mapper';
import { mapOpenLibToMedia } from './openlibrary-mapper';
import { mapIgdbToMedia } from './igdb-mapper';
import { igdbGetGameDetail } from '../tauri';
import type { MediaPageData } from './types';

const ANILIST_TYPES  = ['anime', 'manga', 'novel'];
const IGDB_TYPES     = ['game', 'vnovel'];
const CACHE_PREFIX   = 'media_cache_v2:';
const CACHE_TTL_MS   = 5 * 60 * 1000; // 5 min

// ── Cache (sessionStorage) ────────────────────────────────────────────────

interface CacheEntry { data: MediaPageData; ts: number; }

export function getCachedMediaData(rawId: string): MediaPageData | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${rawId}`);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      sessionStorage.removeItem(`${CACHE_PREFIX}${rawId}`);
      return null;
    }
    return entry.data;
  } catch { return null; }
}

function setCachedMediaData(rawId: string, data: MediaPageData): void {
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${rawId}`, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* sessionStorage lleno */ }
}

// ── Fetch interno ─────────────────────────────────────────────────────────

async function fetchMediaDataInternal(rawId: string): Promise<MediaPageData | null> {
  if (!rawId) return null;

  const firstColon = rawId.indexOf(':');
  const type  = rawId.slice(0, firstColon);
  const idStr = rawId.slice(firstColon + 1);

  if (ANILIST_TYPES.includes(type)) {
    const numericId = parseInt(idStr, 10);
    if (!numericId) return null;
    const raw = await fetchAniListDetail(numericId);
    return raw ? mapAniListToMedia(raw, type) : null;
  }

  if (IGDB_TYPES.includes(type)) {
    const numericId = parseInt(idStr, 10);
    if (!numericId) return null;
    const game = await igdbGetGameDetail(numericId);
    return game ? mapIgdbToMedia(game, rawId) : null;
  }

  if (type === 'book') {
    const cachedNames   = sessionStorage.getItem(`book_authors:${rawId}`);
    const cachedKey     = sessionStorage.getItem(`book_author_key:${rawId}`);
    const preloadNames: string[] | null = cachedNames ? JSON.parse(cachedNames) : null;

    const workPromise   = fetchOpenLibWork(idStr);
    const authorPromise = cachedKey
      ? fetchOpenLibAuthor(cachedKey)
      : workPromise.then(w => {
          const key = w?.authors?.[0]?.author?.key ?? null;
          return key ? fetchOpenLibAuthor(key) : null;
        });

    const [work, authorName] = await Promise.all([workPromise, authorPromise]);
    if (!work) return null;

    const authorNames = preloadNames ?? (authorName ? [authorName] : []);
    return mapOpenLibToMedia(work, authorNames, rawId);
  }

  return null;
}

// ── API pública ───────────────────────────────────────────────────────────

// Comprueba caché primero; si no está, fetcha y guarda
export async function fetchMediaData(rawId: string): Promise<MediaPageData | null> {
  const cached = getCachedMediaData(rawId);
  if (cached) return cached;

  const data = await fetchMediaDataInternal(rawId);
  if (data) setCachedMediaData(rawId, data);
  return data;
}

// Fire-and-forget: llamar en hover para precalentar la caché
export function prefetchMediaData(rawId: string): void {
  if (getCachedMediaData(rawId)) return; // ya está en caché
  fetchMediaData(rawId).catch(() => {}); // silencioso — es prefetch
}
