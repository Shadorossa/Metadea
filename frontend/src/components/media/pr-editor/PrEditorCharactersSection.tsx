import { useState } from 'react';
import { Search, UserRoundPlus } from 'lucide-react';
import type { DbMediaCharacter } from '../../../lib/tauri/characters';
import type { Translations } from '../../../i18n/index';

interface Props {
  t: Translations;
  characters: DbMediaCharacter[];
  changed: boolean;
  onRemove: (externalId: string) => void;
  onOpenSearch: (role: string) => void;
  onOpenCreate: (role: string) => void;
}

const ITEMS_PER_PAGE = 24; // 8 cards x 3 rows per role.
const CHARACTER_ROLES = [
  { value: 'MAIN', labelKey: 'role_main' },
  { value: 'SUPPORTING', labelKey: 'role_supporting' },
  { value: 'BACKGROUND', labelKey: 'role_background' },
  { value: 'CAMEO', labelKey: 'role_cameo' },
] as const;

export function PrEditorCharactersSection({ t, characters, changed, onRemove, onOpenSearch, onOpenCreate }: Props) {
  const [charPage, setCharPage] = useState(0);
  const groupedCharacters = CHARACTER_ROLES.map(role => ({
    ...role,
    allCharacters: characters.filter(c => (c.relation_type ?? 'SUPPORTING') === role.value),
  }));
  const totalPages = Math.ceil(Math.max(0, ...groupedCharacters.map(group => group.allCharacters.length)) / ITEMS_PER_PAGE) || 1;
  const safeCharPage = Math.min(charPage, totalPages - 1);
  const roleGroups = groupedCharacters.map(role => {
    return {
      ...role,
      label: t.character[role.labelKey],
      pageCharacters: role.allCharacters.slice(safeCharPage * ITEMS_PER_PAGE, (safeCharPage + 1) * ITEMS_PER_PAGE),
    };
  });

  return (
    <div className="pr-editor-section">
      <span className="pr-editor-section-title">
        Personajes
        {changed && <span className="pr-editor-section-changed-dot" />}
      </span>

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
                <div key={character.external_id} className="pr-editor-media-card">
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
    </div>
  );
}
