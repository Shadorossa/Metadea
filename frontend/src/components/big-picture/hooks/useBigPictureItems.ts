import { useMemo } from 'react';
import type { CatalogEntryLike, LocalGame, MetaEntry } from '../../../lib/tauri';
import type { CoverCache } from '../../local/details/GameDetailPanel';
import { useLocalMediaItemsByType, type LocalMediaRaw } from '../../local/hooks/useLocalMediaEntries';
import { candidateExternalIdsForGame } from '../../../lib/local/catalog-game-linking';
import { buildGameItem, buildMediaItem } from '../../../lib/big-picture/items';
import { deriveBigPictureTabs, type BigPictureItem, type BigPictureTab } from '../../../lib/big-picture/categories';
import { COMPANIES } from '../../../lib/local/emulator-catalog';

/** What LocalLibrary already holds — Big Picture reads it, never refetches. */
export interface BigPictureData {
  games: LocalGame[];
  mediaRaw: LocalMediaRaw | null;
  pathCache: Record<string, MetaEntry>;
  coverCache: CoverCache;
  catalogMapById: Map<string, CatalogEntryLike>;
}

const PLATFORM_ORDER = COMPANIES.flatMap(company => company.platforms.map(platform => platform.id));

export function useBigPictureItems(data: BigPictureData): {
  items: BigPictureItem[];
  tabs: BigPictureTab[];
  gameByKey: Map<string, LocalGame>;
} {
  const { games, mediaRaw, pathCache, coverCache, catalogMapById } = data;
  // The same in-progress/planned lists each Local media tab shows.
  const anime = useLocalMediaItemsByType('anime', mediaRaw);
  const series = useLocalMediaItemsByType('series', mediaRaw);
  const movies = useLocalMediaItemsByType('movie', mediaRaw);
  const manga = useLocalMediaItemsByType('manga', mediaRaw);
  const comics = useLocalMediaItemsByType('comic', mediaRaw);
  const novels = useLocalMediaItemsByType('lnovel', mediaRaw);
  const books = useLocalMediaItemsByType('book', mediaRaw);

  return useMemo(() => {
    const entryById = new Map((mediaRaw?.entries ?? []).map(entry => [entry.external_id, entry]));
    const context = {
      art: (game: LocalGame) => (game.app_id ? coverCache[game.app_id] : undefined),
      candidateIds: (game: LocalGame) => candidateExternalIdsForGame(game, pathCache),
      catalogById: catalogMapById,
      entryById,
    };
    const gameByKey = new Map<string, LocalGame>();
    const items: BigPictureItem[] = [];
    for (const game of Array.isArray(games) ? games : []) {
      const item = buildGameItem(game, context);
      if (gameByKey.has(item.key)) continue;
      gameByKey.set(item.key, game);
      items.push(item);
    }
    for (const media of [...anime, ...series, ...movies, ...manga, ...comics, ...novels, ...books]) {
      const item = buildMediaItem(media);
      if (item) items.push(item);
    }
    return { items, tabs: deriveBigPictureTabs(items, { platformOrder: PLATFORM_ORDER }), gameByKey };
  }, [games, mediaRaw, pathCache, coverCache, catalogMapById, anime, series, movies, manga, comics, novels, books]);
}

export function platformName(platformId: string): string {
  for (const company of COMPANIES) {
    const platform = company.platforms.find(p => p.id === platformId);
    if (platform) return platform.name;
  }
  return platformId.toUpperCase();
}
