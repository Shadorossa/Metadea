import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { getAllLibraryEntries, getAllCharactersLight, getAllFavoriteCustomImages, getCharacterReactions, emptyCharacterReactionGroups, readMonthlyHistoryTyped, readUserFavoritesTyped, readUserJourneyTyped } from '../../../lib/tauri';
import type { CatalogSummary, FavoriteCustomImage, DayJourney } from '../../../lib/tauri';
import { getT } from '../../../i18n/runtime';
import { escapeHtml } from '../../../lib/shared/text/sanitize-html';
import { beginGlobalLoading } from '../../../lib/dom/global-loading';
import { getCachedLibraryAndCatalog, getCachedMediaRelations } from '../../../lib/profile/library-data-cache';
import { syncActiveRatingSystemFromCachedInfo } from '../../../lib/profile/user-info';
import { resolveCachedCoverPaths } from '../../../lib/profile/cover-cache';
import { OverviewSection, overviewCoverIds, type OverviewData } from '../OverviewSection';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

// One React root per pane element — renderOverview re-renders in place on
// 'refresh-profile-library' instead of tearing the tab down.
let overviewRoot: { el: HTMLElement; root: Root } | null = null;

// Every Tauri round trip this tab needs besides the library/catalog bundle
// — all independent of each other, so batched instead of a sequential await
// chain. Catalog entries are skipped when the caller already has them
// (profile.astro's init() resolves the same scoped catalog for its own
// click-delegation lookups). Relations, the rating system and the journey
// come from the page-level caches: the Library/Stats tabs read the same rows.
function fetchOverviewData(catalog?: CatalogSummary[] | Promise<CatalogSummary[]>) {
  return Promise.all([
    catalog ? Promise.resolve(catalog) : getCachedLibraryAndCatalog().then(bundle => bundle.catalog),
    readMonthlyHistoryTyped().catch(() => ({} as Record<string, string[]>)),
    syncActiveRatingSystemFromCachedInfo(),
    readUserFavoritesTyped().catch(() => ({} as Record<string, string[]>)),
    getAllCharactersLight().catch(() => []),
    getAllFavoriteCustomImages().catch(() => [] as FavoriteCustomImage[]),
    // Fetched here, in parallel, instead of left to ActivitySection's own
    // on-mount fetch — "Actividad reciente" used to appear last by a wide
    // margin even though its own fetch is cheap.
    readUserJourneyTyped().catch(() => [] as DayJourney[]),
    // Anime/series seasons are only linked by SEQUEL/PREQUEL edges — needed
    // to count a saga as one work.
    getCachedMediaRelations(),
    // The monthly history's character view (like / interested / dislike).
    getCharacterReactions().catch(() => emptyCharacterReactionGroups()),
  ]);
}

type FetchedOverview = Awaited<ReturnType<typeof fetchOverviewData>>;

// profile.astro starts these round trips right after the auth check, in
// the same tick as the (much larger) library/catalog fetch. Consumed exactly
// once: a later re-render ('refresh-profile-library') fetches afresh.
let pendingOverviewData: Promise<FetchedOverview> | null = null;

export function prefetchOverviewData(catalog: Promise<CatalogSummary[]>): void {
  pendingOverviewData = fetchOverviewData(catalog);
}

function mountOverview(el: HTMLElement, data: OverviewData): void {
  if (overviewRoot && overviewRoot.el !== el) {
    overviewRoot.root.unmount();
    overviewRoot = null;
  }
  if (!overviewRoot) overviewRoot = { el, root: createRoot(el) };
  overviewRoot.root.render(createElement(OverviewSection, { data }));
}

/** The owner's Overview: local tables → the shared OverviewSection. */
export async function renderOverview(el: HTMLElement, items: Items, catalog?: CatalogSummary[]): Promise<void> {
  const endLoading = beginGlobalLoading();
  try {
    const prefetched = pendingOverviewData;
    pendingOverviewData = null;
    const [catalogEntries, monthlyHistory, system, favorites, characterEntries, customImages, journey, sagaRelations, characterReactions] =
      await (prefetched ?? fetchOverviewData(catalog));

    // Covers the tab paints from plain props / string HTML — resolved before
    // rendering so every <img> gets its final src directly.
    const coverPathById = await resolveCachedCoverPaths(overviewCoverIds(favorites, monthlyHistory));

    mountOverview(el, {
      items,
      catalogMap: new Map(catalogEntries.map(e => [e.external_id, e])),
      monthlyHistory,
      system,
      favorites,
      characterMap: new Map(characterEntries.map(c => [c.external_id, c])),
      customImageMap: new Map(customImages.map(c => [c.external_id, c])),
      coverPathById,
      journey,
      sagaRelations,
      characterReactions,
    });
  } catch (error) {
    console.error("renderOverview failed:", error);
    overviewRoot?.root.unmount();
    overviewRoot = null;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? '' : '';
    el.innerHTML = `<div style="padding: 2rem; color: #ef4444; font-family: monospace; font-size: 0.9rem;">
      ${escapeHtml(getT().profile.overview_render_error.replace('{message}', message))}<br/>
      <pre>${escapeHtml(stack)}</pre>
    </div>`;
  } finally {
    endLoading();
  }
}
