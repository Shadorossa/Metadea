// Façade for the media page's data layer. The implementation is split by
// concern into sibling media-page-* modules; every symbol below keeps its
// original import path so the 20+ callers stay untouched:
//
//   media-page-fetch.ts       provider dispatch by external-id prefix
//   media-page-cache.ts       session-cache hit normalization
//   media-page-persist.ts     sticky-field reconciliation + catalog write-back
//   media-page-local-data.ts  local-only (IPC) enrichment, hover prefetch
//   media-page-load.ts        fetchMediaData + partial/full render staging
//   media-page-enrich.ts      background relation-graph / character top-ups
//   media-page-preview.ts     merged-proposal preview for the PR modal
import { patchCachedRelations, patchCachedCharacters, invalidateCachedMediaData, CACHE_PREFIX } from './media-cache';
import { mapCatalogEntryToPartialData, mapMediaDataToCatalogEntry, inferProgressStatus } from './mappers/catalog-mapper';
import {
  bucketRelations, mediaCharactersToSkeleton, mediaStaffToSkeleton, mergeAndPersistRelations,
} from './saga/media-relations';
import { fetchBookEditions } from './editions/book-editions';
import { fetchComicIssues } from './editions/comic-issues';
import { fetchComicCollectedEditions } from './editions/comic-collected-editions';
import { fetchMediaEpisodes } from './episodes/episode-list';
import { fetchMediaThemes, getAnimePrequelThemeOffsets } from './themes/theme-list';

// Re-exported so callers keep one import path despite the split into
// media-cache/media-relations/catalog-mapper/book-editions/comic-issues/
// comic-collected-editions/episode-list/theme-list.
export {
  patchCachedRelations, patchCachedCharacters, invalidateCachedMediaData, CACHE_PREFIX,
  mapCatalogEntryToPartialData, mapMediaDataToCatalogEntry, inferProgressStatus,
  bucketRelations, mediaCharactersToSkeleton, mediaStaffToSkeleton, mergeAndPersistRelations,
  fetchBookEditions, fetchComicIssues, fetchComicCollectedEditions, fetchMediaEpisodes,
  fetchMediaThemes, getAnimePrequelThemeOffsets,
};
export type { ComicIssuesResult } from './editions/comic-issues';

export { fetchMediaDataInternal } from './media-page-fetch';
export { fetchMediaData, fetchMediaDataWithFallback } from './media-page-load';
export type { MediaPageDataSource } from './media-page-load';
export { prefetchMediaData } from './media-page-local-data';
export { fetchExtraRelations, fetchExtraCharacters } from './media-page-enrich';
export { buildPreviewMediaPageData } from './media-page-preview';
