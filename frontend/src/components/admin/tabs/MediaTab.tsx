import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../../i18n/index';
import { getAllCatalogEntriesForEditor, deleteCatalogEntry } from '../../../lib/tauri/catalog';
import { findCatalogDuplicateCandidateIds } from '../../../lib/media/catalog-duplicate-candidates';
import { CatalogEntryCard } from '../CatalogEntryCard';
import { AdminConfirmDialog } from '../AdminConfirmDialog';
import { useAdminResource } from '../useAdminResource';
import type { AdminPaging } from '../useAdminPaging';
import type { CatalogInfoMap, EditorRequest } from '../admin-panel-types';

interface Props {
  t: Translations['admin'];
  active: boolean;
  searchSlot: HTMLElement | null;
  paging: AdminPaging;
  // Bumped by the panel whenever the local catalog must be re-read (an
  // editor save, a finished backfill sweep).
  reloadToken: number;
  openEditor: (request: EditorRequest) => void;
  onCatalogLoaded: (map: CatalogInfoMap) => void;
}

// Local catalog tab. Loads the *whole* local catalog once — filtering as the
// user types happens client-side (see visibleEntries below) instead of
// re-querying over IPC on every keystroke, which was causing the list (and
// every cover image in it) to reload/flicker on each character typed.
export function MediaTab({ t, active, searchSlot, paging, reloadToken, openEditor, onCatalogLoaded }: Props) {
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const catalog = useAdminResource(getAllCatalogEntriesForEditor, {
    key: entry => entry.external_id,
    remove: entry => deleteCatalogEntry(entry.external_id),
    loadErrorMessage: '[CatalogAdminPanel] Failed to load entries:',
    removeErrorMessage: '[CatalogAdminPanel] Failed to delete entry:',
  });
  const { items: entries, loading, query, setQuery, deferredQuery, deleteTarget, requestDelete, reload } = catalog;

  useEffect(() => {
    if (reloadToken > 0) reload();
  }, [reloadToken, reload]);

  useEffect(() => {
    const map: CatalogInfoMap = {};
    for (const entry of entries) {
      map[entry.external_id] = {
        title: entry.title_main ?? undefined,
        cover: entry.cover_url ?? undefined,
        blocked: !!entry.blocked_at,
      };
    }
    onCatalogLoaded(map);
  }, [entries, onCatalogLoaded]);

  const duplicateCandidateIds = useMemo(() => findCatalogDuplicateCandidateIds(entries), [entries]);

  // Search the visible catalog locally, then optionally narrow it down to
  // possible duplicates. The duplicate filter is strictly for manual review.
  const visibleEntries = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return entries.filter(e =>
      (!q
        || e.external_id.toLowerCase().includes(q)
        || e.title_main?.toLowerCase().includes(q)
        || e.title_english?.toLowerCase().includes(q)
        || e.title_romaji?.toLowerCase().includes(q)
        || e.title_native?.toLowerCase().includes(q))
      && (!duplicatesOnly || duplicateCandidateIds.has(e.external_id))
    );
  }, [entries, deferredQuery, duplicatesOnly, duplicateCandidateIds]);

  const pagedEntries = useMemo(() => paging.pageItems('local-media', visibleEntries), [paging, visibleEntries]);

  const { resetPages } = paging;
  useEffect(() => {
    resetPages();
  }, [deferredQuery, duplicatesOnly, resetPages]);

  const handleEdit = useCallback((externalId: string) => openEditor({ externalId }), [openEditor]);

  if (!active) return null;

  return (
    <>
      {searchSlot && createPortal(
        <>
          <input
            type="text"
            className="catalog-admin-search"
            placeholder={t.search_placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={`catalog-admin-source-btn catalog-admin-duplicate-filter${duplicatesOnly ? ' active' : ''}`}
            aria-pressed={duplicatesOnly}
            title={t.duplicate_filter_hint}
            disabled={duplicateCandidateIds.size === 0 && !duplicatesOnly}
            onClick={() => setDuplicatesOnly(current => !current)}
          >
            {t.duplicate_filter_button.replace('{count}', String(duplicateCandidateIds.size))}
          </button>
        </>,
        searchSlot,
      )}

      {loading && <p className="catalog-admin-status">{t.loading}</p>}
      {!loading && visibleEntries.length === 0 && (
        <p className="catalog-admin-status">
          {duplicatesOnly ? t.no_duplicate_candidates : t.no_entries}
        </p>
      )}

      {!loading && visibleEntries.length > 0 && (
        <>
        <div className="pr-editor-search-grid">
          {pagedEntries.items.map(entry => (
            <CatalogEntryCard
              key={entry.external_id}
              id={entry.external_id}
              title={entry.title_main || entry.external_id}
              cover={entry.cover_url}
              blocked={!!entry.blocked_at}
              editLabel={t.edit_button}
              deleteLabel={t.delete_button}
              openMediaLabel={t.open_media_page}
              mediaPageUrl={entry.blocked_at ? undefined : `/media?id=${encodeURIComponent(entry.external_id)}`}
              onEdit={handleEdit}
              onDelete={requestDelete}
            />
          ))}
        </div>
        {paging.renderPagination('local-media', pagedEntries.totalPages, pagedEntries.currentPage)}
        </>
      )}

      {deleteTarget && (
        <AdminConfirmDialog
          message={t.delete_confirm.replace('{title}', deleteTarget.title_main || deleteTarget.external_id)}
          cancelLabel={t.cancel_button}
          confirmLabel={t.delete_button}
          onCancel={catalog.cancelDelete}
          onConfirm={catalog.confirmDelete}
        />
      )}
    </>
  );
}
