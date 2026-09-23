import { useEffect, useRef } from 'react';
import { scanRomLibrary, renameRomFiles, undoRomRenames } from '../../../lib/tauri/roms';
import { buildRomRenamePlan } from '../../../lib/local/rom-rename-plan';
import { isRomAutoRenameEnabled } from '../../../lib/storage/preferences';
import { showToast } from '../../../lib/dom/toast';
import { getT } from '../../../i18n/runtime';
import type { GamesState } from './useLocalGames';

const UNDO_TOAST_MS = 12000;

// Once per Local visit, after the games scan has landed: re-scan the ROM
// folders in their typed form, compute the clean-up plan
// (rom-rename-plan.ts), apply it through Rust and offer an Undo in the
// toast. Off when the user disabled `local.roms.auto_rename` in Settings >
// Emulators. Reloads the grid afterwards since a renamed ROM has a new
// path-derived app_id (its links and covers moved with it in Rust).
export function useRomAutoRename(gamesState: GamesState, reloadGames: () => void): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (gamesState !== 'done' || ranRef.current) return;
    ranRef.current = true;
    if (!isRomAutoRenameEnabled()) return;
    let cancelled = false;

    (async () => {
      const scan = await scanRomLibrary();
      const plan = buildRomRenamePlan(scan);
      if (plan.length === 0 || cancelled) return;
      const outcome = await renameRomFiles(plan);
      if (outcome.renamed === 0) return;
      const t = getT();
      showToast(t.local.roms_renamed_toast.replace('{count}', String(outcome.renamed)), {
        backgroundColor: 'var(--color-success)',
        durationMs: UNDO_TOAST_MS,
        action: {
          label: t.local.roms_rename_undo,
          onClick: () => {
            undoRomRenames(outcome.journal_ids)
              .then(undone => {
                showToast(getT().local.roms_rename_undone.replace('{count}', String(undone)), 'success');
                reloadGames();
              })
              .catch(err => showToast(String(err), 'error'));
          },
        },
      });
      reloadGames();
    })().catch(err => console.error('[ROM rename]', err));

    return () => { cancelled = true; };
  }, [gamesState, reloadGames]);
}
