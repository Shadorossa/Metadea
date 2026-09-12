import { useState, useCallback } from 'react';
import { debugScanInfo, type LocalGame } from '../../../lib/tauri';
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

  // The scan-failed placeholder's diagnostics button — owned here instead of
  // the component calling debugScanInfo() and formatting its own error,
  // since this hook already owns every other piece of scan state/behavior.
  const runDiagnostics = useCallback(() => {
    debugScanInfo().then(setDebugInfo).catch((e: unknown) => setDebugInfo(String(e)));
  }, []);

  // Optimistic client-side removal for VideojuegosGrid's "Eliminar de la
  // lista" — the backend call (removeLocalGame) is what actually makes the
  // removal durable (see remove_local_game), this just drops it from local
  // state immediately instead of running loadGames()'s full re-scan (which
  // flips gamesState back to 'loading' and, worse, momentarily replaces the
  // ENTIRE grid with the scanning placeholder just to reflect one card
  // disappearing). Same (launcher, app_id ?? install_path ?? name) identity
  // scan_all_games' own game_link_key derives from, so it matches exactly
  // the one row that was actually deleted.
  const removeGame = useCallback((launcher: string, linkKey: string) => {
    setGames(prev => prev.filter(g => !(g.launcher === launcher && (g.app_id ?? g.install_path ?? g.name) === linkKey)));
  }, []);

  return { games, gamesState, scanError, debugInfo, runDiagnostics, loadGames, removeGame };
}
