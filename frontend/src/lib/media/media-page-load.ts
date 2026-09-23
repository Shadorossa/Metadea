// Top-level media page loading: the live fetch that reconciles with and
// persists to the local catalog (fetchMediaData), and the staged
// partial-then-full render that decides between a catalog-only render, a
// background resync, or a first-ever live fetch (fetchMediaDataWithFallback).
// Split out of media-page-data.ts (still re-exported from there); this is
// the one module that genuinely reads from every other media-page-* module.
import { markSyncFailed } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData } from './types';
import { saveMediaAuthors } from '../tauri/catalog';
import { getMediaCharacters, type DbMediaCharacter } from '../tauri/characters';
import { saveMediaCompanies } from '../tauri/companies';
import { needsResync } from './media-status';
import { getCachedMediaData, setCachedMediaData, invalidateCachedMediaData } from './media-cache';
import { mapCatalogEntryToPartialData } from './mappers/catalog-mapper';
import {
  sortRelationsForDisplay, dbAuthorToMediaAuthor, dbCharacterToMediaCharacter, mergeAndPersistRelations,
} from './saga/media-relations';
import { fetchMediaDataInternal } from './media-page-fetch';
import { normalizeCachedApiSportsCompetition } from './media-page-cache';
import { persistToCatalog, filterBlockedRelations, applyStickyLocalFields } from './media-page-persist';
import { loadBaseEditionCharacters, getBaseEditionId, enrichLocalData, loadDbRelationsAndAuthorsCached } from './media-page-local-data';
import { readBlockedExternalIdsCached, readCatalogEntryCached, readSyncStateCached } from './media-page-read-cache';

// Where the data handed to onFull came from — 'local' is the catalog-only
// render (rows just read from the DB), 'live' a fresh provider fetch that
// was reconciled and persisted, 'cache' the session cache of a previous
// live fetch. Lets the caller skip write-backs that would only re-save the
// exact rows it just read.
export type MediaPageDataSource = 'local' | 'live' | 'cache';

// Live fetch, blocked-relation filtering, and full DB persistence.
export async function fetchMediaData(
  rawId: string,
  // Manual "Reintentar sincronización" only — total_count is otherwise
  // sticky (existing-first) like title/synopsis/cover, since PrEditorModal
  // lets curators hand-edit it and a routine background resync must never
  // clobber that. But an AniList entry's real episode/chapter count keeps
  // growing while it airs/publishes, and a curator override is rare enough
  // that the manual retry button should still surface AniList's current
  // count instead of being stuck forever at whatever total_count happened
  // to be on the very first sync.
  // refreshSourceAdaptation: also manual-retry-only — a SOURCE/ADAPTATION
  // pair is otherwise sticky like any other existing relation (protects a
  // curator's hand-fixed direction from a routine background resync), but
  // AniList's own raw relationType for this one pair can be wrong on either
  // side (see anilist-mapper.ts's date-based direction fix) — a pair cached
  // before that fix, or from whichever side happened to sync first, can be
  // stuck backwards forever otherwise (e.g. Kizumonogatari's movies getting
  // cached as the light novel's "original work"). The manual button
  // re-checks this one pair's direction against the fresh fetch and
  // corrects it if it disagrees.
  opts?: { refreshAniListTotalCount?: boolean; refreshSourceAdaptation?: boolean },
): Promise<MediaPageData | null> {
  const blockedIds = await readBlockedExternalIdsCached().catch(() => [] as string[]);
  if (blockedIds.includes(rawId)) {
    invalidateCachedMediaData(rawId);
    return null;
  }
  const cached = getCachedMediaData(rawId);
  const isApiSportsCompetition = /^event:apisports:(?:football|basketball):\d+$/.test(rawId);
  if (cached && (!isApiSportsCompetition || (Array.isArray(cached.seasons) && cached.seasons.length > 0))) {
    return normalizeCachedApiSportsCompetition(rawId, cached);
  }
  if (cached && isApiSportsCompetition) invalidateCachedMediaData(rawId);

  const data = await fetchMediaDataInternal(rawId, true);
  if (!data) {
    // Bumps sync_failed_count so needsResync() backs off a failing provider.
    markSyncFailed(rawId, 'Live fetch returned no data').catch(() => {});
  }
  if (data) {
    // Three independent local DB reads (blocked-ids check, this id's own
    // saved relations/authors, its catalog row) — none of them depend on
    // each other's result, only on `data` from the live fetch above, so
    // running them one after another was pure added latency for no reason.
    const [filteredRelations, { relations: dbRelations, authors: dbAuthors }, existing] = await Promise.all([
      data.relations ? filterBlockedRelations(data.relations, blockedIds) : Promise.resolve(data.relations),
      loadDbRelationsAndAuthorsCached(rawId),
      readCatalogEntryCached(rawId).catch(() => null),
    ]);
    data.relations = filteredRelations;
    applyStickyLocalFields(data, existing);

    // Checks deleted_relations so a deliberately-removed relation isn't silently re-added.
    const relationsChanged = await mergeAndPersistRelations(
      rawId,
      data.relations,
      data.format,
      !!opts?.refreshSourceAdaptation,
      { dbRelations, blockedIds },
    );

    await persistToCatalog(data, existing, relationsChanged, !!opts?.refreshAniListTotalCount);

    // Only overwrite API authors if we have none locally, or the ones we have lack an image.
    const authorsMissingImage = dbAuthors.length > 0 && dbAuthors.every(a => !a.image);
    if ((dbAuthors.length === 0 || authorsMissingImage) && data.authors && data.authors.length > 0) {
      await saveMediaAuthors(rawId, data.authors!).catch(console.error);
    }

    // Every mapper that has companies (igdb/anilist/tmdb/comicvine) already
    // stamps a `role` on each entry — same full-replace semantics as
    // save_characters_skeleton, there's no separate "missing logo" check
    // like authors' above since every provider that has a logo returns one
    // whenever the company has one.
    if (data.companies && data.companies.length > 0) {
      await saveMediaCompanies(rawId, data.companies).catch(console.error);
    }

    // Reload so the result reflects curated relations/authors/characters.
    const [{ relations: finalRels, authors: finalAuthors }, dbChars] = await Promise.all([
      loadDbRelationsAndAuthorsCached(rawId),
      getMediaCharacters(rawId).catch(() => [] as DbMediaCharacter[]),
    ]);

    if (finalRels.length > 0) {
      const { relations, hasSaga } = sortRelationsForDisplay(finalRels);
      data.relations = relations;
      data.hasSaga = hasSaga;
    }

    if (finalAuthors.length > 0) {
      data.authors = finalAuthors.map(dbAuthorToMediaAuthor);
    }

    // If retry-sync requested fresh data and API returned characters, prefer them over stale DB characters.
    const baseEditionId = getBaseEditionId(data);
    if (baseEditionId) {
      data.characters = await loadBaseEditionCharacters(baseEditionId, true);
      data.charactersInheritedFromBase = true;
      data.charactersHasMore = false;
    } else if (dbChars.length > 0 && (!opts?.refreshAniListTotalCount || data.characters.length === 0)) {
      data.characters = dbChars.map(dbCharacterToMediaCharacter);
    }

    setCachedMediaData(rawId, data);
  }
  return data;
}

export function fetchMediaDataWithFallback(
  rawId: string,
  onPartial: (data: MediaPageData) => void,
  // isFinal is false exactly once: the stub/local-data render below that's
  // about to be followed by a background resync. Callers that show a
  // "still loading" indicator should key it off this instead of onFull
  // firing at all, since onFull already fires early for that stub data.
  onFull:    (data: MediaPageData, isFinal: boolean, source: MediaPageDataSource) => void,
  onError:   () => void,
  // Lets the caller skip the background refresh once the user has navigated away.
  isCancelled: () => boolean = () => false,
): void {
  // The catalog row is needed right after the blocked check on every path
  // that survives it, and reading it has no side effects, so it's started
  // now instead of waiting one IPC round-trip for the blocked list first.
  const catalogPromise = readCatalogEntryCached(rawId);
  catalogPromise.catch(() => {});
  const loadVisibleEntry = () => fetchMediaDataWithFallbackVisible(rawId, catalogPromise, onPartial, onFull, onError, isCancelled);
  readBlockedExternalIdsCached().then(blockedIds => {
    if (blockedIds.includes(rawId)) {
      invalidateCachedMediaData(rawId);
      if (!isCancelled()) onError();
      return;
    }
    loadVisibleEntry();
  }).catch(loadVisibleEntry);
}

function fetchMediaDataWithFallbackVisible(
  rawId: string,
  catalogPromise: Promise<MediaCatalogEntry | null>,
  onPartial: (data: MediaPageData) => void,
  onFull: (data: MediaPageData, isFinal: boolean, source: MediaPageDataSource) => void,
  onError: () => void,
  isCancelled: () => boolean,
): void {
  const isApiSportsCompetition = /^event:apisports:(?:football|basketball):\d+$/.test(rawId);
  const cached = getCachedMediaData(rawId);
  if (cached && (!isApiSportsCompetition || (Array.isArray(cached.seasons) && cached.seasons.length > 0))) {
    onFull(normalizeCachedApiSportsCompetition(rawId, cached), true, 'cache');
    return;
  }
  if (cached && isApiSportsCompetition) invalidateCachedMediaData(rawId);

  let fullArrived = false;
  let hasLocalData = false;
  let localData: MediaPageData | null = null;
  let catalogEntry: MediaCatalogEntry | null = null;
  const syncStatePromise = readSyncStateCached(rawId).catch(() => null);

  catalogPromise
    .then(async catalog => {
      if (catalog && catalog.title_main) {
        catalogEntry = catalog;
        hasLocalData = true;
        localData = mapCatalogEntryToPartialData(catalog);

        try {
          await enrichLocalData(rawId, catalog, localData);
        } catch (e) {
          console.error("Failed to load local media relations, authors or characters", e);
        }

        if (!fullArrived && !isApiSportsCompetition) {
          onPartial(localData);
        }
      }
    })
    .catch(() => {})
    .finally(async () => {
      // Competition seasons are provider data, not catalog columns. A local
      // catalog hit cannot be considered complete for this container, so
      // refresh the provider payload on each page load (the session cache
      // above still avoids duplicate calls during its cache lifetime).
      if (isApiSportsCompetition) {
        fetchMediaData(rawId).then(fresh => {
          if (!isCancelled() && fresh) onFull(fresh, true, 'live');
          else if (!isCancelled() && localData) onFull(localData, true, 'local');
          else if (!isCancelled()) onError();
        }).catch(() => {
          if (!isCancelled() && localData) onFull(localData, true, 'local');
          else if (!isCancelled()) onError();
        });
        return;
      }

      // Catalog data is the final answer for this render - a resync (if due) only refreshes in the background.
      if (hasLocalData && localData) {
        fullArrived = true;
        const syncState = await syncStatePromise;
        const dueForResync = needsResync(syncState ? {
          status: catalogEntry?.status,
          last_synced_at: syncState.last_synced_at,
          sync_failed_count: syncState.sync_failed_count,
        } : null);
        onFull(localData, !(catalogEntry && dueForResync), 'local');
        // The background resync's own result used to just be discarded here
        // — persistToCatalog (inside fetchMediaData) only ever writes
        // media_catalog's own scalar columns, never characters/staff, so
        // MediaPage.tsx's saveCharactersSkeleton/saveStaffSkeleton calls
        // (which only run from an onFull callback) never saw this data at
        // all. A catalog row missing its characters (e.g. first added via
        // the admin panel, or the very first live fetch briefly not
        // returning any) stayed missing forever, since every later visit
        // took this local-data branch instead of a fresh fetch. Routing the
        // resync through onFull the same way a first-ever fetch already
        // does fixes that, at the cost of onFull's other one-time work
        // (extra relations walk, etc.) also re-running — acceptable since
        // needsResync() already gates how often this happens at all.
        if (catalogEntry && dueForResync && !isCancelled()) {
          fetchMediaData(rawId).then(fresh => {
            if (fresh && !isCancelled()) onFull(fresh, true, 'live');
          }).catch(() => {});
        }
        return;
      }

      // Brand-new/never-synced entry — the live fetch is the only source.
      fetchMediaData(rawId)
        .then(data => {
          fullArrived = true;
          if (data) {
            onFull(data, true, 'live');
          } else {
            onError();
          }
        })
        .catch(() => {
          fullArrived = true;
          onError();
        });
    });
}
