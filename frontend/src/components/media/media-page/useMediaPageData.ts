import { useEffect, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import { fetchMediaDataWithFallback, fetchExtraRelations, fetchExtraCharacters, fetchBookEditions, fetchComicIssues, fetchComicCollectedEditions, fetchMediaEpisodes, patchCachedRelations, patchCachedCharacters, mergeAndPersistRelations, mediaCharactersToSkeleton, mediaStaffToSkeleton, mapMediaDataToCatalogEntry, CACHE_PREFIX } from '../../../lib/media/media-page-data';
import { saveCatalogEntry, updateCatalogGenres, updateCatalogTotalCount } from '../../../lib/tauri';
import type { MediaEpisode, MediaTheme } from '../../../lib/tauri';
import type { MediaPageData } from '../../../lib/media/types';
import { saveCharactersSkeleton } from '../../../lib/tauri/characters';
import { saveStaffSkeleton } from '../../../lib/tauri/staff';
import { getMediaEpisodes } from '../../../lib/tauri/episodes';
import { getMediaThemes } from '../../../lib/tauri/themes';

export type MediaPageState = 'loading' | 'error' | 'ready';

interface Params {
  currentId: string;
  previewMode: boolean;
  tm: Translations['media'];
}

// The page's main load: skeleton → partial → full (fetchMediaDataWithFallback)
// plus every background top-up that hangs off the `full` result (extra
// characters, transitive relations, editions/issues, series episodes).
// Episodes and themes live here too because the same load seeds them from
// the local cache and — for a series — from that same full result; the anime
// season chain and episode offset are layered on top in useEpisodesAndSeasons.
export function useMediaPageData({ currentId, previewMode, tm }: Params) {
  const [pageState, setPageState] = useState<MediaPageState>('loading');
  const [isFetchingFull,     setIsFetchingFull]     = useState(false);
  const [data,               setData]               = useState<MediaPageData | null>(null);
  const [episodes,           setEpisodes]           = useState<MediaEpisode[]>([]);
  const [themes,             setThemes]             = useState<MediaTheme[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const navs = window.performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      if (navs.length > 0 && navs[0].type === 'reload') {
        // Was checking for 'media_data:'/'cached_saga:' — stale key prefixes
        // from before media-cache.ts's cache was renamed/versioned to
        // CACHE_PREFIX ('media_cache_v3:'). Neither ever matched, so this
        // purge-on-reload safety net has been a silent no-op.
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key && key.startsWith(CACHE_PREFIX)) {
            sessionStorage.removeItem(key);
          }
        }
      }
    }
  }, []);

  // Fetch page data cuando el currentId cambia
  useEffect(() => {
    if (previewMode) return;
    if (!currentId) return;

    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('id') ?? '';

    // Solo inicializamos el esqueleto si la URL actual corresponde al juego que vamos a cargar
    if (urlId === currentId) {
      const skeletonTitle = params.get('t');
      const skeletonCover = params.get('c');

      if (skeletonTitle) {
        setData({
          externalId: currentId,
          type: currentId.split(':')[0],
          titleMain: skeletonTitle,
          cover: skeletonCover || undefined,
          bannerColor: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          metaLines: [],
          stats: [],
          characters: [],
          relations: [],
        } as unknown as MediaPageData);
        setPageState('ready');
      } else {
        setPageState('loading');
        setData(null);
      }
    } else {
      setPageState('loading');
      setData(null);
    }

    setIsFetchingFull(true);
    setEpisodes([]);
    setThemes([]);

    let cancelled = false;

    // Read the local episode/theme cache immediately so the relation column
    // can render it while the full media fetch and provider validation run.
    getMediaEpisodes(currentId).then(cached => {
      if (!cancelled && cached.length > 0) setEpisodes(cached);
    }).catch(() => {});
    getMediaThemes(currentId).then(cached => {
      if (!cancelled && cached.length > 0) setThemes(cached);
    }).catch(() => {});

    fetchMediaDataWithFallback(
      currentId,
      partial => {
        // A never-synced skeleton's first visit kicks off a full live fetch
        // that can take a moment — if the user has already navigated to a
        // different page (or back to this same one) by the time it resolves,
        // this late result must not overwrite whatever's on screen now.
        // Every other callback below already guards on `cancelled`; this one
        // and `full` below didn't, letting a stale fetch clobber the current
        // page's state instead of just being silently dropped.
        if (cancelled) return;
        setData(partial);
        setPageState('ready');
      },
      (full, isFinal) => {
        if (cancelled) return;
        setData(full);
        setPageState('ready');
        // isFinal is false for a stub/local-data row that's about to be
        // followed by a background live resync (see fetchMediaDataWithFallback)
        // — the bottom progress bar must stay up through that resync, not
        // disappear the moment the mostly-empty stub renders.
        if (isFinal) setIsFetchingFull(false);

        // Background fetches below resolve after the user may have already
        // navigated to a different media page — this guards every merge so
        // a late response can't clobber whatever's now on screen.
        const patchIfCurrent = (patch: Partial<MediaPageData>) => {
          setData(prev => (prev && prev.externalId === full.externalId) ? { ...prev, ...patch } : prev);
        };

        if (!full.charactersInheritedFromBase && full.characters && full.characters.length > 0) {
          const isCastRole = full.type === 'movie' || full.type === 'series';
          const skeletonChars = mediaCharactersToSkeleton(full.characters, isCastRole);
          saveCharactersSkeleton(currentId, skeletonChars).catch(console.error);
        }
        if (full.staff && full.staff.length > 0) {
          saveStaffSkeleton(currentId, mediaStaffToSkeleton(full.staff)).catch(console.error);
        }

        // A cast over 50 (AniList's per-page cap) no longer blocks the page
        // itself — see fetchAniListDetail/fetchExtraCharacters — so the rest
        // of it is topped up here, after the page is already showing.
        if (!full.charactersInheritedFromBase && full.charactersHasMore) {
          fetchExtraCharacters(currentId, full).then(characters => {
            if (cancelled || !characters) return;
            patchCachedCharacters(currentId, characters);
            patchIfCurrent({ characters, charactersHasMore: false });
            const isCastRole = full.type === 'movie' || full.type === 'series';
            saveCharactersSkeleton(currentId, mediaCharactersToSkeleton(characters, isCastRole)).catch(console.error);
          });
        }

        // Transitive relations (remaster-of-an-expansion, port-of-a-remaster,
        // etc.) take a few extra sequential IGDB requests — fetch them after
        // the page is already showing instead of delaying first render.
        //
        // Only run this walk when the page being viewed is itself the true
        // base game — every other edition (remake/remaster/DLC/expansion/...)
        // only needs its own Fuente/parent relation (already set), and
        // walking IGDB's edition/content graph starting from a non-base
        // id kept surfacing siblings that don't belong to *this specific*
        // edition (e.g. a remake's page showing the original's remaster and
        // its non-remastered DLC, as if those were the remake's own).
        const isBaseGame = full.format === 'GAME' || full.format === 'VISUAL_NOVEL';
        const targetRelationsId = full.parentGame?.externalId || currentId;
        if (isBaseGame) {
          fetchExtraRelations(targetRelationsId, full).then(relations => {
            // `cancelled` covers "the user has since navigated away from this
            // page load" — skip the cache write too in that case, or a stale
            // response computed from *this* page's data could land in
            // whichever page's cache entry `targetRelationsId` now refers to
            // (a parent game's page, if the user navigated there), corrupting
            // it with relations that don't belong to it.
            if (cancelled || !relations) return;
            patchCachedRelations(targetRelationsId, relations);
            patchIfCurrent({ relations });
            // Transitive relations (remaster-of-an-expansion, etc.) used to
            // only ever land in the session cache — never media_relations —
            // so they rendered fine here but never showed up as an editable
            // relation in the collaborative catalog editor, which reads
            // straight from the DB. Persist them now that we know this
            // response still belongs to the current page.
            mergeAndPersistRelations(targetRelationsId, relations).catch(console.error);
          });
        }

        if (full.type === 'book') {
          fetchBookEditions(currentId, full.relations, tm.relations.EDITIONS).then(result => {
            if (cancelled || !result) return;
            const { relations, totalPages } = result;
            patchCachedRelations(currentId, relations);
            patchIfCurrent(totalPages !== null ? { relations, totalCount: totalPages } : { relations });
            // Same gap the base-game relation walk used to have: caching
            // this in sessionStorage only meant editions rendered fine here
            // but never showed up as an editable relation in the
            // collaborative catalog editor, which reads straight from the DB.
            mergeAndPersistRelations(currentId, relations).catch(console.error);
            // OpenLibrary has no page count on the Work itself, only on its
            // editions (see fetchBookEditions) — persisted here the same way
            // a comic's aggregated genres are, once this background fetch
            // actually finds one.
            if (totalPages !== null) updateCatalogTotalCount(currentId, totalPages).catch(console.error);
          });
        }

        if (full.type === 'comic' || full.type === 'manga' || full.type === 'lnovel') {
          fetchComicIssues(currentId, full.relations, tm.relations.ISSUE, full.titleMain, full.titleRomaji || full.titleEnglish).then(({ relations, characters, genreDots, genreTagDots }) => {
            if (cancelled) return;

            // Full cast aggregated across every issue — supersedes the
            // first-issue-only sample the initial volume fetch showed.
            if (characters.length > 0) {
              const skeletonChars = mediaCharactersToSkeleton(characters, false);
              saveCharactersSkeleton(currentId, skeletonChars).catch(console.error);
              patchIfCurrent({ characters });
            }

            if (genreDots || genreTagDots) {
              updateCatalogGenres(currentId, genreDots ?? null, genreTagDots ?? null).catch(console.error);
              patchIfCurrent({ genreDots, genreTagDots });
            }

            if (relations) {
              patchCachedRelations(currentId, relations);
              patchIfCurrent({ relations });
              // Issues used to only ever land in the session cache — never
              // media_relations — so they never showed up as editable
              // relations in the collaborative catalog editor either.
              mergeAndPersistRelations(currentId, relations).catch(console.error);
            }

            // Chained (not a separate top-level fetch) so it builds off
            // whatever fetchComicIssues just resolved rather than racing it
            // — both would otherwise start from the same `full.relations`
            // snapshot and independently strip+append their own relation
            // type, so whichever finished last would silently wipe out the
            // other's additions.
            if (full.type === 'comic') {
              fetchComicCollectedEditions(currentId, relations ?? full.relations, tm.relations.EDITIONS, full.titleMain, full.totalCount, full.releaseYear).then(editionRelations => {
                if (cancelled || !editionRelations) return;
                patchCachedRelations(currentId, editionRelations);
                patchIfCurrent({ relations: editionRelations });
                mergeAndPersistRelations(currentId, editionRelations).catch(console.error);
              });
            }
          });
        }

        if (full.type === 'series') {
          // totalCount_2 is already this series' season count (see
          // tmdb-mapper.ts) — passing it through skips fetchMediaEpisodes
          // re-fetching TMDB's full detail request a second time just to
          // read that one field back.
          fetchMediaEpisodes(currentId, false, full.type === 'series' ? full.totalCount_2 : undefined).then(eps => {
            if (cancelled || eps.length === 0) return;
            setEpisodes(eps);
          }).catch(console.error);
        }

      },
      ()      => { setPageState(prev => prev === 'ready' ? prev : 'error'); setIsFetchingFull(false); },
      ()      => cancelled,
    );

    return () => { cancelled = true; };
  }, [currentId, previewMode]);

  // Upsert catalog entry with the latest metadata from the API once we know the type
  // (library entry loading is handled by useLibraryEntry above)
  useEffect(() => {
    // data and currentId can briefly disagree when navigating quickly between
    // pages: currentId updates to the new page in the same render where
    // `data` still holds the *previous* page's fetch result (this effect and
    // the data-fetch effect above both run in the same commit, and the
    // fetch effect's setData(null) doesn't take effect until the next
    // render). Without this check, that stale `data` gets upserted under the
    // new currentId's row — e.g. quickly opening MGS3 then MGS2 could leave
    // MGS3's catalog entry overwritten with MGS2's data.
    if (previewMode || !data?.type || !currentId || data.externalId !== currentId) return;

    saveCatalogEntry(mapMediaDataToCatalogEntry(data, currentId)).catch(err => console.error('Failed to refresh catalog entry from live data:', err));
  // Re-run when bannerImage/authors changes so partial→full transition saves the banner URL and authors to catalog.
  // currentId is included so navigating between two items of the same type (and same
  // transient bannerImage state) still re-fetches the library entry for the new item.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, data?.type, data?.bannerImage, data?.authors, previewMode]);

  return {
    data, setData,
    pageState, setPageState,
    isFetchingFull, setIsFetchingFull,
    episodes, setEpisodes,
    themes, setThemes,
  };
}
