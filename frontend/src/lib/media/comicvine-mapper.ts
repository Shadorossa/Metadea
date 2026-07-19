import type { ComicVineVolume, ComicVineIssueDetail } from '../tauri';
import { getT } from '../../i18n/client';
import type { MediaPageData, MediaAuthor, MediaCharacter, MediaStaffMember } from './types';
import { unifyGenres } from './genre-unifier';
import { formatDateParts, type DateParts } from './mapper-utils';
import { CANONICAL_RELATION_LABELS as canonicalRelationLabels } from './canonical-relations';
import { canonicalizeAlwaysFinished } from './media-status';

// Comic Vine descriptions/decks are HTML — strip tags for plain-text display
// since MediaPageData.description is rendered as plain text elsewhere.
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Comic Vine's person_credits (writer, penciler, inker, colorist, ...) is
// the same underlying data `authors` is built from below — this is the
// unfiltered version for the media page's own "Staff" tab (next to
// Personajes), mirroring how AniList/TMDB share one crew list between their
// authors pick and their full staff roster.
function personCreditsToStaff(credits: { id: number; name: string; role: string | null; image?: { medium_url?: string | null; small_url?: string | null } | null }[]): MediaStaffMember[] {
  return credits.map(p => ({
    id: `staff:comicvine:${p.id}`,
    name: p.name,
    image: p.image?.medium_url ?? p.image?.small_url ?? undefined,
    role: p.role ?? undefined,
  }));
}

// Comic Vine dates are plain "YYYY-MM-DD" strings.
function parseCoverDate(date: string | null | undefined): DateParts | null {
  if (!date) return null;
  const [year, month, day] = date.split('-').map(n => parseInt(n, 10));
  if (!Number.isFinite(year)) return null;
  return { year, month: Number.isFinite(month) ? month : undefined, day: Number.isFinite(day) ? day : undefined };
}

export function mapComicVineToMedia(volume: ComicVineVolume, externalId: string): MediaPageData {
  const tm = getT().media;

  const stats: MediaPageData['stats'] = [];
  if (volume.publisher?.name) {
    stats.push({ label: tm.stat_studio, value: volume.publisher.name });
  }
  if (volume.count_of_issues != null) {
    stats.push({ label: tm.stat_issues, value: String(volume.count_of_issues) });
  }

  const description = volume.description
    ? stripHtml(volume.description)
    : volume.deck ?? undefined;

  const characters: MediaCharacter[] = volume.character_credits.map(c => ({
    id: `character:comicvine:${c.id}`,
    name: c.name,
    image: c.image?.medium_url ?? c.image?.small_url ?? undefined,
  }));

  const conceptNames = volume.concept_credits.map(c => c.name);
  const { core, tags } = unifyGenres(conceptNames);
  const genreDots    = core.join(' · ') || undefined;
  const genreTagDots = tags.join(' · ') || undefined;

  const authors: MediaAuthor[] = volume.person_credits.map(p => ({
    external_id: `author:comicvine:${p.id}`,
    name: p.name,
    role: p.role ?? undefined,
    image: p.image?.medium_url ?? p.image?.small_url ?? undefined,
    url: `/author?id=author:comicvine:${p.id}`,
  }));
  const staff = personCreditsToStaff(volume.person_credits);

  const companies = volume.publisher?.name ? [volume.publisher.name] : undefined;

  // Prefer the real first/last issue cover dates (resolved by the Rust side
  // with two lightweight extra requests) over start_year alone, so the badge
  // reads like a proper "Ene 2012 - Oct 2013" range instead of just a year.
  const startParts = parseCoverDate(volume.first_issue_cover_date) ?? (volume.start_year ? { year: parseInt(volume.start_year, 10) } : null);
  const endParts = parseCoverDate(volume.last_issue_cover_date);
  const startFmt = startParts ? formatDateParts(startParts) : undefined;
  const endFmt = endParts ? formatDateParts(endParts) : undefined;
  const dateBadge = startFmt
    ? (endFmt && endFmt !== startFmt ? `${startFmt} - ${endFmt}` : startFmt)
    : undefined;

  return {
    externalId,
    type: 'comic',
    titleMain:    volume.name,
    titleNative:  undefined,
    titleEnglish: undefined,
    cover:        volume.image?.medium_url ?? volume.image?.small_url ?? undefined,
    bannerImage:  undefined,
    bannerColor:  'linear-gradient(135deg, #1a1a2e22, #2a1a3e44)',
    status:       canonicalizeAlwaysFinished(),
    statusLabel:  undefined,
    statusClass:  '',
    genreDots,
    genreTagDots,
    metaLines:    volume.publisher?.name ? [volume.publisher.name] : [],
    dateBadge,
    description,
    stats,
    characters,
    staff,
    relations:    [],
    progressStatus: 'reading',
    progressLabel:  getT().profile.status_reading,
    authors,
    companies,
    totalCount:   volume.count_of_issues ?? undefined,
    source:       'comicvine',
    sourceUrl:    volume.site_detail_url ?? undefined,
    releaseYear:  startParts?.year ?? undefined,
    releaseMonth: startParts?.month ?? undefined,
    releaseDay:   startParts?.day ?? undefined,
  };
}

// A single issue gets its own trackable media page — same idea as a game's
// "Season" (its own catalog row, parented to the base game/volume via
// parentGame) instead of only existing as a relation card under the volume.
export function mapComicVineIssueToMedia(issue: ComicVineIssueDetail, externalId: string): MediaPageData {
  const characters: MediaCharacter[] = issue.character_credits.map(c => ({
    id: `character:comicvine:${c.id}`,
    name: c.name,
    image: c.image?.medium_url ?? c.image?.small_url ?? undefined,
  }));

  const conceptNames = issue.concept_credits.map(c => c.name);
  const { core, tags } = unifyGenres(conceptNames);
  const genreDots    = core.join(' · ') || undefined;
  const genreTagDots = tags.join(' · ') || undefined;

  const authors: MediaAuthor[] = issue.person_credits.map(p => ({
    external_id: `author:comicvine:${p.id}`,
    name: p.name,
    role: p.role ?? undefined,
    image: p.image?.medium_url ?? p.image?.small_url ?? undefined,
    url: `/author?id=author:comicvine:${p.id}`,
  }));
  const staff = personCreditsToStaff(issue.person_credits);

  const description = issue.description
    ? stripHtml(issue.description)
    : issue.deck ?? undefined;

  const numberPart = issue.issue_number ? `#${issue.issue_number}` : '';
  const namePart = issue.name ? ` — ${issue.name}` : '';
  const titleMain = issue.volume
    ? `${issue.volume.name} ${numberPart}${namePart}`.trim()
    : (numberPart + namePart) || `#${issue.id}`;

  const tm = getT().media;
  const relations: MediaPageData['relations'] = issue.volume
    ? [{
        typeLabel: canonicalRelationLabels.PARENT,
        relationType: 'PARENT',
        title: issue.volume.name,
        url: `/media?id=comic:${issue.volume.id}`,
        relatedExternalId: `comic:${issue.volume.id}`,
      }]
    : [];

  return {
    externalId,
    type: 'comic',
    titleMain,
    titleNative:  undefined,
    titleEnglish: undefined,
    cover:        issue.image?.medium_url ?? issue.image?.small_url ?? undefined,
    bannerImage:  undefined,
    bannerColor:  'linear-gradient(135deg, #1a1a2e22, #2a1a3e44)',
    status:       canonicalizeAlwaysFinished(),
    statusLabel:  undefined,
    statusClass:  '',
    genreDots,
    genreTagDots,
    metaLines:    [],
    dateBadge:    issue.cover_date ?? undefined,
    description,
    stats: [],
    characters,
    staff,
    relations,
    progressStatus: 'reading',
    progressLabel:  getT().profile.status_reading,
    authors,
    format:       'ISSUE',
    source:       'comicvine',
    parentGame:   issue.volume
      ? { title: issue.volume.name, externalId: `comic:${issue.volume.id}` }
      : undefined,
  };
}
