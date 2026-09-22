import { useDragReorder } from './useDragReorder';

// Returns the list with the item at `fromIndex` moved to `toIndex`, or null
// when the move is a no-op or either index is out of range — callers skip the
// state update on null so an invalid drag never triggers a re-render.
export function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] | null {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return null;
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

// Drag-to-reorder for a list whose only reorder path is the drag itself.
// Lists that also reorder from elsewhere (the saga chain, whose grouping drop
// reorders as part of a larger update) keep their own handler and call
// `moveItem` directly.
export function useListReorder<T>(list: T[], setList: (next: T[]) => void) {
  return useDragReorder((fromIndex, toIndex) => {
    const next = moveItem(list, fromIndex, toIndex);
    if (next) setList(next);
  });
}
