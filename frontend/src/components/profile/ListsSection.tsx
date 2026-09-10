import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getUserInfo,
  getAllUserLists, getListItemsFull, createUserList, updateUserList,
  deleteUserList, addItemToList, removeItemFromList, reorderListItems,
  getCustomImagesMap, wrapAssetUrl, type FavoriteCustomImage,
} from '../../lib/tauri';
import type { MediaCatalogEntry, ListInfo, ListItemFull } from '../../lib/tauri';
import { saveCharacter, getAllCharacters, type CharacterEntry } from '../../lib/tauri/characters';
import { getT } from '../../i18n/client';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { beginGlobalLoading } from '../../lib/shared/global-loading';
import { MediaSearchPopup } from '../media/MediaSearchPopup';
import { CharacterSearchPopup } from '../media/CharacterSearchPopup';
import { IconTrash } from '../local/ui/icons';
import type { SearchResult as ApiSearchResult } from '../../lib/search';

type P = ReturnType<typeof getT>['profile'];

function fallbackGradient(type: string | null | undefined): string {
  return HOF_GRADIENTS[type ?? 'anime'] ?? 'linear-gradient(160deg,#374151,#1f2937)';
}

/* ── Grid view ──────────────────────────────────────────────────────────── */

function ListCard({ list, catalogMap, charactersMap, customImagesMap, p, active, onClick }: {
  list: ListInfo;
  catalogMap: Map<string, MediaCatalogEntry>;
  charactersMap?: Map<string, CharacterEntry>;
  customImagesMap?: Map<string, FavoriteCustomImage>;
  p: P;
  active?: boolean;
  onClick: () => void;
}) {
  const isCharacters = list.list_type === 'characters';
  const firstId = list.preview_ids.length > 0 ? list.preview_ids[0] : undefined;
  const firstCustom = firstId && customImagesMap ? customImagesMap.get(firstId) : undefined;
  const firstMeta = firstId ? catalogMap.get(firstId) : undefined;
  const firstChar = firstId && charactersMap ? charactersMap.get(firstId) : undefined;
  const rawCoverUrl = isCharacters ? (firstChar?.image_url ?? firstMeta?.cover_url) : firstMeta?.cover_url;
  const coverUrl = firstCustom ? wrapAssetUrl(firstCustom.image_url) : rawCoverUrl;

  return (
    <div className={`list-card${active ? ' list-card--active' : ''}`} onClick={onClick}>
      <div className={`list-card-collage${list.preview_ids.length === 0 ? ' list-card-collage--empty' : ''}`}>
        {list.preview_ids.length > 0
          ? (coverUrl
              ? <img className="list-card-collage-img" src={coverUrl} alt="" loading="lazy" decoding="async" />
              : <div className="list-card-collage-img list-card-collage-fallback" style={{ background: fallbackGradient(firstMeta?.type) }} />)
          : <span className="list-card-empty-icon">{isCharacters ? '👤' : '📋'}</span>}
      </div>
      <div className="list-card-info">
        <span className="list-card-title">{list.name}</span>
        <span className="list-card-count">
          {list.item_count} {isCharacters ? p.lists_characters_count : p.lists_items}
        </span>
      </div>
    </div>
  );
}

function nextUntitledListName(existingNames: string[], base: string): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function ListsGrid({ customLists, catalogMap, charactersMap, customImagesMap, p, onCreate, onOpen, activeKey, readOnly }: {
  customLists: ListInfo[];
  catalogMap: Map<string, MediaCatalogEntry>;
  charactersMap?: Map<string, CharacterEntry>;
  customImagesMap?: Map<string, FavoriteCustomImage>;
  p: P;
  onCreate: (name: string, description: string) => void;
  onOpen: (key: string) => void;
  activeKey?: string | null;
  readOnly?: boolean;
}) {
  const [filterMode, setFilterMode] = useState<'all' | 'media' | 'characters'>('all');
  const showMedia = filterMode === 'all' || filterMode === 'media';
  const showCharacters = filterMode === 'all' || filterMode === 'characters';

  const toggleFilter = (type: 'media' | 'characters') => {
    if (filterMode === 'all') {
      setFilterMode(type === 'media' ? 'characters' : 'media');
    } else if (filterMode === type) {
      setFilterMode(type === 'media' ? 'characters' : 'media');
    } else {
      setFilterMode('all');
    }
  };

  const filteredLists = useMemo(() => {
    if (filterMode === 'all') return customLists;
    if (filterMode === 'media') return customLists.filter(l => l.list_type !== 'characters');
    return customLists.filter(l => l.list_type === 'characters');
  }, [customLists, filterMode]);

  return (
    <div className="lists-layout">
      <div className="lists-header">
        <div className="lists-header-left">
          <h2 className="lists-title">{p.lists}</h2>
          <div className="lists-filter-selector" role="group">
            <button
              type="button"
              className={`lists-filter-btn${showMedia ? ' lists-filter-btn--active' : ''}`}
              onClick={() => toggleFilter('media')}
              title={p.lists_type_media}
              aria-label={p.lists_type_media}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </button>
            <button
              type="button"
              className={`lists-filter-btn${showCharacters ? ' lists-filter-btn--active' : ''}`}
              onClick={() => toggleFilter('characters')}
              title={p.lists_type_characters}
              aria-label={p.lists_type_characters}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>
          </div>
        </div>
        {!readOnly && (
          <button
            className="list-btn list-btn--primary"
            onClick={() => onCreate(nextUntitledListName(customLists.map(l => l.name), p.lists_untitled), '')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            {p.lists_new}
          </button>
        )}
      </div>
      {filteredLists.length > 0 ? (
        <div className="lists-grid">
          {filteredLists.map(l => (
            <ListCard
              list={l}
              catalogMap={catalogMap}
              charactersMap={charactersMap}
              customImagesMap={customImagesMap}
              p={p}
              active={l.key === activeKey}
              onClick={() => onOpen(l.key)}
              key={l.key}
            />
          ))}
        </div>
      ) : (
        <div className="lists-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
          <p>{customLists.length > 0 ? p.lists_no_results : p.lists_empty}</p>
        </div>
      )}
    </div>
  );
}

/* ── Detail view ────────────────────────────────────────────────────────── */

function ListDetail({ list, catalogMap, customImagesMap, p, onBack, onDeleted, onMetaSaved, onCountChanged, readOnly, fetchItems }: {
  list: ListInfo;
  catalogMap: Map<string, MediaCatalogEntry>;
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
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(list.name);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(list.description ?? '');

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState(0);
  const deleteTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setConfirmDelete(false);
    setDeleteCountdown(0);
    if (deleteTimerRef.current) {
      window.clearInterval(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    return () => {
      if (deleteTimerRef.current) window.clearInterval(deleteTimerRef.current);
    };
  }, [list.key]);

  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const listItemsRef = useRef(listItems);
  listItemsRef.current = listItems;

  useEffect(() => {
    let cancelled = false;
    (fetchItems ?? getListItemsFull)(list.key).catch(() => [] as ListItemFull[]).then(res => { if (!cancelled) setListItems(res); });
    return () => { cancelled = true; };
  }, [list.key, fetchItems]);

  const currentIds = useMemo(() => new Set(listItems.map(i => i.external_id)), [listItems]);
  const isCharacters = listType === 'characters';
  const canChangeType = listItems.length === 0;

  useEffect(() => {
    if (!settingsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [settingsOpen]);

  // Native HTML5 drag & drop instead of a hand-rolled mouse-follow drag:
  // the browser/OS renders the drag ghost that tracks the cursor, entirely
  // outside our own render loop, so it can't stutter no matter what this
  // tab's JS is doing. We only reorder the actual DOM nodes as the cursor
  // crosses into another card (dragover), and persist the final order on
  // drop — no floating clone, no per-pixel style writes to chase the mouse.
  useEffect(() => {
    if (!gridEl || readOnly) return;

    let dragEl: HTMLElement | null = null;
    let pendingEvent: DragEvent | null = null;
    let rafId: number | null = null;
    let didDrag = false;

    const onDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.list-item-remove')) { e.preventDefault(); return; }

      const card = target.closest('.list-item-card') as HTMLElement | null;
      if (!card || !gridEl.contains(card)) { e.preventDefault(); return; }

      dragEl = card;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id ?? '');
      }
      // Dim the source a frame later — the browser snapshots the drag
      // ghost synchronously from the current element, so dimming it right
      // away would make the ghost that follows the cursor look faded too.
      requestAnimationFrame(() => card.classList.add('is-dragging-card'));
    };

    const onDragOver = (e: DragEvent) => {
      if (!dragEl) return;
      e.preventDefault(); // required for this to be a valid drop target
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      pendingEvent = e;
      if (rafId === null) rafId = requestAnimationFrame(processPendingOver);
    };

    const processPendingOver = () => {
      rafId = null;
      const e = pendingEvent;
      if (!e || !dragEl) return;

      const target = (e.target as HTMLElement)?.closest('.list-item-card') as HTMLElement | null;
      if (!target || target === dragEl || !gridEl.contains(target)) return;

      const rect = target.getBoundingClientRect();
      const insertAfter = e.clientX > rect.left + rect.width / 2;
      didDrag = true;
      if (insertAfter) target.after(dragEl);
      else target.before(dragEl);
    };

    const finishDrag = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingEvent = null;
      if (!dragEl) return;

      dragEl.classList.remove('is-dragging-card');
      dragEl = null;
      setTimeout(() => { didDrag = false; }, 150);

      if (!didDrag) return;
      const newOrder = Array.from(gridEl.querySelectorAll('.list-item-card'))
        .map(el => (el as HTMLElement).dataset.id)
        .filter((id): id is string => !!id);

      const byId = new Map(listItemsRef.current.map(item => [item.external_id, item]));
      const updated = newOrder.map((id, idx) => ({ ...byId.get(id)!, position: idx }));
      setListItems(updated);
      reorderListItems(list.key, newOrder).catch(err => console.error('Failed to save list order:', err));
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      finishDrag();
    };

    // Fires whether the drag ended on a valid drop target or not (e.g.
    // released outside the grid) — always cleans up either way.
    const onDragEnd = () => finishDrag();

    const onClickCapture = (e: MouseEvent) => {
      if (didDrag) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    gridEl.addEventListener('dragstart', onDragStart);
    gridEl.addEventListener('dragover', onDragOver);
    gridEl.addEventListener('drop', onDrop);
    gridEl.addEventListener('dragend', onDragEnd);
    gridEl.addEventListener('click', onClickCapture, true);

    return () => {
      gridEl.removeEventListener('dragstart', onDragStart);
      gridEl.removeEventListener('dragover', onDragOver);
      gridEl.removeEventListener('drop', onDrop);
      gridEl.removeEventListener('dragend', onDragEnd);
      gridEl.removeEventListener('click', onClickCapture, true);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [gridEl, list.key, readOnly]);

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

  const commitName = async () => {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === list.name) { setNameDraft(list.name); return; }
    await updateUserList(list.key, trimmed, list.description ?? '', list.is_private, listType, isRanked).catch(err => console.error('Failed to save list name:', err));
    onMetaSaved(trimmed, list.description ?? '', list.is_private, listType, isRanked);
  };

  const commitDesc = async () => {
    setEditingDesc(false);
    const trimmed = descDraft.trim();
    if (trimmed === (list.description ?? '')) return;
    await updateUserList(list.key, list.name, trimmed, list.is_private, listType, isRanked).catch(err => console.error('Failed to save list description:', err));
    onMetaSaved(list.name, trimmed, list.is_private, listType, isRanked);
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
            {!readOnly && editingName ? (
              <input
                type="text"
                className="list-detail-title-input"
                value={nameDraft}
                maxLength={60}
                size={Math.max(nameDraft.length || 1, 8)}
                autoFocus
                onChange={e => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setNameDraft(list.name); setEditingName(false); } }}
              />
            ) : (
              <h2
                className={`list-detail-title${readOnly ? '' : ' list-detail-title--editable'}`}
                onClick={readOnly ? undefined : () => { setNameDraft(list.name); setEditingName(true); }}
                title={readOnly ? undefined : p.lists_edit}
              >
                {list.name}
              </h2>
            )}
            <span className="list-detail-count">
              {listItems.length} {isCharacters ? p.lists_characters_count : p.lists_items}
            </span>
          </div>

          {!readOnly && (
            <div className="list-settings-menu-wrapper" ref={settingsMenuRef}>
              <button
                type="button"
                className={`list-settings-btn${settingsOpen ? ' list-settings-btn--active' : ''}`}
                onClick={() => setSettingsOpen(s => !s)}
                title={p.lists_settings}
                aria-label={p.lists_settings}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>

              {settingsOpen && (
                <div className="list-settings-dropdown">
                  <div className="list-settings-section">
                    <div className="list-settings-row">
                      <span className="list-settings-item-title">{p.lists_type}</span>
                      <div className="list-settings-segmented">
                        <button
                          type="button"
                          className={`list-settings-segment${listType === 'media' ? ' list-settings-segment--active' : ''}${!canChangeType && listType !== 'media' ? ' list-settings-segment--disabled' : ''}`}
                          onClick={() => handleSetListType('media')}
                          disabled={!canChangeType && listType !== 'media'}
                        >
                          {p.lists_type_media}
                        </button>
                        <button
                          type="button"
                          className={`list-settings-segment${listType === 'characters' ? ' list-settings-segment--active' : ''}${!canChangeType && listType !== 'characters' ? ' list-settings-segment--disabled' : ''}`}
                          onClick={() => handleSetListType('characters')}
                          disabled={!canChangeType && listType !== 'characters'}
                        >
                          {p.lists_type_characters}
                        </button>
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

        {!readOnly && editingDesc ? (
          <input
            type="text"
            className="list-detail-desc-input"
            value={descDraft}
            maxLength={200}
            autoFocus
            placeholder={p.lists_desc_ph}
            onChange={e => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDescDraft(list.description ?? ''); setEditingDesc(false); } }}
          />
        ) : list.description ? (
          <p className={`list-detail-desc${readOnly ? '' : ' list-detail-desc--editable'}`} onClick={readOnly ? undefined : () => { setDescDraft(list.description ?? ''); setEditingDesc(true); }}>
            {list.description}
          </p>
        ) : !readOnly ? (
          <p className="list-detail-desc list-detail-desc-add" onClick={() => { setDescDraft(''); setEditingDesc(true); }}>{p.lists_desc_ph}</p>
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
          <div className="list-items-grid" ref={setGridEl}>
            {listItems.map((item, index) => {
              const title = item.title_main ?? item.external_id;
              const custom = customImagesMap?.get(item.external_id);
              const cover = custom ? wrapAssetUrl(custom.image_url) : (item.cover_url ?? '');
              const isCharItem = item.external_id.startsWith('character:') || isCharacters;
              const url = isCharItem
                ? `/character?id=${encodeURIComponent(item.external_id)}`
                : `/media?id=${encodeURIComponent(item.external_id)}`;

              return (
                <div className="list-item-card" data-id={item.external_id} key={item.external_id} draggable={!readOnly}>
                  {!readOnly && <span className="list-item-drag-handle" title={p.lists_drag_reorder}>⠿</span>}
                  <a className="list-item-cover-link" href={url} draggable={false}>
                    {cover
                      ? <img className="list-item-cover" src={cover} alt={title} loading="lazy" decoding="async" draggable={false} />
                      : <div className="list-item-cover list-item-cover--fallback" style={{ background: fallbackGradient(item.media_type) }}><span>{title.slice(0, 2).toUpperCase()}</span></div>}
                    <div className="list-item-info">
                      <span className="list-item-title">{title}</span>
                    </div>
                  </a>
                  {isRanked && (
                    <div className="list-item-rank-bar">
                      <span className={`list-item-rank-num${index < 3 ? ` list-item-rank-num--top${index + 1}` : ''}`}>
                        <span className="list-item-rank-prefix">#</span>
                        <span className="list-item-rank-val">{index + 1}</span>
                      </span>
                    </div>
                  )}
                  {!readOnly && (
                    <button className="list-item-remove" title={p.lists_remove} onClick={() => handleRemove(item.external_id)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="lists-empty-state" style={{ padding: '2rem 0' }}>
            <p>{isCharacters ? p.lists_empty_characters : p.lists_empty_items}</p>
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
              {isCharacters ? p.lists_add_characters : p.lists_add_items}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Top-level ──────────────────────────────────────────────────────────── */

interface ListsSectionProps {
  overrideLists?: ListInfo[];
  overrideCatalogMap?: Map<string, MediaCatalogEntry>;
  overrideFetchItems?: (listKey: string) => Promise<ListItemFull[]>;
  readOnly?: boolean;
}

export function ListsSection({ overrideLists, overrideCatalogMap, overrideFetchItems, readOnly }: ListsSectionProps = {}) {
  const p = getT().profile;

  const [catalogMap, setCatalogMap] = useState<Map<string, MediaCatalogEntry>>(overrideCatalogMap ?? new Map());
  const [charactersMap, setCharactersMap] = useState<Map<string, CharacterEntry>>(new Map());
  const [customImagesMap, setCustomImagesMap] = useState<Map<string, FavoriteCustomImage>>(new Map());
  const [username, setUsername] = useState('user');
  const [customLists, setCustomLists] = useState<ListInfo[]>(overrideLists ?? []);
  const [activeListKey, setActiveListKey] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('list');
  });

  useEffect(() => {
    if (overrideLists) {
      setCustomLists(overrideLists);
    }
  }, [overrideLists]);

  useEffect(() => {
    if (overrideCatalogMap) {
      setCatalogMap(overrideCatalogMap);
    }
  }, [overrideCatalogMap]);

  const handleOpenList = (key: string | null) => {
    setActiveListKey(key);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const current = url.searchParams.get('list');
      if (current === (key ?? null)) return;
      if (key) {
        url.searchParams.set('list', key);
        if (url.pathname === '/user') {
          url.searchParams.set('tab', 'lists');
        } else if (url.pathname === '/profile') {
          url.hash = 'lists';
        }
        history.pushState(history.state, '', url.toString());
      } else {
        url.searchParams.delete('list');
        history.pushState(history.state, '', url.toString());
      }
    }
  };

  useEffect(() => {
    const onPopState = () => {
      const listFromUrl = new URLSearchParams(window.location.search).get('list');
      setActiveListKey(listFromUrl);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // No blocking "Cargando..." placeholder here — the grid renders right
  // away (empty at first, or already filled from cache) while the global
  // bottom loading bar (BaseLayout.astro) shows the fetch is in flight.
  useEffect(() => {
    if (overrideLists) return;
    let cancelled = false;
    const endLoading = beginGlobalLoading();
    (async () => {
      try {
        const [{ catalog: catalogEntries }, allLists, profile, allChars, customImgs] = await Promise.all([
          getCachedLibraryAndCatalog(),
          getAllUserLists().catch(() => [] as ListInfo[]),
          getUserInfo().catch(() => ({} as Record<string, unknown>)),
          getAllCharacters().catch(() => [] as CharacterEntry[]),
          getCustomImagesMap().catch(() => new Map<string, FavoriteCustomImage>()),
        ]);
        if (cancelled) return;
        setCatalogMap(new Map(catalogEntries.map(e => [e.external_id, e])));
        setCharactersMap(new Map(allChars.map(c => [c.external_id, c])));
        setCustomImagesMap(customImgs);
        setUsername((profile.display_name as string | undefined)?.toLowerCase().replace(/\s+/g, '_') || 'user');
        setCustomLists(allLists.filter(l => !l.is_fav));
      } finally {
        endLoading();
      }
    })();
    return () => { cancelled = true; };
  }, [overrideLists]);

  const activeList = activeListKey ? customLists.find(l => l.key === activeListKey) : null;

  return (
    <div className="lists-page-layout">
      <ListsGrid
        customLists={customLists}
        catalogMap={catalogMap}
        charactersMap={charactersMap}
        customImagesMap={customImagesMap}
        p={p}
        onOpen={handleOpenList}
        activeKey={activeListKey}
        readOnly={readOnly}
        onCreate={async (name, description) => {
          const key = await createUserList(username, name, description).catch(() => null);
          if (!key) return;
          setCustomLists(prev => [...prev, { key, name, description, is_fav: false, is_private: false, list_type: 'media', item_count: 0, preview_ids: [] }]);
        }}
      />
      <div className="list-detail-panel">
        {activeList ? (
          <ListDetail
            key={activeList.key}
            list={activeList}
            catalogMap={catalogMap}
            customImagesMap={customImagesMap}
            p={p}
            onBack={() => handleOpenList(null)}
            onDeleted={() => { setCustomLists(prev => prev.filter(l => l.key !== activeList.key)); handleOpenList(null); }}
            onMetaSaved={(name, description, isPrivate, listType, isRankedVal) => setCustomLists(prev => prev.map(l => l.key === activeList.key ? { ...l, name, description, is_private: isPrivate, ...(listType ? { list_type: listType } : {}), ...(isRankedVal !== undefined ? { is_ranked: isRankedVal } : {}) } : l))}
            onCountChanged={delta => setCustomLists(prev => prev.map(l => l.key === activeList.key ? { ...l, item_count: Math.max(0, l.item_count + delta) } : l))}
            readOnly={readOnly}
            fetchItems={overrideFetchItems}
          />
        ) : activeListKey && customLists.length === 0 ? (
          <div className="list-detail-panel-empty"></div>
        ) : (
          <div className="list-detail-panel-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
            <p>{p.lists_select_prompt}</p>
          </div>
        )}
      </div>
    </div>
  );
}
