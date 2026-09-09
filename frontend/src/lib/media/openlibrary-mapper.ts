import type { OpenLibWork } from '../search/providers/openlibrary';
import { openLibCoverUrl } from '../search/providers/openlibrary';
import { getT } from '../../i18n/client';
import type { MediaAuthor, MediaPageData } from './types';
import { canonicalizeAlwaysFinished } from './media-status';


function extractDescription(raw: OpenLibWork['description']): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  return raw.value ?? undefined;
}

interface DateParts { year?: number; month?: number; day?: number }

// Open Library's own first_publish_date is free text, not a consistent
// format the way ComicVine's cover_date ("YYYY-MM-DD") is — it's most often
// a bare year ("1954"), sometimes ISO-ish ("1954-07-29"/"1954-07"), and
// occasionally a long-form date ("July 29, 1954"). Tried in that order;
// falls back to the JS Date parser (which already understands the long-form
// case) before giving up entirely.
function parseOpenLibDate(raw: string | undefined): DateParts | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}$/.test(trimmed)) {
    return { year: parseInt(trimmed, 10) };
  }
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    return {
      year:  parseInt(isoMatch[1], 10),
      month: parseInt(isoMatch[2], 10),
      day:   isoMatch[3] ? parseInt(isoMatch[3], 10) : undefined,
    };
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
  }
  return null;
}

export function mapOpenLibToMedia(
  work: OpenLibWork,
  authors: MediaAuthor[],
  externalId: string,
  mediaType: 'book' | 'comic' = 'book',
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
  const dateParts = parseOpenLibDate(work.first_publish_date);

  return {
    externalId,
    type: mediaType,
    titleMain:    work.title,
    titleNative:  undefined,
    titleEnglish: undefined,
    cover,
    bannerImage:  undefined,
    bannerColor:  'linear-gradient(135deg, #1a1a2e22, #2a1a3e44)',
    status:       canonicalizeAlwaysFinished(),
    statusLabel:  undefined,
    statusClass:  '',
    genreDots,
    metaLines,
    releaseYear:  dateParts?.year,
    releaseMonth: dateParts?.month,
    releaseDay:   dateParts?.day,
    dateBadge:    work.first_publish_date,
    description:  extractDescription(work.description),
    stats,
    characters:   [],
    relations:    [],
    progressStatus: 'reading',
    progressLabel:  getT().profile.status_reading,
    authors,
    source:       'openlibrary',
    sourceUrl:    `https://openlibrary.org/works/${externalId.slice(externalId.indexOf(':') + 1)}`,
  };
}
