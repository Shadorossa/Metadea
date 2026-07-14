import type { AniListMediaDetail, AniListStaffEdge } from '../search/providers/anilist';
import { getT } from '../../i18n/client';
import type { MediaPageData, MediaRelation, MediaAuthor } from './types';
import { unifyGenres } from './genre-unifier';
import { formatDateParts, normalizeScore100, lookupLabel } from './mapper-utils';
import { canonicalizeAniListStatus, STATUS_BADGE_CLASS } from './media-status';

const RELATION_PRIORITY: Record<string, number> = {
  PARENT: 1, ADAPTATION: 2, PREQUEL: 3, SEQUEL: 4,
  SPIN_OFF: 5, ALTERNATIVE: 6, SUMMARY: 7,
};

function formatDescription(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  // Convert physical newlines to <br> first
  let cleaned = raw.replace(/\r?\n/g, '<br>');
  // Replace consecutive <br> tags (with optional spaces/newlines inside/around them) with a single <br>
  cleaned = cleaned.replace(/(?:\s*<br\s*\/?>\s*)+/gi, '<br>');
  // Apply Source metadata styling
  return cleaned.replace(
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
  const canonicalStatus = canonicalizeAniListStatus(raw.status);
  const statusLabel = canonicalStatus ? lookupLabel(tm.statuses, canonicalStatus, canonicalStatus) : undefined;
  const statusClass = canonicalStatus ? (STATUS_BADGE_CLASS[canonicalStatus] ?? '') : '';

  // AniList doesn't know the final episode count while a show is still
  // airing (raw.episodes is null) — nextAiringEpisode.episode is the number
  // of the *next* episode to air, so subtracting 1 gives how many have
  // already aired, which is what total_count should track until the show
  // actually finishes (at which point raw.episodes takes over).
  const airedEpisodes = raw.nextAiringEpisode ? raw.nextAiringEpisode.episode - 1 : undefined;

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
    const episodeCount = raw.episodes ?? airedEpisodes;
    if (episodeCount) quickMeta += ` · ${episodeCount} ep`;
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
    .filter(e => e.relationType !== 'CHARACTER' && e.node.type !== 'MUSIC' && e.node.coverImage?.medium)
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
      const typeLabel = lookupLabel(tm.relations, e.relationType, e.relationType);
      const relType = e.node.type?.toUpperCase() === 'ANIME' ? 'anime'
        : e.node.format === 'NOVEL' ? 'lnovel'
        : 'manga';
      const relatedExternalId = `${relType}:${e.node.id}`;
      return {
        typeLabel,
        relationType: e.relationType,
        title: e.node.title.romaji ?? '',
        cover: e.node.coverImage?.medium ?? undefined,
        url:   `/media?id=${relatedExternalId}`,
        relatedExternalId,
      };
    });

  // Staff / Authors — AniList lists staff roles (Original Creator, Original
  // Story, Director, Story & Art, ...) without ranking them, so the first
  // non-empty tier in priority order becomes the work's credited author(s).
  // Anime falls back to Director too since many anime don't credit an
  // Original Creator staff entry at all. Manga/light novels are usually
  // credited to one "Story & Art" mangaka, but when the story and art are
  // split between two different people, AniList credits them separately as
  // "Story" and "Art" — both belong together as co-authors, so that tier
  // combines the two roles instead of picking just one.
  const staffEdges = raw.staff?.edges || [];
  const mapStaffEdges = (edges: AniListStaffEdge[], role: string): MediaAuthor[] =>
    edges.filter(e => e.role === role).map(e => ({
      external_id: `staff:${e.node.id}`,
      name: e.node.name.full,
      image: e.node.image?.medium || undefined,
      role,
      url: `/author?id=staff:${e.node.id}`,
    }));

  const rolePriority: string[][] = resolvedType === 'anime'
    ? [['Original Creator'], ['Original Story'], ['Director']]
    : resolvedType === 'manga' || resolvedType === 'lnovel'
      ? [['Story & Art'], ['Story', 'Art'], ['Original Creator'], ['Original Story']]
      : [];

  let authors: MediaAuthor[] = [];
  for (const tier of rolePriority) {
    const matches = tier.flatMap(role => mapStaffEdges(staffEdges, role));
    if (matches.length > 0) {
      authors = matches;
      break;
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
    status:       canonicalStatus,
    totalCount:   resolvedType === 'anime' ? (raw.episodes ?? airedEpisodes) : (raw.chapters ?? undefined),
    totalCount_2: (resolvedType === 'manga' || resolvedType === 'lnovel') ? (raw.volumes ?? undefined) : undefined,
    // Studios only apply to anime — AniList's `studios` connection is
    // effectively unused for manga/light novels (no animation involved).
    companies:    resolvedType === 'anime' ? raw.studios.nodes.map(n => n.name) : undefined,
    authors:      authors.length > 0 ? authors : undefined,
    hasSaga,
  };
}
