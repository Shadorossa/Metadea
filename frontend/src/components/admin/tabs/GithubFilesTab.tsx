import { useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../../i18n/index';
import { externalIdFromDatabaseFilename } from '../../../lib/github/api';
import { CatalogEntryCard } from '../CatalogEntryCard';
import { AdminConfirmDialog } from '../AdminConfirmDialog';
import type { AdminPaging } from '../useAdminPaging';
import type { GithubCatalogFiles } from '../useGithubCatalogFiles';
import type { CatalogInfoMap } from '../admin-panel-types';
import { BackfillTab } from './BackfillTab';

interface Props {
  t: Translations['admin'];
  active: boolean;
  isRepoCreator: boolean;
  searchSlot: HTMLElement | null;
  paging: AdminPaging;
  github: GithubCatalogFiles;
  catalogInfoMap: CatalogInfoMap;
  onBackfillCompleted: () => void;
}

// GitHub database/ files tab: the already-merged catalog entries, opened for
// re-proposal through the shared editor. The file listing itself lives in
// useGithubCatalogFiles (shared with the sagas tab).
export function GithubFilesTab({
  t, active, isRepoCreator, searchSlot, paging, github, catalogInfoMap, onBackfillCompleted,
}: Props) {
  const { items: githubFiles, loading: githubLoading, query, setQuery, deferredQuery, deleteTarget, requestDelete } = github;

  const visibleGithubFiles = useMemo(() => githubFiles.filter(f => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return true;
    const title = catalogInfoMap[externalIdFromDatabaseFilename(f.name)]?.title;
    return f.name.toLowerCase().includes(q) || !!title?.toLowerCase().includes(q);
  }), [githubFiles, deferredQuery, catalogInfoMap]);

  const pagedGithubFiles = useMemo(
    () => paging.pageItems('github-media', visibleGithubFiles),
    [paging, visibleGithubFiles],
  );

  const { resetPages } = paging;
  useEffect(() => {
    resetPages();
  }, [deferredQuery, resetPages]);

  const { openEntry } = github;
  const handleEdit = useCallback((path: string) => {
    const file = githubFiles.find(f => f.path === path);
    if (file) openEntry(file);
  }, [githubFiles, openEntry]);

  return (
    <>
      {active && searchSlot && createPortal(
        <input
          type="text"
          className="catalog-admin-search"
          placeholder={t.search_placeholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />,
        searchSlot,
      )}

      {active && <p className="catalog-admin-hint">{t.github_hint}</p>}

      <BackfillTab active={active} paging={paging} onCompleted={onBackfillCompleted} />

      {active && (
        <>
          {githubLoading && <p className="catalog-admin-status">{t.loading}</p>}
          {!githubLoading && visibleGithubFiles.length === 0 && <p className="catalog-admin-status">{t.no_entries}</p>}

          {!githubLoading && visibleGithubFiles.length > 0 && (
            <>
            <div className="pr-editor-search-grid">
              {pagedGithubFiles.items.map(file => {
                const fileExternalId = externalIdFromDatabaseFilename(file.name);
                const info = catalogInfoMap[fileExternalId];
                return (
                  <CatalogEntryCard
                    key={file.path}
                    id={fileExternalId}
                    actionId={file.path}
                    title={info?.title || fileExternalId}
                    cover={info?.cover}
                    blocked={!!info?.blocked}
                    editLabel={t.edit_button}
                    deleteLabel={t.delete_button}
                    openMediaLabel={t.open_media_page}
                    mediaPageUrl={info?.blocked ? undefined : `/media?id=${encodeURIComponent(fileExternalId)}`}
                    editDisabled={github.busy}
                    onEdit={handleEdit}
                    onDelete={isRepoCreator ? requestDelete : undefined}
                  />
                );
              })}
            </div>
            {paging.renderPagination('github-media', pagedGithubFiles.totalPages, pagedGithubFiles.currentPage)}
            </>
          )}

          {deleteTarget && (
            <AdminConfirmDialog
              message={t.delete_confirm.replace('{title}', externalIdFromDatabaseFilename(deleteTarget.name))}
              cancelLabel={t.cancel_button}
              confirmLabel={t.delete_button}
              onCancel={github.cancelDelete}
              onConfirm={github.confirmDelete}
            />
          )}
        </>
      )}
    </>
  );
}
