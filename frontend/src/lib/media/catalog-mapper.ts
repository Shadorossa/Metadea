// Local-catalog (SQLite) → MediaPageData mapping, for the instant fast-path
// render shown before/without a live API fetch.
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData, MediaStat } from './types';
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
  const stats: MediaStat[] = [];
  // Order must match each live mapper's own push order (score, author,
  // episodes/chapters, duration, format|status, country) or Datos visibly
  // reorders itself once a live fetch replaces this render. Authors
  // themselves aren't in this fast path at all anymore — no longer cached
  // as a catalog column (see db.rs migration 35), so they only ever come
  // from the relational media_author table, patched in moments later by
  // enrichLocalData just like characters/companies already are.
  if (c.score_global != null) {
    stats.push({ label: tm.stat_score, value: String(c.score_global), isScore: true });
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
  // Same slot anilist/tmdb-mapper use for duration.
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

  const platforms = c.platforms_csv ? c.platforms_csv.split(',').filter(Boolean) : [];

  // "platform|url" pairs.
  const storeLinks = c.shop_links_csv
    ? c.shop_links_csv.split(',').filter(Boolean).map(pair => {
        const [platform, url] = pair.split('|');
        return { platform: platform || '', url: url || '' };
      }).filter(l => l.url)
    : undefined;

  // metaLines[0] is always the publisher/producer line (styled as the bold
  // "studios label") — format already has its own dedicated Stats row above
  // and must never show here instead, even as a placeholder before company
  // data loads. The publisher line itself isn't built here — companies are
  // relational now (companies/media_by_company), not a catalog_media
  // column, so mediaService.ts's enrichLocalData patches it in once it
  // loads, the same "flashes in late" tradeoff as every other relational
  // field on this fast path (authors, characters, ...).
  const metaLines: string[] = [];

  // "start - end" once an end date exists, matching anilist-mapper.
  const startFmt = formatDateParts({ year: c.release_year, month: c.release_month, day: c.release_day });
  const endFmt = formatDateParts({ year: c.release_end_year, month: c.release_end_month, day: c.release_end_day });
  const dateBadge = startFmt ? (endFmt ? `${startFmt} - ${endFmt}` : startFmt) : undefined;

  return {
    externalId:    c.external_id,
    type:          c.type,
    titleMain:     c.title_main   ?? c.external_id,
    titleNative:   c.title_native ?? undefined,
    titleRomaji:   c.title_romaji ?? undefined,
    titleEnglish:  c.title_english ?? undefined,
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
    platforms:     platforms.length > 0 ? platforms : undefined,
    storeLinks,
    metaLines,
    stats,
    characters:    [],
    relations:     [],
    progressStatus: inferProgressStatus(c.type),
    progressLabel,
  };
}

// Inverse of mapCatalogEntryToPartialData — builds the row to persist once
// data is on screen. id/created_at/updated_at are placeholders:
// save_catalog_entry (Rust) resolves the real ones by external_id.
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
    title_main:            data.titleMain   || undefined,
    title_native:          data.titleNative || undefined,
    title_romaji:          data.titleRomaji || undefined,
    title_english:         data.titleEnglish || undefined,
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
    // "platform|url" CSV pairs. null = confirmed no store links (checked and
    // found none); undefined = never checked.
    shop_links_csv:        data.storeLinks === null
      ? null
      : data.storeLinks?.length
        ? data.storeLinks.map(l => `${l.platform}|${l.url}`).join(',')
        : undefined,
    created_at:            now,
    updated_at:            now,
  };
}
