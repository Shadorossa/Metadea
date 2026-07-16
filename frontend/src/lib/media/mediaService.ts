import { fetchAniListDetail } from '../search/providers/anilist';
import { fetchOpenLibWork, fetchOpenLibAuthor, fetchOpenLibEditions, openLibCoverUrl, bookIdFromWorkKey } from '../search/providers/openlibrary';
import type { OpenLibEdition } from '../search/providers/openlibrary';
import { fetchTmdbDetail } from '../search/providers/tmdb';
import { fetchComicVineVolume, fetchComicVineIssues, fetchComicVineIssue, fetchComicVineVolumeCast } from '../search/providers/comicvine';
import type { ComicVineIssue } from '../tauri';
import { unifyGenres } from './genre-unifier';
import { mapAniListToMedia } from './anilist-mapper';
import { mapOpenLibToMedia } from './openlibrary-mapper';
import { mapComicVineToMedia, mapComicVineIssueToMedia } from './comicvine-mapper';
import { mapTmdbToMedia } from './tmdb-mapper';
import { mapIgdbToMedia, mergeBaseGameRelation, mergeRelationGraph, dedupeRelationsByTarget, type IgdbSubGame, type RelationGraphNode } from './igdb-mapper';
import { igdbGetGameDetail, igdbGetBaseGames, igdbGetRelationGraph, getCatalogEntry, saveCatalogEntry, markCatalogSyncFailed } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData, MediaAuthor, MediaCharacter } from './types';
import { saveMediaAuthors } from '../tauri/catalog';
import { getMediaCharacters, type DbMediaCharacter } from '../tauri/characters';
import { parseExternalId } from './mapper-utils';
import { ANILIST_TYPES, IGDB_TYPES } from '../constants/media';
import { needsResync } from './media-status';

import { getCachedMediaData, setCachedMediaData, patchCachedRelations, invalidateCachedMediaData } from './media-cache';
import { mapCatalogEntryToPartialData, mapMediaDataToCatalogEntry, inferProgressStatus } from './catalog-mapper';
import {
  sortRelationsForDisplay, sortMediaRelations, bucketRelations, dbAuthorToMediaAuthor, dbCharacterToMediaCharacter,
  mediaCharactersToSkeleton, loadDbRelationsAndAuthors, mergeAndPersistRelations,
} from './media-relations';

// Re-exported so existing callers (MediaPage.tsx, ProfileLibraryEditor.tsx,
// etc.) don't need to change their import path — mediaService.ts stays the
// single public entry point for "everything about loading/caching a media
// page", even though the cache/relations/catalog-mapping concerns now live
// in their own files (media-cache.ts, media-relations.ts, catalog-mapper.ts).
export {
  getCachedMediaData, patchCachedRelations, invalidateCachedMediaData,
  mapCatalogEntryToPartialData, mapMediaDataToCatalogEntry, inferProgressStatus,
  sortMediaRelations, bucketRelations, mediaCharactersToSkeleton, mergeAndPersistRelations,
};

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

  if (type === 'comic') {
    const idStr = rawId.slice(rawId.indexOf(':') + 1);
    if (idStr.startsWith('issue-')) {
      const issueId = parseInt(idStr.slice('issue-'.length), 10);
      if (!Number.isFinite(issueId)) return null;
      const issue = await fetchComicVineIssue(issueId);
      return issue ? mapComicVineIssueToMedia(issue, rawId) : null;
    }
    const volumeId = parseInt(idStr, 10);
    if (!Number.isFinite(volumeId)) return null;
    const volume = await fetchComicVineVolume(volumeId);
    return volume ? mapComicVineToMedia(volume, rawId) : null;
  }

  if (type === 'book') {
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
    result.push({ typeLabel: label, relationType: 'EDITIONS', title, cover });
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
  const withoutOld = currentRelations.filter(r => r.relationType !== 'EDITIONS');
  return [...withoutOld, ...editionRelations];
}

// Maps Comic Vine issues to MediaRelation shape for the 'Issues' tab. Only
// issues with a cover image are included.
function issuesToRelations(issues: ComicVineIssue[], label: string): MediaPageData['relations'] {
  const result: MediaPageData['relations'] = [];
  for (const issue of issues) {
    const cover = issue.image?.medium_url ?? issue.image?.small_url ?? undefined;
    if (!cover) continue;
    const numberPart = issue.issue_number ? `#${issue.issue_number}` : '';
    const namePart = issue.name ? ` — ${issue.name}` : '';
    const title = (numberPart + namePart) || `#${issue.id}`;
    const relatedExternalId = `comic:issue-${issue.id}`;
    result.push({ typeLabel: label, relationType: 'ISSUE', title, cover, url: `/media?id=${relatedExternalId}`, relatedExternalId });
  }
  return result;
}

export interface ComicIssuesResult {
  relations: MediaPageData['relations'] | null;
  characters: MediaCharacter[];
  genreDots?: string;
  genreTagDots?: string;
}

// Background fetch: loads all issues for a comic volume (for the 'Issues'
// tab) and separately aggregates the full cast/genres across every one of
// those issues via their own singular /issue/ detail resource — the volume's
// own character_credits/concept_credits (used for the initial quick display,
// see comicvine-mapper.ts) is usually just a first-issue sample, since Comic
// Vine editors rarely fill in the volume-level field. This is the "give me
// the real, complete cast" pass: one extra request per issue plus one per
// unique character (for images), so it only runs once per comic (results get
// persisted) rather than being paid on every page view.
export async function fetchComicIssues(
  rawId: string,
  currentRelations: MediaPageData['relations'],
  issuesLabel: string,
): Promise<ComicIssuesResult> {
  const idStr = rawId.slice(rawId.indexOf(':') + 1);
  const volumeId = parseInt(idStr, 10);
  if (!Number.isFinite(volumeId)) return { relations: null, characters: [] };
  const issues = await fetchComicVineIssues(volumeId).catch(() => []);
  if (!issues.length) return { relations: null, characters: [] };

  const cast = await fetchComicVineVolumeCast(issues.map(i => i.id));
  const characters: MediaCharacter[] = cast.characters.map(c => ({
    id: `character:comicvine:${c.id}`,
    name: c.name,
    image: c.image?.medium_url ?? c.image?.small_url ?? undefined,
  }));
  const { core, tags } = unifyGenres(cast.concepts.map(c => c.name));
  const genreDots = core.join(' · ') || undefined;
  const genreTagDots = tags.join(' · ') || undefined;

  const issueRelations = issuesToRelations(issues, issuesLabel);
  if (!issueRelations.length) return { relations: null, characters, genreDots, genreTagDots };
  const withoutOld = (Array.isArray(currentRelations) ? currentRelations : []).filter(r => r.relationType !== 'ISSUE');
  return { relations: [...withoutOld, ...issueRelations], characters, genreDots, genreTagDots };
}

// Comprueba caché primero; si no está, fetcha y guarda
// Helper to persist live API data back to SQLite media_catalog cache
async function persistToCatalog(data: MediaPageData): Promise<void> {
  try {
    const shopLinks = (data.storeLinks ?? []).map(l => `${l.platform}|${l.url}`).join(',');

    // Most providers never return a banner — fall back to the DB's existing
    // value instead of wiping a manually-added one on every live re-fetch.
    const existing = await getCatalogEntry(data.externalId).catch(() => null);

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
      banners_csv: data.bannerImage || existing?.banners_csv || null,
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
      // Marks "we just checked the live provider" — needsResync() (see
      // media-status.ts) reads this to decide whether a RELEASING/
      // NOT_YET_RELEASED/HIATUS entry is due for another check yet, instead
      // of every page view unconditionally re-fetching forever.
      last_synced_at: new Date().toISOString(),
      sync_failed_count: 0,
      last_sync_error: null,
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
  if (!data) {
    // No-ops in Rust if this id has no catalog row yet (a cold first-visit
    // failure has nothing to attach a failure count to) — otherwise bumps
    // sync_failed_count/last_sync_error without touching any other column,
    // so needsResync() can back off a title whose provider keeps failing
    // instead of retrying it on every single visit forever.
    markCatalogSyncFailed(rawId, 'Live fetch returned no data').catch(() => {});
  }
  if (data) {
    const { authors: dbAuthors } = await loadDbRelationsAndAuthors(rawId);
    await mergeAndPersistRelations(rawId, data.relations);

    // persistToCatalog preserves an existing banner in the DB, but this same
    // `data` object also gets shown on screen — patch it too so a live fetch
    // with no banner doesn't flash "no banner" before the DB write lands.
    if (!data.bannerImage) {
      const existing = await getCatalogEntry(rawId).catch(() => null);
      if (existing?.banners_csv) data.bannerImage = existing.banners_csv.split(',')[0];
    }

    // Persist to local SQLite cache so F5 or next visit loads instantly
    await persistToCatalog(data);

    // Only save API authors if we don't have any in the DB yet, or the ones
    // we do have are missing an image — e.g. saved before Comic Vine author
    // images existed, or from a provider that never supplied one. Otherwise
    // leave locally-curated authors (added/edited via the collaborative
    // catalog editor) alone rather than silently overwriting them on every
    // re-fetch.
    const authorsMissingImage = dbAuthors.length > 0 && dbAuthors.every(a => !a.image);
    if ((dbAuthors.length === 0 || authorsMissingImage) && data.authors && data.authors.length > 0) {
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
        // render — but only when needsResync() says this entry is actually
        // due (see media-status.ts's per-status cadence), instead of
        // unconditionally hitting the live API on every single page view
        // forever. Delay by 1 second to avoid database locks.
        //
        // The refreshed data (e.g. a remake/remaster's Fuente relation,
        // absent from the stale DB snapshot shown above) must actually reach
        // the page once this resolves — a fire-and-forget call here used to
        // silently update media_relations with nothing on screen reflecting
        // it, so the correct data only ever showed up on a *later* visit
        // (once it was already saved from the previous one), never on the
        // page load that triggered the resync.
        if (needsResync(catalogEntry)) {
          setTimeout(() => {
            fetchMediaData(rawId).then(freshData => {
              if (freshData) onFull(freshData);
            }).catch(() => {});
          }, 1000);
        }
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
