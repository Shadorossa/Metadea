import type { TmdbMovieDetail, TmdbTvDetail } from '../search/providers/tmdb';
import { parseDateParts } from '../search/providers/tmdb';
import type { MediaPageData, MediaStat } from './types';
import { unifyGenres } from './genre-unifier';
import { getT } from '../../i18n/client';
import { API_ENDPOINTS } from '../api/endpoints';
import { formatDateParts, lookupLabel } from './mapper-utils';

const STATUS_CLASS: Record<string, string> = {
  'Returning Series': 'media-badge--status-airing',
  'In Production':    'media-badge--status-airing',
  'Planned':          'media-badge--status-upcoming',
  'Post Production':  'media-badge--status-upcoming',
};

function isTvDetail(d: TmdbMovieDetail | TmdbTvDetail): d is TmdbTvDetail {
  return 'name' in d;
}

export function mapTmdbToMedia(
  raw: TmdbMovieDetail | TmdbTvDetail,
  mediaType: 'movie' | 'series',
  rawId: string,
): MediaPageData {
  const tm = getT().media;
  const isTv = isTvDetail(raw);

  const titleMain = isTv ? raw.name : raw.title;
  const originalTitle = isTv ? raw.original_name : raw.original_title;
  const titleEnglish = originalTitle && originalTitle !== titleMain ? originalTitle : undefined;

  const cover = raw.poster_path ? API_ENDPOINTS.TMDB_IMAGE(raw.poster_path, 'w780') : undefined;
  const bannerImage = raw.backdrop_path ? API_ENDPOINTS.TMDB_IMAGE(raw.backdrop_path, 'w1280') : undefined;

  const dateParts = parseDateParts((isTv ? raw.first_air_date : raw.release_date) ?? undefined);
  const releaseYear  = dateParts.year  ?? undefined;
  const releaseMonth = dateParts.month ?? undefined;
  const releaseDay   = dateParts.day   ?? undefined;

  const dateBadge = formatDateParts(
    { year: releaseYear, month: releaseMonth, day: releaseDay },
    { monthStyle: 'long', requireDay: true },
  ) || undefined;

  const statusLabel = lookupLabel(tm.tmdb_statuses, raw.status, raw.status ?? '');
  const statusClass = STATUS_CLASS[raw.status ?? ''] ?? '';

  const { core: coreGenres, tags: genreTags } = unifyGenres((raw.genres ?? []).map(g => g.name));
  const genreDots    = coreGenres.join(' · ') || undefined;
  const genreTagDots = genreTags.join(' · ')  || undefined;

  const companies = (raw.production_companies ?? []).map(c => c.name);

  const scoreGlobal = raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : undefined;
  const timeLength = isTv ? raw.episode_run_time?.[0] : raw.runtime ?? undefined;

  const stats: MediaStat[] = [];
  if (scoreGlobal) stats.push({ label: tm.stat_score, value: `${scoreGlobal.toFixed(1)} / 10` });
  if (isTv) {
    if (raw.number_of_episodes) stats.push({ label: tm.stat_episodes, value: String(raw.number_of_episodes) });
  } else if (timeLength) {
    stats.push({ label: tm.stat_duration, value: `${timeLength} min` });
  }
  if (statusLabel) stats.push({ label: tm.stat_status, value: statusLabel });

  const metaLines = [companies.join(', '), dateBadge ?? ''].filter(Boolean);

  return {
    externalId: rawId,
    type: mediaType,
    titleMain,
    titleEnglish,
    cover,
    bannerImage,
    bannerColor: 'linear-gradient(135deg, #1e1b4b 0%, #4c1d95 100%)',
    statusLabel,
    statusClass,
    genreDots,
    genreTagDots,
    metaLines,
    dateBadge,
    description: raw.overview || undefined,
    stats,
    characters: [],
    relations: [],
    progressStatus: 'watching',
    progressLabel: getT().profile.status_watching,
    // Catalog metadata
    source: 'tmdb',
    releaseYear,
    releaseMonth,
    releaseDay,
    scoreGlobal,
    timeLength,
    status: raw.status ?? undefined,
    totalCount: isTv ? raw.number_of_episodes ?? undefined : undefined,
    totalCount_2: isTv ? raw.number_of_seasons ?? undefined : undefined,
    companies,
  };
}
