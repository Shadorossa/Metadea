// Returns the list with the item at `fromIndex` moved to `toIndex`, or null
// when the move is a no-op or either index is out of range — callers skip the
// state update on null so an invalid reorder never triggers a re-render.
export function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] | null {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return null;
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
