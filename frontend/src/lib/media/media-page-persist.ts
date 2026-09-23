// Catalog write-back for a live media fetch: sticky-field reconciliation
// between the local media_catalog row and the fresh provider data, the
// blocked-relation filter, and the persist + sync-state bookkeeping. Split
// out of media-page-data.ts (still re-exported from there) so the merge
// rules are readable apart from provider dispatch and render staging.
import { saveCatalogEntry, getSyncState, setSyncState } from '../tauri';
import { invalidateMediaPageReads, readBlockedExternalIdsCached } from './media-page-read-cache';
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData } from './types';
import { firstCsvUrl, isRecompilationFilm } from './mappers/mapper-utils';

// Fields diffed for "did this fetch bring anything new" — excludes
// sticky-once-set fields (format/release date/banner) and bookkeeping columns.
export const NEW_DATA_COMPARE_FIELDS = [
  'title_main', 'title_native', 'title_romaji', 'title_english', 'synopsis', 'cover_url',
  'status', 'score_global', 'total_count', 'total_count_2',
  'genres_csv', 'genres_tag_csv', 'platforms_csv', 'shop_links_csv',
  'source_url', 'country_code',
] as const;

// AniList's own cover URL encodes its actual tier as a path segment, one
// step below what the GraphQL field that returned it implies (extraLarge
// -> ".../cover/large/...", large -> ".../cover/medium/...", medium ->
// ".../cover/small/..." — confirmed live). cover_url is normally sticky
// (see contentFields below) — but a stub row whose cover got seeded from a
// lower AniList tier (e.g. via a relation whose own extraLarge was missing,
// see anilist-mapper.ts) would otherwise never get repaired, since a fresh,
// better data.cover from this very fetch would just be discarded in favor
// of the stale low-tier one every time "Reintentar sincronización" ran.
export function isLowTierAniListCover(url: string | null | undefined): boolean {
  return !!url && /anilist\.co\/.*\/cover\/(medium|small)\//.test(url);
}

// Store links used to be sticky like every other content field (existing
// value wins outright, live fetch discarded) — meaning "Reintentar
// sincronización" could never backfill a storefront IGDB gained support
// for after the entry was first cataloged (e.g. Nintendo, added later —
// see build_store_links in igdb.rs), since a game that already had a Steam
// link stored just kept that one link forever. Merges by platform instead:
// an existing platform's URL wins (don't clobber a possibly hand-curated
// link), but a platform present in the fresh fetch and missing from
// `existing` gets added.
export function mergeShopLinksCsv(existingCsv: string | null | undefined, freshLinks: { platform: string; url: string }[]): string | null {
  const byPlatform = new Map<string, string>();
  for (const pair of (existingCsv ?? '').split(',')) {
    const [platform, url] = pair.split('|');
    if (platform && url) byPlatform.set(platform, url);
  }
  for (const { platform, url } of freshLinks) {
    if (platform && url && !byPlatform.has(platform)) byPlatform.set(platform, url);
  }
  if (byPlatform.size === 0) return null;
  return [...byPlatform].map(([platform, url]) => `${platform}|${url}`).join(',');
}

export async function persistToCatalog(data: MediaPageData, existing: MediaCatalogEntry | null, relationsChanged: boolean, refreshAniListTotalCount = false): Promise<void> {
  try {
    const shopLinks = mergeShopLinksCsv(existing?.shop_links_csv, data.storeLinks ?? []);

    // Computed up front so hasNewData can diff against `existing` directly.
    const contentFields: Pick<MediaCatalogEntry, typeof NEW_DATA_COMPARE_FIELDS[number]> = {
      title_main: existing?.title_main || data.titleMain || '',
      title_native: existing?.title_native || data.titleNative || null,
      title_romaji: existing?.title_romaji || data.titleRomaji || null,
      title_english: existing?.title_english || data.titleEnglish || null,
      synopsis: existing?.synopsis || data.description || null,
      // data-first, not existing-first like every field above: this runs
      // right after applyStickyLocalFields, which already resolved data.cover
      // to whichever is actually best (existing.cover_url as-is if it's a
      // good tier, or the live fetch's own fresh one if existing was a low
      // AniList tier that needed upgrading) — re-deriving that choice here
      // via existing?.cover_url || data.cover would just re-pick the stale
      // low-tier value every time, undoing the upgrade applyStickyLocalFields
      // just made.
      cover_url: data.cover || existing?.cover_url || null,
      status: existing?.status || data.status || null,
      score_global: existing?.score_global ?? (data.scoreGlobal || null),
      total_count: (refreshAniListTotalCount && data.source === 'anilist' && data.totalCount != null && data.totalCount !== existing?.total_count)
        ? data.totalCount
        : (existing?.total_count ?? (data.totalCount || null)),
      total_count_2: existing?.total_count_2 ?? (data.totalCount_2 || null),
      genres_csv: existing?.genres_csv || (data.genreDots ? data.genreDots.split(' · ').join(',') : null),
      genres_tag_csv: existing?.genres_tag_csv || (data.genreTagDots ? data.genreTagDots.split(' · ').join(',') : null),
      platforms_csv: existing?.platforms_csv || (data.platforms ? data.platforms.join(',') : null),
      shop_links_csv: shopLinks,
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
      format: data.type === 'event' && /^event:apisports:(?:football|basketball):\d+$/.test(data.externalId)
        ? 'Season'
        : existing?.format || data.format || null,
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
      // Normally only PrEditorModal's block toggle sets this — never cleared
      // by a resync. The one exception: a recap/compilation movie is
      // auto-blocked the first time it's fetched (see isRecompilationFilm),
      // no curator review needed for a purely mechanical text match.
      blocked_at: existing?.blocked_at ?? (data.source === 'anilist' && isRecompilationFilm(data.description) ? new Date().toISOString() : null),
      issue_source_id: existing?.issue_source_id ?? null,
      episode_source_id: existing?.episode_source_id ?? null,
      created_at: '',
      updated_at: '',
    };

    await saveCatalogEntry(entry).catch(console.error);
    // The row just changed under any memoised copy the page holds.
    invalidateMediaPageReads();

    // Read by needsResync() to decide when this entry is next due a check —
    // a fetch that brings nothing new widens the backoff too, not just real
    // errors, so this can't just be mark_synced's fixed "reset to 0".
    const existingSync = await getSyncState(data.externalId).catch(() => null);
    await setSyncState(
      data.externalId,
      new Date().toISOString(),
      hasNewData ? 0 : (existingSync?.sync_failed_count ?? 0) + 1,
      null,
    ).catch(() => {});
  } catch (e) {
    console.error("Failed to persist media to local SQLite cache", e);
  }
}

// Strips locally-blocked relations the live provider doesn't know about.
export async function filterBlockedRelations<T extends { relatedExternalId?: string }>(
  relations: T[],
  knownBlockedIds?: readonly string[],
): Promise<T[]> {
  const blockedIds = knownBlockedIds ?? await readBlockedExternalIdsCached().catch(() => [] as string[]);
  const blocked = new Set(blockedIds);
  return relations.filter(r => {
    const relation = r as T & { format?: string | null };
    return relation.format?.trim().toUpperCase() !== 'SUMMARY'
      && (!r.relatedExternalId || !blocked.has(r.relatedExternalId));
  });
}

// Curator-corrected fields take priority over this live fetch's result.
export function applyStickyLocalFields(data: MediaPageData, existing: MediaCatalogEntry | null): void {
  if (!existing) return;

  if (existing.type) data.type = existing.type;
  if (existing.format && !(data.type === 'event' && /^event:apisports:(?:football|basketball):\d+$/.test(data.externalId))) {
    data.format = existing.format;
  }
  if (existing.title_main) data.titleMain = existing.title_main;
  if (existing.title_romaji) data.titleRomaji = existing.title_romaji;
  if (existing.title_native) data.titleNative = existing.title_native;
  if (existing.title_english) data.titleEnglish = existing.title_english;
  if (existing.synopsis) data.description = existing.synopsis;
  // Same upgrade exception persistToCatalog applies below — without it,
  // this always overwrote the live fetch's fresh (already extraLarge-
  // preferring) data.cover with the stale low-tier one first, so by the
  // time persistToCatalog's own isLowTierAniListCover check ran, data.cover
  // had already been clobbered into matching existing.cover_url exactly —
  // there was nothing better left to upgrade to anymore.
  if (existing.cover_url && !isLowTierAniListCover(existing.cover_url)) data.cover = existing.cover_url;
  if (existing.banners_csv) data.bannerImage = firstCsvUrl(existing.banners_csv) ?? undefined;
  if (existing.genres_csv) data.genreDots = existing.genres_csv.split(',').join(' · ');
  if (existing.genres_tag_csv) data.genreTagDots = existing.genres_tag_csv.split(',').join(' · ');
  if (existing.platforms_csv) data.platforms = existing.platforms_csv.split(',').filter(Boolean);
  if (existing.country_code) data.countryOfOrigin = existing.country_code;
  if (existing.source_url) data.sourceUrl = existing.source_url;
  if (existing.issue_source_id) data.issueSourceId = existing.issue_source_id;
  if (existing.episode_source_id) data.episodeSourceId = existing.episode_source_id;
  if (existing.status) data.status = existing.status;
  if (existing.release_year != null) data.releaseYear = existing.release_year;
  if (existing.release_month != null) data.releaseMonth = existing.release_month;
  if (existing.release_day != null) data.releaseDay = existing.release_day;
  if (existing.release_end_year != null) data.releaseEndYear = existing.release_end_year;
  if (existing.release_end_month != null) data.releaseEndMonth = existing.release_end_month;
  if (existing.release_end_day != null) data.releaseEndDay = existing.release_end_day;
  // Author data has no sticky field of its own anymore (authors_csv is
  // retired — see db.rs migration 35) — data.authors stands as whatever the
  // live fetch just returned; the media_author/media_by_author relation
  // tables (loaded below via loadDbRelationsAndAuthors/saveMediaAuthors) are
  // the only persisted source now, and they carry image/url/external_id
  // properly instead of a bare comma-separated name list.
}
