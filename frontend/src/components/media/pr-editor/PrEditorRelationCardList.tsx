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
  sortable: SortableListActions;
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
export function PrEditorRelationCardList({ relations, sortable, onRemove, onAdd, onEditWork }: Props) {
  return (
    <div className="pr-editor-subsection pr-editor-subsection--bundled">
      <SortableList
        ids={relations.map(r => r.external_id)}
        onReorder={sortable.onReorder}
        getLabel={id => relations.find(r => r.external_id === id)?.title || id}
      >
        <div className="pr-editor-media-group-cards pr-editor-media-group-cards--twelve">
          {relations.map(r => (
            <SortableItem key={r.external_id} id={r.external_id}>
              {({ handleProps, isDragging }) => (
                <PrEditorMediaCard
                  externalId={r.external_id}
                  title={r.title}
                  cover={r.cover}
                  isDragging={isDragging}
                  handleProps={handleProps}
                  onRemove={onRemove}
                  onEditWork={onEditWork}
                />
              )}
            </SortableItem>
          ))}
          {onAdd && <PrEditorAddButton className="pr-editor-add-card-btn" onClick={onAdd} />}
        </div>
      </SortableList>
    </div>
  );
}
