interface BundledRelation {
  external_id: string;
  title?: string | null;
  cover?: string | null;
}

interface Props {
  bundledRelations: BundledRelation[];
  onRemove: (externalId: string) => void;
  onOpenSearch: () => void;
}

// The "Bundled In" panel — always saved as a PART_OF relation, no per-item
// type to pick (see PrEditorModal.tsx's own note on this).
export function PrEditorBundledSection({ bundledRelations, onRemove, onOpenSearch }: Props) {
  return (
    <div className="pr-editor-subsection pr-editor-subsection--bundled" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <label className="pr-editor-subsection-label" style={{ marginBottom: 0 }}>Bundled In</label>
        <button type="button" className="pr-editor-add-btn" onClick={onOpenSearch}>+ Add</button>
      </div>
      <div className="pr-editor-media-group-cards pr-editor-media-group-cards--six">
        {bundledRelations.map(r => (
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
