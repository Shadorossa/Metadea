import { useState, useCallback } from 'react';
import { type LocalGame } from '../../../lib/tauri';
import { scanGamesWithSteam } from '../../../lib/local/steam-merge';

export type GamesState = 'idle' | 'loading' | 'done' | 'empty';

export function useLocalGames() {
  const [games,     setGames]     = useState<LocalGame[]>([]);
  const [gamesState, setGamesState] = useState<GamesState>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  const loadGames = useCallback(() => {
    setGamesState('loading');
    setScanError(null);
    setDebugInfo(null);
    scanGamesWithSteam()
      .then(g => {
        const list: LocalGame[] = Array.isArray(g) ? g : [];
        setGames(list);
        setGamesState(list.length === 0 ? 'empty' : 'done');
      })
      .catch((e: unknown) => {
        setScanError(typeof e === 'string' ? e : String(e));
        setGamesState('empty');
      });
  }, []);

  return { games, gamesState, scanError, debugInfo, setDebugInfo, loadGames };
}
