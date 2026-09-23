// Background top-ups that run after the media page already rendered with
// full data: the transitive IGDB relation graph and AniList's remaining
// character pages. Split out of media-page-data.ts (still re-exported from
// there). Both share the same contract — the caller merges/persists/patches
// the cache itself, gated on its own relevance check, since the user may
// have navigated away by the time either resolves.
import { fetchAniListRemainingCharacters } from '../search/providers/anilist';
import { mapAniListCharacterEdges } from './mappers/anilist-mapper';
import { mergeBaseGameRelation, mergeRelationGraph, type IgdbSubGame, type RelationGraphNode } from './mappers/igdb-mapper';
import { igdbGetBaseGames, igdbGetRelationGraph } from '../tauri';
import type { MediaPageData } from './types';
import { parseExternalId } from './mappers/mapper-utils';
import { isAniListMediaType, isIgdbMediaType } from './media-page-fetch';
import { filterBlockedRelations } from './media-page-persist';

// Background: walks the transitive IGDB relation graph after the page
// already has full data. Doesn't call patchCachedRelations itself — by the
// time this resolves the user may have navigated away, so callers must
// patch the cache themselves, gated on their own relevance check.
export async function fetchExtraRelations(rawId: string, currentData: MediaPageData): Promise<MediaPageData['relations'] | null> {
  const { type, id: numericId } = parseExternalId(rawId);
  if (!isIgdbMediaType(type)) return null;
  if (!numericId) return null;

  // Relation graph and optional base-game (PARENT) lookup, in parallel.
  const isRemake = currentData.format === 'REMAKE';
  const isRemaster = currentData.format === 'REMASTER';

  const graphPromise = igdbGetRelationGraph(numericId).catch(() => []);
  const baseGamesPromise = (isRemake || isRemaster)
    ? igdbGetBaseGames(numericId, isRemake ? 'remakes' : 'remasters').catch(() => null)
    : Promise.resolve(null);

  const [graphNodes, baseGames] = await Promise.all([graphPromise, baseGamesPromise]);

  let updatedData = { ...currentData };

  if (baseGames && baseGames.length > 0) {
    updatedData = mergeBaseGameRelation(updatedData, baseGames as IgdbSubGame[]);
  }

  if (graphNodes.length > 0) {
    const gameType = currentData.format === 'EXPANDED_GAME' ? 10 : undefined;
    updatedData = mergeRelationGraph(updatedData, graphNodes as RelationGraphNode[], gameType);
  }

  if (updatedData.relations.length === currentData.relations.length) return null; // nothing new

  updatedData.relations = await filterBlockedRelations(updatedData.relations);
  if (updatedData.relations.length === currentData.relations.length) return null;

  return updatedData.relations;
}

// Background top-up for a large cast — fetchAniListDetail deliberately only
// waits on the first (up to 50) character page so a media page never sits
// blank behind a big reparto's whole pagination walk (see
// fetchAniListRemainingCharacters's own comment); this fetches the rest of
// it separately, after the page has already rendered with what it had.
// Same "caller merges/persists/patches the cache itself, in case the user
// has since navigated away" contract as fetchExtraRelations above.
export async function fetchExtraCharacters(rawId: string, currentData: MediaPageData): Promise<MediaPageData['characters'] | null> {
  if (!currentData.charactersHasMore) return null;
  const { type, id: numericId } = parseExternalId(rawId);
  if (!isAniListMediaType(type) || !numericId) return null;

  const extraEdges = await fetchAniListRemainingCharacters(numericId, true).catch(() => []);
  if (extraEdges.length === 0) return null;

  return [...currentData.characters, ...mapAniListCharacterEdges(extraEdges)];
}
