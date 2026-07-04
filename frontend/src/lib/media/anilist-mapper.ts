import type { AniListMediaDetail } from '../search/providers/anilist';
import { getT } from '../../i18n/client';
import type { MediaPageData, MediaRelation } from './types';
import { unifyGenres } from './genre-unifier';
import { formatDateParts, normalizeScore100 } from './mapper-utils';

const STATUS_CLASS: Record<string, string> = {
  RELEASING:        'media-badge--status-airing',
  NOT_YET_RELEASED: 'media-badge--status-upcoming',
};

const RELATION_PRIORITY: Record<string, number> = {
  PARENT: 1, ADAPTATION: 2, PREQUEL: 3, SEQUEL: 4,
  SPIN_OFF: 5, ALTERNATIVE: 6, SUMMARY: 7,
};

function formatDescription(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.replace(
    /\(Source:\s*([^)]+)\)/g,
    '<span class="media-description-source">&nbsp;&nbsp;—&nbsp;Source: $1</span>'
  );
}

function resolveAniListType(mediaType: string, format: string | null | undefined): string {
  if (mediaType === 'manga' && format === 'NOVEL') return 'lnovel';
  if (mediaType === 'lnovel') return 'lnovel';
  return mediaType;
}

export function mapAniListToMedia(raw: AniListMediaDetail, mediaType: string): MediaPageData {
  const tm = getT().media;
  const resolvedType = resolveAniListType(mediaType, raw.format);

  const titleMain   = raw.title.romaji ?? raw.title.english ?? raw.title.native ?? '—';
  const titleNative = raw.title.native   && raw.title.native   !== titleMain ? raw.title.native   : undefined;
  const titleEnglish = raw.title.english && raw.title.english !== titleMain ? raw.title.english : undefined;

  const cover      = raw.coverImage?.extraLarge ?? raw.coverImage?.large ?? undefined;
  const coverColor = raw.coverImage?.color ?? '#1a1a2e';

  const formatLabel = (tm.formats  as Record<string, string>)[raw.format ?? ''] ?? raw.format ?? '';
  const statusLabel = (tm.statuses as Record<string, string>)[raw.status ?? ''] ?? raw.status ?? '';
  const statusClass = STATUS_CLASS[raw.status ?? ''] ?? '';

  const seasonInfo = (raw.season && raw.seasonYear)
    ? `${(tm.seasons as Record<string, string>)[raw.season] ?? raw.season} ${raw.seasonYear}`
    : formatDateParts(raw.startDate);

  const startFmt = formatDateParts(raw.startDate);
  const endFmt   = formatDateParts(raw.endDate);
  const dateBadge = startFmt
    ? (endFmt ? `${startFmt} - ${endFmt}` : startFmt)
    : undefined;

  let quickMeta = formatLabel;
  if (resolvedType === 'anime') {
    if (raw.episodes) quickMeta += ` · ${raw.episodes} ep`;
    if (raw.duration) quickMeta += ` · ${raw.duration} min`;
  } else {
    if (raw.chapters) quickMeta += ` · ${raw.chapters} cap`;
    if (raw.volumes)  quickMeta += ` · ${raw.volumes} vol`;
  }

  const studiosList = raw.studios.nodes.map(n => n.name).join(', ');
  const metaLines   = [studiosList, quickMeta].filter(Boolean);

  const { core: coreGenres, tags: genreTags } = unifyGenres(raw.genres);
  const genreDots    = coreGenres.join(' · ') || undefined;
  const genreTagDots = genreTags.join(' · ')  || undefined;

  const characters = raw.characters.edges.map(e => ({
    name:  e.node.name.full,
    image: e.node.image.medium ?? undefined,
    role:  e.role,
  }));

  const relations: MediaRelation[] = raw.relations.edges
    .filter(e => e.relationType !== 'CHARACTER' && e.node.coverImage?.medium)
    .sort((a, b) => {
      const typePriority = (RELATION_PRIORITY[a.relationType] ?? 99) - (RELATION_PRIORITY[b.relationType] ?? 99);
      if (typePriority !== 0) return typePriority;
      // Dentro del mismo tipo, ordenar por startDate (más antiguo primero)
      const aYear = a.node.startDate?.year ?? 0;
      const aMonth = a.node.startDate?.month ?? 0;
      const bYear = b.node.startDate?.year ?? 0;
      const bMonth = b.node.startDate?.month ?? 0;
      return (aYear * 12 + aMonth) - (bYear * 12 + bMonth);
    })
    .map(e => {
      let typeLabel = (tm.relations as Record<string, string>)[e.relationType] ?? e.relationType;
      if (e.relationType === 'ADAPTATION' && resolvedType === 'anime' && e.node.type === 'MANGA') {
        typeLabel = (tm.relations as Record<string, string>)['PARENT'] ?? 'Fuente';
      }
      const relType = e.node.type?.toUpperCase() === 'ANIME' ? 'anime'
        : e.node.format === 'NOVEL' ? 'lnovel'
        : 'manga';
      return {
        typeLabel,
        title: e.node.title.romaji ?? '',
        cover: e.node.coverImage?.medium ?? undefined,
        url:   `/media?id=${relType}:${e.node.id}`,
      };
    });

  const progressStatus = resolvedType === 'anime' ? 'watching' as const : 'reading' as const;
  const progressLabel  = resolvedType === 'anime'
    ? (getT().profile.status_watching)
    : (getT().profile.status_reading);

  return {
    externalId: `${resolvedType}:${raw.id}`,
    type: resolvedType,
    titleMain,
    titleNative,
    titleEnglish,
    cover,
    bannerImage:  raw.bannerImage ?? undefined,
    bannerColor:  `linear-gradient(135deg, ${coverColor}22, ${coverColor}44)`,
    statusLabel,
    statusClass,
    genreDots,
    genreTagDots,
    metaLines,
    dateBadge,
    description:  formatDescription(raw.description),
    stats: [],
    characters,
    relations,
    progressStatus,
    progressLabel,
    // Catalog metadata
    source:       'anilist',
    format:       raw.format ?? undefined,
    releaseYear:  raw.startDate?.year  ?? undefined,
    releaseMonth: raw.startDate?.month ?? undefined,
    releaseDay:   raw.startDate?.day   ?? undefined,
    scoreGlobal:  normalizeScore100(raw.averageScore),
    platforms:    undefined,
    timeLength:   resolvedType === 'anime' ? (raw.duration ?? undefined) : undefined,
    status:       raw.status ?? undefined,
    totalCount:   resolvedType === 'anime' ? (raw.episodes ?? undefined) : (raw.chapters ?? undefined),
    totalCount_2: (resolvedType === 'manga' || resolvedType === 'lnovel') ? (raw.volumes ?? undefined) : undefined,
  };
}
