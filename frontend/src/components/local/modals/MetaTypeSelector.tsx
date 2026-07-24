import React, { useState } from 'react';
import { getT } from '../../../i18n/client';

export type MetaType = 'basic' | 'achievements';

interface MetaTypeSelectorProps {
  onConfirm: (types: MetaType[]) => void;
  onCancel:  () => void;
}

const OPTIONS: { id: MetaType; label: string; desc: string }[] = [
  { id: 'basic',        label: 'Básico',          desc: 'Portada, banner, géneros, sinopsis, fecha de lanzamiento y editor' },
  { id: 'achievements', label: 'Logros de Steam',  desc: 'Iconos y textos de todos los logros del juego (requiere API key de Steam)' },
];

export function MetaTypeSelector({ onConfirm, onCancel }: MetaTypeSelectorProps) {
  const t = getT();
  const [selected, setSelected] = useState<Set<MetaType>>(new Set(['basic']));

  const toggle = (t: MetaType) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  return (
    <div className="meta-modal-overlay">
      <div className="meta-modal">
        <h3 className="meta-modal-title">{t.local.meta_selector_title}</h3>
        <p className="meta-modal-subtitle">{t.local.meta_selector_subtitle}</p>
        <div className="meta-type-list">
          {OPTIONS.map(({ id, label, desc }) => (
            <button
              key={id}
              type="button"
              className={`meta-type-option${selected.has(id) ? ' selected' : ''}`}
              onClick={() => toggle(id)}
            >
              <span className="meta-type-check">
                {selected.has(id) && (
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </span>
              <span className="meta-type-text">
                <span className="meta-type-label">{label}</span>
                <span className="meta-type-desc">{desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="meta-modal-actions">
          <button type="button" className="meta-modal-cancel" onClick={onCancel}>{t.local.cancel}</button>
          <button
            type="button"
            className="meta-modal-confirm"
            disabled={selected.size === 0}
            onClick={() => onConfirm(Array.from(selected))}
          >
            Descargar
          </button>
        </div>
      </div>
    </div>
  );
}
