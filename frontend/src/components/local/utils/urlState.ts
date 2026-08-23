// Keeps /local's own URL in sync with the active category tab and whatever
// item's detail panel is open — purely so browser Back actually returns to
// where the user was (same tab, same selected work) instead of landing back
// on /local with nothing encoded, which always re-mounted LocalLibrary at
// its hardcoded default (Videojuegos, nothing selected) — indistinguishable
// from a fresh visit from the navbar. history.replaceState (never
// pushState) throughout: every tab switch/selection change updates this
// same history entry in place rather than adding a new Back stop for each one.
import type { CategoryId } from './constants';

export interface LocalUrlState {
  type: CategoryId | null;
  sel:  string | null; // "g:<id>" (a real scanned/installed item) | "p:<id>" (a library-only pending item)
}

export function readLocalUrlState(): LocalUrlState {
  if (typeof window === 'undefined') return { type: null, sel: null };
  const params = new URLSearchParams(window.location.search);
  return { type: params.get('type') as CategoryId | null, sel: params.get('sel') };
}

export function writeLocalUrlState(type: CategoryId, sel: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('type', type);
  if (sel) url.searchParams.set('sel', sel);
  else url.searchParams.delete('sel');
  history.replaceState(history.state, '', url.toString());
}
