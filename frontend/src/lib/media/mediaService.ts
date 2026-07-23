import { fetchAniListDetail } from '../search/providers/anilist';
import { fetchOpenLibWork, fetchOpenLibAuthor } from '../search/providers/openlibrary';
import { fetchTmdbDetail } from '../search/providers/tmdb';
import { fetchComicVineVolume, fetchComicVineIssue } from '../search/providers/comicvine';
import { mapAniListToMedia } from './anilist-mapper';
import { mapOpenLibToMedia } from './openlibrary-mapper';
import { mapComicVineToMedia, mapComicVineIssueToMedia } from './comicvine-mapper';
import { mapTmdbToMedia } from './tmdb-mapper';
import { mapIgdbToMedia, mergeBaseGameRelation, mergeRelationGraph, dedupeRelationsByTarget, type IgdbSubGame, type RelationGraphNode } from './igdb-mapper';
import { igdbGetGameDetail, igdbGetBaseGames, igdbGetRelationGraph, getCatalogEntry, saveCatalogEntry, markCatalogSyncFailed, getBlockedExternalIds } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData, MediaAuthor, MediaCompany } from './types';
import { saveMediaAuthors } from '../tauri/catalog';
import { getMediaCharacters, type DbMediaCharacter } from '../tauri/characters';
import { getMediaStaff } from '../tauri/staff';
import { getMediaCompanies, saveMediaCompanies } from '../tauri/companies';
import { parseExternalId } from './mapper-utils';
import { ANILIST_TYPES, IGDB_TYPES } from '../constants/media';
import { needsResync } from './media-status';

import { getCachedMediaData, setCachedMediaData, patchCachedRelations, invalidateCachedMediaData, CACHE_PREFIX } from './media-cache';
import { mapCatalogEntryToPartialData, mapMediaDataToCatalogEntry, inferProgressStatus } from './catalog-mapper';
import {
  sortRelationsForDisplay, bucketRelations, dbAuthorToMediaAuthor, dbCharacterToMediaCharacter,
  dbStaffToMediaStaff, dbCompanyToMediaCompany, mediaCharactersToSkeleton, mediaStaffToSkeleton, loadDbRelationsAndAuthors, mergeAndPersistRelations,
} from './media-relations';
import type { ProposalBundle } from '../github/submitCollaborativeProposal';
import { fetchBookEditions } from './book-editions';
import { fetchComicIssues } from './comic-issues';

// Re-exported so callers keep one import path despite the split into
// media-cache/media-relations/catalog-mapper/book-editions/comic-issues.
export {
  patchCachedRelations, invalidateCachedMediaData, CACHE_PREFIX,
  mapCatalogEntryToPartialData, mapMediaDataToCatalogEntry, inferProgressStatus,
  bucketRelations, mediaCharactersToSkeleton, mediaStaffToSkeleton, mergeAndPersistRelations,
  fetchBookEditions, fetchComicIssues,
};
export type { ComicIssuesResult } from './comic-issues';

// ── Fetch interno ─────────────────────────────────────────────────────────

export async function fetchMediaDataInternal(rawId: string): Promise<MediaPageData | null> {
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
    // Base-game/relation-graph queries are slow — deferred to fetchExtraRelations.
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

// Fields diffed for "did this fetch bring anything new" — excludes
// sticky-once-set fields (format/release date/banner) and bookkeeping columns.
const NEW_DATA_COMPARE_FIELDS = [
  'title_main', 'title_native', 'title_romaji', 'title_english', 'synopsis', 'cover_url',
  'status', 'score_global', 'total_count', 'total_count_2',
  'genres_csv', 'genres_tag_csv', 'platforms_csv', 'shop_links_csv',
  'authors_csv', 'source_url', 'country_code',
] as const;

async function persistToCatalog(data: MediaPageData, existing: MediaCatalogEntry | null, relationsChanged: boolean): Promise<void> {
  try {
    const shopLinks = (data.storeLinks ?? []).map(l => `${l.platform}|${l.url}`).join(',');

    // Computed up front so hasNewData can diff against `existing` directly.
    const contentFields: Pick<MediaCatalogEntry, typeof NEW_DATA_COMPARE_FIELDS[number]> = {
      title_main: existing?.title_main || data.titleMain || '',
      title_native: existing?.title_native || data.titleNative || null,
      title_romaji: existing?.title_romaji || data.titleRomaji || null,
      title_english: existing?.title_english || data.titleEnglish || null,
      synopsis: existing?.synopsis || data.description || null,
      cover_url: existing?.cover_url || data.cover || null,
      status: existing?.status || data.status || null,
      score_global: existing?.score_global ?? (data.scoreGlobal || null),
      total_count: existing?.total_count ?? (data.totalCount || null),
      total_count_2: existing?.total_count_2 ?? (data.totalCount_2 || null),
      genres_csv: existing?.genres_csv || (data.genreDots ? data.genreDots.split(' · ').join(',') : null),
      genres_tag_csv: existing?.genres_tag_csv || (data.genreTagDots ? data.genreTagDots.split(' · ').join(',') : null),
      platforms_csv: existing?.platforms_csv || (data.platforms ? data.platforms.join(',') : null),
      shop_links_csv: existing?.shop_links_csv || shopLinks || null,
      authors_csv: existing?.authors_csv || ((data.authors ?? []).map(a => a.name).join(',')),
      source_url: existing?.source_url || data.sourceUrl || null,
      country_code: existing?.country_code || data.countryOfOrigin || null,
    };

    // A fetch that brings nothing new widens needsResync()'s backoff too, not just real errors.
    const hasNewData = !existing || relationsChanged ||
      NEW_DATA_COMPARE_FIELDS.some(f => (contentFields[f] ?? null) !== (existing[f] ?? null));

    const entry: MediaCatalogEntry = {
      id: '', // Will be filled/matched by Rust if already exists
      external_id: data.externalId,
      parent_id: data.parentGame?.externalId || null,
      type: existing?.type || data.type,
      // Sticky: only the collaborative editor changes format again after
      // it's set (`||` not `??`: a legacy row can have format stored as '').
      format: existing?.format || data.format || null,
      source: data.source || 'igdb',
      ...contentFields,
      banners_csv: existing?.banners_csv || data.bannerImage || null,
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
      // Only PrEditorModal's block toggle sets this — never cleared by a resync.
      blocked_at: existing?.blocked_at ?? null,
      created_at: '',
      updated_at: '',
    };

    await saveCatalogEntry(entry).catch(console.error);
  } catch (e) {
    console.error("Failed to persist media to local SQLite cache", e);
  }
}

// Strips locally-blocked relations the live provider doesn't know about.
async function filterBlockedRelations<T extends { relatedExternalId?: string }>(relations: T[]): Promise<T[]> {
  const blockedIds = await getBlockedExternalIds().catch(() => [] as string[]);
  if (blockedIds.length === 0) return relations;
  const blocked = new Set(blockedIds);
  return relations.filter(r => !r.relatedExternalId || !blocked.has(r.relatedExternalId));
}

// Curator-corrected fields take priority over this live fetch's result.
function applyStickyLocalFields(data: MediaPageData, existing: MediaCatalogEntry | null): void {
  if (!existing) return;

  if (existing.type) data.type = existing.type;
  if (existing.format) data.format = existing.format;
  if (existing.title_main) data.titleMain = existing.title_main;
  if (existing.title_romaji) data.titleRomaji = existing.title_romaji;
  if (existing.title_native) data.titleNative = existing.title_native;
  if (existing.title_english) data.titleEnglish = existing.title_english;
  if (existing.synopsis) data.description = existing.synopsis;
  if (existing.cover_url) data.cover = existing.cover_url;
  if (existing.banners_csv) data.bannerImage = existing.banners_csv.split(',')[0];
  if (existing.genres_csv) data.genreDots = existing.genres_csv.split(',').join(' · ');
  if (existing.genres_tag_csv) data.genreTagDots = existing.genres_tag_csv.split(',').join(' · ');
  if (existing.platforms_csv) data.platforms = existing.platforms_csv.split(',').filter(Boolean);
  if (existing.country_code) data.countryOfOrigin = existing.country_code;
  if (existing.source_url) data.sourceUrl = existing.source_url;
  if (existing.status) data.status = existing.status;
  if (existing.release_year != null) data.releaseYear = existing.release_year;
  if (existing.release_month != null) data.releaseMonth = existing.release_month;
  if (existing.release_day != null) data.releaseDay = existing.release_day;
  if (existing.release_end_year != null) data.releaseEndYear = existing.release_end_year;
  if (existing.release_end_month != null) data.releaseEndMonth = existing.release_end_month;
  if (existing.release_end_day != null) data.releaseEndDay = existing.release_end_day;
  if (existing.authors_csv) {
    data.authors = existing.authors_csv.split(',').map(name => ({ name }));
  }
}

// Live fetch, blocked-relation filtering, and full DB persistence.
export async function fetchMediaData(rawId: string): Promise<MediaPageData | null> {
  const cached = getCachedMediaData(rawId);
  if (cached) return cached;

  const data = await fetchMediaDataInternal(rawId);
  if (!data) {
    // Bumps sync_failed_count so needsResync() backs off a failing provider; no-op if no catalog row yet.
    markCatalogSyncFailed(rawId, 'Live fetch returned no data').catch(() => {});
  }
  if (data) {
    if (data.relations) data.relations = await filterBlockedRelations(data.relations);

    const { authors: dbAuthors } = await loadDbRelationsAndAuthors(rawId);
    const existing = await getCatalogEntry(rawId).catch(() => null);
    applyStickyLocalFields(data, existing);

    // Checks deleted_relations so a deliberately-removed relation isn't silently re-added.
    const relationsChanged = await mergeAndPersistRelations(rawId, data.relations, data.format);

    await persistToCatalog(data, existing, relationsChanged);

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

    // Reload so the result reflects curated relations/authors.
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

// Every mapper's display line is always the 'publisher' role (games: the
// actual publisher; anime: the producers/production committee, AniList's
// non-main studios; movies/series: TMDB's production companies, which
// aren't split into roles) — never 'developer', and never a format-label
// fallback (format has its own dedicated Stats row). Book/comic's line is
// authors, untouched by this.
function companyMetaLine(companies: MediaCompany[]): string | undefined {
  const names = companies.filter(c => c.role === 'publisher').map(c => c.name);
  return names.length > 0 ? names.join(', ') : undefined;
}

// Fills in relations/authors/characters/staff/parent from local IPC reads
// only (no network) — fast enough to run before first paint.
async function enrichLocalData(rawId: string, catalog: MediaCatalogEntry, localData: MediaPageData): Promise<void> {
  const [{ relations: dbRels, authors: dbAuthors }, dbChars, dbStaff, dbCompanies, parentEntry] = await Promise.all([
    loadDbRelationsAndAuthors(rawId),
    getMediaCharacters(rawId).catch(() => [] as DbMediaCharacter[]),
    getMediaStaff(rawId).catch(() => [] as Awaited<ReturnType<typeof getMediaStaff>>),
    getMediaCompanies(rawId).catch(() => [] as Awaited<ReturnType<typeof getMediaCompanies>>),
    // Resolved to a full {externalId, title, cover} so isBlockedEdition (MediaPage.tsx) sees it here too.
    catalog.parent_id ? getCatalogEntry(catalog.parent_id).catch(() => null) : Promise.resolve(null),
  ]);

  if (dbRels.length > 0) {
    const { relations, hasSaga } = sortRelationsForDisplay(dbRels);
    localData.relations = relations;
    localData.hasSaga = hasSaga;
  }
  if (dbAuthors.length > 0) localData.authors = dbAuthors.map(dbAuthorToMediaAuthor);
  if (dbChars.length > 0) localData.characters = dbChars.map(dbCharacterToMediaCharacter);
  if (dbStaff.length > 0) localData.staff = dbStaff.map(dbStaffToMediaStaff);
  if (dbCompanies.length > 0) {
    localData.companies = dbCompanies.map(dbCompanyToMediaCompany);
    // The catalog-only fast path (mapCatalogEntryToPartialData) has no
    // company data to build this line from at all — companies are
    // relational now, not a catalog_media column — so it's patched in here
    // once the company table loads, same "flashes in late" tradeoff as
    // every other relational field on this page (authors, characters, ...).
    const companyLine = companyMetaLine(localData.companies);
    if (companyLine) localData.metaLines = [companyLine, ...localData.metaLines];
  }
  if (parentEntry) {
    localData.parentGame = {
      externalId: parentEntry.external_id,
      title: parentEntry.title_main || parentEntry.external_id,
      cover: parentEntry.cover_url ?? undefined,
    };
  }
}

export function fetchMediaDataWithFallback(
  rawId: string,
  onPartial: (data: MediaPageData) => void,
  onFull:    (data: MediaPageData) => void,
  onError:   () => void,
  // Lets the caller skip the background refresh once the user has navigated away.
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
          await enrichLocalData(rawId, catalog, localData);
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
      // Catalog data is the final answer for this render — a resync (if due) only refreshes in the background.
      if (hasLocalData && localData) {
        fullArrived = true;
        onFull(localData);
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
        if (catalogEntry && needsResync(catalogEntry) && !isCancelled()) {
          fetchMediaData(rawId).then(fresh => {
            if (fresh && !isCancelled()) onFull(fresh);
          }).catch(() => {});
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

// Background: walks the transitive IGDB relation graph after the page
// already has full data. Doesn't call patchCachedRelations itself — by the
// time this resolves the user may have navigated away, so callers must
// patch the cache themselves, gated on their own relevance check.
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

  updatedData.relations = await filterBlockedRelations(updatedData.relations);
  if (updatedData.relations.length === currentData.relations.length) return null;

  return updatedData.relations;
}

// Simulates a merged proposal PR for the preview modal — never fetches or
// writes anything. `baseline` fills in fields the proposal itself doesn't
// touch, since bundle.media_catalog only carries what actually changed.
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
