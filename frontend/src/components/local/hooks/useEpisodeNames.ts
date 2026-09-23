import { useAsyncResource } from '../../shared/hooks/useAsyncResource';
import { fetchLocalSeasonEpisodeNames } from '../../../lib/media/episodes/episode-list';
import { memoLocalRead } from '../../../lib/local/local-read-cache';
import type { LocalMediaItem } from './useLocalMediaEntries';

// Provider-sourced episode names (AniList/TMDB, via the same "Episodios"
// data the media page's own tab uses) for the "próximo episodio" chip and
// each history row — only anime/series have any concept of one. Keyed
// `externalId|episodeNumber` since history spans several seasons' own ids
// at once (see ChainHistoryEntry) while the chip only ever needs this
// item's own. Fetched once per unique id (fetchLocalSeasonEpisodeNames'
// own DB cache makes repeats across renders/other panels cheap), not once
// per history row.
//
// The previous map stays in place while a refetch runs (history changes
// often), so already-shown names never flicker out and back in.
export function useEpisodeNames(
  item: LocalMediaItem,
  isReading: boolean,
  isMovieFormat: boolean,
  currentHistory: readonly { external_id: string }[],
): Map<string, string> {
  const { value } = useAsyncResource<Map<string, string>>(async () => {
    if (isReading || isMovieFormat || (item.libraryEntry.type !== 'anime' && item.libraryEntry.type !== 'series')) {
      return new Map();
    }
    const ids = new Set<string>([item.externalId, ...currentHistory.map(h => h.external_id)]);
    const merged = new Map<string, string>();
    await Promise.all([...ids].map(async id => {
      // Once per id per Local visit (see local-read-cache.ts) — reopening a
      // work, or the history growing, must not re-run the provider lookup.
      const localMap = await memoLocalRead('episode-names', id, () => fetchLocalSeasonEpisodeNames(id)).catch(() => new Map<number, string>());
      for (const [num, name] of localMap) merged.set(`${id}|${num}`, name);
    }));
    return merged;
  }, [item.externalId, item.libraryEntry.type, isReading, isMovieFormat, currentHistory], new Map());
  return value;
}
