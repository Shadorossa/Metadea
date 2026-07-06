import type { OpenLibWork } from '../search/providers/openlibrary';
import { openLibCoverUrl } from '../search/providers/openlibrary';
import { getT } from '../../i18n/client';
import type { MediaAuthor, MediaPageData } from './types';


function extractDescription(raw: OpenLibWork['description']): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  return raw.value ?? undefined;
}

export function mapOpenLibToMedia(
  work: OpenLibWork,
  authors: MediaAuthor[],
  externalId: string,
): MediaPageData {
  const tm = getT().media;

  const cover = work.covers?.[0] != null
    ? openLibCoverUrl(work.covers[0], 'L')
    : undefined;

  const genres    = (work.subjects ?? []).slice(0, 6);
  const genreDots = genres.join(' · ') || undefined;

  const stats: MediaPageData['stats'] = [];
  if (authors.length) {
    stats.push({
      label: authors.length > 1 ? tm.stat_authors : tm.stat_author,
      value: authors.map(a => a.name).join(', '),
    });
  }
  if (work.first_publish_date) {
    stats.push({ label: tm.stat_published, value: work.first_publish_date });
  }

  const metaLines = authors.length ? [authors.map(a => a.name).join(', ')] : [];

  return {
    externalId,
    type: 'book',
    titleMain:    work.title,
    titleNative:  undefined,
    titleEnglish: undefined,
    cover,
    bannerImage:  undefined,
    bannerColor:  'linear-gradient(135deg, #1a1a2e22, #2a1a3e44)',
    statusLabel:  undefined,
    statusClass:  '',
    genreDots,
    metaLines,
    dateBadge:    work.first_publish_date,
    description:  extractDescription(work.description),
    stats,
    characters:   [],
    relations:    [],
    progressStatus: 'reading',
    progressLabel:  getT().profile.status_reading,
    authors,
  };
}
