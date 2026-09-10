import type { DragHandlers } from './hooks/useDragReorder';

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
}

// Generic "grid of draggable cards with a remove button" panel — the Bundled
// In and Contains sections used to be two near-identical copies of this.
// Drag reordering itself lives in useDragReorder, in the parent — same
// pattern as the Saga order list. The "+ Add" trigger isn't rendered here —
// it lives in the caller's own section header row, next to the section
// title, not in its own row below.
export function PrEditorRelationCardList({
  relations, draggedIndex, dragHandlers, onRemove,
}: Props) {
  return (
    <div className="pr-editor-subsection pr-editor-subsection--bundled" style={{ width: '100%' }}>
      <div className="pr-editor-media-group-cards pr-editor-media-group-cards--six">
        {relations.map((r, index) => (
          <div
            key={r.external_id}
            className={`pr-editor-media-card${draggedIndex === index ? ' pr-editor-media-card--dragging' : ''}`}
            {...dragHandlers(index)}
          >
            <div className="pr-editor-media-card-cover">
              {r.cover
                ? <img src={r.cover} alt="" draggable={false} />
                : <div className="pr-editor-media-card-placeholder" />}
              <button
                type="button"
                className="pr-editor-media-card-remove"
                onClick={() => onRemove(r.external_id)}
              >
                ×
              </button>
            </div>
            <div className="pr-editor-media-card-title" title={r.title || r.external_id}>
              {r.title || r.external_id}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
