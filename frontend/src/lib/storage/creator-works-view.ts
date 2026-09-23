// Grid | Timeline choice of the company and author works sections,
// remembered per page type. A per-viewer convenience: storage failing
// (private window, blocked site data) just falls back to the grid.
import { STORAGE_KEYS } from './storage-keys';
import type { CreatorKind } from '../media/creator-completion';

export type CreatorWorksView = 'grid' | 'timeline';

function keyFor(kind: CreatorKind): string {
  return `${STORAGE_KEYS.creatorWorksView}:${kind}`;
}

export function readCreatorWorksView(kind: CreatorKind): CreatorWorksView {
  try {
    return localStorage.getItem(keyFor(kind)) === 'timeline' ? 'timeline' : 'grid';
  } catch {
    return 'grid';
  }
}

export function saveCreatorWorksView(kind: CreatorKind, view: CreatorWorksView): void {
  try {
    localStorage.setItem(keyFor(kind), view);
  } catch {
    // Not remembered this time; the page still switches.
  }
}
