import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../../i18n/index';
import { getAllMediaEpisodesGrouped, deleteAllMediaEpisodes } from '../../../lib/tauri/episodes';
import { searchAnimeAndSeries, type SearchResult as ApiSearchResult } from '../../../lib/search';
import { useDebouncedSearch, dedupeByKey } from '../../shared/hooks/useDebouncedSearch';
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
  catalogInfoMap: CatalogInfoMap;
  openEditor: (request: EditorRequest) => void;
}

type EpisodeMediaTypeFilter = 'all' | 'anime' | 'series';

// Episodes tab: titles with cached episodes in the local DB, or — while a
// query is typed — a live show search. Selecting Edit opens the media entry
// directly at Relations > Episodes.
export function EpisodesTab({ t, active, searchSlot, paging, catalogInfoMap, openEditor }: Props) {
  const groups = useAdminResource(getAllMediaEpisodesGrouped, {
    key: group => group.external_id,
    remove: group => deleteAllMediaEpisodes(group.external_id),
    loadErrorMessage: '[CatalogAdminPanel] Failed to load episode groups:',
    removeErrorMessage: '[CatalogAdminPanel] Failed to delete all episodes:',
  });
  const {
    items: episodeGroups, loading: episodesLoading, query: episodeQuery, setQuery, deferredQuery,
    deleteTarget: episodesDeleteTarget, setDeleteTarget, requestDelete,
  } = groups;
  const [episodeMediaTypeFilter, setEpisodeMediaTypeFilter] = useState<EpisodeMediaTypeFilter>('all');

  const { results: rawEpisodeShowResults, isLoading: isSearchingEpisodeShows } = useDebouncedSearch<ApiSearchResult>(
    episodeQuery,
    async (q, signal) => {
      if (!active) return [];
      return searchAnimeAndSeries(q, episodeMediaTypeFilter, signal);
    },
    [active, episodeMediaTypeFilter],
  );

  const deduplicatedEpisodeShows = useMemo(
    () => dedupeByKey(rawEpisodeShowResults, r => r.externalId),
    [rawEpisodeShowResults],
  );

  const visibleEpisodeGroups = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return episodeGroups;
    return episodeGroups.filter(g => {
      const title = catalogInfoMap[g.external_id]?.title || g.sample_name || '';
      return g.external_id.toLowerCase().includes(q) || title.toLowerCase().includes(q);
    });
  }, [episodeGroups, deferredQuery, catalogInfoMap]);

  const pagedEpisodeShows = useMemo(
    () => paging.pageItems('episode-search', deduplicatedEpisodeShows),
    [paging, deduplicatedEpisodeShows],
  );
  const pagedEpisodeGroups = useMemo(
    () => paging.pageItems('episode-groups', visibleEpisodeGroups),
    [paging, visibleEpisodeGroups],
  );

  const { resetPages } = paging;
  useEffect(() => {
    resetPages();
  }, [deferredQuery, resetPages]);

  const handleEdit = useCallback((externalId: string) => {
    openEditor({ externalId, initialTab: 'relations', initialRelationsSubtab: 'episodes' });
  }, [openEditor]);

  // A searched show may have no cached group yet, so its confirm target is
  // built from the search result rather than looked up in the list.
  const handleDeleteSearched = useCallback((externalId: string) => {
    const show = deduplicatedEpisodeShows.find(s => s.externalId === externalId);
    if (!show) return;
    setDeleteTarget({
      external_id: show.externalId,
      episode_count: 0,
      sample_name: show.titleMain,
      sample_cover: show.coverUrl ?? null,
    });
  }, [deduplicatedEpisodeShows, setDeleteTarget]);

  if (!active) return null;

  return (
    <>
      {searchSlot && createPortal(
        <>
          <input
            type="text"
            className="catalog-admin-search"
            placeholder={t.search_placeholder}
            value={episodeQuery}
            onChange={e => setQuery(e.target.value)}
          />
          <select
            className="catalog-admin-type-select"
            value={episodeMediaTypeFilter}
            onChange={e => setEpisodeMediaTypeFilter(e.target.value as EpisodeMediaTypeFilter)}
          >
            <option value="all">Todos (Anime / Series)</option>
            <option value="anime">Anime</option>
            <option value="series">Series</option>
          </select>
        </>,
        searchSlot,
      )}

      {episodeQuery.trim() ? (
        <>
          {isSearchingEpisodeShows && <p className="catalog-admin-status">{t.loading}</p>}
          {!isSearchingEpisodeShows && deduplicatedEpisodeShows.length === 0 && (
            <p className="catalog-admin-status">{t.no_entries}</p>
          )}
          {!isSearchingEpisodeShows && deduplicatedEpisodeShows.length > 0 && (
            <>
            <div className="pr-editor-search-grid">
              {pagedEpisodeShows.items.map(show => (
                <CatalogEntryCard
                  key={show.externalId}
                  id={show.externalId}
                  title={show.titleMain || '—'}
                  cover={show.coverUrl}
                  editLabel={t.edit_button}
                  deleteLabel={t.delete_button}
                  openMediaLabel={t.open_media_page}
                  mediaPageUrl={catalogInfoMap[show.externalId]?.blocked
                    ? undefined
                    : `/media?id=${encodeURIComponent(show.externalId)}`}
                  onEdit={handleEdit}
                  onDelete={handleDeleteSearched}
                />
              ))}
            </div>
            {paging.renderPagination('episode-search', pagedEpisodeShows.totalPages, pagedEpisodeShows.currentPage)}
            </>
          )}
        </>
      ) : (
        /* When query is empty, show titles that already have cached episodes in local DB */
        <>
          {episodesLoading && <p className="catalog-admin-status">{t.loading}</p>}
          {!episodesLoading && visibleEpisodeGroups.length === 0 && (
            <p className="catalog-admin-status">{t.no_episodes}</p>
          )}

          {!episodesLoading && visibleEpisodeGroups.length > 0 && (
            <>
            <div className="pr-editor-search-grid">
              {pagedEpisodeGroups.items.map(group => {
                const info = catalogInfoMap[group.external_id];
                const title = info?.title || group.sample_name || group.external_id;
                const cover = info?.cover || group.sample_cover;
                const countText = `${group.episode_count} eps`;
                return (
                  <CatalogEntryCard
                    key={group.external_id}
                    id={`${group.external_id} (${countText})`}
                    actionId={group.external_id}
                    title={title}
                    cover={cover}
                    editLabel={t.edit_button}
                    deleteLabel={t.delete_button}
                    openMediaLabel={t.open_media_page}
                    mediaPageUrl={info?.blocked ? undefined : `/media?id=${encodeURIComponent(group.external_id)}`}
                    onEdit={handleEdit}
                    onDelete={requestDelete}
                  />
                );
              })}
            </div>
            {paging.renderPagination('episode-groups', pagedEpisodeGroups.totalPages, pagedEpisodeGroups.currentPage)}
            </>
          )}
        </>
      )}

      {episodesDeleteTarget && (
        <AdminConfirmDialog
          message={t.delete_all_episodes_confirm
            .replace('{title}', catalogInfoMap[episodesDeleteTarget.external_id]?.title || episodesDeleteTarget.sample_name || episodesDeleteTarget.external_id)
            .replace('{count}', String(episodesDeleteTarget.episode_count))}
          cancelLabel={t.cancel_button}
          confirmLabel={t.delete_button}
          onCancel={groups.cancelDelete}
          onConfirm={groups.confirmDelete}
        />
      )}
    </>
  );
}
