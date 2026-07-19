// Local-catalog (SQLite) → MediaPageData mapping — extracted from
// mediaService.ts (still re-exported from there). Builds immediately-usable
// page data from the local catalog so the page has *something* to show
// before the live API fetch completes; missing fields (stats, characters,
// relations, metaLines) are empty until then.
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData, MediaAuthor, MediaStat } from './types';
import { formatDateParts, lookupLabel, countryName } from './mapper-utils';
import { getT } from '../../i18n/client';
import { IN_PROGRESS_STATUSES } from '../constants/media';

export function inferProgressStatus(type: string): typeof IN_PROGRESS_STATUSES[number] {
  const base = type.split('_')[0];
  if (base === 'game' || base === 'vnovel') return 'playing';
  if (base === 'anime' || base === 'series' || base === 'movie') return 'watching';
  return 'reading';
}

export function mapCatalogEntryToPartialData(c: MediaCatalogEntry, progressLabel: string = getT().media.progress_in_progress): MediaPageData {
  const tm = getT().media;
  const authorList = c.authors_csv ? c.authors_csv.split(',').filter(Boolean) : [];
  const authors: MediaAuthor[] = authorList.map(name => ({ external_id: `author:${name}`, name }));
  const stats: MediaStat[] = [];
  // Same "Formato | Estado" and score stats every live mapper builds — this
  // catalog-only fast path (shown whenever needsResync() says a live fetch
  // isn't due yet, i.e. most visits after the first) used to only ever
  // rebuild the author stat, silently dropping score/format/status from the
  // Datos section on every subsequent visit even though they were already
  // saved to the catalog row.
  // Order matters here — it must match each live mapper's own stats push
  // order (anilist-mapper: score, author, episodes/chapters, format|status,
  // country; igdb/tmdb-mapper follow their own equivalent order), or the
  // Datos section visibly reorders itself the instant a live/full fetch
  // replaces this fast-path render with the live mapper's stats array.
  if (c.score_global != null) {
    stats.push({ label: tm.stat_score, value: String(c.score_global), isScore: true });
  }
  if (authorList.length > 0) {
    stats.push({
      label: authorList.length > 1 ? 'Autores' : 'Autor',
      value: authorList.join(', '),
    });
  }
  if (c.type === 'anime' || c.type === 'series') {
    if (c.total_count) {
      stats.push({ label: tm.stat_episodes, value: String(c.total_count), label2: tm.stat_seasons, value2: String(c.total_count_2 ?? 1) });
    }
  } else if (c.type === 'manga' || c.type === 'lnovel') {
    if (c.total_count || c.total_count_2) {
      const chaptersStat: MediaStat = { label: tm.stat_chapters, value: String(c.total_count ?? 0) };
      if (c.total_count_2) {
        chaptersStat.label2 = tm.stat_volumes;
        chaptersStat.value2 = String(c.total_count_2);
      }
      stats.push(chaptersStat);
    }
  }
  // Same slot anilist-mapper (anime only) / tmdb-mapper (movie, or tv when
  // known) use for duration — right after episodes/chapters, before
  // format|status. Never persisted before, so it was silently dropped here.
  if (c.time_length && (c.type === 'anime' || c.type === 'movie' || c.type === 'series')) {
    stats.push({ label: tm.stat_duration, value: `${c.time_length} min` });
  }
  if (c.format || c.status) {
    const formatLabel = c.format ? lookupLabel(tm.formats, c.format, c.format) : undefined;
    const statusLabel = c.status ? lookupLabel(tm.statuses, c.status, c.status) : undefined;
    const formatStat: MediaStat = { label: tm.stat_format, value: formatLabel ?? '' };
    if (statusLabel) {
      formatStat.label2 = tm.stat_status;
      formatStat.value2 = statusLabel;
    }
    stats.push(formatStat);
  }
  if (c.country_code) {
    stats.push({ label: tm.stat_country, value: countryName(c.country_code) ?? c.country_code });
  }

  const companies = c.publishers_csv ? c.publishers_csv.split(',').filter(Boolean) : [];
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
    // MediaPage.tsx / data.platforms) instead of this line. Publisher(s)
    // only, matching igdb-mapper.ts's own live-fetch metaLines exactly —
    // read straight from publishers_csv (persisted separately, verbatim)
    // rather than derived by subtracting the developer's name out of the
    // merged `companies` list. That subtraction used to hide a company that
    // legitimately is both developer and publisher (e.g. a self-published
    // title), since companies_cache_csv can't tell the two roles apart once
    // flattened.
    const publishers = c.publishers_csv ? c.publishers_csv.split(',').filter(Boolean) : companies;
    if (publishers.length > 0) metaLines.push(publishers.join(', '));
  } else {
    if (companies.length > 0) metaLines.push(companies.join(', '));
    // Chapter/volume/episode counts already have their own dedicated stat
    // row (Capítulos | Volúmenes / Episodios | Temporadas, built above) —
    // repeating them here too was redundant with that row.
    const formatLabel = c.format ? lookupLabel(tm.formats, c.format, c.format) : undefined;
    if (formatLabel) metaLines.push(formatLabel);
  }

  // Mirrors anilist-mapper's own dateBadge: "start - end" once an end date
  // exists, not just the start — the fast path used to only ever persist/
  // rebuild the start date, so a finished series' range would only show up
  // once (if ever) a live fetch actually ran.
  const startFmt = formatDateParts({ year: c.release_year, month: c.release_month, day: c.release_day });
  const endFmt = formatDateParts({ year: c.release_end_year, month: c.release_end_month, day: c.release_end_day });
  const dateBadge = startFmt ? (endFmt ? `${startFmt} - ${endFmt}` : startFmt) : undefined;

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
    countryOfOrigin: c.country_code ?? undefined,
    scoreGlobal:   c.score_global  ?? undefined,
    releaseYear:   c.release_year  ?? undefined,
    releaseMonth:  c.release_month ?? undefined,
    releaseDay:    c.release_day   ?? undefined,
    releaseEndYear:  c.release_end_year  ?? undefined,
    releaseEndMonth: c.release_end_month ?? undefined,
    releaseEndDay:   c.release_end_day   ?? undefined,
    timeLength:    c.time_length   ?? undefined,
    status:        c.status        ?? undefined,
    format:        c.format        ?? undefined,
    source:        c.source        ?? undefined,
    sourceUrl:     c.source_url      ?? undefined,
    developerBadge: c.developer_badge ?? undefined,
    platforms:     platforms.length > 0 ? platforms : undefined,
    companies:     companies.length > 0 ? companies : undefined,
    publishers:    c.publishers_csv ? c.publishers_csv.split(',').filter(Boolean) : undefined,
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
    source_url:            data.sourceUrl      || undefined,
    developer_badge:       data.developerBadge || undefined,
    title_main:            data.titleMain   || undefined,
    title_native:          data.titleNative || undefined,
    title_romaji:          data.titleRomaji || undefined,
    synopsis:              data.description || undefined,
    cover_url:             data.cover       || undefined,
    banners_csv:           data.bannerImage || undefined,
    release_year:          data.releaseYear,
    release_month:         data.releaseMonth,
    release_day:           data.releaseDay,
    release_end_year:      data.releaseEndYear,
    release_end_month:     data.releaseEndMonth,
    release_end_day:       data.releaseEndDay,
    score_global:          data.scoreGlobal,
    time_length:           data.timeLength,
    status:                data.status,
    total_count:           data.totalCount,
    total_count_2:         data.totalCount_2,
    country_code:          data.countryOfOrigin || undefined,
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
    publishers_csv:        data.publishers?.length ? data.publishers.join(',') : (data.companies?.length ? data.companies.join(',') : undefined),
    // Names only, same convention as companies_cache_csv — this is a flat
    // display cache for the instant partial-load path (mapCatalogEntryToPartialData),
    // not a relation store. The real author relations (id, image, role, url)
    // are synced separately via saveMediaAuthors, into media_author/media_by_author.
    authors_csv:           data.authors?.length ? data.authors.map(a => a.name).join(',') : undefined,
    created_at:            now,
    updated_at:            now,
  };
}
