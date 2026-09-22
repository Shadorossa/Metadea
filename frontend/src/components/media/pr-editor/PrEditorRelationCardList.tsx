import type { DragHandlers } from '../hooks/useDragReorder';
import { PrEditorMediaCard } from './PrEditorMediaCard';
import { PrEditorAddButton } from './PrEditorAddButton';

interface RelationCard {
  external_id: string;
  title?: string | null;
  cover?: string | null;
}

interface Props {
  relations: RelationCard[];
  draggedIndex: number | null;
  dragHandlers: (index: number) => DragHandlers;
  onRemove: (externalId: string) => void;
  onAdd?: () => void;
}

// Generic "grid of draggable cards with a remove button" panel - the Bundled
// In and Contains sections used to be two near-identical copies of this.
// Drag reordering itself lives in useDragReorder, in the parent - same
// pattern as the Saga order list. The "+ Add" trigger isn't rendered here -
// it lives in the caller's own section header row, next to the section
// title, not in its own row below.
export function PrEditorRelationCardList({
  relations, draggedIndex, dragHandlers, onRemove, onAdd,
}: Props) {
  return (
    <div className="pr-editor-subsection pr-editor-subsection--bundled">
      <div className="pr-editor-media-group-cards pr-editor-media-group-cards--twelve">
        {relations.map((r, index) => (
          <PrEditorMediaCard
            key={r.external_id}
            externalId={r.external_id}
            title={r.title}
            cover={r.cover}
            isDragging={draggedIndex === index}
            dragHandlers={dragHandlers(index)}
            onRemove={onRemove}
          />
        ))}
        {onAdd && <PrEditorAddButton className="pr-editor-add-card-btn" onClick={onAdd} />}
      </div>
    </div>
  );
}
