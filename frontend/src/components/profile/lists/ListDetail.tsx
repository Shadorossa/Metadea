import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useKeyedState } from '../../shared/hooks/useKeyedState';
import {
  useFloating, offset, flip, shift, useDismiss, useRole, useListNavigation, useInteractions,
} from '@floating-ui/react';
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import {
  getListItemsFullLight, updateUserList, deleteUserList, addItemToList, removeItemFromList, reorderListItems,
  type FavoriteCustomImage,
} from '../../../lib/tauri';
import type { CatalogSummary, ListInfo, ListItemFull } from '../../../lib/tauri';
import { saveCharacter } from '../../../lib/tauri/characters';
import { getT } from '../../../i18n/runtime';
import { resolveListItemDisplay, sortListItems, type ListSortMode } from '../../../lib/profile/list-display';
import { MediaSearchPopup } from '../../search-popups/MediaSearchPopup';
import { CharacterSearchPopup } from '../../search-popups/CharacterSearchPopup';
import { EpisodeSearchPopup, type EpisodeSearchResult } from '../../search-popups/EpisodeSearchPopup';
import { IconTrash } from '../../local/ui/icons';
import type { SearchResult as ApiSearchResult } from '../../../lib/search';
import { ListItemCardBody, SortableListItemCard } from './ListItemCard';
import { useInlineEdit } from './useInlineEdit';

type P = ReturnType<typeof getT>['profile'];

export function ListDetail({ list, catalogMap, customImagesMap, p, onBack, onDeleted, onMetaSaved, onCountChanged, readOnly, fetchItems }: {
  list: ListInfo;
  catalogMap: Map<string, CatalogSummary>;
  customImagesMap?: Map<string, FavoriteCustomImage>;
  p: P;
  onBack: () => void;
  onDeleted: () => void;
  onMetaSaved: (name: string, description: string, isPrivate: boolean, listType?: string, isRanked?: boolean) => void;
  onCountChanged: (delta: number) => void;
  readOnly?: boolean;
  fetchItems?: (listKey: string) => Promise<ListItemFull[]>;
}) {
  const [listItems, setListItems] = useState<ListItemFull[]>([]);
  const [sortMode, setSortMode] = useState<ListSortMode>(() => {
    try {
      const saved = localStorage.getItem(`metadea_list_sort_${list.key}`);
      return saved === 'alphabetical' || saved === 'release' ? saved : 'custom';
    } catch {
      return 'custom';
    }
  });
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [listType, setListType] = useState(list.list_type || 'media');
  const [isRanked, setIsRanked] = useState<boolean>(() => {
    if (list.is_ranked !== undefined) return list.is_ranked;
    try {
      return localStorage.getItem(`metadea_list_ranked_${list.key}`) === '1';
    } catch {
      return false;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [typeActiveIndex, setTypeActiveIndex] = useState<number | null>(null);
  const typeItemsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const nameEdit = useInlineEdit(list.name, async draft => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === list.name) return;
    await updateUserList(list.key, trimmed, list.description ?? '', list.is_private, listType, isRanked).catch(err => console.error('Failed to save list name:', err));
    onMetaSaved(trimmed, list.description ?? '', list.is_private, listType, isRanked);
  });
  const descEdit = useInlineEdit(list.description ?? '', async draft => {
    const trimmed = draft.trim();
    if (trimmed === (list.description ?? '')) return;
    await updateUserList(list.key, list.name, trimmed, list.is_private, listType, isRanked).catch(err => console.error('Failed to save list description:', err));
    onMetaSaved(list.name, trimmed, list.is_private, listType, isRanked);
  });

  // Both start over for every list this detail view is pointed at.
  const [confirmDelete, setConfirmDelete] = useKeyedState(list.key, false);
  const [deleteCountdown, setDeleteCountdown] = useKeyedState(list.key, 0);
  const deleteTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (deleteTimerRef.current) {
      window.clearInterval(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    return () => {
      if (deleteTimerRef.current) window.clearInterval(deleteTimerRef.current);
    };
  }, [list.key]);

  const listItemsRef = useRef(listItems);
  useLayoutEffect(() => {
    listItemsRef.current = listItems;
  });

  useEffect(() => {
    let cancelled = false;
    (fetchItems ?? getListItemsFullLight)(list.key).catch(() => [] as ListItemFull[]).then(res => { if (!cancelled) setListItems(res); });
    return () => { cancelled = true; };
  }, [list.key, fetchItems]);

  const currentIds = useMemo(() => new Set(listItems.map(i => i.external_id)), [listItems]);
  const visibleListItems = useMemo(
    () => sortListItems(listItems, sortMode, catalogMap),
    [listItems, sortMode, catalogMap],
  );
  const isCharacters = listType === 'characters';
  const isEpisodes = listType === 'episodes';
  const canChangeType = listItems.length === 0;

  // Settings dropdown — flip/shift keep it inside the viewport (it used to
  // be a plain `top: calc(100% + 6px); right: 0`, with no collision
  // handling), and useDismiss replaces the old global `mousedown` listener
  // with proper outside-press + Escape handling.
  const {
    refs: settingsRefs, floatingStyles: settingsFloatingStyles, context: settingsContext,
  } = useFloating({
    open: settingsOpen,
    onOpenChange: open => { setSettingsOpen(open); if (!open) setTypeMenuOpen(false); },
    placement: 'bottom-end',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });
  const settingsDismiss = useDismiss(settingsContext);
  const settingsRole = useRole(settingsContext, { role: 'menu' });
  const { getReferenceProps: getSettingsReferenceProps, getFloatingProps: getSettingsFloatingProps } =
    useInteractions([settingsDismiss, settingsRole]);

  // Type sub-dropdown, nested inside the settings panel above — same
  // flip/shift + dismiss treatment, plus arrow-key navigation across its
  // three options (the one dropdown here with more than a single row).
  const {
    refs: typeRefs, floatingStyles: typeFloatingStyles, context: typeContext,
  } = useFloating({
    open: typeMenuOpen,
    onOpenChange: setTypeMenuOpen,
    placement: 'bottom-end',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  });
  const typeDismiss = useDismiss(typeContext);
  const typeRole = useRole(typeContext, { role: 'menu' });
  const typeListNav = useListNavigation(typeContext, {
    listRef: typeItemsRef,
    activeIndex: typeActiveIndex,
    onNavigate: setTypeActiveIndex,
  });
  const {
    getReferenceProps: getTypeReferenceProps, getFloatingProps: getTypeFloatingProps, getItemProps: getTypeItemProps,
  } = useInteractions([typeDismiss, typeRole, typeListNav]);

  // Drag-to-reorder — PointerSensor's own activation distance (8px) is what
  // used to be the hand-rolled Math.hypot threshold check, and its own
  // collision detection (closestCenter) is what used to be the "nearest
  // slot" distance loop below it. KeyboardSensor + sortableKeyboardCoordinates
  // is what makes this reorderable with arrow keys/Tab at all, which the old
  // mousedown/mousemove implementation never supported (mouse-only, no touch
  // either — touch-action:none on .list-item-card was already set up for
  // this, just never actually wired to anything that used it).
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const activeDragItem = activeDragId ? listItems.find(i => i.external_id === activeDragId) ?? null : null;

  const handleDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id));

  const handleDragEnd = (e: DragEndEvent) => {
    if (sortMode !== 'custom') return;
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = listItemsRef.current.findIndex(i => i.external_id === active.id);
    const newIndex = listItemsRef.current.findIndex(i => i.external_id === over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    const updated = arrayMove(listItemsRef.current, oldIndex, newIndex).map((item, idx) => ({ ...item, position: idx }));
    setListItems(updated);
    reorderListItems(list.key, updated.map(i => i.external_id)).catch(err => console.error('Failed to save list order:', err));
  };

  const handleSortChange = (next: ListSortMode) => {
    setSortMode(next);
    try {
      localStorage.setItem(`metadea_list_sort_${list.key}`, next);
    } catch {}
  };

  const handleAddMediaFromSearch = async (result: ApiSearchResult) => {
    if (currentIds.has(result.externalId)) return;
    await addItemToList(list.key, result.externalId).catch(err => console.error('Failed to add item to list:', err));
    setListItems(prev => [...prev, {
      external_id: result.externalId,
      position: prev.length,
      library_id: null,
      status: null,
      rating: null,
      progress: 0,
      progress_2: 0,
      is_favorite: false,
      is_platinum: false,
      title_main: result.titleMain,
      cover_url: result.coverUrl,
      media_type: result.type,
      format: result.format,
    }]);
    onCountChanged(1);
  };

  const handleAddCharacterFromSearch = async (result: ApiSearchResult) => {
    if (currentIds.has(result.externalId)) return;
    await saveCharacter(result.externalId, result.titleMain, result.coverUrl).catch(console.error);
    await addItemToList(list.key, result.externalId).catch(console.error);
    setListItems(prev => [...prev, {
      external_id: result.externalId,
      position: prev.length,
      library_id: null,
      status: null,
      rating: null,
      progress: 0,
      progress_2: 0,
      is_favorite: false,
      is_platinum: false,
      title_main: result.titleMain,
      cover_url: result.coverUrl,
      media_type: null,
      format: null,
    }]);
    onCountChanged(1);
  };

  const handleAddEpisodeFromSearch = async (result: EpisodeSearchResult) => {
    const { episodeExternalId, episode, parentMedia } = result;
    if (currentIds.has(episodeExternalId)) return;
    await addItemToList(list.key, episodeExternalId).catch(console.error);
    const title = episode.name || (episode.season_number > 0 ? `T${episode.season_number} E${episode.episode_number}` : `Ep. ${episode.episode_number}`);
    const cover = episode.cover_url || parentMedia.coverUrl || null;
    setListItems(prev => [...prev, {
      external_id: episodeExternalId,
      position: prev.length,
      library_id: null,
      status: null,
      rating: null,
      progress: 0,
      progress_2: 0,
      is_favorite: false,
      is_platinum: false,
      title_main: title,
      cover_url: cover,
      media_type: parentMedia.type,
      format: null,
    }]);
    onCountChanged(1);
  };

  const handleRemove = async (id: string) => {
    await removeItemFromList(list.key, id).catch(err => console.error('Failed to remove item from list:', err));
    setListItems(prev => prev.filter(x => x.external_id !== id));
    onCountChanged(-1);
  };

  const handleSetListType = async (newType: string) => {
    if (!canChangeType || newType === listType) return;
    setListType(newType);
    await updateUserList(list.key, list.name, list.description ?? '', list.is_private, newType, isRanked).catch(console.error);
    onMetaSaved(list.name, list.description ?? '', list.is_private, newType, isRanked);
  };

  const toggleRanked = async () => {
    const next = !isRanked;
    setIsRanked(next);
    try {
      localStorage.setItem(`metadea_list_ranked_${list.key}`, next ? '1' : '0');
    } catch {}
    await updateUserList(list.key, list.name, list.description ?? '', list.is_private, listType, next).catch(console.error);
    onMetaSaved(list.name, list.description ?? '', list.is_private, listType, next);
  };

  const togglePrivate = async () => {
    const next = !list.is_private;
    await updateUserList(list.key, list.name, list.description ?? '', next, listType, isRanked).catch(err => console.error('Failed to save list privacy:', err));
    onMetaSaved(list.name, list.description ?? '', next, listType, isRanked);
  };

  const handleDeleteClick = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setDeleteCountdown(5);

      if (deleteTimerRef.current) window.clearInterval(deleteTimerRef.current);

      let timeLeft = 5;
      deleteTimerRef.current = window.setInterval(() => {
        timeLeft -= 1;
        if (timeLeft > 0) {
          setDeleteCountdown(timeLeft);
        } else if (timeLeft === 0) {
          setDeleteCountdown(0);
        } else if (timeLeft <= -6) {
          if (deleteTimerRef.current) window.clearInterval(deleteTimerRef.current);
          deleteTimerRef.current = null;
          setConfirmDelete(false);
          setDeleteCountdown(0);
        }
      }, 1000);
      return;
    }

    if (deleteCountdown > 0) return;

    if (deleteTimerRef.current) window.clearInterval(deleteTimerRef.current);
    deleteTimerRef.current = null;
    deleteUserList(list.key).catch(err => console.error('Failed to delete list:', err)).then(onDeleted);
  };

  return (
    <div className="list-detail-layout">
      <div className="list-detail-meta">
        <div className="list-detail-meta-row">
          <div className="list-detail-meta-row-left">
            {!readOnly && nameEdit.editing ? (
              <input
                type="text"
                className="list-detail-title-input"
                value={nameEdit.draft}
                maxLength={60}
                size={Math.max(nameEdit.draft.length || 1, 8)}
                autoFocus
                onChange={e => nameEdit.setDraft(e.target.value)}
                onBlur={nameEdit.commit}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') nameEdit.cancel(); }}
              />
            ) : (
              <h2
                className={`list-detail-title${readOnly ? '' : ' list-detail-title--editable'}`}
                onClick={readOnly ? undefined : nameEdit.begin}
                title={readOnly ? undefined : p.lists_edit}
              >
                {list.name}
              </h2>
            )}
            <span className="list-detail-count">
              {listItems.length} {isCharacters ? p.lists_characters_count : isEpisodes ? (p.lists_episodes_count || 'episodios') : p.lists_items}
            </span>
          </div>

          <div className="list-detail-actions">
            <label className="list-sort-control">
              <span className="sr-only">{p.lists_sort}</span>
              <select
                value={sortMode}
                onChange={e => handleSortChange(e.target.value as ListSortMode)}
                title={p.lists_sort}
                aria-label={p.lists_sort}
                className="local-sort-select"
              >
                <option value="custom">{p.lists_sort_custom}</option>
                <option value="alphabetical">{p.lists_sort_alphabetical}</option>
                <option value="release">{p.lists_sort_release}</option>
              </select>
            </label>
            {!readOnly && (
            <div className="list-settings-menu-wrapper">
              <button
                ref={settingsRefs.setReference}
                type="button"
                className={`list-settings-btn${settingsOpen ? ' list-settings-btn--active' : ''}`}
                {...getSettingsReferenceProps({ onClick: () => setSettingsOpen(s => !s) })}
                title={p.lists_settings}
                aria-label={p.lists_settings}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>

              {settingsOpen && (
                <div
                  ref={settingsRefs.setFloating}
                  style={settingsFloatingStyles}
                  className="list-settings-dropdown"
                  {...getSettingsFloatingProps()}
                >
                  <div className="list-settings-section">
                    <div className="list-settings-row">
                      <span className="list-settings-item-title">{p.lists_type}</span>
                      <div className="list-settings-type-wrapper">
                        <button
                          ref={typeRefs.setReference}
                          type="button"
                          className={`list-settings-type-btn${typeMenuOpen ? ' list-settings-type-btn--active' : ''}${!canChangeType ? ' list-settings-type-btn--disabled' : ''}`}
                          {...getTypeReferenceProps({ onClick: () => { if (canChangeType) setTypeMenuOpen(o => !o); } })}
                          disabled={!canChangeType}
                          title={!canChangeType ? p.lists_type_locked_hint : undefined}
                        >
                          <span className="list-settings-type-label">
                            {listType === 'characters'
                              ? p.lists_type_characters
                              : listType === 'episodes'
                                ? (p.lists_type_episodes || 'Episodios')
                                : p.lists_type_media}
                          </span>
                          <svg className="list-settings-type-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {typeMenuOpen && (
                          <div
                            ref={typeRefs.setFloating}
                            style={typeFloatingStyles}
                            className="list-settings-type-dropdown"
                            {...getTypeFloatingProps()}
                          >
                            {[
                              { id: 'media', label: p.lists_type_media },
                              { id: 'characters', label: p.lists_type_characters },
                              { id: 'episodes', label: p.lists_type_episodes || 'Episodios' },
                            ].map((opt, idx) => (
                              <button
                                key={opt.id}
                                ref={node => { typeItemsRef.current[idx] = node; }}
                                type="button"
                                tabIndex={typeActiveIndex === idx ? 0 : -1}
                                className={`list-settings-type-option${listType === opt.id ? ' list-settings-type-option--active' : ''}`}
                                {...getTypeItemProps({
                                  onClick: () => {
                                    handleSetListType(opt.id);
                                    setTypeMenuOpen(false);
                                  },
                                })}
                              >
                                <span className="list-settings-type-option-text">{opt.label}</span>
                                {listType === opt.id && (
                                  <svg className="list-settings-type-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="list-settings-divider" />

                  <div className="list-settings-section">
                    <label className="list-settings-toggle-row">
                      <span className="list-settings-item-title">{p.lists_private}</span>
                      <input
                        type="checkbox"
                        checked={list.is_private}
                        onChange={togglePrivate}
                        className="list-settings-checkbox"
                      />
                    </label>
                  </div>

                  <div className="list-settings-divider" />

                  <div className="list-settings-section">
                    <label className="list-settings-toggle-row">
                      <span className="list-settings-item-title">{p.lists_ranking ?? 'Ranking'}</span>
                      <input
                        type="checkbox"
                        checked={isRanked}
                        onChange={toggleRanked}
                        className="list-settings-checkbox"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        {!readOnly && descEdit.editing ? (
          <input
            type="text"
            className="list-detail-desc-input"
            value={descEdit.draft}
            maxLength={200}
            autoFocus
            placeholder={p.lists_desc_ph}
            onChange={e => descEdit.setDraft(e.target.value)}
            onBlur={descEdit.commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') descEdit.cancel(); }}
          />
        ) : list.description ? (
          <p className={`list-detail-desc${readOnly ? '' : ' list-detail-desc--editable'}`} onClick={readOnly ? undefined : descEdit.begin}>
            {list.description}
          </p>
        ) : !readOnly ? (
          <p className="list-detail-desc list-detail-desc-add" onClick={descEdit.begin}>{p.lists_desc_ph}</p>
        ) : null}
      </div>

      {!readOnly && showAddPanel && (
        isCharacters ? (
          <CharacterSearchPopup
            onSelect={handleAddCharacterFromSearch}
            onClose={() => setShowAddPanel(false)}
            excludeIds={Array.from(currentIds)}
            closeOnSelect={false}
          />
        ) : isEpisodes ? (
          <EpisodeSearchPopup
            onSelect={handleAddEpisodeFromSearch}
            onClose={() => setShowAddPanel(false)}
            excludeIds={Array.from(currentIds)}
            closeOnSelect={false}
          />
        ) : (
          <MediaSearchPopup
            onSelect={handleAddMediaFromSearch}
            onClose={() => setShowAddPanel(false)}
            excludeIds={Array.from(currentIds)}
            closeOnSelect={false}
          />
        )
      )}

      <div className="list-detail-content">
        {listItems.length > 0 ? (
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDragId(null)}
          >
            <SortableContext items={visibleListItems.map(i => i.external_id)} strategy={rectSortingStrategy}>
              <div className="list-items-grid">
                {visibleListItems.map((item, index) => (
                  <SortableListItemCard
                    key={item.external_id}
                    item={item}
                    display={resolveListItemDisplay(item, isCharacters, isEpisodes, customImagesMap)}
                    index={index}
                    isRanked={isRanked}
                    readOnly={readOnly || sortMode !== 'custom'}
                    p={p}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeDragItem && (
                <div className={`list-item-card${resolveListItemDisplay(activeDragItem, isCharacters, isEpisodes, customImagesMap).isEpItem ? ' list-item-card--episode' : ''} is-dragging-card`}>
                  <ListItemCardBody
                    item={activeDragItem}
                    display={resolveListItemDisplay(activeDragItem, isCharacters, isEpisodes, customImagesMap)}
                    index={visibleListItems.findIndex(i => i.external_id === activeDragItem.external_id)}
                    isRanked={isRanked}
                    readOnly={readOnly}
                    p={p}
                    onRemove={() => {}}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        ) : (
          <div className="lists-empty-state" style={{ padding: '2rem 0' }}>
            <p>
              {isCharacters
                ? p.lists_empty_characters
                : isEpisodes
                  ? p.lists_empty_episodes
                  : p.lists_empty_items}
            </p>
          </div>
        )}
      </div>

      <div className="list-detail-footer">
        <div className="list-detail-footer-left">
          <button type="button" className="list-back-btn" onClick={onBack} title={p.lists_back} aria-label={p.lists_back}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
          </button>
          {!readOnly && (
            <button
              type="button"
              className={`list-delete-btn${confirmDelete ? ' list-delete-btn--confirm' : ''}${confirmDelete && deleteCountdown > 0 ? ' list-delete-btn--waiting' : ''}`}
              onClick={handleDeleteClick}
              disabled={confirmDelete && deleteCountdown > 0}
              title={confirmDelete ? (deleteCountdown > 0 ? `${p.lists_delete_confirm} (${deleteCountdown}s)` : p.lists_delete_confirm) : p.lists_delete}
              aria-label={confirmDelete ? p.lists_delete_confirm : p.lists_delete}
            >
              <IconTrash size={16} />
              {confirmDelete && (
                <span className="list-delete-confirm-text">
                  {deleteCountdown > 0 ? `${p.lists_delete_confirm} (${deleteCountdown}s)` : p.lists_delete_confirm}
                </span>
              )}
            </button>
          )}
        </div>
        <div className="list-detail-footer-right">
          {!readOnly && (
            <button className="list-btn list-btn--primary" onClick={() => setShowAddPanel(s => !s)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              {isCharacters ? p.lists_add_characters : isEpisodes ? p.lists_add_episodes : p.lists_add_items}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
