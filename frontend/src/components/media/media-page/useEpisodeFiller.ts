import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaEpisode } from '../../../lib/tauri';
import type { MediaPageData } from '../../../lib/media/types';
import { fillerKindOf, seasonEpisodeToAbsolute, type FillerInfo, type FillerKind } from '../../../lib/anime/filler';
import {
  FILLER_INFO_CHANGED_EVENT, loadAllFillerInfo, resolveChainFillerInfo, type ChainFillerState,
} from '../../../lib/anime/filler-data';
import { useKeyedState } from '../../shared/hooks/useKeyedState';

interface Params {
  currentId: string;
  previewMode: boolean;
  data: MediaPageData | null;
  /** The episode list's number for this entry's episode 1, minus one
   *  (useEpisodesAndSeasons). */
  episodeOffset: number;
}

export interface EpisodeFillerView {
  /** Anime / TMDB series page where filler data can exist. */
  applies: boolean;
  /** This entry's filler info (link + fetched show). */
  ownInfo: FillerInfo | undefined;
  state: ChainFillerState | null;
  kindOf: (ep: MediaEpisode) => FillerKind | null;
  /** Whether any listed episode is filler (the attribution line). */
  anyFiller: boolean;
}

function isAiring(data: MediaPageData | null): boolean {
  const status = data?.status ?? '';
  return status === 'RELEASING' || /return/i.test(status);
}

// Episodes-section filler state for the media page: the chain's links and
// show data (auto-linked on the first visit) and the per-episode category.
// Badge rendering stays in EpisodeFillerBadge; the entry editor also calls
// this for the auto-link.
export function useEpisodeFiller({ currentId, previewMode, data, episodeOffset }: Params): EpisodeFillerView {
  const applies = !previewMode && !!currentId && (data?.type === 'anime' || data?.type === 'series');
  const [state, setState] = useKeyedState<ChainFillerState | null>(currentId, null);
  const [version, setVersion] = useState(0);
  const airing = isAiring(data);

  useEffect(() => {
    const bump = () => setVersion(value => value + 1);
    window.addEventListener(FILLER_INFO_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FILLER_INFO_CHANGED_EVENT, bump);
  }, []);

  const titlesKey = [data?.titleRomaji, data?.titleMain, data?.titleEnglish, data?.titleNative].filter(Boolean).join('\n');
  const totalCount = data?.totalCount ?? 0;
  const format = data?.format;
  useEffect(() => {
    if (!applies) return;
    let cancelled = false;
    // The library-wide map too, for helpers reading it synchronously on this
    // page (saga completion, the editor).
    void loadAllFillerInfo();
    resolveChainFillerInfo(currentId, { titles: titlesKey.split('\n').filter(Boolean), totalCount, airing, format })
      .then(resolved => { if (!cancelled) setState(resolved); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [applies, currentId, titlesKey, totalCount, airing, format, version, setState]);

  const ownInfo = state?.infos.get(currentId);

  const seasons = data?.seasons;
  const seasonCounts = useMemo(
    () => (seasons ?? []).map(season => ({ season_number: season.seasonNumber, episode_count: season.episodeCount ?? 0 })),
    [seasons],
  );

  const kindOf = useCallback((ep: MediaEpisode): FillerKind | null => {
    if (!state) return null;
    const entryId = ep.external_id || currentId;
    const info = state.infos.get(entryId);
    if (!info) return null;
    if (data?.type === 'series') {
      // TMDB season + episode → absolute through the season counts; lists
      // cached before episodes were numbered cumulatively still map right.
      const position = ep.source_key?.match(/:season:(\d+):episode:(\d+)$/);
      const absolute = position && seasonCounts.length > 0
        ? seasonEpisodeToAbsolute(seasonCounts, Number(position[1]), Number(position[2]))
        : null;
      return fillerKindOf(info, absolute ?? ep.episode_number);
    }
    const start = entryId === currentId
      ? episodeOffset
      : state.entries.find(entry => entry.externalId === entryId)?.chainStart ?? 0;
    return fillerKindOf(info, ep.episode_number - start);
  }, [state, currentId, data?.type, episodeOffset, seasonCounts]);

  const anyFiller = useMemo(() => !!state && [...state.infos.values()].some(info => info.fillerAbsolute.length > 0), [state]);

  return { applies, ownInfo, state, kindOf, anyFiller };
}
