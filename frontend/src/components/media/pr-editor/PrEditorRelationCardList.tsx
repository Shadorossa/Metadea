import type { DragHandlers, DragHandlersFactory } from '../hooks/useDragReorder';
import { SortableItem, SortableList, type SortableListActions } from '../../shared/SortableList';
import { PrEditorMediaCard } from './PrEditorMediaCard';
import { PrEditorAddButton } from './PrEditorAddButton';

interface RelationCard {
  external_id: string;
  title?: string | null;
  cover?: string | null;
}

interface Props {
  relations: RelationCard[];
  sortable?: SortableListActions;
  // Legacy pair from useDragReorder; the factory carries `sortable` itself,
  // which is what actually drives the list. Only the native handlers remain
  // for a factory built without it.
  draggedIndex?: number | null;
  dragHandlers?: DragHandlersFactory;
  onRemove: (externalId: string) => void;
  onAdd?: () => void;
  onEditWork?: (externalId: string) => void;
}

// Generic "grid of draggable cards with a remove button" panel - the Bundled
// In and Contains sections used to be two near-identical copies of this.
// Reordering (mouse and keyboard) is the shared SortableList; the parent only
// supplies the reorder action. The "+ Add" trigger isn't rendered here -
// it lives in the caller's own section header row, next to the section
// title, not in its own row below.
export function PrEditorRelationCardList({
  relations, sortable, draggedIndex, dragHandlers, onRemove, onAdd, onEditWork,
}: Props) {
  const actions = sortable ?? dragHandlers?.sortable;
  const addButton = onAdd && <PrEditorAddButton className="pr-editor-add-card-btn" onClick={onAdd} />;
  const card = (r: RelationCard, isDragging: boolean, handleProps: DragHandlers) => (
    <PrEditorMediaCard
      key={r.external_id}
      externalId={r.external_id}
      title={r.title}
      cover={r.cover}
      isDragging={isDragging}
      dragHandlers={handleProps}
      onRemove={onRemove}
      onEditWork={onEditWork}
    />
  );

  return (
    <div className="pr-editor-subsection pr-editor-subsection--bundled">
      {actions ? (
        <SortableList
          ids={relations.map(r => r.external_id)}
          onReorder={actions.onReorder}
          getLabel={id => relations.find(r => r.external_id === id)?.title || id}
        >
          <div className="pr-editor-media-group-cards pr-editor-media-group-cards--twelve">
            {relations.map(r => (
              <SortableItem key={r.external_id} id={r.external_id}>
                {({ handleProps, isDragging }) => card(r, isDragging, handleProps)}
              </SortableItem>
            ))}
            {addButton}
          </div>
        </SortableList>
      ) : (
        <div className="pr-editor-media-group-cards pr-editor-media-group-cards--twelve">
          {relations.map((r, index) => card(r, draggedIndex === index, dragHandlers?.(index) ?? {}))}
          {addButton}
        </div>
      )}
    </div>
  );
}
