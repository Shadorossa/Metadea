import { isRecord } from './json-guards';
import { anilistPost, fetchRemainingEdges } from './client';
import {
  DETAIL_QUERY, CHARACTERS_QUERY, CHARACTERS_PER_PAGE, STREAMING_EPISODES_QUERY,
  DETAIL_CHARACTER_QUERY, CHARACTER_MEDIA_PER_PAGE, DETAIL_STAFF_QUERY, MAL_ID_QUERY,
  MEDIA_BY_MAL_IDS_QUERY, MEDIA_BY_MAL_IDS_PER_PAGE,
} from './queries';
import type { AniListImportMedia } from '../../../anilist/import';
import { characterMediaEdgeKey } from './mappers';
import type {
  AniListMediaDetail, AniListCharacterEdge, AniListStreamingEpisode,
  AniListCharacterDetail, AniListCharacterDetailPage, AniListStaffDetail,
} from './types';

// Deliberately does NOT wait on any extra character pages beyond the first
// (see DETAIL_QUERY's characters(perPage: 50)) — a media page used to sit
// blank until a large-cast show's whole reparto finished paginating in,
// even though nothing about first-rendering the page actually needs more
// than what's already on the first page. Callers that want the rest fetch
// them separately in the background (see fetchAniListRemainingCharacters)
// once the page is already showing.
export async function fetchAniListDetail(id: number): Promise<AniListMediaDetail | null> {
  const data = await anilistPost<{ Media: AniListMediaDetail }>(DETAIL_QUERY, { id });
  return data?.Media ?? null;
}

// Walks whatever character pages come after the first one already shown —
// same sequential-with-delay pagination fetchAniListDetail used to do
// inline, just called separately so it can run after the page has already
// rendered instead of blocking it.
export async function fetchAniListRemainingCharacters(id: number, hasNextPage: boolean): Promise<AniListCharacterEdge[]> {
  if (!hasNextPage) return [];
  return fetchRemainingEdges<AniListCharacterEdge>(
    { pageInfo: { hasNextPage: true, total: null }, edges: [] },
    CHARACTERS_PER_PAGE,
    page => anilistPost<{ Media: { characters: AniListMediaDetail['characters'] } }>(CHARACTERS_QUERY, { id, page })
      .then(pageData => pageData?.Media?.characters ?? null),
  );
}

export async function fetchAniListStreamingEpisodes(id: number): Promise<AniListStreamingEpisode[] | null> {
  const data = await anilistPost<{ Media: { streamingEpisodes: AniListStreamingEpisode[] } }>(
    STREAMING_EPISODES_QUERY, { id },
  );
  return data?.Media?.streamingEpisodes ?? null;
}

export async function fetchAniListCharacterDetail(id: number): Promise<AniListCharacterDetail | null> {
  // Page 1 also carries the character's own profile fields, so it has to be
  // fetched (and awaited) on its own before the remaining pages can be fanned
  // out (see fetchRemainingEdges).
  const firstData = await anilistPost<{ Character: AniListCharacterDetailPage }>(DETAIL_CHARACTER_QUERY, { id, mediaPage: 1 });
  const character = firstData?.Character ?? null;
  if (!character) return null;

  // A response whose media connection is missing or malformed is treated as
  // "no appearances" rather than allowed to throw on pageInfo/edges reads.
  const firstMediaPage: AniListCharacterDetailPage['media'] = isRecord(character.media) && Array.isArray(character.media.edges)
    ? character.media
    : { pageInfo: { hasNextPage: false, total: null }, edges: [] };

  const extraEdges = await fetchRemainingEdges(firstMediaPage, CHARACTER_MEDIA_PER_PAGE, page =>
    anilistPost<{ Character: AniListCharacterDetailPage }>(DETAIL_CHARACTER_QUERY, { id, mediaPage: page })
      .then(data => data?.Character?.media ?? null),
  );

  // De-duped by the same type:id key every consumer already uses as this
  // media's external_id — a page-boundary overlap (or AniList itself
  // occasionally returning the same node twice) used to surface as literal
  // duplicate "appearances" entries for every downstream reader
  // (character.astro, CharacterPrEditorModal.tsx).
  const seenMedia = new Set<string>();
  const allEdges = [...firstMediaPage.edges, ...extraEdges].filter(edge => {
    const key = characterMediaEdgeKey(edge);
    if (key === null || seenMedia.has(key)) return false;
    seenMedia.add(key);
    return true;
  });
  character.media = { pageInfo: firstMediaPage.pageInfo, edges: allEdges };
  return character;
}

export async function fetchAniListStaffDetail(staffId: number): Promise<AniListStaffDetail | null> {
  const res = await anilistPost<{ Staff: AniListStaffDetail }>(DETAIL_STAFF_QUERY, { id: staffId });
  return res?.Staff ?? null;
}

// `null` both when AniList is unreachable and when the anime simply has no
// MAL counterpart — callers treat either as "no AniSkip for this one".
export async function fetchAniListMalId(anilistId: number): Promise<number | null> {
  const res = await anilistPost<{ Media: { idMal: number | null } | null }>(MAL_ID_QUERY, { id: anilistId });
  const idMal = res?.Media?.idMal;
  return typeof idMal === 'number' && idMal > 0 ? idMal : null;
}

export interface AniListMediaByMalId extends AniListImportMedia {
  idMal: number | null;
}

/** The AniList works behind these MAL ids (one media type), in chunks of
 *  MEDIA_BY_MAL_IDS_PER_PAGE walked sequentially with the same pause the
 *  other paginated fetches keep — an import of a large list would
 *  otherwise burst through AniList's rate limit. Ids AniList does not know
 *  are simply absent from the result; a failed chunk is skipped (its ids
 *  come back as unmatched to the caller). */
export async function fetchAniListMediaByMalIds(
  malIds: number[],
  type: 'ANIME' | 'MANGA',
  pauseMs = 1500,
): Promise<AniListMediaByMalId[]> {
  const unique = [...new Set(malIds.filter(id => Number.isInteger(id) && id > 0))];
  const found: AniListMediaByMalId[] = [];
  for (let start = 0; start < unique.length; start += MEDIA_BY_MAL_IDS_PER_PAGE) {
    if (start > 0) await new Promise(resolve => setTimeout(resolve, pauseMs));
    const chunk = unique.slice(start, start + MEDIA_BY_MAL_IDS_PER_PAGE);
    const res = await anilistPost<{ Page: { media: AniListMediaByMalId[] } }>(MEDIA_BY_MAL_IDS_QUERY, { idMal: chunk, type });
    const media = res?.Page?.media;
    if (Array.isArray(media)) found.push(...media.filter(m => isRecord(m) && typeof m.id === 'number'));
  }
  return found;
}
