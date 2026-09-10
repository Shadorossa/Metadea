import { useRef, useState, type DragEvent } from 'react';

export interface DragHandlers {
  draggable: true;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
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
export function useDragReorder(onReorder: (fromIndex: number, toIndex: number) => void) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const dragHandlers = (index: number): DragHandlers => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      // Let clicks on nested controls (remove button, group-name input,
      // relation-type select) behave normally instead of starting a drag.
      const target = e.target as HTMLElement;
      if (target.closest('button, input, textarea, select')) {
        e.preventDefault();
        return;
      }
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
      if (dragIndexRef.current !== index) {
        onReorder(dragIndexRef.current, index);
        dragIndexRef.current = index;
        setDraggedIndex(index);
      }
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
    },
    // Fires whether the drag ended on a valid drop target or not — always
    // cleans up either way.
    onDragEnd: () => {
      dragIndexRef.current = null;
      setDraggedIndex(null);
    },
  });

  return { draggedIndex, dragHandlers };
}
