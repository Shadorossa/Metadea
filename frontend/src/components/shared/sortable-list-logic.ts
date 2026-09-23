// Pure decisions behind SortableList — which drop zone a pointer offset falls
// in, where an "insert before/after target" drop lands, and what a drop
// finally does. Kept DOM-free so they can be characterised without dnd-kit.

export type DropSide = 'before' | 'after';
export type DropZone = DropSide | 'group';
export type GroupState = 'none' | 'pending' | 'ready';

// Horizontal thirds of the target card: the outer 22% on each side insert
// next to it; the middle groups (when the pair can be grouped) — otherwise
// the card is simply split in half between before and after.
export function classifyDropZone(offsetRatio: number, canGroup: boolean): DropZone {
  if (offsetRatio < 0.22 || (!canGroup && offsetRatio <= 0.5)) return 'before';
  if (offsetRatio > 0.78 || (!canGroup && offsetRatio > 0.5)) return 'after';
  return 'group';
}

// The index an item lands on (arrayMove semantics: remove `from`, then insert)
// when dropped before/after `target`.
export function resolveSideDropIndex(from: number, target: number, side: DropSide): number {
  const shifted = from < target ? target - 1 : target;
  return side === 'after' ? shifted + 1 : shifted;
}

export interface DropInput {
  from: number;
  target: number;
  groupState: GroupState;
  canGroup: boolean;
  side: DropSide | null;
}

export type DropResult = { kind: 'group'; to: number } | { kind: 'reorder'; to: number } | null;

// Null means "nothing happens" — no target, dropped on itself, or an
// insert that would not move the item.
export function resolveDrop({ from, target, groupState, canGroup, side }: DropInput): DropResult {
  if (from < 0 || target < 0 || from === target) return null;
  if (groupState === 'ready' && canGroup) return { kind: 'group', to: target };
  const to = side ? resolveSideDropIndex(from, target, side) : target;
  return to === from ? null : { kind: 'reorder', to };
}

// `{item}`-style placeholder substitution for the announcement strings.
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((acc, [key, value]) => acc.split(`{${key}}`).join(String(value)), template);
}
