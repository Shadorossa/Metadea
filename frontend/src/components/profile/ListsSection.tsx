import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useFloating, offset, flip, shift, useDismiss, useRole, useListNavigation, useInteractions,
} from '@floating-ui/react';
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import { EpisodeSearchPopup, type EpisodeSearchResult } from '../media/EpisodeSearchPopup';
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
  const isEpisodes = list.list_type === 'episodes';
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
          : <span className="list-card-empty-icon">{isCharacters ? '👤' : isEpisodes ? '📺' : '📋'}</span>}
      </div>
      <div className="list-card-info">
        <span className="list-card-title">{list.name}</span>
        <span className="list-card-count">
          {list.item_count} {isCharacters ? p.lists_characters_count : isEpisodes ? (p.lists_episodes_count || 'episodios') : p.lists_items}
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
  const [filterMode, setFilterMode] = useState<'all' | 'media' | 'characters' | 'episodes'>('all');
  const showMedia = filterMode === 'all' || filterMode === 'media';
  const showCharacters = filterMode === 'all' || filterMode === 'characters';
  const showEpisodes = filterMode === 'all' || filterMode === 'episodes';

  const toggleFilter = (type: 'media' | 'characters' | 'episodes') => {
    if (filterMode === type) {
      setFilterMode('all');
    } else {
      setFilterMode(type);
    }
  };

  const filteredLists = useMemo(() => {
    if (filterMode === 'all') return customLists;
    if (filterMode === 'media') return customLists.filter(l => l.list_type !== 'characters' && l.list_type !== 'episodes');
    if (filterMode === 'characters') return customLists.filter(l => l.list_type === 'characters');
    return customLists.filter(l => l.list_type === 'episodes');
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
            <button
              type="button"
              className={`lists-filter-btn${showEpisodes ? ' lists-filter-btn--active' : ''}`}
              onClick={() => toggleFilter('episodes')}
              title={p.lists_type_episodes || 'Episodios'}
              aria-label={p.lists_type_episodes || 'Episodios'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
                <polyline points="17 2 12 7 7 2" />
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

interface ListItemDisplay { cover: string; isEpItem: boolean; url: string; epBadge: string | null; title: string }

type ListSortMode = 'custom' | 'alphabetical' | 'release';

function sortListItems(
  items: ListItemFull[],
  mode: ListSortMode,
  catalogMap: Map<string, MediaCatalogEntry>,
): ListItemFull[] {
  if (mode === 'custom') return items;
  return [...items].sort((a, b) => {
    if (mode === 'alphabetical') {
      return (a.title_main ?? a.external_id).localeCompare(b.title_main ?? b.external_id);
    }

    const aMeta = catalogMap.get(a.external_id);
    const bMeta = catalogMap.get(b.external_id);
    const aDate = aMeta?.release_year
      ? aMeta.release_year * 10000 + (aMeta.release_month ?? 1) * 100 + (aMeta.release_day ?? 1)
      : Number.POSITIVE_INFINITY;
    const bDate = bMeta?.release_year
      ? bMeta.release_year * 10000 + (bMeta.release_month ?? 1) * 100 + (bMeta.release_day ?? 1)
      : Number.POSITIVE_INFINITY;
    return aDate - bDate || a.position - b.position;
  });
}

// Pure derivation from an item + the list's own type/custom-cover overrides
// — used identically by the sortable grid card and its DragOverlay preview,
// so a dragged card doesn't need its own separate "what does this look like"
// logic.
function resolveListItemDisplay(
  item: ListItemFull, isCharacters: boolean, isEpisodes: boolean, customImagesMap?: Map<string, FavoriteCustomImage>,
): ListItemDisplay {
  const custom = customImagesMap?.get(item.external_id);
  const cover = custom ? wrapAssetUrl(custom.image_url) : (item.cover_url ?? '');
  const isCharItem = item.external_id.startsWith('character:') || isCharacters;
  const isEpItem = item.external_id.startsWith('episode:') || isEpisodes;

  let url = `/media?id=${encodeURIComponent(item.external_id)}`;
  let epBadge: string | null = null;
  const title = item.title_main ?? item.external_id;

  if (isCharItem) {
    url = `/character?id=${encodeURIComponent(item.external_id)}`;
  } else if (isEpItem) {
    const parts = item.external_id.split(':');
    // episode:<type>:<numericId>:<season>:<episode>
    if (parts.length >= 5) {
      const parentId = `${parts[1]}:${parts[2]}`;
      const sNum = parseInt(parts[3], 10);
      const epNum = parts[4];
      url = `/media?id=${encodeURIComponent(parentId)}`;
      epBadge = sNum > 0 ? `T${sNum} E${epNum}` : `Ep. ${epNum}`;
    }
  }
  return { cover, isEpItem, url, epBadge, title };
}

// Everything inside the card except the sortable wrapper div itself — shared
// between the live grid card (wrapped by SortableListItemCard below, with
// real drag listeners) and the DragOverlay clone (a plain floating visual,
// no listeners of its own).
function ListItemCardBody({ item, display, index, isRanked, readOnly, p, onRemove }: {
  item: ListItemFull;
  display: ListItemDisplay;
  index: number;
  isRanked: boolean;
  readOnly?: boolean;
  p: P;
  onRemove: (id: string) => void;
}) {
  const { cover, url, epBadge, title } = display;
  return (
    <>
      {/* Purely a visual hint now — the whole card is grabbable (see
          SortableListItemCard), not just this handle. */}
      {!readOnly && <span className="list-item-drag-handle" title={p.lists_drag_reorder}>⠿</span>}
      <a className="list-item-cover-link" href={url} draggable={false}>
        {epBadge && <span className="list-item-episode-badge">{epBadge}</span>}
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
        <button className="list-item-remove" title={p.lists_remove} onClick={() => onRemove(item.external_id)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      )}
    </>
  );
}

function SortableListItemCard({ item, display, index, isRanked, readOnly, p, onRemove }: {
  item: ListItemFull;
  display: ListItemDisplay;
  index: number;
  isRanked: boolean;
  readOnly?: boolean;
  p: P;
  onRemove: (id: string) => void;
}) {
  // Grabbable from anywhere on the card (matching the old implementation),
  // not just the ⠿ handle — the handle is a low-opacity, top-corner-only
  // hint that's easy to miss/miss-click, so attributes/listeners go on the
  // whole card instead. PointerSensor's activationConstraint (see
  // ListDetail's dndSensors) is what actually distinguishes a click on the
  // cover link/remove button from a drag start now, so this doesn't need
  // its own click-vs-drag suppression the way the old manual implementation
  // did (its didDrag flag + capture-phase click handler).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.external_id,
    disabled: readOnly,
  });
  return (
    <div
      ref={setNodeRef}
      className={`list-item-card${display.isEpItem ? ' list-item-card--episode' : ''}${isDragging ? ' list-item-card--ghost' : ''}`}
      data-id={item.external_id}
      style={{
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      <ListItemCardBody
        item={item} display={display} index={index} isRanked={isRanked} readOnly={readOnly} p={p} onRemove={onRemove}
      />
    </div>
  );
}

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

  const listItemsRef = useRef(listItems);
  listItemsRef.current = listItems;

  useEffect(() => {
    let cancelled = false;
    (fetchItems ?? getListItemsFull)(list.key).catch(() => [] as ListItemFull[]).then(res => { if (!cancelled) setListItems(res); });
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
                  ? (p.lists_empty_episodes || 'Esta lista está vacía. Añade episodios a tu lista.')
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
              {isCharacters ? p.lists_add_characters : isEpisodes ? (p.lists_add_episodes || 'Añadir episodios') : p.lists_add_items}
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
