import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { Translations } from '../../../i18n/index';
import type { MediaEpisode, MediaTheme } from '../../../lib/tauri';
import type { MediaPageData } from '../../../lib/media/types';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { replaceIssueRelations } from '../../../lib/tauri';
import { fetchMediaData, fetchExtraCharacters, fetchComicIssues, fetchMediaEpisodes, fetchMediaThemes, patchCachedRelations, patchCachedCharacters, mediaCharactersToSkeleton, mediaStaffToSkeleton, invalidateCachedMediaData } from '../../../lib/media/media-page-data';
import { saveCharactersSkeleton } from '../../../lib/tauri/characters';
import { saveStaffSkeleton } from '../../../lib/tauri/staff';
import { fetchUnifiedAnimeEpisodes } from './media-page-format';

interface Params {
  currentId: string;
  unifySeasonsEnabled: boolean;
  animeSeasonChain: SagaEntry[];
  tm: Translations['media'];
  setData: Dispatch<SetStateAction<MediaPageData | null>>;
  setEpisodes: Dispatch<SetStateAction<MediaEpisode[]>>;
  setThemes: Dispatch<SetStateAction<MediaTheme[]>>;
}

// The hero's manual refresh button: the forced counterpart of the main load
// in useMediaPageData, writing into the same data/episodes/themes state.
export function useRetrySync({ currentId, unifySeasonsEnabled, animeSeasonChain, tm, setData, setEpisodes, setThemes }: Params) {
  const [retryingSync,       setRetryingSync]       = useState(false);

  // Manual "retry sync" — calls fetchMediaData directly instead of
  // fetchMediaDataWithFallback, which still gates its own live fetch behind
  // needsResync()/sync_state; that used to make this button a no-op
  // whenever the entry wasn't actually due yet (sync_state's backoff can
  // push that out to months on a title with a couple of past failures),
  // silently redisplaying the same stale local data instead of the fresh
  // fetch the button promises.
  const handleRetrySync = useCallback(() => {
    if (!currentId || retryingSync) return;
    setRetryingSync(true);
    invalidateCachedMediaData(currentId);
    fetchMediaData(currentId, { refreshAniListTotalCount: true, refreshSourceAdaptation: true }).then(async fresh => {
      if (fresh) {
        setData(fresh);
        if (!fresh.charactersInheritedFromBase && fresh.characters && fresh.characters.length > 0) {
          const isCastRole = fresh.type === 'movie' || fresh.type === 'series';
          saveCharactersSkeleton(currentId, mediaCharactersToSkeleton(fresh.characters, isCastRole)).catch(console.error);
        }
        if (fresh.staff && fresh.staff.length > 0) {
          saveStaffSkeleton(currentId, mediaStaffToSkeleton(fresh.staff)).catch(console.error);
        }
        if (!fresh.charactersInheritedFromBase && fresh.charactersHasMore) {
          fetchExtraCharacters(currentId, fresh).then(characters => {
            if (!characters) return;
            patchCachedCharacters(currentId, characters);
            setData(prev => (prev && prev.externalId === currentId) ? { ...prev, characters, charactersHasMore: false } : prev);
            const isCastRole = fresh.type === 'movie' || fresh.type === 'series';
            saveCharactersSkeleton(currentId, mediaCharactersToSkeleton(characters, isCastRole)).catch(console.error);
          });
        }
      }
      // Chained off the fresh fetch (not fired alongside it) so a series'
      // already-known season count (totalCount_2) can be passed through —
      // same duplicate-TMDB-detail-request avoidance as the main load
      // effect above, otherwise this ran its own full TMDB detail fetch in
      // parallel with the one fetchMediaData just made.
      // Forced (not the cache-checked default) so this also backfills a
      // series/anime that was saved before the Episodios tab existed — and
      // refreshes one that's already had episodes fetched but has since
      // aired new ones, which a plain revisit wouldn't do on its own.
      const shouldUnifyAnime = fresh?.type === 'anime'
        && unifySeasonsEnabled
        && animeSeasonChain.length > 1
        && currentId === animeSeasonChain[0].externalId;
      const episodeRefresh = shouldUnifyAnime
        ? fetchUnifiedAnimeEpisodes(animeSeasonChain, true)
        : fetchMediaEpisodes(currentId, true, fresh?.type === 'series' ? fresh.totalCount_2 : undefined);
      episodeRefresh.then(eps => {
        setEpisodes(eps);
      }).catch(console.error);
      if (fresh?.type === 'anime') {
        fetchMediaThemes(currentId, true).then(t => {
          if (t.length > 0) setThemes(t);
        }).catch(console.error);
      }

      // Retry also refreshes ComicVine issues. Replace only ISSUE rows so a
      // corrected volume mapping removes its previous #1/#2 cards without
      // disturbing curated relations of any other kind.
      if (fresh && ['comic', 'manga', 'lnovel'].includes(fresh.type)) {
        const issueResult = await fetchComicIssues(
          currentId,
          fresh.relations,
          tm.relations.ISSUE,
          fresh.titleMain,
          fresh.titleRomaji || fresh.titleEnglish,
        ).catch(error => {
          console.error('Failed to refresh ComicVine issues', error);
          return null;
        });

        if (issueResult?.relations) {
          const refreshedIssues = issueResult.relations.filter(relation => relation.relationType === 'ISSUE');
          const refreshedRelations = [
            ...fresh.relations.filter(relation => relation.relationType !== 'ISSUE'),
            ...refreshedIssues,
          ];
          patchCachedRelations(currentId, refreshedRelations);
          setData(prev => prev?.externalId === currentId ? { ...prev, relations: refreshedRelations } : prev);

          await replaceIssueRelations(currentId,
            refreshedIssues.flatMap(relation => relation.relatedExternalId ? [{
              related_media_external_id: relation.relatedExternalId,
              relation_type: 'ISSUE',
              type_label: relation.typeLabel,
              title: relation.title,
              cover: relation.cover ?? null,
              format: relation.format ?? null,
              release_day: relation.releaseDay ?? null,
              release_month: relation.releaseMonth ?? null,
              release_year: relation.releaseYear ?? null,
            }] : []),
          ).catch(console.error);
        }
      }
    }).finally(() => setRetryingSync(false));
  }, [currentId, retryingSync, unifySeasonsEnabled]);

  return { retryingSync, handleRetrySync };
}
