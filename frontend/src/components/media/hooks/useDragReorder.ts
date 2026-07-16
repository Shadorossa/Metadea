import { useState, useEffect } from 'react';

function toKebabCase(name: string): string {
  return name.replace(/([A-Z])/g, '-$1').toLowerCase();
}

// Pointer-based drag reorder for a grid of cards, each rendered with a
// `data-{datasetName}={index}` attribute (e.g. data-saga-index). Tracks which
// card is currently being dragged and calls onReorder whenever the pointer
// moves over a different card's index — used by both the saga-order list and
// the relations list in PrEditorModal.tsx, which used to duplicate this
// pointermove/pointerup wiring verbatim.
export function useDragReorder(
  datasetName: string,
  onReorder: (fromIndex: number, toIndex: number) => void,
) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (draggedIndex === null) return;

    const attr = toKebabCase(datasetName);
    const handleMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const card = el?.closest<HTMLElement>(`[data-${attr}]`);
      if (!card) return;
      const overIndex = parseInt(card.dataset[datasetName] || '', 10);
      if (Number.isNaN(overIndex) || overIndex === draggedIndex) return;
      onReorder(draggedIndex, overIndex);
      setDraggedIndex(overIndex);
    };
    const handleUp = () => setDraggedIndex(null);

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, [draggedIndex, datasetName, onReorder]);

  return { draggedIndex, setDraggedIndex };
}
