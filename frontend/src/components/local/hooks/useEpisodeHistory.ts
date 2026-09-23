import { useState, useEffect, useCallback } from 'react';
import { deleteEpisodeHistoryEntry, type EpisodeHistoryEntry } from '../../../lib/tauri';
import { readLocalEpisodeHistory as getEpisodeHistory, invalidateLocalEpisodeHistory } from '../../../lib/local/local-read-cache';
import { resolveSeasonExternalIds, resolveOwnSeasonNumber } from '../../../lib/local/season-resolve';
import type { LocalMediaItem } from './useLocalMediaEntries';

export interface ChainHistoryEntry extends EpisodeHistoryEntry {
  seasonNum?: number | null;
  seasonTitle?: string;
}

const EMPTY_CHAIN_HISTORY: ChainHistoryEntry[] = [];

export interface HistoryMenuState {
  x: number;
  y: number;
  entry: EpisodeHistoryEntry;
}

export interface EpisodeHistory {
  currentHistory: ChainHistoryEntry[];
  historyMenu: HistoryMenuState | null;
  setHistoryMenu: (menu: HistoryMenuState | null) => void;
  deleteHistoryEntry: (entry: EpisodeHistoryEntry) => Promise<void>;
}

// Watched/read history across this work's whole season chain (every
// PREQUEL/SEQUEL sibling's own entries merged and sorted), kept fresh on
// the app-wide `metadea:episode-marked` event.
export function useEpisodeHistory(
  item: LocalMediaItem,
  itemSeason: number | null,
  onProgressSaved: () => void,
): EpisodeHistory {
  const [history, setHistory] = useState<ChainHistoryEntry[]>([]);
  const [historyExternalId, setHistoryExternalId] = useState(item.externalId);
  // This panel stays mounted while the selected work changes. Don't render
  // the previous work's history while the new chain is being fetched.
  const currentHistory = historyExternalId === item.externalId ? history : EMPTY_CHAIN_HISTORY;
  // Right-click on a history row — same delete-entry pattern as Profile's
  // own activity feed (see ActivitySection.tsx).
  const [historyMenu, setHistoryMenu] = useState<HistoryMenuState | null>(null);

  const fetchChainHistory = useCallback(async () => {
    try {
      const resolvedSeason = await resolveOwnSeasonNumber(item.externalId, item.title) ?? itemSeason;
      const seasonMap = await resolveSeasonExternalIds(item.externalId, item.title, resolvedSeason);
      const seasonEntries = Object.entries(seasonMap);
      if (seasonEntries.length === 0) {
        const direct = await getEpisodeHistory(item.externalId);
        return direct.map(h => ({ ...h, seasonNum: itemSeason, seasonTitle: item.title }));
      }

      const all = await Promise.all(
        seasonEntries.map(async ([sStr, sInfo]) => {
          const sNum = parseInt(sStr, 10);
          try {
            const list = await getEpisodeHistory(sInfo.externalId);
            return list.map(h => ({
              ...h,
              seasonNum: sNum,
              seasonTitle: sInfo.title || item.title,
            }));
          } catch {
            return [];
          }
        })
      );
      const merged = all.flat();
      merged.sort((a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime());
      return merged;
    } catch {
      const direct = await getEpisodeHistory(item.externalId).catch(() => []);
      return direct.map(h => ({ ...h, seasonNum: itemSeason, seasonTitle: item.title }));
    }
  }, [item.externalId, item.title, itemSeason]);

  useEffect(() => {
    let cancelled = false;
    fetchChainHistory().then(res => {
      if (!cancelled) {
        setHistory(res);
        setHistoryExternalId(item.externalId);
        setHistoryMenu(null);
      }
    });
    return () => { cancelled = true; };
  }, [fetchChainHistory, item.externalId]);

  useEffect(() => {
    let cancelled = false;
    function onEpisodeMarked() {
      fetchChainHistory().then(res => {
        if (!cancelled) {
          setHistory(res);
          setHistoryExternalId(item.externalId);
        }
      }).catch(() => {});
      onProgressSaved();
    }
    window.addEventListener('metadea:episode-marked', onEpisodeMarked);
    return () => {
      cancelled = true;
      window.removeEventListener('metadea:episode-marked', onEpisodeMarked);
    };
  }, [fetchChainHistory, item.externalId, onProgressSaved]);

  useEffect(() => {
    if (!historyMenu) return;
    const close = () => setHistoryMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [historyMenu]);

  const deleteHistoryEntry = useCallback(async (entry: EpisodeHistoryEntry) => {
    setHistoryMenu(null);
    try {
      await deleteEpisodeHistoryEntry(entry.id);
      // The visit memo still holds the pre-delete list for this id.
      invalidateLocalEpisodeHistory(entry.external_id);
      setHistory(prev => prev.filter(h => h.id !== entry.id));
    } catch (err) {
      console.error('Failed to delete episode history entry', err);
    }
  }, []);

  return { currentHistory, historyMenu, setHistoryMenu, deleteHistoryEntry };
}
