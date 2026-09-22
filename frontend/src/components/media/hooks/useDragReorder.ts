import { useRef, useState, type DragEvent } from 'react';

export interface DragHandlers {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
}

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
// Used by the saga-order list and the relations lists in PrEditorModal.tsx,
// which used to each pass their own dataset attribute name into this hook.
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

  const dragHandlers = (index: number): DragHandlers => ({
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
  });

  return { draggedIndex, dragHandlers, dwellTargetIndex, dwellReady };
}
