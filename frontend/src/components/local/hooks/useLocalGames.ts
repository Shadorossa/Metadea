import { useState, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { debugScanInfo, type LocalGame } from '../../../lib/tauri';
import { scanGamesWithSteam } from '../../../lib/local/steam-merge';
import { romDisplayTitle } from '../../../lib/local/rom-name-parser';
import { dedupeLocalGames, gameLinkKey } from '../../../lib/local/game-identity';
import { takeRomDiscMergeSummary } from '../../../lib/tauri/roms';
import { showToast } from '../../../lib/dom/toast';
import { interpolateTranslation } from '../../../lib/i18n-dom/apply-translations';
import { getT } from '../../../i18n/runtime';

// A scanned ROM's `name` is the raw file stem (see emulator_roms.rs) — the
// clean title shows from the very first render, before any IGDB match.
function withRomDisplayNames(games: LocalGame[]): LocalGame[] {
  return games.map(g => (g.rom_platform && g.install_path ? { ...g, name: romDisplayTitle(g.name) } : g));
}

export type GamesState = 'idle' | 'loading' | 'done' | 'empty';

export function useLocalGames() {
  const [games,     setGames]     = useState<LocalGame[]>([]);
  const [gamesState, setGamesState] = useState<GamesState>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  // A plain load lets every launcher whose registry/manifests/folders are
  // unchanged answer from the Rust-side memo (scan_cache.rs); rescanGames
  // (the "Escanear de nuevo" button) always re-walks everything.
  // Only the latest scan's answer lands: a reload fired while an earlier
  // scan is still running (the ROM clean-up's rescan, a manual rescan)
  // must not be overwritten by the older, pre-rename result arriving last.
  const scanSeqRef = useRef(0);
  const scanWith = useCallback((force: boolean) => {
    const seq = ++scanSeqRef.current;
    setGamesState('loading');
    setScanError(null);
    setDebugInfo(null);
    scanGamesWithSteam(force)
      .then(g => {
        if (seq !== scanSeqRef.current) return;
        const list: LocalGame[] = dedupeLocalGames(withRomDisplayNames(Array.isArray(g) ? g : []));
        setGames(list);
        setGamesState(list.length === 0 ? 'empty' : 'done');
        // Old per-disc entries folded into their multi-disc set by this
        // scan (rom_disc_merge.rs): told once.
        takeRomDiscMergeSummary()
          .then(summary => {
            if (summary && summary.entries > 0) {
              showToast(interpolateTranslation(getT().local.discs_merged_toast, { games: summary.games, entries: summary.entries }), 'success');
            }
          })
          .catch(() => {});
      })
      .catch((e: unknown) => {
        if (seq !== scanSeqRef.current) return;
        setScanError(typeof e === 'string' ? e : String(e));
        setGamesState('empty');
      });
  }, []);
  const loadGames = useCallback(() => scanWith(false), [scanWith]);
  const rescanGames = useCallback(() => scanWith(true), [scanWith]);

  // The scan-failed placeholder's diagnostics button — owned here instead of
  // the component calling debugScanInfo() and formatting its own error,
  // since this hook already owns every other piece of scan state/behavior.
  const runDiagnostics = useCallback(() => {
    debugScanInfo().then(setDebugInfo).catch((e: unknown) => setDebugInfo(String(e)));
  }, []);

  // Optimistic client-side removal for GamesGrid's "Eliminar de la
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
      setGames(prev => prev.filter(g => !(g.launcher === launcher && gameLinkKey(g) === linkKey)));
    });
    window.scrollTo(0, scrollY);
  }, []);

  // Optimistic client-side update for "editar metadatos" (IgdbPickerModal,
  // via GameDetailPanel's onGameRelinked) — saveGameLink only ever persists
  // to local_game_links, so without this the in-memory `games` array (and
  // everything derived from it: gameStatusMatch, groupedGames, a card's own
  // displayName lookup) would keep showing this game as unlinked until the
  // next full loadGames() rescan re-applies it from the DB. Same
  // (launcher, app_id ?? install_path ?? name) identity as removeGame above.
  const relinkGame = useCallback((launcher: string, linkKey: string, externalId: string) => {
    setGames(prev => prev.map(g =>
      g.launcher === launcher && gameLinkKey(g) === linkKey
        ? { ...g, external_id: externalId }
        : g));
  }, []);

  return { games, gamesState, scanError, debugInfo, runDiagnostics, loadGames, rescanGames, removeGame, relinkGame };
}
