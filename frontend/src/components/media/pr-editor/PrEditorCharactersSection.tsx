import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, UserRoundPlus } from 'lucide-react';
import type { DbMediaCharacter } from '../../../lib/tauri/characters';
import type { Translations } from '../../../i18n/index';
import { getRolePageCount, getRolePageItems } from './PrEditorRolePagination';

interface Props {
  t: Translations;
  characters: DbMediaCharacter[];
  onRemove: (externalId: string) => void;
  onOpenSearch: (role: string) => void;
  onOpenCreate: (role: string) => void;
  onOpenCharacterEditor: (externalId: string, title?: string) => void;
}

const CHARACTER_ROLES = [
  { value: 'MAIN', labelKey: 'role_main' },
  { value: 'SUPPORTING', labelKey: 'role_supporting' },
  { value: 'BACKGROUND', labelKey: 'role_background' },
  { value: 'CAMEO', labelKey: 'role_cameo' },
] as const;

export function PrEditorCharactersSection({ t, characters, onRemove, onOpenSearch, onOpenCreate, onOpenCharacterEditor }: Props) {
  const [charPage, setCharPage] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ externalId: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);
  const groupedCharacters = CHARACTER_ROLES.map(role => ({
    ...role,
    allCharacters: characters.filter(c => (c.relation_type ?? 'SUPPORTING') === role.value),
  }));
  const totalPages = getRolePageCount(groupedCharacters.map(group => group.allCharacters.length));
  const safeCharPage = Math.min(charPage, totalPages - 1);
  const roleGroups = groupedCharacters.map(role => {
    return {
      ...role,
      label: t.character[role.labelKey],
      pageCharacters: getRolePageItems(role.allCharacters, safeCharPage),
    };
  });

  return (
    <div className="pr-editor-section">
      <div className="pr-editor-character-appearance-groups pr-editor-media-character-role-groups">
        {roleGroups.map(group => (
          <section className="pr-editor-character-appearance-group pr-editor-media-character-role-group" key={group.value}>
            <div className="pr-editor-character-appearance-header">
              <h3 className="pr-editor-section-title pr-editor-character-appearance-title">
                {group.label} <span>({group.allCharacters.length})</span>
              </h3>
              <div className="pr-editor-character-role-actions">
                <button type="button" className="pr-editor-character-role-action" onClick={() => onOpenCreate(group.value)} title={t.character.non_anilist_character_title} aria-label="Crear personaje">
                  <UserRoundPlus size={16} aria-hidden="true" />
                </button>
                <button type="button" className="pr-editor-character-role-action" onClick={() => onOpenSearch(group.value)} title="Añadir personaje" aria-label="Añadir personaje">
                  <Search size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="pr-editor-characters-grid pr-editor-media-character-role-grid">
              {group.pageCharacters.map(character => (
                <div
                  key={character.external_id}
                  className="pr-editor-media-card"
                  onContextMenu={event => {
                    event.preventDefault();
                    setContextMenu({ externalId: character.external_id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <div className="pr-editor-media-card-cover">
                    {character.image_url
                      ? <img className="cover-image-fill" src={character.image_url} alt="" />
                      : <div className="pr-editor-media-card-placeholder" />}
                    <button
                      type="button"
                      className="pr-editor-media-card-remove"
                      onClick={() => onRemove(character.external_id)}
                      aria-label={`Eliminar ${character.name}`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="pr-editor-media-card-title" title={character.name}>
                    {character.name}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="pr-editor-character-role-pagination">
          <button
            type="button"
            className="pr-editor-btn pr-editor-btn--cancel"
            disabled={safeCharPage === 0}
            onClick={() => setCharPage(page => Math.max(0, page - 1))}
            aria-label="Página anterior"
          >
            ‹
          </button>
          <span>Página {safeCharPage + 1} de {totalPages}</span>
          <button
            type="button"
            className="pr-editor-btn pr-editor-btn--cancel"
            disabled={safeCharPage >= totalPages - 1}
            onClick={() => setCharPage(page => Math.min(totalPages - 1, page + 1))}
            aria-label="Página siguiente"
          >
            ›
          </button>
        </div>
      )}
      {contextMenu && createPortal(
        <div
          className="pr-editor-session-tab-context-menu"
          role="menu"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 190), top: Math.min(contextMenu.y, window.innerHeight - 58) }}
          onPointerDown={event => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => {
            onOpenCharacterEditor(contextMenu.externalId, characters.find(character => character.external_id === contextMenu.externalId)?.name);
            setContextMenu(null);
          }}>
            Editar personaje
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
