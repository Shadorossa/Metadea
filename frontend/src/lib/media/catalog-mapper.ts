// Local-catalog (SQLite) → MediaPageData mapping — extracted from
// mediaService.ts (still re-exported from there). Builds immediately-usable
// page data from the local catalog so the page has *something* to show
// before the live API fetch completes; missing fields (stats, characters,
// relations, metaLines) are empty until then.
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData, MediaAuthor, MediaStat } from './types';
import { formatDateParts } from './mapper-utils';
import { getT } from '../../i18n/client';
import { IN_PROGRESS_STATUSES } from '../constants/media';

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
    // Platforms get their own dedicated block in the Datos section (see
    // MediaPage.tsx / data.platforms) instead of this line.
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
    titleRomaji:   c.title_romaji ?? undefined,
    // No dedicated catalog column for an "English" alternate title — this
    // partial/cached render just leaves it unset until the live API refetch
    // (which computes it fresh per provider) fills it back in.
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

// Inverse of mapCatalogEntryToPartialData — builds the row MediaPage.tsx
// upserts once live API data (or catalog fast-path data) is on screen, so
// the next F5/visit has this to build a partial render from instantly. id/
// created_at/updated_at are always regenerated: save_catalog_entry (Rust)
// looks up any existing row by external_id and keeps its real id/created_at,
// this call's values are just placeholders that satisfy MediaCatalogEntry's
// required fields.
export function mapMediaDataToCatalogEntry(data: MediaPageData, externalId: string): MediaCatalogEntry {
  const now = new Date().toISOString();
  return {
    id:                    '',
    external_id:           externalId,
    parent_id:             data.parentGame?.externalId ?? null,

    type:                  data.type,
    format:                data.format,
    source:                data.source,
    title_main:            data.titleMain   || undefined,
    title_native:          data.titleNative || undefined,
    title_romaji:          data.titleRomaji || undefined,
    synopsis:              data.description || undefined,
    cover_url:             data.cover       || undefined,
    banners_csv:           data.bannerImage || undefined,
    release_year:          data.releaseYear,
    release_month:         data.releaseMonth,
    release_day:           data.releaseDay,
    score_global:          data.scoreGlobal,
    time_length:           data.timeLength,
    status:                data.status,
    total_count:           data.totalCount,
    total_count_2:         data.totalCount_2,
    genres_csv:            data.genreDots    ? data.genreDots.split(' · ').join(',')    : undefined,
    genres_tag_csv:        data.genreTagDots ? data.genreTagDots.split(' · ').join(',') : undefined,
    platforms_csv:         data.platforms?.join(',') || undefined,
    // "platform|url" pairs — IGDB store links (Steam, GOG, ...). Neither
    // token can contain a comma so a flat CSV join/split round-trips safely.
    // data.storeLinks is null once the backend has checked this game *and*
    // its ports and found nothing — persisted as an explicit NULL rather
    // than left untouched, so "confirmed no links" is distinguishable from
    // "never checked" (undefined, non-game media types).
    shop_links_csv:        data.storeLinks === null
      ? null
      : data.storeLinks?.length
        ? data.storeLinks.map(l => `${l.platform}|${l.url}`).join(',')
        : undefined,
    companies_cache_csv:   data.companies?.length ? data.companies.join(',') : undefined,
    // Names only, same convention as companies_cache_csv — this is a flat
    // display cache for the instant partial-load path (mapCatalogEntryToPartialData),
    // not a relation store. The real author relations (id, image, role, url)
    // are synced separately via saveMediaAuthors, into media_author/media_by_author.
    authors_csv:           data.authors?.length ? data.authors.map(a => a.name).join(',') : undefined,
    created_at:            now,
    updated_at:            now,
  };
}
