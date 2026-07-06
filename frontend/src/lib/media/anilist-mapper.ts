import type { AniListMediaDetail } from '../search/providers/anilist';
import { getT } from '../../i18n/client';
import type { MediaPageData, MediaRelation } from './types';
import { unifyGenres } from './genre-unifier';
import { formatDateParts, normalizeScore100, lookupLabel } from './mapper-utils';

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

export function resolveAniListType(mediaType: string, format: string | null | undefined): string {
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

  const formatLabel = lookupLabel(tm.formats, raw.format, raw.format ?? '');
  const statusLabel = lookupLabel(tm.statuses, raw.status, raw.status ?? '');
  const statusClass = STATUS_CLASS[raw.status ?? ''] ?? '';

  const seasonInfo = (raw.season && raw.seasonYear)
    ? `${lookupLabel(tm.seasons, raw.season, raw.season)} ${raw.seasonYear}`
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
    id:    e.node.id ? `character:${e.node.id}` : undefined,
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
      let typeLabel = lookupLabel(tm.relations, e.relationType, e.relationType);
      if (e.relationType === 'ADAPTATION' && resolvedType === 'anime' && e.node.type === 'MANGA') {
        typeLabel = lookupLabel(tm.relations, 'PARENT', 'Fuente');
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

  // Staff / Authors
  const staffEdges = raw.staff?.edges || [];
  const originalCreators = staffEdges.filter(e => e.role === 'Original Creator').map(e => ({
    name: e.node.name.full,
    image: e.node.image?.medium || undefined,
    role: 'Original Creator',
    url: e.node.id ? `https://anilist.co/staff/${e.node.id}` : undefined
  }));
  const originalStories = staffEdges.filter(e => e.role === 'Original Story').map(e => ({
    name: e.node.name.full,
    image: e.node.image?.medium || undefined,
    role: 'Original Story',
    url: e.node.id ? `https://anilist.co/staff/${e.node.id}` : undefined
  }));
  const directors = staffEdges.filter(e => e.role === 'Director').map(e => ({
    name: e.node.name.full,
    image: e.node.image?.medium || undefined,
    role: 'Director',
    url: e.node.id ? `https://anilist.co/staff/${e.node.id}` : undefined
  }));

  let authors: MediaAuthor[] = [];
  if (resolvedType === 'anime') {
    if (originalCreators.length > 0) {
      authors = originalCreators;
    } else if (originalStories.length > 0) {
      authors = originalStories;
    } else if (directors.length > 0) {
      authors = directors;
    }
  } else if (resolvedType === 'manga' || resolvedType === 'lnovel') {
    if (originalCreators.length > 0) {
      authors = originalCreators;
    } else if (originalStories.length > 0) {
      authors = originalStories;
    }
  }

  const stats: MediaPageData['stats'] = [];
  if (authors.length > 0) {
    stats.push({
      label: authors[0].role || 'Author',
      value: authors.map(a => a.name).join(', '),
    });
  }

  // SagaViewer only makes sense when there's at least one direct prequel/sequel
  // to walk from — the full transitive chain is resolved later, on demand,
  // by lib/anilist/saga.ts when the user actually opens the viewer.
  const hasSaga = raw.relations.edges.some(e => e.relationType === 'PREQUEL' || e.relationType === 'SEQUEL');

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
    stats,
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
    // Studios only apply to anime — AniList's `studios` connection is
    // effectively unused for manga/light novels (no animation involved).
    companies:    resolvedType === 'anime' ? raw.studios.nodes.map(n => n.name) : undefined,
    authors:      authors.length > 0 ? authors : undefined,
    hasSaga,
  };
}
