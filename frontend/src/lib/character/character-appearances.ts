// Appearance list for the character page: local DB rows unioned with the
// live AniList edges, resolved against the media catalog and sorted by
// release date.
import { compareByReleaseDateThenTitle, mapExternalFormatToType } from '../media/mappers/mapper-utils';
import type { AniListCharacterDetail } from '../search/providers/anilist';
import type { CharacterAppearance } from '../tauri/characters';

export const APPEARANCES_PER_PAGE = 8;

export interface MergedAppearance {
  mediaId: string;
  title: string;
  cover: string | null;
  year: number | null;
  month: number | null;
  day: number | null;
  roleLabel: string;
}

export interface AniListMediaCacheEntry {
  title: string;
  cover: string | null;
  year: number | null;
  month: number | null;
  day: number | null;
  role: string | null;
}

type CharacterMediaEdge = AniListCharacterDetail['media']['edges'][number];

// AniList's own `type` field can't tell manga from light novel
// (both are type MANGA — format NOVEL is what actually distinguishes
// them) — using it bare here used to key light novel appearances as
// "manga:<id>" instead of "lnovel:<id>", creating a second entry
// alongside whatever this same work already existed as elsewhere.
function edgeExternalId(edge: CharacterMediaEdge): string {
  return `${mapExternalFormatToType(edge.node.type, edge.node.format)}:${edge.node.id}`;
}

export function buildAniListMediaCache(edges: CharacterMediaEdge[]): Record<string, AniListMediaCacheEntry> {
  const cache: Record<string, AniListMediaCacheEntry> = {};
  for (const edge of edges) {
    cache[edgeExternalId(edge)] = {
      title: edge.node.title.userPreferred || edgeExternalId(edge),
      cover: edge.node.coverImage?.large ?? null,
      year: edge.node.startDate?.year ?? null,
      month: edge.node.startDate?.month ?? null,
      day: edge.node.startDate?.day ?? null,
      role: edge.characterRole ?? null,
    };
  }
  return cache;
}

// Union of local rows + this live AniList lookup — local rows are
// never dropped (so a manual edit in CharacterPrEditorModal sticks),
// but any AniList appearance not already known locally gets added.
// Just seeding once "while local is empty" (the previous approach)
// stalled after the very first row got persisted from ANY source
// (e.g. a media-page visit before ever opening the character page),
// silently leaving the rest of AniList's list out forever.
export function mergeAppearanceRows(
  localRows: CharacterAppearance[],
  edges: CharacterMediaEdge[],
): { union: CharacterAppearance[]; newFromAniList: CharacterAppearance[] } {
  const localIds = new Set(localRows.map(a => a.media_external_id));
  const newFromAniList: CharacterAppearance[] = edges
    .map(edge => ({
      media_external_id: edgeExternalId(edge),
      relation_type: edge.characterRole ?? null,
      character_name: null as string | null,
      // Seeds a media_catalog stub (cover/type/title) the same way a
      // media page already does for its own relations, so this work has
      // a real card/link even before anyone visits its own page first.
      title: edge.node.title.userPreferred,
      cover: edge.node.coverImage?.large ?? null,
    }))
    .filter(a => !localIds.has(a.media_external_id));
  // Hard guarantee against duplicate cards for the same work — first
  // occurrence wins, so a local (possibly curator-edited) row always
  // beats whatever AniList's own live edge for that same id would say.
  const union = Array.from(
    new Map([...localRows, ...newFromAniList].map(a => [a.media_external_id, a])).values(),
  );
  return { union, newFromAniList };
}

export interface AppearanceCatalogFields {
  title_main?: string | null;
  cover_url?: string | null;
  release_year?: number | null;
  release_month?: number | null;
  release_day?: number | null;
}

export function resolveMergedAppearance(
  row: CharacterAppearance,
  entry: AppearanceCatalogFields | null,
  cached: AniListMediaCacheEntry | undefined,
  roleLabels: Record<string, string>,
): MergedAppearance {
  const relationType = row.relation_type ?? cached?.role ?? null;
  return {
    mediaId: row.media_external_id,
    title: entry?.title_main || cached?.title || row.media_external_id,
    cover: entry?.cover_url ?? cached?.cover ?? null,
    year: entry?.release_year ?? cached?.year ?? null,
    month: entry?.release_month ?? cached?.month ?? null,
    day: entry?.release_day ?? cached?.day ?? null,
    roleLabel: relationType ? (roleLabels[relationType] ?? relationType) : '',
  };
}

export function sortAppearances(list: MergedAppearance[]): MergedAppearance[] {
  return [...list].sort((a, b) => compareByReleaseDateThenTitle(
    { release_year: a.year, release_month: a.month, release_day: a.day, id: a.mediaId, title: a.title },
    { release_year: b.year, release_month: b.month, release_day: b.day, id: b.mediaId, title: b.title },
  ));
}

export function appearancesTotalPages(count: number): number {
  return Math.ceil(count / APPEARANCES_PER_PAGE);
}

export function appearancesPageSlice<T>(list: T[], page: number): T[] {
  const start = (page - 1) * APPEARANCES_PER_PAGE;
  return list.slice(start, start + APPEARANCES_PER_PAGE);
}
