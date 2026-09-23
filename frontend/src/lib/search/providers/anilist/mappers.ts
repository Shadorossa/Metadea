import type { MediaType, SearchResult, SearchPage, SearchFilters } from '../../types';
import { SEASON_MONTHS } from '../../types';
import { isUnifySeasonsEnabled } from '../../../storage/preferences';
import type { GraphQLResult } from '../../../api/client';
import { AniListSearchError } from '../../errors';
import { isRecord, rowsOf, optionalString, optionalNumber, stringList, fuzzyDate, hasNextPageOf } from './json-guards';
import type { AniListMedia, AniListSearchData, AniListCharacterSearch, AniListStaffSearchRow } from './types';

// ── Filters → query variables ─────────────────────────────────────────────────

// AniList's FuzzyDateInt is YYYYMMDD as a plain integer — lexicographic
// integer comparison matches chronological order within a single year (the
// only thing startDate_greater/startDate_lesser are ever used for here),
// so no date-library needed to build one.
function fuzzyDateInt(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

// Builds the optional startDate_greater/startDate_lesser pair for a
// year+season filter — season alone (no year) has no fixed year to anchor
// a range to, so it's a no-op without one.
export function dateRangeFromFilters(filters?: SearchFilters): { startDate_greater?: number; startDate_lesser?: number } {
  if (!filters?.year) return {};
  const [fromMonth, toMonth] = filters.season ? SEASON_MONTHS[filters.season] : [1, 12];
  return {
    startDate_greater: fuzzyDateInt(filters.year, fromMonth, 1) - 1,
    startDate_lesser: fuzzyDateInt(filters.year, toMonth, 31) + 1,
  };
}

// ── Row guards ────────────────────────────────────────────────────────────────

function parseAniListMedia(raw: unknown): AniListMedia | null {
  if (!isRecord(raw) || !isRecord(raw.title)) return null;
  const id = optionalNumber(raw.id);
  if (id === null) return null;
  const relationEdges = isRecord(raw.relations) ? rowsOf(raw.relations.edges) : null;
  return {
    id,
    format: optionalString(raw.format),
    title: { romaji: optionalString(raw.title.romaji), native: optionalString(raw.title.native) },
    coverImage: isRecord(raw.coverImage) ? { large: optionalString(raw.coverImage.large) } : null,
    startDate: fuzzyDate(raw.startDate),
    averageScore: optionalNumber(raw.averageScore),
    genres: stringList(raw.genres),
    relations: relationEdges
      ? {
        edges: relationEdges.filter(isRecord).map(edge => ({
          relationType: optionalString(edge.relationType),
          node: { type: isRecord(edge.node) ? optionalString(edge.node.type) : null },
        })),
      }
      : undefined,
  };
}

export function parseAniListCharacterRow(raw: unknown): AniListCharacterSearch | null {
  if (!isRecord(raw) || !isRecord(raw.name)) return null;
  const id = optionalNumber(raw.id);
  const full = optionalString(raw.name.full);
  if (id === null || full === null) return null;
  return {
    id,
    name: {
      full,
      native: optionalString(raw.name.native),
      alternative: Array.isArray(raw.name.alternative) ? stringList(raw.name.alternative) : null,
    },
    image: isRecord(raw.image) ? { large: optionalString(raw.image.large) } : null,
  };
}

export function parseAniListStaffRow(raw: unknown): AniListStaffSearchRow | null {
  if (!isRecord(raw) || !isRecord(raw.name)) return null;
  const id = optionalNumber(raw.id);
  const full = optionalString(raw.name.full);
  if (id === null || full === null) return null;
  return {
    id,
    name: { full, native: optionalString(raw.name.native) },
    image: isRecord(raw.image) ? { large: optionalString(raw.image.large) } : null,
  };
}

// The type:id key consumers use as a character appearance's external_id —
// null for an edge whose node is missing either half (skipped, not thrown on).
export function characterMediaEdgeKey(edge: unknown): string | null {
  if (!isRecord(edge) || !isRecord(edge.node)) return null;
  const type = optionalString(edge.node.type);
  const mediaId = optionalNumber(edge.node.id);
  return type !== null && mediaId !== null ? `${type.toLowerCase()}:${mediaId}` : null;
}

// ── Rows → SearchResult ───────────────────────────────────────────────────────

function mapAniListMediaToResult(media: AniListMedia, mediaType: MediaType): SearchResult {
  return {
    externalId: `${mediaType}:${media.id}`,
    type: mediaType,
    format: media.format ?? '',
    source: 'anilist',
    titleMain: media.title.romaji ?? media.title.native ?? '',
    titleRomaji: media.title.romaji,
    titleNative: media.title.native,
    coverUrl: media.coverImage?.large ?? null,
    releaseYear: media.startDate?.year ?? null,
    releaseMonth: media.startDate?.month ?? null,
    releaseDay: media.startDate?.day ?? null,
    scoreGlobal: media.averageScore ? media.averageScore / 10 : null,
    genres: media.genres,
  };
}

export function mapAniListCharacterToResult(char: AniListCharacterSearch): SearchResult {
  return {
    externalId: `character:a:${char.id}`,
    type: 'character' as MediaType,
    format: '',
    source: 'anilist' as const,
    titleMain: char.name.full,
    titleRomaji: char.name.alternative?.join(', ') ?? null,
    titleNative: char.name.native,
    coverUrl: char.image?.large ?? null,
    releaseYear: null,
    releaseMonth: null,
    releaseDay: null,
    scoreGlobal: null,
    genres: [],
  };
}

// True for any result that's a direct sequel of another anime — i.e. not
// the chain's own first/basic entry. Only ever meaningful on the *_ANIME
// query variants (see RELATIONS_FIELD in queries.ts); manga/lnovel results
// never carry `relations` at all, so this always reads false for them.
function hasAnimePrequel(media: AniListMedia): boolean {
  return !!media.relations?.edges.some(e => e.relationType === 'PREQUEL' && e.node.type === 'ANIME');
}

// Shared by searchAniList and topRatedAniList — both hit the same Page.media
// shape, just with a different sort/no search term.
export function toSearchPage(ok: boolean, result: GraphQLResult<AniListSearchData> | null, mediaType: MediaType): SearchPage {
  if (!ok) {
    // Check for token expiration errors
    if (result?.errors?.some(e =>
      e.message?.includes('Unauthorized') ||
      e.message?.includes('expired') ||
      e.message?.includes('invalid')
    )) {
      throw new AniListSearchError('token_expired', 'AniList token has expired', 'anilist_token_expired');
    }
    // Check for other GraphQL errors
    if (result?.errors?.[0]) {
      throw new AniListSearchError('unknown', result.errors[0].message, 'anilist_search_failed');
    }
    throw new AniListSearchError('network_error', 'Failed to reach AniList', 'anilist_network_error');
  }
  const pageData = result?.data?.Page;
  if (!isRecord(pageData)) {
    // Check if there were errors even though ok was true (edge case)
    if (result?.errors?.length) {
      throw new AniListSearchError('unknown', result.errors[0].message, 'anilist_search_failed');
    }
    return { results: [], hasMore: false };
  }

  // AniList's MANGA type covers both manga and light novels — the 'lnovel'
  // caller filters to format: NOVEL explicitly, but the plain 'manga' caller
  // (no format filter, so it can still find ONE_SHOT/DOUJIN/etc alongside
  // regular manga) never excluded NOVEL, so the same work turned up twice:
  // once correctly under "lnovel", once again mislabeled "manga:{id}".
  // "Unificar temporadas" (Settings > Preferencias) wants search/browse to
  // surface only a chain's basic/first entry, not every season as its own
  // separate hit — so a later season (has its own PREQUEL back to an anime)
  // is dropped here. Off by default, and never applied to manga/lnovel,
  // which has no such per-season splitting to begin with.
  const rows = rowsOf(pageData.media)
    .map(parseAniListMedia)
    .filter((m): m is AniListMedia => m !== null);
  const media = mediaType === 'manga'
    ? rows.filter(m => m.format !== 'NOVEL')
    : mediaType === 'anime' && isUnifySeasonsEnabled()
    ? rows.filter(m => !hasAnimePrequel(m))
    : rows;

  return {
    results: media.map(m => mapAniListMediaToResult(m, mediaType)),
    hasMore: hasNextPageOf(pageData),
  };
}
