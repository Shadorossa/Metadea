import { fetchAniListDetail } from '../search/providers/anilist';
import { fetchOpenLibWork, fetchOpenLibAuthor, fetchOpenLibEditions, openLibCoverUrl, bookIdFromWorkKey } from '../search/providers/openlibrary';
import type { OpenLibEdition } from '../search/providers/openlibrary';
import { fetchTmdbDetail } from '../search/providers/tmdb';
import { mapAniListToMedia } from './anilist-mapper';
import { mapOpenLibToMedia } from './openlibrary-mapper';
import { mapTmdbToMedia } from './tmdb-mapper';
import { mapIgdbToMedia, mergeBaseGameRelation, mergeRelationGraph, dedupeRelationsByTarget, IGDB_GAME_TYPE_REMAKE, IGDB_GAME_TYPE_REMASTER, type IgdbSubGame, type RelationGraphNode } from './igdb-mapper';
import { igdbGetGameDetail, igdbGetBaseGames, igdbGetRelationGraph, getCatalogEntry, saveCatalogEntry } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData, MediaAuthor, MediaCharacter, MediaStat } from './types';
import { getMediaRelations, getMediaAuthors, saveMediaRelations, saveMediaAuthors, type DbMediaRelation, type DbMediaAuthor } from '../tauri/catalog';
import { getMediaCharacters, type DbMediaCharacter } from '../tauri/characters';
import { formatDateParts, parseExternalId } from './mapper-utils';
import { getT } from '../../i18n/client';

import { ANILIST_TYPES, IGDB_TYPES, IN_PROGRESS_STATUSES } from '../constants/media';
import { normalizeLegacyRelationType } from './sagaTypes';

// Fuente / Precuela / Secuela / Historia paralela, everything else after —
// shared by every place that turns saved DB relations back into the page's
// Related section (first full fetch, catalog-first partial render).
const RELATION_SORT_PRIORITY: Record<string, number> = {
  SOURCE: 1, PARENT: 1, PREQUEL: 2, SEQUEL: 3, SIDE_STORY: 4,
};

function normalizeLegacyDbRelation(rel: DbMediaRelation): DbMediaRelation {
  const canonical = normalizeLegacyRelationType(rel.relation_type);
  if (canonical === rel.relation_type) return rel;
  return { ...rel, relation_type: canonical, type_label: getT().media.relations[canonical as keyof ReturnType<typeof getT>['media']['relations']] ?? rel.type_label };
}

function sortRelationsForDisplay(rels: DbMediaRelation[]): { relations: MediaPageData['relations']; hasSaga: boolean } {
  const sorted = [...rels].sort((a, b) => {
    const priorityA = RELATION_SORT_PRIORITY[a.relation_type] ?? 5;
    const priorityB = RELATION_SORT_PRIORITY[b.relation_type] ?? 5;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.title.localeCompare(b.title);
  });
  return {
    relations: sorted.map(r => ({
      typeLabel: r.type_label,
      title: r.title,
      cover: r.cover || undefined,
      url: `/media?id=${r.related_media_external_id}`,
      // Without this, mergeRelationGraph's "already have this id" dedup Set
      // (built by reading relatedExternalId off whatever's already in
      // data.relations) never sees DB-sourced rows — since they only had
      // `url` set — so the transitive relation-graph walk could rediscover
      // and re-add an already-saved relation under a second, different type.
      relatedExternalId: r.related_media_external_id,
    })),
    hasSaga: rels.some(r => r.relation_type === 'PREQUEL' || r.relation_type === 'SEQUEL'),
  };
}

function dbAuthorToMediaAuthor(a: DbMediaAuthor): MediaAuthor {
  return {
    external_id: a.external_id,
    name: a.name,
    image: a.image || undefined,
    role: a.role || undefined,
    url: `/author?id=${a.external_id}`,
  };
}

function dbCharacterToMediaCharacter(c: DbMediaCharacter): MediaCharacter {
  return {
    id: c.external_id,
    name: c.name,
    image: c.image_url || undefined,
    role: c.relation_type || c.character_name || undefined,
  };
}

// Shared by fetchMediaData and fetchMediaDataWithFallback — both need "load
// whatever's already curated in the DB for this media" before deciding
// whether to trust it as-is or enrich it with a live API fetch.
async function loadDbRelationsAndAuthors(rawId: string): Promise<{ relations: DbMediaRelation[]; authors: DbMediaAuthor[] }> {
  const [relations, authors] = await Promise.all([
    getMediaRelations(rawId).catch(() => []),
    getMediaAuthors(rawId).catch(() => []),
  ]);
  return { relations, authors };
}

const CACHE_PREFIX   = 'media_cache_v3:';
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

// Patches just the relations field of an already-cached entry (used once the
// background transitive-relations fetch resolves), keeping its original
// timestamp so the TTL isn't reset. Exported so callers can gate the write
// behind their own "is this fetch still relevant" check — see the comment
// on fetchExtraRelations below for why this can't safely happen internally.
export function patchCachedRelations(rawId: string, relations: MediaPageData['relations']): void {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${rawId}`);
    if (!raw) return;
    const entry: CacheEntry = JSON.parse(raw);
    entry.data = { ...entry.data, relations };
    sessionStorage.setItem(`${CACHE_PREFIX}${rawId}`, JSON.stringify(entry));
  } catch { /* sessionStorage lleno */ }
}

export function invalidateCachedMediaData(rawId: string): void {
  try {
    sessionStorage.removeItem(`${CACHE_PREFIX}${rawId}`);
  } catch {}
}

// ── Fetch interno ─────────────────────────────────────────────────────────

async function fetchMediaDataInternal(rawId: string): Promise<MediaPageData | null> {
  if (!rawId) return null;

  const { type, id: numericId } = parseExternalId(rawId);

  if (ANILIST_TYPES.includes(type)) {
    if (!numericId) return null;
    const raw = await fetchAniListDetail(numericId);
    return raw ? mapAniListToMedia(raw, type) : null;
  }

  if (IGDB_TYPES.includes(type)) {
    if (!numericId) return null;

    // Single request: banner image and store links ride along as Game
    // sub-fields in the core IGDB query (see igdb_get_game_detail).
    const game = await igdbGetGameDetail(numericId);
    if (!game) return null;
    let data = mapIgdbToMedia(game, rawId);

    // Remakes/remasters base games (PARENT) are slow because they require a reverse query.
    // We defer this lookup to the asynchronous fetchExtraRelations so the initial page renders instantly.

    data.relations = dedupeRelationsByTarget(data.relations);

    // The transitive relation graph (remaster-of-an-expansion, port-of-a-
    // remaster, etc.) needs up to 4 sequential IGDB requests — too slow to
    // block the initial page render. Fetched separately and merged in the
    // background (see fetchExtraRelations), not awaited here.

    return data;
  }

  if (type === 'movie' || type === 'series') {
    if (!numericId) return null;
    const raw = await fetchTmdbDetail(numericId, type);
    return raw ? mapTmdbToMedia(raw, type, rawId) : null;
  }

  if (type === 'book' || type === 'comic') {
    const idStr = rawId.slice(rawId.indexOf(':') + 1);
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

    const [work, authorDetail] = await Promise.all([workPromise, authorPromise]);
    if (!work) return null;

    let richAuthors: MediaAuthor[] = [];
    if (authorDetail) {
      richAuthors.push({
        external_id: authorDetail.key ? `author:${authorDetail.key}` : `author:${authorDetail.name}`,
        name: authorDetail.name,
        image: authorDetail.image || undefined,
        url: authorDetail.key ? `/author?id=author:${authorDetail.key}` : undefined
      });
    } else if (preloadNames) {
      richAuthors = preloadNames.map(name => ({ external_id: `author:${name}`, name }));
    }
    return mapOpenLibToMedia(work, richAuthors, rawId, type);
  }

  return null;
}

// Maps OpenLibrary editions to MediaRelation shape for the 'Ediciones' tab.
// Only editions with a valid cover are included.
function editionsToRelations(editions: OpenLibEdition[], label: string): MediaPageData['relations'] {
  const seen = new Set<string>();
  const result: MediaPageData['relations'] = [];
  for (const ed of editions) {
    const edId = bookIdFromWorkKey(ed.key);
    if (seen.has(edId)) continue;
    seen.add(edId);
    const coverId = ed.covers?.[0];
    const cover = coverId && coverId > 0 ? openLibCoverUrl(coverId, 'M') : undefined;
    if (!cover) continue;
    const publisherPart = ed.publishers?.[0] ?? '';
    const yearPart = ed.publish_date ? ` (${ed.publish_date})` : '';
    const title = ed.title + (publisherPart ? ` — ${publisherPart}${yearPart}` : yearPart);
    result.push({ typeLabel: label, title, cover });
  }
  return result;
}

// Background fetch: loads all editions for a book and returns them merged with
// any existing relations. Called after the page already has data, same pattern
// as fetchExtraRelations for games.
export async function fetchBookEditions(
  rawId: string,
  currentRelations: MediaPageData['relations'],
  editionsLabel: string,
): Promise<MediaPageData['relations'] | null> {
  const workId = rawId.slice(rawId.indexOf(':') + 1);
  const editions = await fetchOpenLibEditions(workId).catch(() => []);
  if (!editions.length) return null;
  const editionRelations = editionsToRelations(editions, editionsLabel);
  if (!editionRelations.length) return null;
  const withoutOld = currentRelations.filter(r => r.typeLabel !== editionsLabel);
  return [...withoutOld, ...editionRelations];
}

// ── Catalog → partial MediaPageData ──────────────────────────────────────────
// Builds immediately-usable page data from the local catalog (SQLite).
// Missing fields (stats, characters, relations, metaLines) are empty — filled
// once the full API fetch completes.

export function inferProgressStatus(type: string): typeof IN_PROGRESS_STATUSES[number] {
  const base = type.split('_')[0];
  if (base === 'game' || base === 'vnovel') return 'playing';
  if (base === 'anime' || base === 'series' || base === 'movie') return 'watching';
  return 'reading';
}

export function mapCatalogEntryToPartialData(c: MediaCatalogEntry, progressLabel: string = getT().media.progress_in_progress): MediaPageData {
  const authorList = c.authors_csv ? c.authors_csv.split(',').filter(Boolean) : [];
  const authors: MediaAuthor[] = authorList.map(name => ({ external_id: `author:${name}`, name }));
  const stats: MediaStat[] = [];
  if (authorList.length > 0) {
    stats.push({
      label: authorList.length > 1 ? 'Autores' : 'Autor',
      value: authorList.join(', '),
    });
  }

  const companies = c.companies_cache_csv ? c.companies_cache_csv.split(',').filter(Boolean) : [];
  const platforms = c.platforms_csv ? c.platforms_csv.split(',').filter(Boolean) : [];
  const isGameType = c.type === 'game' || c.type === 'vnovel';

  // "platform|url" pairs — see MediaPage.tsx's catalog-sync payload.
  const storeLinks = c.shop_links_csv
    ? c.shop_links_csv.split(',').filter(Boolean).map(pair => {
        const [platform, url] = pair.split('|');
        return { platform: platform || '', url: url || '' };
      }).filter(l => l.url)
    : undefined;

  // Mirrors each API mapper's own metaLines convention (igdb-mapper: platforms
  // then publisher; anilist-mapper: studios then format/episode count) so the
  // catalog-only render (no live API call — see fetchMediaDataWithFallback)
  // doesn't lose this info once catalog data is the final answer instead of
  // just a placeholder while the API call is in flight.
  const metaLines: string[] = [];
  if (c.type === 'book' || c.type === 'comic') {
    if (authorList.length > 0) metaLines.push(authorList.join(', '));
  } else if (isGameType) {
    if (platforms.length > 0) metaLines.push(platforms.join(' · '));
    if (companies.length > 0) metaLines.push(companies.join(', '));
  } else {
    if (companies.length > 0) metaLines.push(companies.join(', '));
    const quickBits: string[] = [];
    if (c.format) quickBits.push(c.format);
    if (c.total_count) quickBits.push(`${c.total_count} ${c.type === 'anime' ? 'ep' : 'cap'}`);
    if (quickBits.length > 0) metaLines.push(quickBits.join(' · '));
  }

  const dateBadge = formatDateParts({ year: c.release_year, month: c.release_month, day: c.release_day }) || undefined;

  return {
    externalId:    c.external_id,
    type:          c.type,
    titleMain:     c.title_main   ?? c.external_id,
    titleNative:   c.title_native ?? undefined,
    titleEnglish:  c.title_romaji ?? undefined,
    cover:         c.cover_url    ?? undefined,
    bannerImage:   c.banners_csv?.split(',')[0] ?? undefined,
    bannerColor:   'linear-gradient(135deg, #c084fc 0%, #7c3aed 100%)',
    description:   c.synopsis     ?? undefined,
    genreDots:     c.genres_csv     ? c.genres_csv.split(',').join(' · ')     : undefined,
    genreTagDots:  c.genres_tag_csv ? c.genres_tag_csv.split(',').join(' · ') : undefined,
    dateBadge,
    totalCount:    c.total_count   ?? undefined,
    totalCount_2:  c.total_count_2 ?? undefined,
    scoreGlobal:   c.score_global  ?? undefined,
    releaseYear:   c.release_year  ?? undefined,
    releaseMonth:  c.release_month ?? undefined,
    releaseDay:    c.release_day   ?? undefined,
    timeLength:    c.time_length   ?? undefined,
    status:        c.status        ?? undefined,
    format:        c.format        ?? undefined,
    source:        c.source        ?? undefined,
    platforms:     platforms.length > 0 ? platforms : undefined,
    companies:     companies.length > 0 ? companies : undefined,
    storeLinks,
    metaLines,
    stats,
    characters:    [],
    relations:     [],
    progressStatus: inferProgressStatus(c.type),
    progressLabel,
    authors:       authors.length > 0 ? authors : undefined,
  };
}

// ── API pública ───────────────────────────────────────────────────────────

// Merges freshly-fetched relations (from any source — the direct IGDB
// fetch, or the transitive relation-graph walk) into whatever's already
// saved, instead of only ever syncing once per title. IGDB keeps adding
// DLCs/standalone expansions/etc. to a game's entry over time, and a plain
// "skip if dbRels isn't empty" gate meant any title that already had one
// curated/synced relation (e.g. a manually-added PREQUEL) would never pick
// up newly-listed ones again — they'd render fine on that one page load
// (from live memory) but silently never reach media_relations, so they
// never showed up as an editable relation in the collaborative catalog
// editor. Existing DB rows always win on id conflicts since they may have
// been hand-edited (saga grouping, relation-type fixes) via PrEditorModal
// and must not be clobbered by a fresh IGDB fetch.
//
// Also normalizes any legacy-labeled DB rows even when there's nothing new
// to merge — that must not be gated behind "there's something to add", or a
// title whose relations were all saved under the old raw-label scheme (and
// whose live fetch happens to add nothing new) would never get corrected.
export async function mergeAndPersistRelations(rawId: string, fetchedRelations: MediaPageData['relations']): Promise<void> {
  const { relations: dbRels } = await loadDbRelationsAndAuthors(rawId);

  const normalizedDbRels = dbRels.map(normalizeLegacyDbRelation);
  const changedLegacyTypes = normalizedDbRels.some((r, i) => r.relation_type !== dbRels[i].relation_type);

  const dbIds = new Set(dbRels.map(r => r.related_media_external_id));
  const newFromApi = (fetchedRelations ?? [])
    .filter(r => r.relatedExternalId && !dbIds.has(r.relatedExternalId))
    .map(r => ({
      related_media_external_id: r.relatedExternalId!,
      relation_type: r.relationType ?? 'RELATED',
      type_label: r.typeLabel,
      title: r.title,
      cover: r.cover || null,
    }));

  if (newFromApi.length > 0 || changedLegacyTypes) {
    await saveMediaRelations(rawId, [...normalizedDbRels, ...newFromApi]).catch(console.error);
  }
}

// Comprueba caché primero; si no está, fetcha y guarda
// Helper to persist live API data back to SQLite media_catalog cache
async function persistToCatalog(data: MediaPageData): Promise<void> {
  try {
    const shopLinks = (data.storeLinks ?? []).map(l => `${l.platform}|${l.url}`).join(',');
    
    const entry: MediaCatalogEntry = {
      id: '', // Will be filled/matched by Rust if already exists
      external_id: data.externalId,
      parent_id: data.parentGame?.externalId || null,
      type: data.type,
      format: data.format || null,
      source: data.source || 'igdb',
      title_main: data.titleMain,
      title_native: data.titleNative || null,
      title_romaji: data.titleEnglish || null,
      synopsis: data.description || null,
      cover_url: data.cover || null,
      banners_csv: data.bannerImage || null,
      release_year: data.releaseYear || null,
      release_month: data.releaseMonth || null,
      release_day: data.releaseDay || null,
      time_length: data.timeLength || null,
      status: data.status || null,
      score_global: data.scoreGlobal || null,
      total_count: data.totalCount || null,
      total_count_2: data.totalCount_2 || null,
      genres_csv: data.genreDots ? data.genreDots.split(' · ').join(',') : null,
      genres_tag_csv: data.genreTagDots ? data.genreTagDots.split(' · ').join(',') : null,
      platforms_csv: data.platforms ? data.platforms.join(',') : null,
      shop_links_csv: shopLinks || null,
      companies_cache_csv: data.companies ? data.companies.join(',') : null,
      authors_csv: (data.authors ?? []).map(a => a.name).join(','),
      created_at: '',
      updated_at: '',
    };
    
    await saveCatalogEntry(entry).catch(console.error);
  } catch (e) {
    console.error("Failed to persist media to local SQLite cache", e);
  }
}

// Comprueba caché primero; si no está, fetcha y guarda
export async function fetchMediaData(rawId: string): Promise<MediaPageData | null> {
  const cached = getCachedMediaData(rawId);
  if (cached) return cached;

  const data = await fetchMediaDataInternal(rawId);
  if (data) {
    const { authors: dbAuthors } = await loadDbRelationsAndAuthors(rawId);
    await mergeAndPersistRelations(rawId, data.relations);

    // Persist to local SQLite cache so F5 or next visit loads instantly
    await persistToCatalog(data);

    // Only save API authors if we don't have any in the DB
    if (dbAuthors.length === 0 && data.authors && data.authors.length > 0) {
      await saveMediaAuthors(rawId, data.authors!).catch(console.error);
    }

    // Reload from database to ensure local curated relations/authors are used in the final UI data object!
    const { relations: finalRels, authors: finalAuthors } = await loadDbRelationsAndAuthors(rawId);

    if (finalRels.length > 0) {
      const { relations, hasSaga } = sortRelationsForDisplay(finalRels);
      data.relations = relations;
      data.hasSaga = hasSaga;
    }

    if (finalAuthors.length > 0) {
      data.authors = finalAuthors.map(dbAuthorToMediaAuthor);
    }

    setCachedMediaData(rawId, data);
  }
  return data;
}

// Fire-and-forget: llamar en hover para precalentar la caché
export function prefetchMediaData(rawId: string): void {
  if (getCachedMediaData(rawId)) return; // ya está en caché
  fetchMediaData(rawId).catch(() => {}); // silencioso — es prefetch
}

// Catalog-first fetch: shows catalog data immediately while API loads in background.
// onPartial fires as soon as catalog data is available; onFull fires when API completes.
export function fetchMediaDataWithFallback(
  rawId: string,
  onPartial: (data: MediaPageData) => void,
  onFull:    (data: MediaPageData) => void,
  onError:   () => void,
): void {
  const cached = getCachedMediaData(rawId);
  if (cached) {
    onFull(cached);
    return;
  }

  let fullArrived = false;
  let hasLocalData = false;
  let localData: MediaPageData | null = null;
  let catalogEntry: MediaCatalogEntry | null = null;
  let dbCharacterCount = 0;

  getCatalogEntry(rawId)
    .then(async catalog => {
      if (catalog && catalog.title_main) {
        catalogEntry = catalog;
        hasLocalData = true;
        localData = mapCatalogEntryToPartialData(catalog);

        try {
          const { relations: dbRels, authors: dbAuthors } = await loadDbRelationsAndAuthors(rawId);
          const dbChars = await getMediaCharacters(rawId).catch(() => [] as DbMediaCharacter[]);
          dbCharacterCount = dbChars.length;

          if (dbRels.length > 0) {
            const { relations, hasSaga } = sortRelationsForDisplay(dbRels);
            localData.relations = relations;
            localData.hasSaga = hasSaga;
          }

          if (dbAuthors.length > 0) {
            localData.authors = dbAuthors.map(dbAuthorToMediaAuthor);
          }

          if (dbChars.length > 0) {
            localData.characters = dbChars.map(dbCharacterToMediaCharacter);
          }
        } catch (e) {
          console.error("Failed to load local media relations, authors or characters", e);
        }

        if (!fullArrived) {
          onPartial(localData);
        }
      }
    })
    .catch(() => {})
    .finally(() => {
      // If the catalog entry is a thin skeleton or missing basic columns
      // (like synopsis, source, format, release date, genres, or companies),
      // we do not skip the live API fetch — we fetch from the network to enrich it.
      // Anime/manga/lnovel entries always have characters on AniList, so a
      // fully-enriched catalog row with zero locally-cached characters still
      // forces a live re-fetch instead of permanently showing none.
      const isAniListType = catalogEntry ? (ANILIST_TYPES as readonly string[]).includes(catalogEntry.type) : false;
      const isSkeleton = !catalogEntry ||
        !catalogEntry.format ||
        !catalogEntry.source ||
        !catalogEntry.synopsis ||
        !catalogEntry.release_year ||
        !catalogEntry.genres_csv ||
        !catalogEntry.companies_cache_csv ||
        (isAniListType && dbCharacterCount === 0);

      if (hasLocalData && localData && !isSkeleton) {
        fullArrived = true;
        onFull(localData);
        // A "fully enriched" catalog row (synopsis/genres/companies all
        // present) skips the live IGDB fetch entirely for speed — but that
        // also means fetchMediaData's relation-merge-and-save step (new
        // DLCs/expansions/remasters IGDB has added since this row was last
        // synced) never runs for already-visited titles. Kick it off in the
        // background so relations catch up without delaying the initial
        // render. Delay by 1 second to avoid database locks.
        //
        // The refreshed data (e.g. a remake/remaster's Fuente relation,
        // absent from the stale DB snapshot shown above) must actually reach
        // the page once this resolves — a fire-and-forget call here used to
        // silently update media_relations with nothing on screen reflecting
        // it, so the correct data only ever showed up on a *later* visit
        // (once it was already saved from the previous one), never on the
        // page load that triggered the resync.
        setTimeout(() => {
          fetchMediaData(rawId).then(freshData => {
            if (freshData) onFull(freshData);
          }).catch(() => {});
        }, 1000);
        return;
      }

      fetchMediaData(rawId)
        .then(data => {
          fullArrived = true;
          if (data) {
            if (!data.bannerImage && localData?.bannerImage) {
              data.bannerImage = localData.bannerImage;
            }
            onFull(data);
          } else if (hasLocalData && localData) {
            onFull(localData);
          } else {
            onError();
          }
        })
        .catch(() => {
          fullArrived = true;
          if (hasLocalData && localData) {
            onFull(localData);
          } else {
            onError();
          }
        });
    });
}

// Background enrichment: walks the transitive IGDB relation graph (up to a
// few sequential requests) and returns the merged relations list. Meant to
// be called *after* the page already has full data, so the slow multi-hop
// walk never blocks the initial render.
//
// Deliberately does NOT call patchCachedRelations() itself: this is a
// multi-request round trip, so by the time it resolves the user may have
// already navigated to a different page (possibly one whose external_id
// happens to be `rawId` here, e.g. a parent game). Writing to the cache
// unconditionally used to let a stale response computed from *this* call's
// currentData land in a different, now-current page's cache entry —
// corrupting it with relations that don't belong to it (reported as a
// title showing itself, or the wrong title, as its own prequel/sequel).
// Callers must call patchCachedRelations() themselves, gated behind
// whatever "is this fetch still relevant" check they already use for
// setData (see MediaPage.tsx's `cancelled` flag).
export async function fetchExtraRelations(rawId: string, currentData: MediaPageData): Promise<MediaPageData['relations'] | null> {
  const { type, id: numericId } = parseExternalId(rawId);
  if (!IGDB_TYPES.includes(type)) return null;
  if (!numericId) return null;

  // Run the relation graph and optional base game (PARENT) lookup in parallel to minimize latency.
  const isRemake = currentData.format === 'REMAKE';
  const isRemaster = currentData.format === 'REMASTER';
  
  const graphPromise = igdbGetRelationGraph(numericId).catch(() => []);
  const baseGamesPromise = (isRemake || isRemaster)
    ? igdbGetBaseGames(numericId, isRemake ? 'remakes' : 'remasters').catch(() => null)
    : Promise.resolve(null);

  const [graphNodes, baseGames] = await Promise.all([graphPromise, baseGamesPromise]);

  let updatedData = { ...currentData };

  // 1. Merge parent relation (source game) if found
  if (baseGames && baseGames.length > 0) {
    updatedData = mergeBaseGameRelation(updatedData, baseGames as IgdbSubGame[]);
  }

  // 2. Merge transitively discovered relation graph nodes
  if (graphNodes.length > 0) {
    const gameType = currentData.format === 'EXPANDED_GAME' ? 10 : undefined;
    updatedData = mergeRelationGraph(updatedData, graphNodes as RelationGraphNode[], gameType);
  }

  if (updatedData.relations.length === currentData.relations.length) return null; // nothing new

  return updatedData.relations;
}
