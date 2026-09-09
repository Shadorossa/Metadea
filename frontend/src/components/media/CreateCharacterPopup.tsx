import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { generateCustomCharacterId } from '../../lib/character/customCharacter';

export interface CreatedCharacter {
  externalId: string;
  name:       string;
  imageUrl:   string | null;
}

export interface CreateCharacterPopupProps {
  onCreate: (result: CreatedCharacter) => void;
  onClose:  () => void;
}

// Companion to CharacterSearchPopup for a character no provider has ever
// cataloged — just a name (and optionally an image URL) instead of a search
// result. The character itself isn't persisted here: it's added to this
// entry's own in-memory character list the same way a search pick is (see
// PrEditorModal's addCharacter), and only actually saved when the whole
// proposal is submitted — same "draft until Submit" behavior as everything
// else in this editor.
export function CreateCharacterPopup({ onCreate, onClose }: CreateCharacterPopupProps) {
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ externalId: generateCustomCharacterId(), name: trimmed, imageUrl: imageUrl.trim() || null });
  };

  const modal = (
    <div className="pr-editor-search-popup" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="pr-editor-search-popup-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
        <div className="pr-editor-search-controls" style={{ flexDirection: 'column', gap: '0.6rem', alignItems: 'stretch' }}>
          <input
            type="text"
            placeholder="Nombre del personaje"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
            className="pr-editor-search-input"
            style={{ width: '100%' }}
          />
          <input
            type="text"
            placeholder="URL de imagen (opcional)"
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            className="pr-editor-search-input"
            style={{ width: '100%' }}
          />
          <button
            type="button"
            className="pr-editor-btn pr-editor-btn--submit"
            style={{ margin: 0, alignSelf: 'flex-end' }}
            disabled={!name.trim()}
            onClick={handleCreate}
          >
            Crear personaje
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}
