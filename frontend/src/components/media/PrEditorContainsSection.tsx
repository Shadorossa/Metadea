interface ContainedRelation {
  external_id: string;
  title?: string | null;
  cover?: string | null;
}

interface Props {
  containedRelations: ContainedRelation[];
  onRemove: (externalId: string) => void;
  onOpenSearch: () => void;
}

// The "Contains" panel — the reverse of Bundled In: things that have *this*
// entry as their Bundled In (this entry is the container). Only rendered
// when there's at least one, so an entry that isn't a container never shows
// an empty section for it (see PrEditorModal.tsx's caller).
export function PrEditorContainsSection({ containedRelations, onRemove, onOpenSearch }: Props) {
  return (
    <div className="pr-editor-subsection pr-editor-subsection--bundled" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <label className="pr-editor-subsection-label" style={{ marginBottom: 0 }}>Contains</label>
        <button type="button" className="pr-editor-add-btn" onClick={onOpenSearch}>+ Add</button>
      </div>
      <div className="pr-editor-media-group-cards pr-editor-media-group-cards--six">
        {containedRelations.map(r => (
          <div key={r.external_id} className="pr-editor-media-card">
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
