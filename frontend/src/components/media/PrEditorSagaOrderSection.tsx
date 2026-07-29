import type { MetaResolver } from '../../lib/media/sagaGrouping';
import { getT } from '../../i18n/client';

interface Props {
  externalId: string;
  sagaOrder: string[];
  sagaGroups: Record<string, string>;
  draggedIndex: number | null;
  onStartDrag: (index: number) => void;
  onRemove: (id: string) => void;
  onUpdateGroup: (id: string, group: string) => void;
  resolveMeta: MetaResolver;
}

// The "Saga order" panel — the draggable chain of every media in the saga
// (this entry included, never removable from its own chain). The saga name
// field and "+ Add to Saga" button both live in PrEditorModal's own section
// header row now, next to the "Saga" title. Drag reordering itself lives in
// useDragReorder, in the parent.
export function PrEditorSagaOrderSection({
  externalId, sagaOrder, sagaGroups,
  draggedIndex, onStartDrag, onRemove, onUpdateGroup, resolveMeta,
}: Props) {
  const pe = getT().pr_editor;
  return (
    <div className="pr-editor-subsection pr-editor-subsection--saga">
      <div className="pr-editor-media-group-cards pr-editor-media-group-cards--seven" style={{ marginBottom: '1.25rem' }}>
        {sagaOrder.map((id, index) => {
          const meta = resolveMeta(id);
          return (
            <div
              key={id}
              data-saga-index={index}
              className={`pr-editor-media-card${id === externalId ? ' pr-editor-media-card--current' : ''}${draggedIndex === index ? ' pr-editor-media-card--dragging' : ''}`}
              onPointerDown={e => {
                e.preventDefault();
                onStartDrag(index);
              }}
            >
              <div className="pr-editor-media-card-cover">
                {meta.cover
                  ? <img src={meta.cover} alt="" draggable={false} />
                  : <div className="pr-editor-media-card-placeholder" />}
                {id !== externalId && (
                  <button
                    type="button"
                    className="pr-editor-media-card-remove"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={() => onRemove(id)}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="pr-editor-media-card-title" title={meta.title || id}>
                {meta.title || id}
              </div>
              <input
                type="text"
                placeholder={pe.concept_group_placeholder}
                value={sagaGroups[id] || ''}
                onChange={e => onUpdateGroup(id, e.target.value)}
                onPointerDown={e => e.stopPropagation()}
                className="pr-editor-media-card-group-input"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
