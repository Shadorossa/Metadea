import { useMemo } from 'react';
import { RelationTypeSelect } from '../RelationTypeSelect';
import { SortableItem, SortableList, type SortableListActions } from '../../shared/SortableList';
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
  sortable: SortableListActions;
  onRemove: (id: string) => void;
  onUpdateType: (id: string, relationType: string) => void;
  onAdd?: () => void;
  onEditWork?: (externalId: string) => void;
}

// The "Relations" panel - ADAPTATION/SPIN_OFF/ALTERNATIVE/etc, i.e. every
// relation that isn't managed by the saga chain or Bundled In. The
// "+ Add Relation" button lives in PrEditorModal's own section header row
// now, next to the "Relations" title. Reordering (mouse and keyboard) is the
// shared SortableList; the parent only supplies the reorder action.
export function PrEditorRelationsSection({
  editableRelations, relationOptions, relationLabels,
  sortable, onRemove, onUpdateType,
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
      <SortableList
        ids={editableRelations.map(r => r.related_media_external_id)}
        onReorder={sortable.onReorder}
        getLabel={id => editableRelations.find(r => r.related_media_external_id === id)?.title || id}
      >
        <div className="pr-editor-media-group-cards pr-editor-media-group-cards--twelve">
          {editableRelations.map(r => (
            <SortableItem key={r.related_media_external_id} id={r.related_media_external_id}>
              {({ handleProps, isDragging }) => (
                <PrEditorMediaCard
                  externalId={r.related_media_external_id}
                  title={r.title}
                  cover={r.cover}
                  isDragging={isDragging}
                  handleProps={handleProps}
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
              )}
            </SortableItem>
          ))}
          {onAdd && <PrEditorAddButton className="pr-editor-add-card-btn" onClick={onAdd} />}
        </div>
      </SortableList>
    </div>
  );
}
