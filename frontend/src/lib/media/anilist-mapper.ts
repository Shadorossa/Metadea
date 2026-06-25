import type { AniListMediaDetail } from '../search/providers/anilist';
import { getT, getLangCode } from '../../i18n/client';
import type { MediaPageData, MediaRelation } from './types';

const STATUS_CLASS: Record<string, string> = {
  RELEASING:        'media-badge--status-airing',
  NOT_YET_RELEASED: 'media-badge--status-upcoming',
};

const RELATION_PRIORITY: Record<string, number> = {
  PARENT: 1, ADAPTATION: 2, PREQUEL: 3, SEQUEL: 4,
  SPIN_OFF: 5, ALTERNATIVE: 6, SUMMARY: 7,
};

type NullableDate = { year: number | null; month: number | null; day: number | null } | null;

function fmtDate(d: NullableDate): string {
  if (!d?.year) return '';
  if (!d.month) return String(d.year);
  const date = new Date(d.year, d.month - 1, d.day ?? 1);
  return date.toLocaleDateString(getLangCode(), {
    year: 'numeric',
    month: 'short',
    day: d.day ? 'numeric' : undefined,
  });
}

export function mapAniListToMedia(raw: AniListMediaDetail, mediaType: string): MediaPageData {
  const tm = getT().media;

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
    : fmtDate(raw.startDate);

  const startFmt = fmtDate(raw.startDate);
  const endFmt   = fmtDate(raw.endDate);
  const dateBadge = startFmt
    ? (endFmt ? `${startFmt} - ${endFmt}` : startFmt)
    : undefined;

  let quickMeta = formatLabel;
  if (mediaType === 'anime') {
    if (raw.episodes) quickMeta += ` · ${raw.episodes} ep`;
    if (raw.duration) quickMeta += ` · ${raw.duration} min`;
  } else {
    if (raw.chapters) quickMeta += ` · ${raw.chapters} cap`;
    if (raw.volumes)  quickMeta += ` · ${raw.volumes} vol`;
  }

  const studiosList = raw.studios.nodes.map(n => n.name).join(', ');
  const metaLines   = [studiosList, quickMeta].filter(Boolean);

  const genreDots = raw.genres.join(' · ');

  const characters = raw.characters.nodes.map(c => ({
    name:  c.name.full,
    image: c.image.medium ?? undefined,
  }));

  const relations: MediaRelation[] = raw.relations.edges
    .filter(e => e.relationType !== 'CHARACTER' && e.node.coverImage?.medium)
    .sort((a, b) => (RELATION_PRIORITY[a.relationType] ?? 99) - (RELATION_PRIORITY[b.relationType] ?? 99))
    .map(e => {
      let typeLabel = (tm.relations as Record<string, string>)[e.relationType] ?? e.relationType;
      if (e.relationType === 'ADAPTATION' && mediaType === 'anime' && e.node.type === 'MANGA') {
        typeLabel = (tm.relations as Record<string, string>)['PARENT'] ?? 'Fuente';
      }
      const relPrefix = e.node.type?.toLowerCase() === 'anime' ? 'anime' : 'manga';
      return {
        typeLabel,
        title: e.node.title.romaji ?? '',
        cover: e.node.coverImage?.medium ?? undefined,
        url:   `/media?id=${relPrefix}:${e.node.id}`,
      };
    });

  const progressStatus = mediaType === 'anime' ? 'watching' as const : 'reading' as const;
  const progressLabel  = mediaType === 'anime'
    ? (getT().profile.status_watching)
    : (getT().profile.status_reading);

  return {
    externalId: `${mediaType}:${raw.id}`,
    type: mediaType,
    titleMain,
    titleNative,
    titleEnglish,
    cover,
    bannerImage:  raw.bannerImage ?? undefined,
    bannerColor:  `linear-gradient(135deg, ${coverColor}22, ${coverColor}44)`,
    statusLabel,
    statusClass,
    genreDots,
    metaLines,
    dateBadge,
    description:  raw.description ?? undefined,
    stats: [],
    characters,
    relations,
    progressStatus,
    progressLabel,
  };
}
