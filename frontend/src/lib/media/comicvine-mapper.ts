import type { ComicVineVolume } from '../tauri';
import { getT } from '../../i18n/client';
import type { MediaPageData } from './types';

// Comic Vine descriptions/decks are HTML — strip tags for plain-text display
// since MediaPageData.description is rendered as plain text elsewhere.
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

  return {
    externalId,
    type: 'comic',
    titleMain:    volume.name,
    titleNative:  undefined,
    titleEnglish: undefined,
    cover:        volume.image?.medium_url ?? volume.image?.small_url ?? undefined,
    bannerImage:  undefined,
    bannerColor:  'linear-gradient(135deg, #1a1a2e22, #2a1a3e44)',
    statusLabel:  undefined,
    statusClass:  '',
    genreDots:    undefined,
    metaLines:    volume.publisher?.name ? [volume.publisher.name] : [],
    dateBadge:    volume.start_year ?? undefined,
    description,
    stats,
    characters:   [],
    relations:    [],
    progressStatus: 'reading',
    progressLabel:  getT().profile.status_reading,
    authors:      [],
    totalCount:   volume.count_of_issues ?? undefined,
  };
}
