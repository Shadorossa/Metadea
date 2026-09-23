import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../../i18n/index';
import { getT } from '../../../i18n/runtime';
import { getAllCharactersLight, deleteCharacter, getCommunityCharacters, type CharacterEntry } from '../../../lib/tauri/characters';
import { wrapAssetUrl } from '../../../lib/tauri/bridge';
import { generateCustomCharacterId } from '../../../lib/character/custom-character';
import { CharacterSearchPopup } from '../../search-popups/CharacterSearchPopup';
import { CatalogEntryCard } from '../CatalogEntryCard';
import { AdminConfirmDialog } from '../AdminConfirmDialog';
import { useAdminResource } from '../useAdminResource';
import type { AdminPaging } from '../useAdminPaging';
import type { Source } from '../admin-panel-types';

interface Props {
  t: Translations['admin'];
  active: boolean;
  source: Source;
  isOwner: boolean;
  searchSlot: HTMLElement | null;
  paging: AdminPaging;
}

// Characters tab: the local list, GitHub's own list, and the "Add" source
// that hands off to the character editor island.
export function CharactersTab({ t, active, source, isOwner, searchSlot, paging }: Props) {
  const local = useAdminResource(getAllCharactersLight, {
    key: character => character.external_id,
    remove: character => deleteCharacter(character.external_id),
    loadErrorMessage: '[CatalogAdminPanel] Failed to load characters:',
    removeErrorMessage: '[CatalogAdminPanel] Failed to delete character:',
  });
  const { items: characters, loading: characterLoading, query, setQuery, deferredQuery, deleteTarget, requestDelete } = local;
  const [characterSearchOpen, setCharacterSearchOpen] = useState(false);

  // GitHub's own characters (read-only peek at the community database.db,
  // not the local one) — fetched on demand, the first time this tab
  // combination is actually visited, since it's a network download rather
  // than a local IPC read.
  const [githubCharacters, setGithubCharacters] = useState<CharacterEntry[]>([]);
  const [githubCharactersLoading, setGithubCharactersLoading] = useState(false);
  const [githubCharactersError, setGithubCharactersError] = useState(false);

  useEffect(() => {
    if (!isOwner || !active || source !== 'github') return;
    if (githubCharacters.length > 0 || githubCharactersLoading) return;
    setGithubCharactersLoading(true);
    setGithubCharactersError(false);
    getCommunityCharacters()
      .then(setGithubCharacters)
      .catch(err => {
        console.error('[CatalogAdminPanel] Failed to load GitHub characters:', err);
        setGithubCharactersError(true);
      })
      .finally(() => setGithubCharactersLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, active, source]);

  const visibleCharacters = useMemo(() => {
    const list = source === 'github' ? githubCharacters : characters;
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(c => c.name.toLowerCase().includes(q));
  }, [source, githubCharacters, characters, deferredQuery]);

  const pagedCharacters = useMemo(
    () => paging.pageItems(`characters-${source}`, visibleCharacters),
    [paging, source, visibleCharacters],
  );

  const { resetPages } = paging;
  useEffect(() => {
    resetPages();
  }, [deferredQuery, resetPages]);

  const handleEdit = useCallback((externalId: string) => window.__metadeaCharacterEditor?.open(externalId), []);

  if (!active) return null;

  const listLoading = source === 'github' ? githubCharactersLoading : characterLoading;

  return (
    <>
      {source !== 'add' && searchSlot && createPortal(
        <input
          type="text"
          className="catalog-admin-search"
          placeholder={t.search_placeholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />,
        searchSlot,
      )}

      {source !== 'add' && (
        <>
          {source === 'github' && <p className="catalog-admin-hint">{t.github_hint}</p>}

          {listLoading && <p className="catalog-admin-status">{t.loading}</p>}
          {source === 'github' && githubCharactersError && <p className="catalog-admin-status">{t.github_open_error}</p>}
          {!listLoading && visibleCharacters.length === 0 && (
            <p className="catalog-admin-status">{t.no_characters}</p>
          )}

          {!listLoading && visibleCharacters.length > 0 && (
            <>
            <div className="pr-editor-search-grid">
              {pagedCharacters.items.map(character => (
                <CatalogEntryCard
                  key={character.external_id}
                  id={character.external_id}
                  title={character.name || character.external_id}
                  cover={character.image_url ? wrapAssetUrl(character.image_url) : character.image_url}
                  editLabel={t.edit_button}
                  deleteLabel={t.delete_button}
                  openMediaLabel={t.open_media_page}
                  onEdit={handleEdit}
                  onDelete={source === 'github' ? undefined : requestDelete}
                />
              ))}
            </div>
            {paging.renderPagination(`characters-${source}`, pagedCharacters.totalPages, pagedCharacters.currentPage)}
            </>
          )}
        </>
      )}

      {source === 'add' && isOwner && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="catalog-admin-source-btn" onClick={() => setCharacterSearchOpen(true)}>
            {t.add_character_button}
          </button>
          <button
            type="button"
            className="catalog-admin-source-btn"
            title={getT().character.non_anilist_character_title}
            onClick={() => window.__metadeaCharacterEditor?.open(generateCustomCharacterId())}
          >
            + Crear personaje custom
          </button>
        </div>
      )}

      {deleteTarget && (
        <AdminConfirmDialog
          message={t.delete_confirm.replace('{title}', deleteTarget.name || deleteTarget.external_id)}
          cancelLabel={t.cancel_button}
          confirmLabel={t.delete_button}
          onCancel={local.cancelDelete}
          onConfirm={local.confirmDelete}
        />
      )}

      {characterSearchOpen && (
        <CharacterSearchPopup
          onSelect={result => {
            setCharacterSearchOpen(false);
            window.__metadeaCharacterEditor?.open(result.externalId);
          }}
          onClose={() => setCharacterSearchOpen(false)}
          excludeIds={characters.map(c => c.external_id)}
        />
      )}
    </>
  );
}
