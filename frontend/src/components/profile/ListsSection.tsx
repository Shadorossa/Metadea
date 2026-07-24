import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getAllLibraryEntries, getUserInfo,
  getAllUserLists, getListItemsFull, createUserList, updateUserList,
  deleteUserList, addItemToList, removeItemFromList, reorderListItems,
} from '../../lib/tauri';
import type { MediaCatalogEntry, ListInfo, ListItemFull, LibraryEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { HOF_GRADIENTS } from '../../lib/profile/hof';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { dbRatingToStars5 } from '../../lib/media/rating-utils';
import { TYPE_LABELS } from '../../lib/constants/media';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type P = ReturnType<typeof getT>['profile'];

function fallbackGradient(type: string | null | undefined): string {
  return HOF_GRADIENTS[type ?? 'anime'] ?? 'linear-gradient(160deg,#374151,#1f2937)';
}

/* ── Grid view ──────────────────────────────────────────────────────────── */

function ListCard({ list, catalogMap, p, onClick }: {
  list: ListInfo;
  catalogMap: Map<string, MediaCatalogEntry>;
  p: P;
  onClick: () => void;
}) {
  const previewMetas = list.preview_ids.map(id => catalogMap.get(id));
  return (
    <div className="list-card" onClick={onClick}>
      <div className={`list-card-collage${previewMetas.length === 0 ? ' list-card-collage--empty' : ''}`}>
        {previewMetas.length > 0
          ? previewMetas.map((meta, i) => meta?.cover_url
              ? <img className="list-card-collage-img" src={meta.cover_url} alt="" loading="lazy" key={i} />
              : <div className="list-card-collage-img list-card-collage-fallback" style={{ background: fallbackGradient(meta?.type) }} key={i} />)
          : <span className="list-card-empty-icon">📋</span>}
      </div>
      <div className="list-card-info">
        <span className="list-card-title">{list.name}</span>
        <span className="list-card-count">{list.item_count} {p.lists_items}</span>
      </div>
    </div>
  );
}

function ListsGrid({ customLists, catalogMap, p, onCreate, onOpen }: {
  customLists: ListInfo[];
  catalogMap: Map<string, MediaCatalogEntry>;
  p: P;
  onCreate: (name: string, description: string) => void;
  onOpen: (key: string) => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <div className="lists-layout">
      <div className="lists-header">
        <h2 className="lists-title">{p.lists}</h2>
        <button className="list-btn list-btn--primary" onClick={() => setIsCreating(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          {p.lists_new}
        </button>
      </div>
      {isCreating && (
        <div className="list-create-form">
          <input type="text" className="list-input list-create-name" placeholder={p.lists_name_ph} maxLength={60} autoFocus value={name} onChange={e => setName(e.target.value)} />
          <input type="text" className="list-input list-create-desc" placeholder={p.lists_desc_ph} maxLength={200} value={description} onChange={e => setDescription(e.target.value)} />
          <div className="list-create-actions">
            <button
              className="list-btn list-btn--primary"
              onClick={() => {
                const trimmed = name.trim();
                if (!trimmed) return;
                onCreate(trimmed, description.trim());
                setIsCreating(false);
                setName('');
                setDescription('');
              }}
            >
              {p.lists_create}
            </button>
            <button className="list-btn list-btn--ghost" onClick={() => setIsCreating(false)}>{p.lists_cancel}</button>
          </div>
        </div>
      )}
      {customLists.length > 0 ? (
        <div className="lists-grid">
          {customLists.map(l => <ListCard list={l} catalogMap={catalogMap} p={p} onClick={() => onOpen(l.key)} key={l.key} />)}
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

function ListDetail({ list, items, catalogMap, p, onBack, onDeleted, onMetaSaved, onCountChanged }: {
  list: ListInfo;
  items: Items;
  catalogMap: Map<string, MediaCatalogEntry>;
  p: P;
  onBack: () => void;
  onDeleted: () => void;
  onMetaSaved: (name: string, description: string) => void;
  onCountChanged: (delta: number) => void;
}) {
  const [listItems, setListItems] = useState<ListItemFull[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [metaName, setMetaName] = useState(list.name);
  const [metaDesc, setMetaDesc] = useState(list.description ?? '');

  const gridRef = useRef<HTMLDivElement>(null);
  const listItemsRef = useRef(listItems);
  listItemsRef.current = listItems;

  useEffect(() => {
    let cancelled = false;
    getListItemsFull(list.key).catch(() => [] as ListItemFull[]).then(res => { if (!cancelled) setListItems(res); });
    return () => { cancelled = true; };
  }, [list.key]);

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

  const available = useMemo(() => {
    if (!showAddPanel) return [];
    const q = searchQuery.toLowerCase();
    return items
      .filter(i => !currentIds.has(i.external_id))
      .filter(i => {
        if (!q) return true;
        const meta = catalogMap.get(i.external_id);
        return (meta?.title_main ?? i.external_id).toLowerCase().includes(q);
      })
      .slice(0, 30);
  }, [showAddPanel, searchQuery, items, currentIds, catalogMap]);

  const handleAdd = async (item: LibraryEntry) => {
    if (currentIds.has(item.external_id)) return;
    await addItemToList(list.key, item.external_id).catch(err => console.error('Failed to add item to list:', err));
    const meta = catalogMap.get(item.external_id);
    setListItems(prev => [...prev, {
      external_id: item.external_id,
      position: prev.length,
      library_id: item.id ?? null,
      status: item.status ?? null,
      rating: item.rating ?? null,
      progress: item.progress ?? 0,
      progress_2: item.progress_2 ?? 0,
      is_favorite: (item.is_favorite ?? 0) !== 0,
      is_platinum: (item.is_platinum ?? 0) !== 0,
      title_main: meta?.title_main ?? null,
      cover_url: meta?.cover_url ?? null,
      media_type: meta?.type ?? null,
      format: meta?.format ?? null,
    }]);
    onCountChanged(1);
  };

  const handleRemove = async (id: string) => {
    await removeItemFromList(list.key, id).catch(err => console.error('Failed to remove item from list:', err));
    setListItems(prev => prev.filter(x => x.external_id !== id));
    onCountChanged(-1);
  };

  const saveMeta = async () => {
    const trimmed = metaName.trim();
    if (!trimmed) return;
    await updateUserList(list.key, trimmed, metaDesc.trim()).catch(err => console.error('Failed to save list metadata:', err));
    onMetaSaved(trimmed, metaDesc.trim());
    setIsEditingMeta(false);
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
        <div className="list-detail-actions">
          <button className="list-btn list-btn--ghost" onClick={() => setIsEditingMeta(true)}>{p.lists_edit}</button>
          <button className="list-btn list-btn--danger" onClick={handleDelete}>{p.lists_delete}</button>
        </div>
      </div>

      {isEditingMeta ? (
        <div className="list-detail-meta-edit">
          <input type="text" className="list-input list-meta-name-input" value={metaName} maxLength={60} placeholder={p.lists_name_ph} onChange={e => setMetaName(e.target.value)} />
          <input type="text" className="list-input list-meta-desc-input" value={metaDesc} maxLength={200} placeholder={p.lists_desc_ph} onChange={e => setMetaDesc(e.target.value)} />
          <div className="list-create-actions">
            <button className="list-btn list-btn--primary" onClick={saveMeta}>{p.lists_save}</button>
            <button className="list-btn list-btn--ghost" onClick={() => { setIsEditingMeta(false); setMetaName(list.name); setMetaDesc(list.description ?? ''); }}>{p.lists_cancel}</button>
          </div>
        </div>
      ) : (
        <div className="list-detail-meta">
          <h2 className="list-detail-title">{list.name}</h2>
          {list.description && <p className="list-detail-desc">{list.description}</p>}
        </div>
      )}

      {showAddPanel && (
        <div className="list-add-panel">
          <div className="list-add-search-row">
            <input type="text" className="list-add-search" placeholder={p.lists_search_library} value={searchQuery} autoFocus onChange={e => setSearchQuery(e.target.value)} />
            <button className="list-btn list-btn--ghost" onClick={() => { setShowAddPanel(false); setSearchQuery(''); }}>✕</button>
          </div>
          <div className="list-add-results">
            {available.length > 0 ? available.map(item => {
              const meta = catalogMap.get(item.external_id);
              const title = meta?.title_main ?? item.external_id;
              const cover = meta?.cover_url ?? '';
              return (
                <div className="list-add-item" key={item.external_id}>
                  {cover
                    ? <img className="list-add-cover" src={cover} alt="" loading="lazy" />
                    : <div className="list-add-cover list-add-cover--fallback" style={{ background: fallbackGradient(item.type) }} />}
                  <span className="list-add-title">{title}</span>
                  <button className="list-add-btn" onClick={() => handleAdd(item)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                </div>
              );
            }) : <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem 0' }}>{p.lists_no_results}</p>}
          </div>
        </div>
      )}

      <div className="list-detail-content">
        <div className="list-detail-header-row">
          <span className="list-detail-count">{listItems.length} {p.lists_items}</span>
          <button className="list-btn list-btn--primary" onClick={() => setShowAddPanel(s => !s)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            {p.lists_add_items}
          </button>
        </div>
        {listItems.length > 0 ? (
          <div className="list-items-grid" ref={gridRef}>
            {listItems.map(item => {
              const title = item.title_main ?? item.external_id;
              const cover = item.cover_url ?? '';
              const url = `/media?id=${encodeURIComponent(item.external_id)}`;
              const typeLabel = TYPE_LABELS[item.media_type ?? ''] ?? (item.media_type ?? '');
              const ratingDisplay = item.rating ? `★ ${dbRatingToStars5(item.rating).toFixed(1)}` : null;

              return (
                <div className="list-item-card" data-id={item.external_id} key={item.external_id}>
                  <span className="list-item-drag-handle" title={p.lists_drag_reorder}>⠿</span>
                  <a className="list-item-cover-link" href={url}>
                    {cover
                      ? <img className="list-item-cover" src={cover} alt={title} loading="lazy" />
                      : <div className="list-item-cover list-item-cover--fallback" style={{ background: fallbackGradient(item.media_type) }}><span>{title.slice(0, 2).toUpperCase()}</span></div>}
                  </a>
                  <div className="list-item-info">
                    <a className="list-item-title" href={url}>{title}</a>
                    {typeLabel && <span className="list-item-type">{typeLabel}</span>}
                    {ratingDisplay && <span className="list-item-rating">{ratingDisplay}</span>}
                  </div>
                  <button className="list-item-remove" title={p.lists_remove} onClick={() => handleRemove(item.external_id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
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

export function ListsSection() {
  const p = getT().profile;

  const [items, setItems] = useState<Items | null>(null);
  const [catalogMap, setCatalogMap] = useState<Map<string, MediaCatalogEntry>>(new Map());
  const [username, setUsername] = useState('user');
  const [customLists, setCustomLists] = useState<ListInfo[]>([]);
  const [activeListKey, setActiveListKey] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  if (items === null) return <div className="profile-empty"><p>{p.stats_loading}</p></div>;

  const activeList = activeListKey ? customLists.find(l => l.key === activeListKey) : null;

  if (activeList) {
    return (
      <ListDetail
        list={activeList}
        items={items}
        catalogMap={catalogMap}
        p={p}
        onBack={() => setActiveListKey(null)}
        onDeleted={() => { setCustomLists(prev => prev.filter(l => l.key !== activeList.key)); setActiveListKey(null); }}
        onMetaSaved={(name, description) => setCustomLists(prev => prev.map(l => l.key === activeList.key ? { ...l, name, description } : l))}
        onCountChanged={delta => setCustomLists(prev => prev.map(l => l.key === activeList.key ? { ...l, item_count: Math.max(0, l.item_count + delta) } : l))}
      />
    );
  }

  return (
    <ListsGrid
      customLists={customLists}
      catalogMap={catalogMap}
      p={p}
      onOpen={setActiveListKey}
      onCreate={async (name, description) => {
        const key = await createUserList(username, name, description).catch(() => null);
        if (!key) return;
        setCustomLists(prev => [...prev, { key, name, description, is_fav: false, item_count: 0, preview_ids: [] }]);
      }}
    />
  );
}
