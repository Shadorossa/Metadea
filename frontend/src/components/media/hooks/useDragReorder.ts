import { useRef, useState, type DragEvent, type HTMLAttributes, type RefCallback } from 'react';
import type { SortableListActions } from '../../shared/SortableList';

// Props a card spreads on its root to become draggable. Either the native
// HTML5 handlers this hook builds, or the dnd-kit handle props SortableItem
// hands out (ref + aria attributes + pointer/keyboard listeners + transform
// style) — PrEditorMediaCard takes both through this one type.
export type DragHandlers = HTMLAttributes<HTMLElement> & { ref?: RefCallback<HTMLElement> };

// `dragHandlers(index)` as consumers receive it; `sortable` rides along for
// call sites that reach this hook only through that function.
export type DragHandlersFactory = ((index: number) => DragHandlers) & { sortable?: SortableListActions };

interface DragReorderOptions {
  /** When supplied, holding over another item delays the decision until drop:
   *  drop before the dwell timeout reorders; drop after it invokes this group action. */
  onDwellDrop?: (fromIndex: number, toIndex: number) => void;
  /** Prevents the dwell/group affordance for targets that cannot be grouped. */
  canDwellOver?: (fromIndex: number, toIndex: number) => boolean;
  dwellMs?: number;
}

// Native HTML5 drag & drop reorder for a flat list of cards — the browser/OS
// renders the drag ghost that tracks the cursor, entirely outside our own
// render loop, so it can't stutter. Each card gets `dragHandlers(index)`
// spread onto it directly; its own onDragOver already tells us which index
// the cursor is over, so unlike the old pointer-based version there's no
// data-{attr}-index attribute to read and no document.elementFromPoint()
// scan (itself a layout-forcing call) running on every raw pointer move.
//
// Still used natively by the editable-relations and issues lists. The saga
// chain and the relation card grids render through the shared SortableList
// instead (keyboard-reorderable); they take the same reorder/group callbacks
// as `sortable`, which also rides on `dragHandlers` because
// usePrEditorDraftActions hand-picks the saga's fields.
export function useDragReorder(onReorder: (fromIndex: number, toIndex: number) => void, options: DragReorderOptions = {}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dwellTargetIndex, setDwellTargetIndex] = useState<number | null>(null);
  const [dwellReady, setDwellReady] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const dwellTargetRef = useRef<number | null>(null);
  const dwellReadyRef = useRef<number | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDwell = () => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = null;
    dwellTargetRef.current = null;
    dwellReadyRef.current = null;
    setDwellTargetIndex(null);
    setDwellReady(false);
  };

  const sortable: SortableListActions = { onReorder, onGroup: options.onDwellDrop, canGroup: options.canDwellOver };

  const dragHandlers = Object.assign((index: number): DragHandlers => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      // Let clicks on nested controls (remove button, inputs, selects) behave
      // normally instead of starting a drag.
      const target = e.target as HTMLElement;
      if (target.closest('button, input, textarea, select')) {
        e.preventDefault();
        return;
      }
      clearDwell();
      dragIndexRef.current = index;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
      }
      setDraggedIndex(index);
    },
    onDragOver: (e: DragEvent) => {
      if (dragIndexRef.current === null) return;
      e.preventDefault(); // required for this to be a valid drop target
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (options.onDwellDrop) {
        if (dragIndexRef.current === index) {
          clearDwell();
          return;
        }
        if (options.canDwellOver && !options.canDwellOver(dragIndexRef.current, index)) {
          if (dwellTargetRef.current !== null) clearDwell();
          return;
        }
        if (dwellTargetRef.current !== index) {
          clearDwell();
          dwellTargetRef.current = index;
          setDwellTargetIndex(index);
          dwellTimerRef.current = setTimeout(() => {
            if (dwellTargetRef.current !== index) return;
            dwellReadyRef.current = index;
            setDwellReady(true);
          }, options.dwellMs ?? 1000);
        }
        return;
      }
      if (dragIndexRef.current !== index) {
        onReorder(dragIndexRef.current, index);
        dragIndexRef.current = index;
        setDraggedIndex(index);
      }
    },
    onDragLeave: (e: DragEvent) => {
      if (!options.onDwellDrop || dwellTargetRef.current !== index) return;
      const relatedTarget = e.relatedTarget;
      if (relatedTarget instanceof Node && e.currentTarget.contains(relatedTarget)) return;
      clearDwell();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const fromIndex = dragIndexRef.current;
      if (options.onDwellDrop && fromIndex !== null && fromIndex !== index) {
        if (dwellReadyRef.current === index) options.onDwellDrop(fromIndex, index);
        else onReorder(fromIndex, index);
      }
      clearDwell();
    },
    // Fires whether the drag ended on a valid drop target or not — always
    // cleans up either way.
    onDragEnd: () => {
      dragIndexRef.current = null;
      clearDwell();
      setDraggedIndex(null);
    },
  }), { sortable });

  return { draggedIndex, dragHandlers, dwellTargetIndex, dwellReady, sortable };
}
