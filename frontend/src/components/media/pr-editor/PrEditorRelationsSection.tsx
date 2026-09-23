import { useMemo } from 'react';
import { RelationTypeSelect } from '../RelationTypeSelect';
import type { DragHandlers } from '../hooks/useDragReorder';
import { groupRelationOptions } from '../../../lib/media/saga/saga-relation-types';
import { RELATION_TYPE_RECIPROCAL } from '../../../lib/media/saga/canonical-relations';
import { PrEditorMediaCard } from './PrEditorMediaCard';
import { PrEditorAddButton } from './PrEditorAddButton';

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
  dragHandlers: (index: number) => DragHandlers;
  onRemove: (id: string) => void;
  onUpdateType: (id: string, relationType: string) => void;
  onAdd?: () => void;
  onEditWork?: (externalId: string) => void;
}

// The "Relations" panel - ADAPTATION/SPIN_OFF/ALTERNATIVE/etc, i.e. every
// relation that isn't managed by the saga chain or Bundled In. The
// "+ Add Relation" button lives in PrEditorModal's own section header row
// now, next to the "Relations" title. Drag reordering itself lives in
// useDragReorder, in the parent.
export function PrEditorRelationsSection({
  editableRelations, relationOptions, relationLabels,
  draggedIndex, dragHandlers, onRemove, onUpdateType,
  onAdd, onEditWork,
}: Props) {
  // Same groups for every card (doesn't depend on the individual relation),
  // so this is computed once per relationOptions/relationLabels change
  // instead of once per card render.
  const relationGroups = useMemo(
    () => groupRelationOptions(relationOptions, RELATION_TYPE_RECIPROCAL, relationLabels),
    [relationOptions, relationLabels],
  );

  return (
    <div className="pr-editor-subsection pr-editor-subsection--saga">
      <div className="pr-editor-media-group-cards pr-editor-media-group-cards--twelve">
        {editableRelations.map((r, index) => (
          <PrEditorMediaCard
            key={r.related_media_external_id}
            externalId={r.related_media_external_id}
            title={r.title}
            cover={r.cover}
            isDragging={draggedIndex === index}
            dragHandlers={dragHandlers(index)}
            onRemove={onRemove}
            onEditWork={onEditWork}
          >
            <RelationTypeSelect
              value={r.relation_type}
              groups={relationGroups}
              labels={relationLabels}
              extraOption={{ value: r.relation_type, label: r.type_label }}
              onChange={type => onUpdateType(r.related_media_external_id, type)}
            />
          </PrEditorMediaCard>
        ))}
        {onAdd && <PrEditorAddButton className="pr-editor-add-card-btn" onClick={onAdd} />}
      </div>
    </div>
  );
}
