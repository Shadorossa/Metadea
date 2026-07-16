import type { MetaResolver } from '../../lib/media/sagaGrouping';

interface Props {
  externalId: string;
  sagaName: string;
  onSagaNameChange: (name: string) => void;
  sagaOrder: string[];
  sagaGroups: Record<string, string>;
  draggedIndex: number | null;
  onStartDrag: (index: number) => void;
  onRemove: (id: string) => void;
  onUpdateGroup: (id: string, group: string) => void;
  onOpenSearch: () => void;
  resolveMeta: MetaResolver;
}

// The "Saga order" panel — a name field plus the draggable chain of every
// media in the saga (this entry included, never removable from its own
// chain). Drag reordering itself lives in useDragReorder, in the parent.
export function PrEditorSagaOrderSection({
  externalId, sagaName, onSagaNameChange, sagaOrder, sagaGroups,
  draggedIndex, onStartDrag, onRemove, onUpdateGroup, onOpenSearch, resolveMeta,
}: Props) {
  return (
    <div className="pr-editor-subsection pr-editor-subsection--saga">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1.25rem' }}>
        <label className="pr-editor-subsection-label">Saga Name</label>
        <input
          type="text"
          placeholder="Saga Name (e.g. Inazuma Eleven)"
          value={sagaName}
          onChange={e => onSagaNameChange(e.target.value)}
          className="pr-editor-media-card-group-input"
          style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem', border: '1px solid rgba(124, 106, 247, 0.3)' }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <label className="pr-editor-subsection-label" style={{ marginBottom: 0 }}>Saga order</label>
        <button type="button" className="pr-editor-add-btn" onClick={onOpenSearch}>+ Add to Saga</button>
      </div>
      <div className="pr-editor-media-group-cards" style={{ marginBottom: '1.25rem' }}>
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
                placeholder="Concept Group..."
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
