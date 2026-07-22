import { fetchAniListDetail } from '../search/providers/anilist';
import { fetchOpenLibWork, fetchOpenLibAuthor, fetchOpenLibEditions, openLibCoverUrl, bookIdFromWorkKey } from '../search/providers/openlibrary';
import type { OpenLibEdition } from '../search/providers/openlibrary';
import { fetchTmdbDetail } from '../search/providers/tmdb';
import { fetchComicVineVolume, fetchComicVineIssues, fetchComicVineIssue, fetchComicVineVolumeCast } from '../search/providers/comicvine';
import { comicVineSearch, type ComicVineIssue } from '../tauri';
import { unifyGenres } from './genre-unifier';
import { mapAniListToMedia } from './anilist-mapper';
import { mapOpenLibToMedia } from './openlibrary-mapper';
import { mapComicVineToMedia, mapComicVineIssueToMedia } from './comicvine-mapper';
import { mapTmdbToMedia } from './tmdb-mapper';
import { mapIgdbToMedia, mergeBaseGameRelation, mergeRelationGraph, dedupeRelationsByTarget, type IgdbSubGame, type RelationGraphNode } from './igdb-mapper';
import { igdbGetGameDetail, igdbGetBaseGames, igdbGetRelationGraph, getCatalogEntry, saveCatalogEntry, markCatalogSyncFailed, getBlockedExternalIds } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData, MediaAuthor, MediaCharacter } from './types';
import { saveMediaAuthors } from '../tauri/catalog';
import { getMediaCharacters, type DbMediaCharacter } from '../tauri/characters';
import { getMediaStaff } from '../tauri/staff';
import { parseExternalId } from './mapper-utils';
import { ANILIST_TYPES, IGDB_TYPES } from '../constants/media';
import { needsResync } from './media-status';

import { getCachedMediaData, setCachedMediaData, patchCachedRelations, invalidateCachedMediaData, CACHE_PREFIX } from './media-cache';
import { mapCatalogEntryToPartialData, mapMediaDataToCatalogEntry, inferProgressStatus } from './catalog-mapper';
import {
  sortRelationsForDisplay, bucketRelations, dbAuthorToMediaAuthor, dbCharacterToMediaCharacter,
  dbStaffToMediaStaff, mediaCharactersToSkeleton, mediaStaffToSkeleton, loadDbRelationsAndAuthors, mergeAndPersistRelations,
} from './media-relations';
import type { ProposalBundle } from '../github/submitCollaborativeProposal';

// Re-exported so callers keep one import path even though these concerns
// now live in their own files (media-cache/media-relations/catalog-mapper).
export {
  patchCachedRelations, invalidateCachedMediaData, CACHE_PREFIX,
  mapCatalogEntryToPartialData, mapMediaDataToCatalogEntry, inferProgressStatus,
  bucketRelations, mediaCharactersToSkeleton, mediaStaffToSkeleton, mergeAndPersistRelations,
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

    // Banner/store links ride along as Game sub-fields in one request.
    const game = await igdbGetGameDetail(numericId);
    if (!game) return null;
    let data = mapIgdbToMedia(game, rawId);
    data.relations = dedupeRelationsByTarget(data.relations);

    // Base-game (PARENT) and transitive relation graph both need slow
    // reverse/multi-hop queries — deferred to fetchExtraRelations so they
    // don't block the initial render.

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

// Background fetch: all editions for a book, merged with existing relations.
// Same pattern as fetchExtraRelations for games.
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

// Background fetch: all issues for a comic volume ('Issues' tab), plus the
// full cast/genres aggregated across every issue — the volume's own
// character_credits (used for the quick initial display) is usually just a
// first-issue sample, since Comic Vine editors rarely fill the volume-level
// field. Runs once per comic; results get persisted.
export async function fetchComicIssues(
  rawId: string,
  currentRelations: MediaPageData['relations'],
  issuesLabel: string,
  titleMain?: string,
  altTitle?: string,
): Promise<ComicIssuesResult> {
  const isComic = rawId.startsWith('comic:');
  let volumeId: number | null = null;

  if (isComic) {
    const idStr = rawId.slice(rawId.indexOf(':') + 1);
    const parsed = parseInt(idStr, 10);
    if (Number.isFinite(parsed)) {
      volumeId = parsed;
    }
  }

  if (!volumeId) {
    if (!titleMain) return { relations: null, characters: [] };
    const searchRes = await comicVineSearch(titleMain).catch(() => null);

    const pickBestVolume = (vols?: typeof searchRes.volumes) => {
      if (!vols || vols.length === 0) return null;
      const lowerTitle = titleMain.toLowerCase().trim();
      const exact = vols.find(v => v.name.toLowerCase().trim() === lowerTitle);
      if (exact) return exact;
      const contains = vols.find(v => v.name.toLowerCase().includes(lowerTitle) || lowerTitle.includes(v.name.toLowerCase()));
      if (contains) return contains;
      const sorted = [...vols].sort((a, b) => (b.count_of_issues ?? 0) - (a.count_of_issues ?? 0));
      return sorted[0];
    };

    let matchedVol = pickBestVolume(searchRes?.volumes);
    if (!matchedVol && altTitle && altTitle !== titleMain) {
      const searchAltRes = await comicVineSearch(altTitle).catch(() => null);
      matchedVol = pickBestVolume(searchAltRes?.volumes);
    }

    if (matchedVol) {
      volumeId = matchedVol.id;
    } else {
      return { relations: null, characters: [] };
    }
  }

  const issues = await fetchComicVineIssues(volumeId).catch(() => []);
  if (!issues.length) return { relations: null, characters: [] };

  const cast = isComic ? await fetchComicVineVolumeCast(issues.map(i => i.id)) : { characters: [], concepts: [] };
  const characters: MediaCharacter[] = cast.characters.map(c => ({
    id: `character:comicvine:${c.id}`,
    name: c.name,
    image: c.image?.medium_url ?? c.image?.small_url ?? undefined,
  }));
  const { core, tags } = unifyGenres(cast.concepts.map(c => c.name));
  const genreDots = isComic ? (core.join(' · ') || undefined) : undefined;
  const genreTagDots = isComic ? (tags.join(' · ') || undefined) : undefined;

  const issueRelations = issuesToRelations(issues, issuesLabel);
  if (!issueRelations.length) return { relations: null, characters, genreDots, genreTagDots };
  const withoutOld = (Array.isArray(currentRelations) ? currentRelations : []).filter(r => r.relationType !== 'ISSUE');
  return { relations: [...withoutOld, ...issueRelations], characters, genreDots, genreTagDots };
}

// Fields worth diffing for "did this fetch bring anything new" — excludes
// sticky-once-set fields (format/release date/banner, which never register
// as changed once already present) and bookkeeping columns.
const NEW_DATA_COMPARE_FIELDS = [
  'title_main', 'title_native', 'title_romaji', 'title_english', 'synopsis', 'cover_url',
  'status', 'score_global', 'total_count', 'total_count_2',
  'genres_csv', 'genres_tag_csv', 'platforms_csv', 'shop_links_csv',
  'publishers_csv', 'authors_csv', 'source_url', 'developer_badge', 'country_code',
] as const;

async function persistToCatalog(data: MediaPageData, existing: MediaCatalogEntry | null, relationsChanged: boolean): Promise<void> {
  try {
    const shopLinks = (data.storeLinks ?? []).map(l => `${l.platform}|${l.url}`).join(',');

    // Computed up front so hasNewData can diff against `existing` directly.
    const contentFields: Pick<MediaCatalogEntry, typeof NEW_DATA_COMPARE_FIELDS[number]> = {
      title_main: data.titleMain || existing?.title_main || '',
      title_native: data.titleNative || existing?.title_native || null,
      title_romaji: data.titleRomaji || existing?.title_romaji || null,
      title_english: data.titleEnglish || existing?.title_english || null,
      synopsis: data.description || null,
      cover_url: data.cover || null,
      status: data.status || null,
      score_global: data.scoreGlobal || null,
      total_count: data.totalCount || null,
      total_count_2: data.totalCount_2 || null,
      genres_csv: data.genreDots ? data.genreDots.split(' · ').join(',') : null,
      genres_tag_csv: data.genreTagDots ? data.genreTagDots.split(' · ').join(',') : null,
      platforms_csv: data.platforms ? data.platforms.join(',') : null,
      shop_links_csv: shopLinks || null,
      publishers_csv: data.publishers ? data.publishers.join(',') : null,
      authors_csv: (data.authors ?? []).map(a => a.name).join(','),
      source_url: data.sourceUrl || null,
      developer_badge: data.developerBadge || null,
      country_code: data.countryOfOrigin || null,
    };

    // A fetch that brings nothing new widens needsResync()'s backoff the
    // same way a genuine provider error does, instead of retrying forever.
    const hasNewData = !existing || relationsChanged ||
      NEW_DATA_COMPARE_FIELDS.some(f => (contentFields[f] ?? null) !== (existing[f] ?? null));

    const entry: MediaCatalogEntry = {
      id: '', // Will be filled/matched by Rust if already exists
      external_id: data.externalId,
      parent_id: data.parentGame?.externalId || null,
      type: data.type,
      // Sticky: once set, only the collaborative editor changes format/
      // release date again — a live re-fetch must not reset a manual
      // correction back to whatever the API says. `||` not `??` since a
      // legacy row can have format stored as '' rather than null.
      format: existing?.format || data.format || null,
      source: data.source || 'igdb',
      ...contentFields,
      banners_csv: data.bannerImage || existing?.banners_csv || null,
      release_year: existing?.release_year ?? (data.releaseYear || null),
      release_month: existing?.release_month ?? (data.releaseMonth || null),
      release_day: existing?.release_day ?? (data.releaseDay || null),
      release_end_year: existing?.release_end_year ?? (data.releaseEndYear || null),
      release_end_month: existing?.release_end_month ?? (data.releaseEndMonth || null),
      release_end_day: existing?.release_end_day ?? (data.releaseEndDay || null),
      time_length: data.timeLength || null,
      // Read by needsResync() to decide when this entry is next due a check.
      last_synced_at: new Date().toISOString(),
      sync_failed_count: hasNewData ? 0 : (existing?.sync_failed_count ?? 0) + 1,
      last_sync_error: null,
      // Never set here — only PrEditorModal's block toggle ever sets this,
      // and a live resync must never silently clear it back to visible.
      blocked_at: existing?.blocked_at ?? null,
      created_at: '',
      updated_at: '',
    };

    await saveCatalogEntry(entry).catch(console.error);
  } catch (e) {
    console.error("Failed to persist media to local SQLite cache", e);
  }
}

// Live fetch, blocked-relation filtering, and full DB persistence.
export async function fetchMediaData(rawId: string): Promise<MediaPageData | null> {
  const cached = getCachedMediaData(rawId);
  if (cached) return cached;

  const data = await fetchMediaDataInternal(rawId);
  if (!data) {
    // No-ops if there's no catalog row yet; otherwise bumps sync_failed_count
    // so needsResync() can back off a title whose provider keeps failing.
    markCatalogSyncFailed(rawId, 'Live fetch returned no data').catch(() => {});
  }
  if (data) {
    // The live provider doesn't know a related title was blocked locally —
    // strip those out before they ever reach the screen or get persisted.
    const blockedIds = await getBlockedExternalIds().catch(() => [] as string[]);
    if (blockedIds.length > 0 && data.relations) {
      const blocked = new Set(blockedIds);
      data.relations = data.relations.filter(r => !r.relatedExternalId || !blocked.has(r.relatedExternalId));
    }

    const { authors: dbAuthors } = await loadDbRelationsAndAuthors(rawId);

    // persistToCatalog preserves an existing banner, but `data` is also shown
    // on screen — patch it too so a bannerless fetch doesn't flash empty.
    const existing = await getCatalogEntry(rawId).catch(() => null);
    if (!data.bannerImage && existing?.banners_csv) {
      data.bannerImage = existing.banners_csv.split(',')[0];
    }

    // mergeAndPersistRelations checks deleted_relations so a relation the
    // user deliberately removed isn't silently re-added by this same fetch.
    const relationsChanged = await mergeAndPersistRelations(rawId, data.relations, data.format);

    await persistToCatalog(data, existing, relationsChanged);

    // Only overwrite API authors if we have none locally yet, or the ones we
    // do have are missing an image — otherwise leave curated authors alone.
    const authorsMissingImage = dbAuthors.length > 0 && dbAuthors.every(a => !a.image);
    if ((dbAuthors.length === 0 || authorsMissingImage) && data.authors && data.authors.length > 0) {
      await saveMediaAuthors(rawId, data.authors!).catch(console.error);
    }

    // Reload so the final data object reflects curated relations/authors.
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

// Fire-and-forget: call on hover to warm the cache.
export function prefetchMediaData(rawId: string): void {
  if (getCachedMediaData(rawId)) return;
  fetchMediaData(rawId).catch(() => {});
}

// Catalog-first fetch: shows catalog data immediately while API loads in background.
// onPartial fires as soon as catalog data is available; onFull fires when API completes.
export function fetchMediaDataWithFallback(
  rawId: string,
  onPartial: (data: MediaPageData) => void,
  onFull:    (data: MediaPageData) => void,
  onError:   () => void,
  // Lets the caller skip the background refresh below once the user has
  // navigated away — that fetch/persist no longer serves any purpose.
  isCancelled: () => boolean = () => false,
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

  getCatalogEntry(rawId)
    .then(async catalog => {
      if (catalog && catalog.title_main) {
        catalogEntry = catalog;
        hasLocalData = true;
        localData = mapCatalogEntryToPartialData(catalog);

        try {
          // All local IPC reads — no network involved, so gathering them
          // before the first paint (instead of painting an empty characters/
          // relations/staff grid that pops in a beat later) still lands fast.
          // Only an actual live API fetch is slow enough to justify painting
          // ahead of it.
          const [{ relations: dbRels, authors: dbAuthors }, dbChars, dbStaff, parentEntry] = await Promise.all([
            loadDbRelationsAndAuthors(rawId),
            getMediaCharacters(rawId).catch(() => [] as DbMediaCharacter[]),
            getMediaStaff(rawId).catch(() => [] as Awaited<ReturnType<typeof getMediaStaff>>),
            // catalog.parent_id is just the id — resolved to a full
            // {externalId, title, cover} object so isBlockedEdition
            // (MediaPage.tsx) sees a parentGame here too, not just on live fetch.
            catalog.parent_id ? getCatalogEntry(catalog.parent_id).catch(() => null) : Promise.resolve(null),
          ]);

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

          if (dbStaff.length > 0) {
            localData.staff = dbStaff.map(dbStaffToMediaStaff);
          }

          if (parentEntry) {
            localData.parentGame = {
              externalId: parentEntry.external_id,
              title: parentEntry.title_main || parentEntry.external_id,
              cover: parentEntry.cover_url ?? undefined,
            };
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
      // Catalog data, if usable, is always the final answer for this render
      // — a live re-fetch (if needsResync() says one is due) only happens
      // silently in the background to refresh the row for next time, never
      // to replace what's already on screen.
      if (hasLocalData && localData) {
        fullArrived = true;
        onFull(localData);
        if (catalogEntry && needsResync(catalogEntry) && !isCancelled()) {
          fetchMediaData(rawId).catch(() => {});
        }
        return;
      }

      // Brand-new/never-synced entry — the live fetch is the only source.
      fetchMediaData(rawId)
        .then(data => {
          fullArrived = true;
          if (data) {
            onFull(data);
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

// Background enrichment: walks the transitive IGDB relation graph (a few
// sequential requests) after the page already has full data, so this never
// blocks the initial render. Does NOT call patchCachedRelations() itself —
// by the time this resolves the user may have navigated away, and writing
// unconditionally could corrupt a different, now-current page's cache entry.
// Callers must patch the cache themselves, gated on their own "still
// relevant" check (see MediaPage.tsx's `cancelled` flag).
export async function fetchExtraRelations(rawId: string, currentData: MediaPageData): Promise<MediaPageData['relations'] | null> {
  const { type, id: numericId } = parseExternalId(rawId);
  if (!IGDB_TYPES.includes(type)) return null;
  if (!numericId) return null;

  // Relation graph and optional base-game (PARENT) lookup, in parallel.
  const isRemake = currentData.format === 'REMAKE';
  const isRemaster = currentData.format === 'REMASTER';

  const graphPromise = igdbGetRelationGraph(numericId).catch(() => []);
  const baseGamesPromise = (isRemake || isRemaster)
    ? igdbGetBaseGames(numericId, isRemake ? 'remakes' : 'remasters').catch(() => null)
    : Promise.resolve(null);

  const [graphNodes, baseGames] = await Promise.all([graphPromise, baseGamesPromise]);

  let updatedData = { ...currentData };

  if (baseGames && baseGames.length > 0) {
    updatedData = mergeBaseGameRelation(updatedData, baseGames as IgdbSubGame[]);
  }

  if (graphNodes.length > 0) {
    const gameType = currentData.format === 'EXPANDED_GAME' ? 10 : undefined;
    updatedData = mergeRelationGraph(updatedData, graphNodes as RelationGraphNode[], gameType);
  }

  if (updatedData.relations.length === currentData.relations.length) return null; // nothing new

  // Same blocked-relation filter as fetchMediaData.
  const blockedIds = await getBlockedExternalIds().catch(() => [] as string[]);
  if (blockedIds.length > 0) {
    const blocked = new Set(blockedIds);
    updatedData.relations = updatedData.relations.filter(r => !r.relatedExternalId || !blocked.has(r.relatedExternalId));
    if (updatedData.relations.length === currentData.relations.length) return null;
  }

  return updatedData.relations;
}

// Simulates what a collaborative-catalog proposal PR would look like once
// merged, for the PR preview modal — never fetches or writes anything.
// `baseline` (the current local catalog entry, or null if this would be a
// brand-new entry) fills in fields the proposal itself doesn't touch, since
// bundle.media_catalog only carries what PrEditorModal actually changed.
export function buildPreviewMediaPageData(bundle: ProposalBundle, baseline: MediaCatalogEntry | null): MediaPageData {
  const merged: MediaCatalogEntry = baseline ? { ...baseline, ...bundle.media_catalog } : bundle.media_catalog;
  const base = mapCatalogEntryToPartialData(merged);

  const ownRelations = bundle.media_relations.filter(
    r => !r.media_external_id || r.media_external_id === bundle.media_catalog.external_id,
  );
  const { relations, hasSaga } = sortRelationsForDisplay(ownRelations);

  return {
    ...base,
    relations,
    hasSaga,
    characters: bundle.characters.map(dbCharacterToMediaCharacter),
    authors: bundle.media_authors.length > 0 ? bundle.media_authors.map(dbAuthorToMediaAuthor) : base.authors,
  };
}
