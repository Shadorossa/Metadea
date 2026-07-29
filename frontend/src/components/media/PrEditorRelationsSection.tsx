import { RelationTypeSelect } from './RelationTypeSelect';

interface EditableRelation {
  related_media_external_id: string;
  relation_type: string;
  type_label: string;
  title?: string | null;
  cover?: string | null;
}

interface Props {
  editableRelations: EditableRelation[];
  relationOptions: string[];
  relationLabels: Record<string, string>;
  draggedIndex: number | null;
  onStartDrag: (index: number) => void;
  onRemove: (id: string) => void;
  onUpdateType: (id: string, relationType: string) => void;
}

// The "Relations" panel — ADAPTATION/SPIN_OFF/ALTERNATIVE/etc, i.e. every
// relation that isn't managed by the saga chain or Bundled In. The
// "+ Add Relation" button lives in PrEditorModal's own section header row
// now, next to the "Relations" title. Drag reordering itself lives in
// useDragReorder, in the parent.
export function PrEditorRelationsSection({
  editableRelations, relationOptions, relationLabels,
  draggedIndex, onStartDrag, onRemove, onUpdateType,
}: Props) {
  return (
    <div className="pr-editor-subsection pr-editor-subsection--saga" style={{ flex: 1, minWidth: '200px' }}>
      <div className="pr-editor-media-group-cards pr-editor-media-group-cards--six" style={{ marginBottom: '1.25rem' }}>
        {editableRelations.map((r, index) => (
          <div
            key={r.related_media_external_id}
            data-relation-index={index}
            className={`pr-editor-media-card${draggedIndex === index ? ' pr-editor-media-card--dragging' : ''}`}
            onPointerDown={e => {
              e.preventDefault();
              onStartDrag(index);
            }}
          >
            <div className="pr-editor-media-card-cover">
              {r.cover
                ? <img src={r.cover} alt="" draggable={false} />
                : <div className="pr-editor-media-card-placeholder" />}
              <button
                type="button"
                className="pr-editor-media-card-remove"
                onClick={() => onRemove(r.related_media_external_id)}
              >
                ×
              </button>
            </div>
            <RelationTypeSelect
              value={r.relation_type}
              options={relationOptions}
              labels={relationLabels}
              extraOption={{ value: r.relation_type, label: r.type_label }}
              onChange={type => onUpdateType(r.related_media_external_id, type)}
            />
            <div className="pr-editor-media-card-title" title={r.title || r.related_media_external_id}>
              {r.title || r.related_media_external_id}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
