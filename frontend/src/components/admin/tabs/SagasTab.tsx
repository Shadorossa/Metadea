import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../../i18n/index';
import { getAllSagas, getCommunitySagas, deleteSaga, type SagaListEntry } from '../../../lib/tauri/catalog';
import { externalIdFromDatabaseFilename, type GitHubDirEntry } from '../../../lib/github/api';
import { SagaViewerModal } from '../../media/SagaViewerModal';
import { CatalogEntryCard } from '../CatalogEntryCard';
import { AdminConfirmDialog } from '../AdminConfirmDialog';
import { useAdminResource } from '../useAdminResource';
import type { AdminPaging } from '../useAdminPaging';
import type { GithubCatalogFiles } from '../useGithubCatalogFiles';
import type { EditorRequest, Source } from '../admin-panel-types';

interface Props {
  i18n: Pick<Translations, 'media' | 'admin'>;
  active: boolean;
  source: Source;
  isOwner: boolean;
  searchSlot: HTMLElement | null;
  paging: AdminPaging;
  reloadToken: number;
  github: GithubCatalogFiles;
  openEditor: (request: EditorRequest) => void;
}

// Sagas use the shared cover-card style and the same viewer as media pages.
export function SagasTab({ i18n, active, source, isOwner, searchSlot, paging, reloadToken, github, openEditor }: Props) {
  const t = i18n.admin;
  const local = useAdminResource(getAllSagas, {
    key: saga => saga.id,
    remove: saga => deleteSaga(saga.id),
    loadErrorMessage: '[CatalogAdminPanel] Failed to load sagas:',
    removeErrorMessage: '[CatalogAdminPanel] Failed to delete saga:',
  });
  const { items: sagas, loading: sagaLoading, query, setQuery, deferredQuery, deleteTarget, requestDelete, reload } = local;
  const [sagaViewerExternalId, setSagaViewerExternalId] = useState<string | null>(null);

  // GitHub's own sagas (read-only peek at the community database.db, not the
  // local one) — fetched on demand, the first time this tab combination is
  // actually visited, since it's a network download rather than a local IPC
  // read.
  const [githubSagas, setGithubSagas] = useState<SagaListEntry[]>([]);
  const [githubSagasLoading, setGithubSagasLoading] = useState(false);
  const [githubSagasError, setGithubSagasError] = useState(false);

  useEffect(() => {
    if (reloadToken > 0) reload();
  }, [reloadToken, reload]);

  useEffect(() => {
    if (!isOwner || !active || source !== 'github') return;
    if (githubSagas.length > 0 || githubSagasLoading) return;
    setGithubSagasLoading(true);
    setGithubSagasError(false);
    getCommunitySagas()
      .then(setGithubSagas)
      .catch(err => {
        console.error('[CatalogAdminPanel] Failed to load GitHub sagas:', err);
        setGithubSagasError(true);
      })
      .finally(() => setGithubSagasLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, active, source]);

  const visibleSagas = useMemo(() => {
    const list = source === 'github' ? githubSagas : sagas;
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(s =>
      s.name.toLowerCase().includes(q) || s.anchor_title?.toLowerCase().includes(q)
    );
  }, [source, githubSagas, sagas, deferredQuery]);

  const pagedSagas = useMemo(() => paging.pageItems(`sagas-${source}`, visibleSagas), [paging, source, visibleSagas]);

  const { resetPages } = paging;
  useEffect(() => {
    resetPages();
  }, [deferredQuery, resetPages]);

  const githubFiles = github.items;
  const findSagaFile = useCallback((saga: SagaListEntry): GitHubDirEntry | undefined => (
    source === 'github'
      ? githubFiles.find(file => externalIdFromDatabaseFilename(file.name) === saga.id)
        ?? saga.members
          .map(member => githubFiles.find(file => externalIdFromDatabaseFilename(file.name) === member.external_id))
          .find((file): file is GitHubDirEntry => !!file)
      : undefined
  ), [source, githubFiles]);

  const { openEntry: openGithubEntry } = github;
  const handleEdit = useCallback((id: string) => {
    const saga = visibleSagas.find(s => s.id === id);
    if (!saga) return;
    if (source === 'github') {
      const sagaFile = findSagaFile(saga);
      if (sagaFile) openGithubEntry(sagaFile, 'relations');
    } else {
      openEditor({ externalId: saga.id, initialTab: 'relations' });
    }
  }, [visibleSagas, source, findSagaFile, openGithubEntry, openEditor]);

  const handleView = useCallback((id: string) => setSagaViewerExternalId(id), []);
  const closeViewer = useCallback(() => setSagaViewerExternalId(null), []);

  if (!active) return null;

  const listLoading = source === 'github' ? githubSagasLoading : sagaLoading;

  return (
    <>
      {searchSlot && createPortal(
        <input
          type="text"
          className="catalog-admin-search"
          placeholder={t.search_placeholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />,
        searchSlot,
      )}

      {source === 'github' && <p className="catalog-admin-hint">{t.github_hint}</p>}

      {listLoading && <p className="catalog-admin-status">{t.loading}</p>}
      {source === 'github' && githubSagasError && <p className="catalog-admin-status">{t.github_open_error}</p>}
      {!listLoading && visibleSagas.length === 0 && (
        <p className="catalog-admin-status">{t.no_sagas}</p>
      )}

      {!listLoading && visibleSagas.length > 0 && (
        <>
        <div className="pr-editor-search-grid">
          {pagedSagas.items.map(saga => {
            const sagaFile = findSagaFile(saga);
            return (
              <CatalogEntryCard
                key={saga.id}
                id={saga.id}
                title={`${saga.name || saga.anchor_title || saga.id} (${saga.members.length})`}
                cover={saga.anchor_cover || saga.members[0]?.cover}
                editLabel={t.edit_button}
                deleteLabel={t.delete_button}
                openMediaLabel={t.open_media_page}
                viewLabel={t.view_saga}
                onView={handleView}
                onEdit={handleEdit}
                onDelete={source === 'github' ? undefined : requestDelete}
                editDisabled={source === 'github' && (!sagaFile || github.busy)}
              />
            );
          })}
        </div>
        {paging.renderPagination(`sagas-${source}`, pagedSagas.totalPages, pagedSagas.currentPage)}
        </>
      )}

      {deleteTarget && (
        <AdminConfirmDialog
          message={t.delete_confirm.replace('{title}', deleteTarget.name || deleteTarget.anchor_title || deleteTarget.id)}
          cancelLabel={t.cancel_button}
          confirmLabel={t.delete_button}
          onCancel={local.cancelDelete}
          onConfirm={local.confirmDelete}
        />
      )}

      {sagaViewerExternalId && (
        <SagaViewerModal
          externalId={sagaViewerExternalId}
          i18n={i18n.media}
          onClose={closeViewer}
        />
      )}
    </>
  );
}
