import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getAllLibraryEntries, getUserInfo,
  getAllUserLists, getListItemsFull, createUserList, updateUserList,
  deleteUserList, addItemToList, removeItemFromList, reorderListItems,
} from '../../lib/tauri';
import type { MediaCatalogEntry, ListInfo, ListItemFull } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { MediaSearchPopup } from '../media/MediaSearchPopup';
import type { SearchResult as ApiSearchResult } from '../../lib/search';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type P = ReturnType<typeof getT>['profile'];

function fallbackGradient(type: string | null | undefined): string {
  return HOF_GRADIENTS[type ?? 'anime'] ?? 'linear-gradient(160deg,#374151,#1f2937)';
}

/* ── Grid view ──────────────────────────────────────────────────────────── */

function ListCard({ list, catalogMap, p, active, onClick }: {
  list: ListInfo;
  catalogMap: Map<string, MediaCatalogEntry>;
  p: P;
  active?: boolean;
  onClick: () => void;
}) {
  // Just the first work in the list, not a multi-cover collage — a 2x2
  // grid with only one (or two) covers left the rest of the tile as bare
  // background instead of a real cover filling the card's full width.
  const firstMeta = list.preview_ids.length > 0 ? catalogMap.get(list.preview_ids[0]) : undefined;
  return (
    <div className={`list-card${active ? ' list-card--active' : ''}`} onClick={onClick}>
      <div className={`list-card-collage${list.preview_ids.length === 0 ? ' list-card-collage--empty' : ''}`}>
        {list.preview_ids.length > 0
          ? (firstMeta?.cover_url
              ? <img className="list-card-collage-img" src={firstMeta.cover_url} alt="" loading="lazy" decoding="async" />
              : <div className="list-card-collage-img list-card-collage-fallback" style={{ background: fallbackGradient(firstMeta?.type) }} />)
          : <span className="list-card-empty-icon">📋</span>}
      </div>
      <div className="list-card-info">
        <span className="list-card-title">{list.name}</span>
        <span className="list-card-count">{list.item_count} {p.lists_items}</span>
      </div>
    </div>
  );
}

// The first name in "Sin nombre", "Sin nombre 1", "Sin nombre 2", ... not
// already taken by one of this user's existing lists — same idea as
// picking a free numeric suffix, just against display names instead of
// the key's own numeric-suffix scheme (create_user_list, Rust side).
function nextUntitledListName(existingNames: string[], base: string): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function ListsGrid({ customLists, catalogMap, p, onCreate, onOpen, activeKey, readOnly }: {
  customLists: ListInfo[];
  catalogMap: Map<string, MediaCatalogEntry>;
  p: P;
  onCreate: (name: string, description: string) => void;
  onOpen: (key: string) => void;
  activeKey?: string | null;
  readOnly?: boolean;
}) {
  return (
    <div className="lists-layout">
      <div className="lists-header">
        <h2 className="lists-title">{p.lists}</h2>
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
      {customLists.length > 0 ? (
        <div className="lists-grid">
          {customLists.map(l => <ListCard list={l} catalogMap={catalogMap} p={p} active={l.key === activeKey} onClick={() => onOpen(l.key)} key={l.key} />)}
        </div>
      ) : (
        <div className="lists-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
          <p>{p.lists_empty}</p>
        </div>
      )}
    </div>
  );
}

/* ── Detail view ────────────────────────────────────────────────────────── */

function ListDetail({ list, catalogMap, p, onBack, onDeleted, onMetaSaved, onCountChanged, readOnly, fetchItems }: {
  list: ListInfo;
  catalogMap: Map<string, MediaCatalogEntry>;
  p: P;
  onBack: () => void;
  onDeleted: () => void;
  onMetaSaved: (name: string, description: string, isPrivate: boolean) => void;
  onCountChanged: (delta: number) => void;
  // Someone else's profile (UserProfileView) has no local list to read via
  // getListItemsFull — this fetches from the social cache instead.
  readOnly?: boolean;
  fetchItems?: (listKey: string) => Promise<ListItemFull[]>;
}) {
  const [listItems, setListItems] = useState<ListItemFull[]>([]);
  const [showAddPanel, setShowAddPanel] = useState(false);
  // Click-to-edit, not a separate "Editar" form — name/description commit
  // individually (blur or Enter) instead of behind one shared Guardar/
  // Cancelar step. Private is a plain toggle, saved the instant it flips.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(list.name);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(list.description ?? '');

  const gridRef = useRef<HTMLDivElement>(null);
  const listItemsRef = useRef(listItems);
  listItemsRef.current = listItems;

  useEffect(() => {
    let cancelled = false;
    (fetchItems ?? getListItemsFull)(list.key).catch(() => [] as ListItemFull[]).then(res => { if (!cancelled) setListItems(res); });
    return () => { cancelled = true; };
  }, [list.key, fetchItems]);

  const currentIds = useMemo(() => new Set(listItems.map(i => i.external_id)), [listItems]);

  // Pointer-based reordering (no floating ghost — card reorders in place),
  // delegated on the grid so it keeps working across re-renders without
  // needing to re-bind a handler per card. Direct DOM manipulation during
  // the drag (not React state) matches the original's rAF-throttled
  // approach — only committing to React state (and persisting) on mouseup.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    let dragCard: HTMLElement | null = null;
    let dragActive = false;

    type CardRect = { el: HTMLElement; cy: number; top: number; height: number };
    let rectCache: CardRect[] = [];

    const refreshRectCache = () => {
      rectCache = Array.from(grid.querySelectorAll('.list-item-card:not(.drag-source)')).map(cardEl => {
        const r = (cardEl as HTMLElement).getBoundingClientRect();
        return { el: cardEl as HTMLElement, cy: r.top + r.height / 2, top: r.top, height: r.height };
      });
    };

    const getClosestCard = (clientY: number): CardRect | null => {
      let closest: CardRect | null = null;
      let closestDist = Infinity;
      for (const entry of rectCache) {
        const dist = Math.abs(clientY - entry.cy);
        if (dist < closestDist) { closestDist = dist; closest = entry; }
      }
      return closest;
    };

    let rafId = 0;
    let lastMoveY = 0;
    let prevMoveY = 0;

    // Which side of the target the dragged card lands on is decided by the
    // direction of travel, not a static 50/50 split — self-stabilizing,
    // avoids the oscillation flicker a fixed midpoint check causes.
    const reorderTick = () => {
      rafId = 0;
      if (!dragCard) return;
      const target = getClosestCard(lastMoveY);
      if (target && target.el !== dragCard) {
        const movingDown = lastMoveY >= prevMoveY;
        const midpoint = target.top + target.height / 2;
        const passedMidpoint = movingDown ? lastMoveY > midpoint : lastMoveY < midpoint;
        if (passedMidpoint) {
          if (movingDown) grid.insertBefore(dragCard, target.el.nextSibling);
          else grid.insertBefore(dragCard, target.el);
          refreshRectCache();
        }
      }
      prevMoveY = lastMoveY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragActive || !dragCard) return;
      e.preventDefault();
      lastMoveY = e.clientY;
      if (!rafId) rafId = requestAnimationFrame(reorderTick);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

      dragActive = false;
      if (dragCard) {
        dragCard.classList.remove('drag-source');

        const newIds = Array.from(grid.querySelectorAll('.list-item-card'))
          .map(c => (c as HTMLElement).dataset.id)
          .filter(Boolean) as string[];

        const byId = new Map(listItemsRef.current.map(i => [i.external_id, i]));
        const reordered = newIds.map(id => byId.get(id)).filter((i): i is ListItemFull => Boolean(i));

        reorderListItems(list.key, newIds).catch(err => console.error('Failed to persist list reorder:', err));
        dragCard = null;
        setListItems(reordered);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const handle = (e.target as HTMLElement).closest<HTMLElement>('.list-item-drag-handle');
      if (!handle) return;
      const card = handle.closest<HTMLElement>('.list-item-card');
      if (!card) return;
      e.preventDefault();
      window.getSelection()?.removeAllRanges();

      dragCard = card;
      dragActive = true;
      prevMoveY = e.clientY;
      card.classList.add('drag-source');
      refreshRectCache();

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    grid.addEventListener('mousedown', onMouseDown);
    return () => {
      grid.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [list.key]);

  // MediaSearchPopup's own live multi-provider search — same one PrEditor's
  // "Add to Saga" uses — replaces the old library-only text-filter panel, so
  // a list can include any cataloged work, not just something already in
  // the user's own library.
  const handleAddFromSearch = async (result: ApiSearchResult) => {
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

  const handleRemove = async (id: string) => {
    await removeItemFromList(list.key, id).catch(err => console.error('Failed to remove item from list:', err));
    setListItems(prev => prev.filter(x => x.external_id !== id));
    onCountChanged(-1);
  };

  const commitName = async () => {
    setEditingName(false);
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === list.name) { setNameDraft(list.name); return; }
    await updateUserList(list.key, trimmed, list.description ?? '', list.is_private).catch(err => console.error('Failed to save list name:', err));
    onMetaSaved(trimmed, list.description ?? '', list.is_private);
  };

  const commitDesc = async () => {
    setEditingDesc(false);
    const trimmed = descDraft.trim();
    if (trimmed === (list.description ?? '')) return;
    await updateUserList(list.key, list.name, trimmed, list.is_private).catch(err => console.error('Failed to save list description:', err));
    onMetaSaved(list.name, trimmed, list.is_private);
  };

  const togglePrivate = async () => {
    const next = !list.is_private;
    await updateUserList(list.key, list.name, list.description ?? '', next).catch(err => console.error('Failed to save list privacy:', err));
    onMetaSaved(list.name, list.description ?? '', next);
  };

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar la lista "${list.name}"?`)) return;
    await deleteUserList(list.key).catch(err => console.error('Failed to delete list:', err));
    onDeleted();
  };

  return (
    <div className="list-detail-layout">
      <div className="list-detail-nav">
        <button className="list-back-btn" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
          {p.lists_back}
        </button>
        {!readOnly && (
          <div className="list-detail-actions">
            <button className="list-btn list-btn--danger" onClick={handleDelete}>{p.lists_delete}</button>
          </div>
        )}
      </div>

      <div className="list-detail-meta">
        <div className="list-detail-meta-row">
          <div className="list-detail-meta-row-left">
            {!readOnly && editingName ? (
              <input
                type="text"
                className="list-input list-detail-title-input"
                value={nameDraft}
                maxLength={60}
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
            <span className="list-detail-count">{listItems.length} {p.lists_items}</span>
          </div>
          {!readOnly && (
            <label className="list-meta-private-toggle">
              <input type="checkbox" checked={list.is_private} onChange={togglePrivate} />
              {p.lists_private}
            </label>
          )}
        </div>
        {!readOnly && editingDesc ? (
          <input
            type="text"
            className="list-input list-detail-desc-input"
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
          <p className="list-detail-desc-add" onClick={() => { setDescDraft(''); setEditingDesc(true); }}>{p.lists_desc_ph}</p>
        ) : null}
      </div>

      {!readOnly && showAddPanel && (
        <MediaSearchPopup
          onSelect={handleAddFromSearch}
          onClose={() => setShowAddPanel(false)}
          excludeIds={Array.from(currentIds)}
          closeOnSelect={false}
        />
      )}

      <div className="list-detail-content">
        <div className="list-detail-header-row">
          {!readOnly && (
            <button className="list-btn list-btn--primary" onClick={() => setShowAddPanel(s => !s)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              {p.lists_add_items}
            </button>
          )}
        </div>
        {listItems.length > 0 ? (
          <div className="list-items-grid" ref={gridRef}>
            {listItems.map(item => {
              const title = item.title_main ?? item.external_id;
              const cover = item.cover_url ?? '';
              const url = `/media?id=${encodeURIComponent(item.external_id)}`;

              return (
                <div className="list-item-card" data-id={item.external_id} key={item.external_id}>
                  {!readOnly && <span className="list-item-drag-handle" title={p.lists_drag_reorder}>⠿</span>}
                  <a className="list-item-cover-link" href={url}>
                    {cover
                      ? <img className="list-item-cover" src={cover} alt={title} loading="lazy" decoding="async" />
                      : <div className="list-item-cover list-item-cover--fallback" style={{ background: fallbackGradient(item.media_type) }}><span>{title.slice(0, 2).toUpperCase()}</span></div>}
                    <div className="list-item-info">
                      <span className="list-item-title">{title}</span>
                    </div>
                  </a>
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
          <div className="lists-empty-state" style={{ padding: '2rem 0' }}><p>{p.lists_empty_items}</p></div>
        )}
      </div>
    </div>
  );
}

/* ── Top-level ──────────────────────────────────────────────────────────── */

interface ListsSectionProps {
  // Someone else's profile (UserProfileView) already has their lists and
  // the viewer's own catalogMap in hand — passing them in skips this
  // component's own local-only fetch. readOnly hides every create/edit/
  // reorder/remove affordance and reads list items via overrideFetchItems
  // (the social cache) instead of getListItemsFull (the viewer's own).
  overrideLists?: ListInfo[];
  overrideCatalogMap?: Map<string, MediaCatalogEntry>;
  overrideFetchItems?: (listKey: string) => Promise<ListItemFull[]>;
  readOnly?: boolean;
}

export function ListsSection({ overrideLists, overrideCatalogMap, overrideFetchItems, readOnly }: ListsSectionProps = {}) {
  const p = getT().profile;

  const [items, setItems] = useState<Items | null>(overrideLists ? [] : null);
  const [catalogMap, setCatalogMap] = useState<Map<string, MediaCatalogEntry>>(overrideCatalogMap ?? new Map());
  const [username, setUsername] = useState('user');
  const [customLists, setCustomLists] = useState<ListInfo[]>(overrideLists ?? []);
  const [activeListKey, setActiveListKey] = useState<string | null>(null);

  useEffect(() => {
    if (overrideLists) return;
    let cancelled = false;
    (async () => {
      const [{ items: libItems, catalog: catalogEntries }, allLists, profile] = await Promise.all([
        getCachedLibraryAndCatalog(),
        getAllUserLists().catch(() => [] as ListInfo[]),
        getUserInfo().catch(() => ({} as Record<string, unknown>)),
      ]);
      if (cancelled) return;
      setItems(libItems);
      setCatalogMap(new Map(catalogEntries.map(e => [e.external_id, e])));
      setUsername((profile.display_name as string | undefined)?.toLowerCase().replace(/\s+/g, '_') || 'user');
      // Favorites already have their own "Favoritos" profile tab
      // (LibrarySection is driven separately by LibraryEntry.is_favorite) —
      // the favorite-backed ListInfo rows returned by getAllUserLists()
      // would just duplicate that here, so they're filtered out entirely
      // rather than shown a second time under "Listas".
      setCustomLists(allLists.filter(l => !l.is_fav));
    })();
    return () => { cancelled = true; };
  }, [overrideLists]);

  if (items === null) return <div className="profile-empty"><p>{p.stats_loading}</p></div>;

  const activeList = activeListKey ? customLists.find(l => l.key === activeListKey) : null;

  // The panel frame (.list-detail-panel) is always mounted — not something
  // that pops in on selecting a list — so the layout is already "ready" the
  // moment you're in the Lists tab; picking a list just fills it in instead
  // of triggering an entrance of its own. Same idea as Local's detail panel
  // staying next to the grid rather than replacing it, just without that
  // panel's own open/close animation, since there's nothing to open here.
  // ListDetail itself is remounted per list (key={list.key}) so its local
  // edit-form state (name/description/private draft) can't leak from
  // whichever list was open before.
  return (
    <div className="lists-page-layout">
      <ListsGrid
        customLists={customLists}
        catalogMap={catalogMap}
        p={p}
        onOpen={setActiveListKey}
        activeKey={activeListKey}
        readOnly={readOnly}
        onCreate={async (name, description) => {
          const key = await createUserList(username, name, description).catch(() => null);
          if (!key) return;
          setCustomLists(prev => [...prev, { key, name, description, is_fav: false, is_private: false, item_count: 0, preview_ids: [] }]);
        }}
      />
      <div className="list-detail-panel">
        {activeList ? (
          <ListDetail
            key={activeList.key}
            list={activeList}
            catalogMap={catalogMap}
            p={p}
            onBack={() => setActiveListKey(null)}
            onDeleted={() => { setCustomLists(prev => prev.filter(l => l.key !== activeList.key)); setActiveListKey(null); }}
            onMetaSaved={(name, description, isPrivate) => setCustomLists(prev => prev.map(l => l.key === activeList.key ? { ...l, name, description, is_private: isPrivate } : l))}
            onCountChanged={delta => setCustomLists(prev => prev.map(l => l.key === activeList.key ? { ...l, item_count: Math.max(0, l.item_count + delta) } : l))}
            readOnly={readOnly}
            fetchItems={overrideFetchItems}
          />
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
