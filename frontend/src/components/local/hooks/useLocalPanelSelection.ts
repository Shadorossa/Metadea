import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CategoryId } from '../utils/constants';
import type { LocalGame } from '../../../lib/tauri';
import { readLocalUrlState, writeLocalUrlState } from '../utils/urlState';
import { captureLocalGridScrollAnchor, clearLocalGridScrollAnchor } from './useVirtualCardGrid';

// Single source of truth for "what detail panel is open" across every Local
// category, Videojuegos included — LocalLibrary owns one instance of this
// and hands its selection/setters down to LocalMediaSection as props (and
// uses them directly in its own Videojuegos JSX), instead of each category
// keeping its own separate, drifting copy of the same three-state machine.
//
// Deliberately just an identifier, not the actual LocalMediaItem/LocalGame
// object — those come from whichever category's own item list happened to
// be active when it was selected, which goes stale (and in Videojuegos'
// case, isn't even the same list) the moment you tab away. Resolving a
// selection back into a real object is left to whoever's actually
// rendering it (LocalMediaSection, or LocalLibrary's own Videojuegos block),
// against whatever item list they already have on hand — see
// resolveCatalogSelection/resolveGameSelection/resolvePendingSelection.
export type LocalPanelSelection =
  | { kind: 'catalog'; id: string }
  | { kind: 'game'; key: string }
  | { kind: 'pending'; id: string; launchGameKey?: string }
  | null;

export function gameSelectionKey(g: LocalGame): string {
  return g.external_id ?? g.app_id ?? g.name;
}

export function resolveCatalogSelection<T extends { externalId: string }>(selection: LocalPanelSelection, items: T[]): T | null {
  return selection?.kind === 'catalog' ? items.find(i => i.externalId === selection.id) ?? null : null;
}

export function resolveGameSelection(selection: LocalPanelSelection, games: LocalGame[]): LocalGame | null {
  return selection?.kind === 'game' ? games.find(g => gameSelectionKey(g) === selection.key) ?? null : null;
}

export function resolvePendingSelection<T extends { externalId: string }>(selection: LocalPanelSelection, items: T[]): T | null {
  return selection?.kind === 'pending' ? items.find(i => i.externalId === selection.id) ?? null : null;
}

export function resolvePendingLaunchGame(selection: LocalPanelSelection, games: LocalGame[]): LocalGame | undefined {
  if (selection?.kind !== 'pending' || !selection.launchGameKey) return undefined;
  return games.find(g => gameSelectionKey(g) === selection.launchGameKey);
}

function parseSelection(sel: string): LocalPanelSelection {
  const kind = sel.slice(0, 2);
  const id = sel.slice(2);
  if (kind === 'c:') return { kind: 'catalog', id };
  if (kind === 'g:') return { kind: 'game', key: id };
  if (kind === 'p:') return { kind: 'pending', id };
  return null;
}

function encodeSelection(sel: LocalPanelSelection): string | null {
  if (!sel) return null;
  if (sel.kind === 'catalog') return `c:${sel.id}`;
  if (sel.kind === 'game') return `g:${sel.key}`;
  return `p:${sel.id}`;
}

export function useLocalPanelSelection(category: CategoryId) {
  const [selection, setSelectionRaw] = useState<LocalPanelSelection>(null);
  // Every category's own last-open selection, kept even while a DIFFERENT
  // category is active — forgotten only when this hook's owner (LocalLibrary)
  // unmounts, i.e. leaving /local entirely, not from switching tabs.
  const memory = useRef<Partial<Record<CategoryId, LocalPanelSelection>>>({});
  // null (not a real CategoryId) so the very first render's "settle into
  // whatever category/selection the URL actually named" goes through the
  // exact same code path as a later real tab switch, rather than needing a
  // separate one-shot effect that could race LocalLibrary's own ?type=
  // correction (see the isInitialSettle guard below for why that race
  // matters: writing to the URL before that correction runs would erase the
  // very sel= it still needs to read).
  const prevCategoryRef = useRef<CategoryId | null>(null);
  const urlCheckedRef = useRef(false);

  if (!urlCheckedRef.current) {
    urlCheckedRef.current = true;
    const { type, sel } = readLocalUrlState();
    if (type && sel) memory.current[type] = parseSelection(sel);
  }

  // Adjusted during render, not in an effect, so React re-renders
  // synchronously before painting instead of committing one frame with the
  // OLD selection resolved against the NEW category's items first (always
  // nothing, since ids never cross categories) — that in-between frame is
  // exactly what made the panel look like it closed-then-reopened, replaying
  // its entrance animation, on every category switch.
  if (category !== prevCategoryRef.current) {
    const outgoing = prevCategoryRef.current;
    const isInitialSettle = outgoing === null;
    if (!isInitialSettle) {
      if (selection) memory.current[outgoing] = selection;
      else delete memory.current[outgoing];
    }

    const incoming = memory.current[category] ?? null;
    setSelectionRaw(incoming);
    prevCategoryRef.current = category;
    // Skipped on the initial settle: LocalLibrary's own activeCategory
    // hasn't necessarily finished correcting itself from ?type= yet (it
    // does so from a useLayoutEffect, to avoid a hydration mismatch), and
    // writing here first would clobber the very sel= that correction still
    // needs to read.
    if (!isInitialSettle) writeLocalUrlState(category, encodeSelection(incoming));
  }

  function setSelection(sel: LocalPanelSelection) {
    // Opening/closing the detail panel narrows/widens .local-main-content,
    // which can change the games grid's own column count and therefore how
    // many ROWS it needs to hold the same cards. When that reflow happens
    // above (or overlapping) the current scroll position, the page grows or
    // shrinks there and everything below — including whatever the user was
    // actually looking at — shifts by that amount, with no accompanying
    // scroll adjustment: reads as the whole list jumping to a different
    // spot the instant the panel opens. Same "measure a stable reference
    // point before the synchronous DOM update. Virtualized grids hand the
    // correction to TanStack Virtual after their lane count changes; plain
    // grids use the small fallback below.
    const anchorKey = sel ? (sel.kind === 'game' ? sel.key : sel.id) : selection
      ? (selection.kind === 'game' ? selection.key : selection.id)
      : null;
    const anchor = captureLocalGridScrollAnchor(anchorKey);
    const beforeTop = anchor?.top;
    flushSync(() => setSelectionRaw(sel));
    if (anchor && beforeTop !== undefined && !anchor.virtualized) {
      const restoreAnchorPosition = () => {
        const afterTop = anchor.card.getBoundingClientRect().top;
        if (afterTop !== beforeTop) window.scrollBy(0, afterTop - beforeTop);
      };
      restoreAnchorPosition();
      requestAnimationFrame(() => {
        restoreAnchorPosition();
        requestAnimationFrame(restoreAnchorPosition);
      });
    }
    if (anchor?.virtualized) {
      // If the panel width did not remove a column, no ResizeObserver update
      // is needed and the virtualizer will not consume the pending anchor.
      // Give it two frames to handle a real lane change, then discard it.
      requestAnimationFrame(() => requestAnimationFrame(clearLocalGridScrollAnchor));
    }
    writeLocalUrlState(category, encodeSelection(sel));
  }
  function setCatalogSelection(id: string | null) {
    setSelection(id ? { kind: 'catalog', id } : null);
  }
  function setGameSelection(g: LocalGame | null) {
    setSelection(g ? { kind: 'game', key: gameSelectionKey(g) } : null);
  }
  function openPendingSelection(item: { externalId: string }, launchGame?: LocalGame) {
    setSelection({ kind: 'pending', id: item.externalId, launchGameKey: launchGame ? gameSelectionKey(launchGame) : undefined });
  }
  function clearSelection() {
    setSelection(null);
  }

  return { selection, setCatalogSelection, setGameSelection, openPendingSelection, clearSelection };
}
