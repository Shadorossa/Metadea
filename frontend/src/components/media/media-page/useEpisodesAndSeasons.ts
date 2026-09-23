import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { MediaEpisode, MediaTheme } from '../../../lib/tauri';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { fetchMediaEpisodes, fetchMediaThemes } from '../../../lib/media/media-page-data';
import { prefetchSagaData, loadSagaChain } from '../../../lib/media/saga/saga-loader';
import { getAnimePrequelEpisodeOffset } from '../../../lib/media/episodes/anime-tmdb-match';
import { fetchUnifiedAnimeEpisodes } from './media-page-format';

interface Params {
  currentId: string;
  previewMode: boolean;
  dataType: string | undefined;
  dataHasSaga: boolean | undefined;
  unifySeasonsEnabled: boolean;
  episodes: MediaEpisode[];
  setEpisodes: Dispatch<SetStateAction<MediaEpisode[]>>;
  setThemes: Dispatch<SetStateAction<MediaTheme[]>>;
}

// Everything the unify-seasons preference layers on top of the
// episode/theme lists useMediaPageData already loaded: the anime's own
// PREQUEL/SEQUEL season chain, the merged multi-season episode/theme lists,
// and the episode-number offset a later season starts counting from.
export function useEpisodesAndSeasons({
  currentId,
  previewMode,
  dataType,
  dataHasSaga,
  unifySeasonsEnabled,
  episodes,
  setEpisodes,
  setThemes,
}: Params) {
  // Anime's own season list — the live/cached PREQUEL/SEQUEL chain from
  // sagaData.ts, same source SagaViewerModal already uses. TMDB series don't
  // need this state at all: their season list is already sitting on
  // data.seasons (tmdb-mapper.ts), no extra fetch involved.
  const [animeSeasonChain,   setAnimeSeasonChain]   = useState<SagaEntry[]>([]);
  const [animeSeasonChainResolvedFor, setAnimeSeasonChainResolvedFor] = useState<string | null>(null);
  const [episodeOffset,      setEpisodeOffset]      = useState(0);

  // Warms SagaViewerModal's saga-chain + story-arcs caches (lib/media/sagaData.ts)
  // as soon as the page is known to have a saga, instead of only starting
  // that fetch once the user clicks the Saga button — by then it's typically
  // already resolved, so opening the modal reads a cached result instantly.
  //
  // Also fires for every anime/manga even when data.hasSaga is false —
  // hasSaga only reflects PREQUEL/SEQUEL rows already saved locally, which a
  // freshly-added work (never visited/resynced before) won't have yet.
  // loadSagaChain's own fallback (sagaData.ts) checks a live AniList query
  // in that case instead of just giving up, and persists whatever it finds
  // back to media_relations — so this is what actually discovers a season
  // chain the first time, not just re-reads an already-known one.
  useEffect(() => {
    if (previewMode || !currentId) return;
    if (dataHasSaga || dataType === 'anime' || dataType === 'manga') prefetchSagaData(currentId);
  }, [previewMode, dataHasSaga, dataType, currentId]);

  // Anime's "Temporadas" tab — only when the Settings > Preferencias toggle
  // is on (see preferences.ts's own doc comment for why: TMDB's own tab
  // stays on unconditionally, but AniList's per-season entries are still the
  // default/classic view unless the user opts into this). Reads the same
  // loadSagaChain the effect above already warmed, so this is normally an
  // instant cache hit, not a second fetch.
  useEffect(() => {
    if (previewMode || !currentId || dataType !== 'anime' || !unifySeasonsEnabled) {
      setAnimeSeasonChain([]);
      setAnimeSeasonChainResolvedFor(currentId || null);
      return;
    }
    let cancelled = false;
    loadSagaChain(currentId).then(chain => {
      if (cancelled) return;
      setAnimeSeasonChain(chain.ok && chain.entries.length > 1 ? chain.entries : []);
      setAnimeSeasonChainResolvedFor(currentId);
    }).catch(() => {
      if (cancelled) return;
      setAnimeSeasonChain([]);
      setAnimeSeasonChainResolvedFor(currentId);
    });
    return () => { cancelled = true; };
  }, [previewMode, currentId, dataType, unifySeasonsEnabled]);

  // When "Unificar temporadas" is on, combine the chain's own episodes in
  // watch order. A movie/single-episode special contributes one display-only
  // unit; its standalone page still has no episode list.
  useEffect(() => {
    if (previewMode || !currentId || dataType !== 'anime') return;
    if (unifySeasonsEnabled && animeSeasonChainResolvedFor !== currentId) return;
    let cancelled = false;

    const canUnifySeasonChain = unifySeasonsEnabled
      && animeSeasonChain.length > 1
      && animeSeasonChain.every(entry => entry.mediaType === 'anime' || entry.mediaType === 'series');
    if (!canUnifySeasonChain) {
      // Single-season mode: load only current anime's episodes and themes
      fetchMediaEpisodes(currentId, false).then(eps => {
        if (!cancelled && eps.length > 0) setEpisodes(eps);
      }).catch(() => {});
      fetchMediaThemes(currentId).then(th => {
        if (!cancelled && th.length > 0) setThemes(th);
      }).catch(() => {});
      return;
    }

    if (currentId !== animeSeasonChain[0].externalId) {
      setEpisodes([]);
      setThemes([]);
      return;
    }

    // Episodes and themes are independent. Start both immediately and update
    // each tab as soon as its own data is ready; previously episodes waited
    // for every season's themes, which were also fetched one after another.
    fetchUnifiedAnimeEpisodes(animeSeasonChain).then(allEpisodes => {
      if (!cancelled && allEpisodes.length > 0) setEpisodes(allEpisodes);
    }).catch(() => {});

    Promise.all(animeSeasonChain.map(seasonEntry =>
      fetchMediaThemes(seasonEntry.externalId).catch(() => [] as MediaTheme[]),
    )).then(themeLists => {
      if (cancelled) return;
      const allThemes = themeLists.flat();
      if (allThemes.length > 0) {
        const themeMap = new Map<string, MediaTheme>();
        for (const th of allThemes) {
          const key = `${th.theme_type}_${th.sequence}_${(th.song_title || th.slug).toLowerCase().trim()}`;
          if (!themeMap.has(key)) {
            themeMap.set(key, th);
          }
        }
        const mergedThemes = Array.from(themeMap.values()).sort((a, b) =>
          a.theme_type !== b.theme_type ? (a.theme_type === 'OP' ? -1 : 1) : a.sequence - b.sequence
        );
        setThemes(mergedThemes);
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [previewMode, currentId, dataType, animeSeasonChain, animeSeasonChainResolvedFor, unifySeasonsEnabled]);

  // Reset the offset on navigation — same trigger and guards as the main
  // load effect this reset used to be part of.
  useEffect(() => {
    if (previewMode) return;
    if (!currentId) return;
    setEpisodeOffset(0);
  }, [currentId, previewMode]);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    getAnimePrequelEpisodeOffset(currentId).then(off => {
      if (!cancelled && off > 0) setEpisodeOffset(off);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentId]);

  useEffect(() => {
    if (episodes.length > 0 && episodes[0].episode_number > 1) {
      setEpisodeOffset(episodes[0].episode_number - 1);
    }
  }, [episodes]);

  return { animeSeasonChain, animeSeasonChainResolvedFor, episodeOffset };
}
