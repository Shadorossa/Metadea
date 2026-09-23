import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaEpisode } from '../../../lib/tauri';
import type { MediaPageData } from '../../../lib/media/types';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { chainToRelations, type SpoilerRelation } from '../../../lib/spoilers/spoiler-franchises';
import { lateDebutCastIds } from '../../../lib/spoilers/spoiler-late-debut';
import { loadKnownCastIds } from '../../../lib/spoilers/spoiler-data';
import { spoilerItemKey } from '../../../lib/spoilers/spoiler-reveals';
import { isSequelRelationType } from '../../../lib/media/saga/saga-relation-types';
import { useSpoilerShield } from '../../spoilers/hooks/useSpoilerShield';

/** Everything the media page's sections ask the spoiler shield, already
 *  combined with this session's single-item reveals. */
export interface MediaSpoilers {
  synopsisHidden: boolean;
  /** Shield data still loading: keep the synopsis unpainted meanwhile. */
  synopsisPending: boolean;
  revealSynopsis: () => void;
  coverHidden: boolean;
  revealCover: () => void;
  /** Covers of related/season cards (`earlierIds`: the viewer's own order). */
  isRelatedCoverHidden: (externalId: string | undefined, earlierIds?: readonly string[]) => boolean;
  revealRelatedCover: (externalId: string) => void;
  isEpisodeHidden: (episode: MediaEpisode) => boolean;
  revealEpisode: (episode: MediaEpisode) => void;
  isCastMemberHidden: (characterId: string | null | undefined) => boolean;
  revealCastMember: (characterId: string) => void;
}

interface Params {
  currentId: string;
  previewMode: boolean;
  data: MediaPageData | null;
  animeSeasonChain: readonly SagaEntry[];
  episodes: readonly MediaEpisode[];
}

const NOTHING_HIDDEN = new Set<string>();

export function useMediaSpoilers({ currentId, previewMode, data, animeSeasonChain, episodes }: Params): MediaSpoilers {
  // The page's own PREQUEL/SEQUEL rows and season chain may be newer than
  // the shared cache (a first visit saves them as it loads).
  const pageData = data && data.externalId === currentId ? data : null;
  const extraRelations = useMemo<SpoilerRelation[]>(() => {
    const rows: SpoilerRelation[] = [];
    for (const relation of pageData?.relations ?? []) {
      if (!relation.relatedExternalId || !relation.relationType || !isSequelRelationType(relation.relationType)) continue;
      rows.push({ media_external_id: currentId, related_media_external_id: relation.relatedExternalId, relation_type: relation.relationType });
    }
    rows.push(...chainToRelations(animeSeasonChain.map(entry => entry.externalId)));
    return rows;
  }, [pageData, currentId, animeSeasonChain]);

  const { evaluator, pending, isRevealed, reveal } = useSpoilerShield({ disabled: previewMode, extraRelations });

  const offsets = useMemo(
    () => (evaluator ? evaluator.episodeOffsets(episodes, currentId) : new Map<string, number>()),
    [evaluator, episodes, currentId],
  );

  // Late-debut cast: only for a page the user has not started, compared
  // with the cast lists (local rows) of the works they did start.
  const comparisonWorks = evaluator && currentId ? evaluator.castComparisonWorks(currentId) : null;
  const comparisonKey = comparisonWorks?.join('|') ?? '';
  const [knownCast, setKnownCast] = useState<{ key: string; ids: Set<string> | null } | null>(null);
  useEffect(() => {
    if (!comparisonKey) return;
    let cancelled = false;
    loadKnownCastIds(comparisonKey.split('|')).then(ids => {
      if (!cancelled) setKnownCast({ key: comparisonKey, ids });
    });
    return () => { cancelled = true; };
  }, [comparisonKey]);
  const castIds = useMemo(() => (pageData?.characters ?? []).map(c => c.id ?? ''), [pageData]);
  const hiddenCast = useMemo(
    () => (comparisonKey && knownCast?.key === comparisonKey ? lateDebutCastIds(castIds, knownCast.ids) : NOTHING_HIDDEN),
    [comparisonKey, knownCast, castIds],
  );

  const revealRelatedCover = useCallback((externalId: string) => reveal(spoilerItemKey.cover(externalId)), [reveal]);
  const revealEpisode = useCallback(
    (episode: MediaEpisode) => reveal(spoilerItemKey.episode(episode.external_id || currentId, episode.episode_number)),
    [reveal, currentId],
  );
  const revealCastMember = useCallback(
    (characterId: string) => reveal(spoilerItemKey.castMember(currentId, characterId)),
    [reveal, currentId],
  );

  return {
    synopsisHidden: !!evaluator && evaluator.isSynopsisHidden(currentId) && !isRevealed(spoilerItemKey.synopsis(currentId)),
    synopsisPending: pending && !previewMode,
    revealSynopsis: () => reveal(spoilerItemKey.synopsis(currentId)),
    coverHidden: !!evaluator && evaluator.isCoverHidden(currentId) && !isRevealed(spoilerItemKey.cover(currentId)),
    revealCover: () => reveal(spoilerItemKey.cover(currentId)),
    isRelatedCoverHidden: (externalId, earlierIds) => !!externalId && !!evaluator
      && evaluator.isCoverHidden(externalId, earlierIds) && !isRevealed(spoilerItemKey.cover(externalId)),
    revealRelatedCover,
    isEpisodeHidden: episode => !!evaluator
      && evaluator.isEpisodeHidden(episode, currentId, offsets)
      && !isRevealed(spoilerItemKey.episode(episode.external_id || currentId, episode.episode_number)),
    revealEpisode,
    isCastMemberHidden: characterId => !!characterId && hiddenCast.has(characterId)
      && !isRevealed(spoilerItemKey.castMember(currentId, characterId)),
    revealCastMember,
  };
}
