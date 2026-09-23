// Pure parts of the pause overlay: which entries it shows and where "Quit
// game" leaves the user.
import type { GamePauseInfo } from '../tauri/game-pause';

export type PauseMenuAction = 'continue' | 'save_state' | 'quit';

export function pauseMenuActions(info: Pick<GamePauseInfo, 'canSaveState'>): PauseMenuAction[] {
  return info.canSaveState ? ['continue', 'save_state', 'quit'] : ['continue', 'quit'];
}

/** Session length as "1h 05m" / "12m". */
export function formatSessionTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

/** After "Quit game": stay in Big Picture when it is open, else the game's
 *  page (its catalog entry, or Local when the game has no catalog id). */
export function pathAfterQuit(externalId: string, bigPictureOpen: boolean, currentPath: string): string | null {
  if (bigPictureOpen) return null;
  const isCatalogId = /^[a-z]+:[^\s]+$/i.test(externalId);
  if (isCatalogId) {
    const target = `/media?id=${encodeURIComponent(externalId)}`;
    return currentPath === target ? null : target;
  }
  return currentPath.startsWith('/local') ? null : '/local';
}
