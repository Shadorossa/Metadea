import { useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
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
    // The page's own scroll (there's no inner overflow:auto container here —
    // .local-main-content grows to its natural height) visibly jumped
    // whenever the removed card sat above the fold: the document got
    // shorter, and if the user was scrolled far enough down, the browser
    // clamps scrollY to the new (smaller) max the instant this commits.
    // flushSync forces that DOM update — and whatever auto-clamp comes with
    // it — to happen synchronously right here, so the explicit scrollTo
    // right after runs before the browser ever paints the jumped frame,
    // restoring the exact pre-removal scroll position in the same tick
    // (or, if the content really did shrink past it, re-clamping to
    // whatever the new legitimate max is — same outcome as before, just
    // without the visible flash in between).
    const scrollY = window.scrollY;
    flushSync(() => {
      setGames(prev => prev.filter(g => !(g.launcher === launcher && (g.app_id ?? g.install_path ?? g.name) === linkKey)));
    });
    window.scrollTo(0, scrollY);
  }, []);

  return { games, gamesState, scanError, debugInfo, runDiagnostics, loadGames, removeGame };
}
