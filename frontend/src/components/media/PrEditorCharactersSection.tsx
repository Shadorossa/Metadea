import { useState } from 'react';
import type { DbMediaCharacter } from '../../lib/tauri/characters';
import type { Translations } from '../../i18n/index';

interface Props {
  t: Translations;
  characters: DbMediaCharacter[];
  changed: boolean;
  onRemove: (externalId: string) => void;
  onUpdateRole: (externalId: string, role: string) => void;
  onOpenSearch: () => void;
}

const ITEMS_PER_PAGE = 12;

// The "Personajes" panel of PrEditorModal — paginated grid + role picker per
// card. Self-contained aside from its own page index, so it owns that piece
// of state locally instead of pushing it up into the parent.
export function PrEditorCharactersSection({ t, characters, changed, onRemove, onUpdateRole, onOpenSearch }: Props) {
  const [charPage, setCharPage] = useState(0);

  const totalPages = Math.ceil(characters.length / ITEMS_PER_PAGE) || 1;
  const safeCharPage = Math.min(charPage, totalPages - 1);
  const paginatedChars = characters.slice(safeCharPage * ITEMS_PER_PAGE, (safeCharPage + 1) * ITEMS_PER_PAGE);

  return (
    <div className="pr-editor-section">
      <span className="pr-editor-section-title">
        Personajes
        {changed && <span className="pr-editor-section-changed-dot" />}
      </span>

      <div className="pr-editor-characters-grid" style={{ marginTop: '0.6rem', marginBottom: '0.75rem', minHeight: '25.5rem' }}>
        {paginatedChars.map(c => (
          <div key={c.external_id} className="pr-editor-media-card">
            <div className="pr-editor-media-card-cover">
              {c.image_url
                ? <img src={c.image_url} alt="" />
                : <div className="pr-editor-media-card-placeholder" />}
              <button
                type="button"
                className="pr-editor-media-card-remove"
                onClick={() => onRemove(c.external_id)}
              >
                ×
              </button>
            </div>
            <div
              className="pr-editor-media-card-title"
              title={c.name}
              style={{
                height: '2.4em',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: '1.2'
              }}
            >
              {c.name}
            </div>
            <select
              value={c.relation_type ?? 'SUPPORTING'}
              onChange={e => onUpdateRole(c.external_id, e.target.value)}
              className="pr-editor-media-card-select"
              style={{ fontSize: '0.7rem' }}
            >
              <option value="MAIN">{t.character.role_main}</option>
              <option value="SUPPORTING">{t.character.role_supporting}</option>
              <option value="BACKGROUND">{t.character.role_background}</option>
            </select>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            className="pr-editor-btn pr-editor-btn--cancel"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', margin: 0 }}
            disabled={safeCharPage === 0}
            onClick={() => setCharPage(prev => Math.max(0, prev - 1))}
          >
            &lt;
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Página {safeCharPage + 1} de {totalPages}
          </span>
          <button
            type="button"
            className="pr-editor-btn pr-editor-btn--cancel"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', margin: 0 }}
            disabled={safeCharPage >= totalPages - 1}
            onClick={() => setCharPage(prev => Math.min(totalPages - 1, prev + 1))}
          >
            &gt;
          </button>
        </div>

        <button
          type="button"
          className="pr-editor-btn pr-editor-btn--submit"
          style={{ padding: '0.35rem 0.85rem', fontSize: '0.75rem', margin: 0 }}
          onClick={onOpenSearch}
        >
          + Añadir personaje
        </button>
      </div>
    </div>
  );
}
