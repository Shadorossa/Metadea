import type { TmdbMovieDetail, TmdbTvDetail } from '../search/providers/tmdb';
import { parseDateParts } from '../search/providers/tmdb';
import type { MediaPageData, MediaStat, MediaCharacter, MediaRelation, MediaAuthor } from './types';
import { unifyGenres } from './genre-unifier';
import { getT } from '../../i18n/client';
import { API_ENDPOINTS } from '../api/endpoints';
import { formatDateParts, lookupLabel, countryName, pickPreferredCountry } from './mapper-utils';
import { canonicalizeTmdbStatus, STATUS_BADGE_CLASS } from './media-status';
import { CANONICAL_RELATION_LABELS as canonicalRelationLabels } from './canonical-relations';

// TMDB doesn't rank cast by relevance beyond its own `order` field — capping
// avoids dumping a 100+ name cast list onto a page that has no pagination for
// the Characters grid (only a "load more" that reveals 12 at a time).
const CAST_LIMIT = 25;

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
  // original_title/original_name is the title in the work's original
  // production language and script (e.g. Japanese kanji for a Japanese
  // movie) — that's the "native" slot, not an English alternate. TMDB has
  // no romanization concept of its own, so titleRomaji stays unset here.
  const originalTitle = isTv ? raw.original_name : raw.original_title;
  const titleNative = originalTitle && originalTitle !== titleMain ? originalTitle : undefined;

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

  const canonicalStatus = canonicalizeTmdbStatus(raw.status, isTv);
  const statusLabel = canonicalStatus ? lookupLabel(tm.statuses, canonicalStatus, canonicalStatus) : undefined;
  const statusClass = canonicalStatus ? (STATUS_BADGE_CLASS[canonicalStatus] ?? '') : '';

  const { core: coreGenres, tags: genreTags } = unifyGenres((raw.genres ?? []).map(g => g.name));
  const genreDots    = coreGenres.join(' · ') || undefined;
  const genreTagDots = genreTags.join(' · ')  || undefined;

  const companies = (raw.production_companies ?? []).map(c => c.name);

  const scoreGlobal = raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : undefined;
  const timeLength = isTv ? raw.episode_run_time?.[0] : raw.runtime ?? undefined;

  const stats: MediaStat[] = [];
  if (scoreGlobal) stats.push({ label: tm.stat_score, value: String(scoreGlobal), isScore: true });
  if (isTv) {
    // Always shown (not gated on a truthy count) — and when seasons are
    // known too, folded into the same stat row via label2/value2 ("Episodios
    // 65 | Temporadas 5", each half styled the same way) instead of two
    // separate rows.
    const episodesStat: MediaStat = { label: tm.stat_episodes, value: String(raw.number_of_episodes ?? 0) };
    if (raw.number_of_seasons) {
      episodesStat.label2 = tm.stat_seasons;
      episodesStat.value2 = String(raw.number_of_seasons);
    }
    stats.push(episodesStat);
    if (timeLength) stats.push({ label: tm.stat_duration, value: `${timeLength} min` });
  } else if (timeLength) {
    stats.push({ label: tm.stat_duration, value: `${timeLength} min` });
  }
  if (statusLabel) stats.push({ label: tm.stat_status, value: statusLabel });

  // Prefer a US certification (most consistently populated across TMDB
  // entries) and fall back to whichever country's rating is present first.
  const ageRating = isTv
    ? pickPreferredCountry(raw.content_ratings?.results)?.rating
    : pickPreferredCountry(raw.release_dates?.results)?.release_dates.find(r => r.certification)?.certification;
  if (ageRating) stats.push({ label: tm.stat_age_rating, value: ageRating });

  const originCountry = raw.origin_country?.[0];
  if (originCountry) stats.push({ label: tm.stat_country, value: countryName(originCountry) ?? originCountry });

  // The date already shows in the banner's own dateBadge overlay (top-right
  // square) — it must not also repeat here, under the studios/companies line.
  const metaLines = [companies.join(', ')].filter(Boolean);

  // Cards here represent the in-fiction character, not the actor — the
  // photo is necessarily the actor's own (TMDB has no separate character
  // art), but the name/identity must be the character's. credit_id (unique
  // per casting) keys each card instead of the actor's person id, so an
  // actor playing two different roles gets two distinct character cards
  // instead of colliding into one. Actor identity/credits are a separate
  // concern for later (an actor page or dedicated section), not this list.
  const characters: MediaCharacter[] = (raw.credits?.cast ?? [])
    .slice(0, CAST_LIMIT)
    .map(c => ({
      id: `character:tmdb:${c.credit_id ?? `${c.id}-${c.character ?? ''}`}`,
      name: c.character || c.name,
      image: c.profile_path ? API_ENDPOINTS.TMDB_IMAGE(c.profile_path, 'w185') : undefined,
    }));

  // Crew for the media page's own "Staff" tab — a person credited for more
  // than one job (e.g. Director + Writer) only gets one card, with their
  // first listed job.
  const seenCrewIds = new Set<number>();
  const staff: MediaPageData['staff'] = (raw.credits?.crew ?? [])
    .filter(c => {
      if (seenCrewIds.has(c.id)) return false;
      seenCrewIds.add(c.id);
      return true;
    })
    .slice(0, CAST_LIMIT)
    .map(c => ({
      id: `person:${c.id}`,
      name: c.name,
      image: c.profile_path ? API_ENDPOINTS.TMDB_IMAGE(c.profile_path, 'w185') : undefined,
      role: c.job || c.department || undefined,
    }));

  // "Similar/recommended" titles double as this media's Related section —
  // TMDB has no prequel/sequel graph of its own to draw from instead.
  const relations: MediaRelation[] = (raw.recommendations?.results ?? [])
    .filter(r => r.poster_path)
    .map(r => ({
      typeLabel: lookupLabel(canonicalRelationLabels, 'RECOMMENDATION', canonicalRelationLabels.OTHER),
      relationType: 'RECOMMENDATION',
      title: r.title ?? r.name ?? '',
      cover: r.poster_path ? API_ENDPOINTS.TMDB_IMAGE(r.poster_path, 'w300') : undefined,
      url: `/media?id=${mediaType}:${r.id}`,
      relatedExternalId: `${mediaType}:${r.id}`,
    }));

  // Series credit their showrunner(s) directly on the TV detail response
  // (created_by); when that's empty, fall back to Executive Producer credits,
  // then to whichever crew member worked the most episodes. Movies only
  // surface authorship buried in the crew credits list (Director).
  function tvAuthors(tv: TmdbTvDetail): MediaAuthor[] {
    if (tv.created_by?.length) {
      return tv.created_by.map(c => ({
        external_id: `person:${c.id}`,
        name: c.name,
        image: c.profile_path ? API_ENDPOINTS.TMDB_IMAGE(c.profile_path, 'w185') : undefined,
        role: 'Creator',
      }));
    }
    const crew = tv.credits?.crew ?? [];
    const execProducers = crew.filter(m => m.job === 'Executive Producer');
    if (execProducers.length) {
      return execProducers.map(m => ({
        external_id: `person:${m.id}`,
        name: m.name,
        image: m.profile_path ? API_ENDPOINTS.TMDB_IMAGE(m.profile_path, 'w185') : undefined,
        role: 'Executive Producer',
      }));
    }
    const topByEpisodes = crew.reduce<typeof crew[number] | undefined>((top, m) =>
      (m.episode_count ?? 0) > (top?.episode_count ?? 0) ? m : top, undefined);
    return topByEpisodes ? [{
      external_id: `person:${topByEpisodes.id}`,
      name: topByEpisodes.name,
      image: topByEpisodes.profile_path ? API_ENDPOINTS.TMDB_IMAGE(topByEpisodes.profile_path, 'w185') : undefined,
      role: topByEpisodes.job || topByEpisodes.department || 'Staff',
    }] : [];
  }

  const authors: MediaAuthor[] = isTv
    ? tvAuthors(raw)
    : (raw.credits?.crew ?? [])
        .filter(m => m.job === 'Director')
        .map(m => ({
          external_id: `person:${m.id}`,
          name: m.name,
          image: m.profile_path ? API_ENDPOINTS.TMDB_IMAGE(m.profile_path, 'w185') : undefined,
          role: 'Director',
        }));

  return {
    externalId: rawId,
    type: mediaType,
    titleMain,
    titleNative,
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
    characters,
    staff,
    relations,
    authors,
    progressStatus: 'watching',
    progressLabel: getT().profile.status_watching,
    // Catalog metadata
    source: 'tmdb',
    sourceUrl: `https://www.themoviedb.org/${isTv ? 'tv' : 'movie'}/${rawId.slice(rawId.indexOf(':') + 1)}`,
    releaseYear,
    releaseMonth,
    releaseDay,
    scoreGlobal,
    timeLength,
    status: canonicalStatus,
    totalCount: isTv ? raw.number_of_episodes ?? undefined : 1,
    totalCount_2: isTv ? raw.number_of_seasons ?? undefined : undefined,
    companies,
  };
}
