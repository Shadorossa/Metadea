import React from 'react';

export interface MetaProgress {
  total:       number;
  current:     number;
  currentName: string;
  cancelled:   boolean;
}

interface MetadataModalProps {
  progress: MetaProgress;
  onCancel: () => void;
}

export function MetadataModal({ progress, onCancel }: MetadataModalProps) {
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div className="meta-modal-overlay">
      <div className="meta-modal">
        <h3 className="meta-modal-title">Actualizando metadatos</h3>
        <p className="meta-modal-subtitle">{progress.currentName || 'Iniciando…'}</p>
        <div className="meta-modal-bar-track">
          <div className="meta-modal-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="meta-modal-count">{progress.current} / {progress.total}</p>
        <button type="button" className="meta-modal-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
