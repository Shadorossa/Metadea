import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { getAllLibraryEntries, getAllCharacters, getAllFavoriteCustomImages, readUserFavorites, writeUserFavorites, wrapAssetUrl, saveLibraryEntry } from '../../lib/tauri';
import type { MediaCatalogEntry, FavoriteCustomImage, CharacterEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { typeIconMap } from '../../lib/shared/icon-strings';
import { openFavoriteImageEditor } from '../../lib/profile/favorite-image-editor';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { ALL_MEDIA_TYPES } from '../../lib/constants/media';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type FavData = Record<string, string[]>;

const TYPE_ICON = typeIconMap(16);

const CROWN_ICON_ON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M3 20h18v2H3z"/></svg>`;
const CROWN_ICON_OFF = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M3 20h18v2H3z"/></svg>`;
const REMOVE_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const EDIT_IMAGE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
const MULTIMEDIA_TAB_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const CHARACTER_TAB_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const REORDER_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M21 3L14 10"/><path d="M18 14l3 3M14 21h7v-7"/><path d="M21 21L14 14"/><path d="M3 3l18 18"/></svg>`;
const EMPTY_ICON = `<svg class="fav-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

interface FavItem { external_id: string; type: string; }

interface FavCardProps {
  item: FavItem;
  idx: number;
  catalogMap: Map<string, MediaCatalogEntry>;
  characterMap: Map<string, CharacterEntry>;
  customImageMap: Map<string, FavoriteCustomImage>;
  reorderModeActive: boolean;
  readOnly: boolean;
  isCrowned: boolean;
  onToggleCrown: (id: string) => void;
  onRemove: (id: string, type: string) => void;
  onEditImage: (item: FavItem) => void;
}

const MemoizedFavCard = memo(function FavCard({
  item,
  idx,
  catalogMap,
  characterMap,
  customImageMap,
  reorderModeActive,
  readOnly,
  isCrowned,
  onToggleCrown,
  onRemove,
  onEditImage,
}: FavCardProps) {
  const title = item.type === 'character'
    ? (characterMap.get(item.external_id)?.name ?? item.external_id)
    : (catalogMap.get(item.external_id)?.title_main ?? item.external_id);
  const rawCover = item.type === 'character'
    ? (characterMap.get(item.external_id)?.image_url ?? '')
    : (catalogMap.get(item.external_id)?.cover_url ?? '');
  const customImg = customImageMap.get(item.external_id);
  const mediaUrl = item.type === 'character'
    ? `/character?id=${item.external_id.replace('character:', '')}`
    : `/media?id=${encodeURIComponent(item.external_id)}`;

  return (
    <div className={`fav-card ${reorderModeActive ? 'reordering' : ''}`} data-id={item.external_id} draggable={reorderModeActive && !readOnly}>
      <a className="fav-card-link" href={mediaUrl} draggable={false} />
      <div className="fav-badge">#{idx + 1}</div>

      {!readOnly && (
        <div className="fav-card-icons">
          <div className="fav-card-icons-row">
            {item.type !== 'character' && (
              <button
                type="button"
                className={`fav-crown-btn ${isCrowned ? 'active' : ''}`}
                title="Multimedia"
                onClick={e => { e.stopPropagation(); onToggleCrown(item.external_id); }}
                dangerouslySetInnerHTML={{ __html: isCrowned ? CROWN_ICON_ON : CROWN_ICON_OFF }}
              />
            )}
            <button
              type="button"
              className="fav-remove-btn"
              title="Eliminar"
              onClick={e => { e.stopPropagation(); e.preventDefault(); onRemove(item.external_id, item.type); }}
              dangerouslySetInnerHTML={{ __html: REMOVE_ICON }}
            />
          </div>
          <button
            type="button"
            className="fav-edit-image-btn"
            title="Editar imagen"
            onClick={e => { e.stopPropagation(); e.preventDefault(); onEditImage(item); }}
            dangerouslySetInnerHTML={{ __html: EDIT_IMAGE_ICON }}
          />
        </div>
      )}

      {customImg ? (
        <div
          className="fav-cover-wrap fav-cover-wrap--custom"
          style={{
            backgroundImage: `url('${wrapAssetUrl(customImg.image_url)}')`,
            backgroundSize: `${customImg.bg_size}% auto`,
            backgroundPosition: `${customImg.pos_x}% ${customImg.pos_y}%`,
          }}
        />
      ) : rawCover ? (
        <img className="fav-cover" src={wrapAssetUrl(rawCover)} alt={title} loading="lazy" decoding="async" draggable={false} />
      ) : (
        <div className="fav-no-cover"><span>{title.slice(0, 2).toUpperCase()}</span></div>
      )}
      <div className="fav-overlay">
        <span className="fav-title">{title}</span>
      </div>
    </div>
  );
});

interface Props {
  // Someone else's profile (UserProfileView) already has the mapped
  // library, the viewer's own catalogMap/characterMap, and the full synced
  // favData (profile-sync.ts sends the whole readUserFavorites() record,
  // every per-type key included, not just multimedia/character) in hand —
  // passing them in skips this component's own local-only fetch and the
  // is_favorite-reconciliation write below (which would be both wrong and
  // pointless against someone else's data). readOnly hides every crown/
  // remove/edit-image/reorder affordance — custom crop images aren't
  // synced either, so covers always show the plain, uncropped version.
  overrideItems?: Items;
  overrideCatalogMap?: Map<string, MediaCatalogEntry>;
  overrideCharacterMap?: Map<string, CharacterEntry>;
  overrideFavData?: FavData;
  readOnly?: boolean;
}

export function FavoritesSection({ overrideItems, overrideCatalogMap, overrideCharacterMap, overrideFavData, readOnly }: Props = {}) {
  const t = getT();
  const p = t.profile;
  const s = t.search.types;

  const [items, setItems] = useState<Items | null>(overrideItems ?? null);
  const [catalogMap, setCatalogMap] = useState<Map<string, MediaCatalogEntry>>(overrideCatalogMap ?? new Map());
  const [characterMap, setCharacterMap] = useState<Map<string, CharacterEntry>>(overrideCharacterMap ?? new Map());
  const [customImageMap, setCustomImageMap] = useState<Map<string, FavoriteCustomImage>>(new Map());
  const [favData, setFavData] = useState<FavData>(overrideFavData ?? {});
  const [activeCatKey, setActiveCatKey] = useState('multimedia');
  const [reorderModeActive, setReorderModeActive] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const favDataRef = useRef(favData);
  favDataRef.current = favData;
  const activeCatKeyRef = useRef(activeCatKey);
  activeCatKeyRef.current = activeCatKey;

  useEffect(() => {
    if (overrideItems) return;
    let cancelled = false;

    const load = async () => {
      const [{ items: libItems, catalog: catalogEntries }, characterEntries, customImages, rawFavData] = await Promise.all([
        getCachedLibraryAndCatalog(),
        getAllCharacters().catch(err => {
          console.error('[Favorites] Failed to load characters — is the Tauri backend rebuilt?', err);
          return [] as CharacterEntry[];
        }),
        getAllFavoriteCustomImages().catch(() => [] as FavoriteCustomImage[]),
        readUserFavorites().catch(() => ({} as FavData)),
      ]);
      if (cancelled) return;

      const cMap = new Map(catalogEntries.map(e => [e.external_id, e]));

      // 'multimedia' is a synthetic aggregate bucket (not a real media type)
      // on top of every type in ALL_MEDIA_TYPES — kept as one source of
      // truth so a new media type doesn't silently leave favData[type]
      // undefined here again.
      const favKeys = ['multimedia', ...ALL_MEDIA_TYPES];
      let modified = false;
      for (const k of favKeys) {
        if (!rawFavData[k]) { rawFavData[k] = []; modified = true; }
      }
      for (const item of libItems) {
        const type = item.type || 'book';
        if (item.is_favorite === 1) {
          if (!rawFavData[type].includes(item.external_id)) { rawFavData[type].push(item.external_id); modified = true; }
        } else {
          if (rawFavData[type].includes(item.external_id)) { rawFavData[type] = rawFavData[type].filter(id => id !== item.external_id); modified = true; }
          if (rawFavData.multimedia.includes(item.external_id)) { rawFavData.multimedia = rawFavData.multimedia.filter(id => id !== item.external_id); modified = true; }
        }
      }
      if (modified) await writeUserFavorites(rawFavData).catch(err => console.error('Failed to persist favorites reorder:', err));

      setItems(libItems);
      setCatalogMap(cMap);
      setCharacterMap(new Map(characterEntries.map(c => [c.external_id, c])));
      setCustomImageMap(new Map(customImages.map(c => [c.external_id, c])));
      setFavData(rawFavData);
    };

    load();

    // Fired by saveLibraryEntry (see LibrarySection.tsx's own listener) after
    // a save/delete — MediaEditorModal's favorite toggle goes through the
    // same save path, but this component had no listener of its own, so a
    // newly-favorited item never showed up here until the page was reloaded.
    window.addEventListener('refresh-profile-library', load);
    return () => {
      cancelled = true;
      window.removeEventListener('refresh-profile-library', load);
    };
  }, [overrideItems]);

  const getOrderedItems = (catKey: string): FavItem[] => {
    const ids = favData[catKey] || [];
    if (catKey === 'character') return ids.map(id => ({ external_id: id, type: 'character' }));
    return ids.map(id => {
      const local = items?.find(item => item.external_id === id);
      if (local) return local;
      const meta = catalogMap.get(id);
      if (meta) return { external_id: id, type: meta.type };
      return null;
    }).filter((i): i is FavItem => i !== null);
  };

  const categories = useMemo(() => [
    { key: 'multimedia', label: p.favorites_multimedia || 'Multimedia', icon: MULTIMEDIA_TAB_ICON },
    { key: 'anime', label: s.anime, icon: TYPE_ICON['anime'] },
    { key: 'manga', label: s.manga, icon: TYPE_ICON['manga'] },
    { key: 'game', label: s.game, icon: TYPE_ICON['game'] },
    { key: 'vnovel', label: s.vnovel, icon: TYPE_ICON['vnovel'] },
    { key: 'lnovel', label: s.lnovel, icon: TYPE_ICON['lnovel'] },
    { key: 'series', label: s.series, icon: TYPE_ICON['series'] },
    { key: 'movie', label: s.movie, icon: TYPE_ICON['movie'] },
    { key: 'book', label: s.book, icon: TYPE_ICON['book'] },
    { key: 'character', label: s.character || 'Personajes', icon: CHARACTER_TAB_ICON },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [p, s]);

  // Persists favData both to React state and to disk in one place, since
  // nearly every handler below does exactly this.
  const persistFavData = async (next: FavData) => {
    setFavData(next);
    await writeUserFavorites(next).catch(err => console.error('Failed to persist favorites:', err));
  };

  const toggleCrown = async (id: string) => {
    const next = { ...favData, multimedia: [...(favData.multimedia || [])] };
    if (next.multimedia.includes(id)) next.multimedia = next.multimedia.filter(x => x !== id);
    else next.multimedia.push(id);
    await persistFavData(next);
  };

  const removeFavorite = async (id: string, type: string) => {
    const next: FavData = { ...favData };
    if (type === 'character') {
      next.character = (favData.character || []).filter(x => x !== id);
    } else {
      const entry = items?.find(i => i.external_id === id);
      if (entry) {
        entry.is_favorite = 0;
        await saveLibraryEntry(entry).catch(console.error);
      }
      next[type] = (favData[type] || []).filter(x => x !== id);
    }
    next.multimedia = (favData.multimedia || []).filter(x => x !== id);
    await persistFavData(next);
  };

  const editImage = async (item: FavItem) => {
    const rawCover = item.type === 'character'
      ? (characterMap.get(item.external_id)?.image_url ?? '')
      : (catalogMap.get(item.external_id)?.cover_url ?? '');

    const result = await openFavoriteImageEditor(item.external_id, rawCover, customImageMap.get(item.external_id));
    if (result.action === 'cancelled') return;
    setCustomImageMap(prev => {
      const next = new Map(prev);
      if (result.action === 'saved') next.set(item.external_id, result.image);
      else next.delete(item.external_id);
      return next;
    });
  };

  // Native HTML5 drag & drop (same approach as Lists' item reorder,
  // ListsSection.tsx) — the browser/OS renders the drag ghost that tracks
  // the cursor, entirely outside our own render loop, so it can't stutter.
  // Cards stay draggable={true} only while reorderModeActive (the "edit
  // mode" toggle below), which also keeps its own wiggle animation
  // (.fav-card.reordering, profile.css) untouched — that's a permanent
  // visual while edit mode is on, independent of whether a drag is
  // actually in progress.
  useEffect(() => {
    if (readOnly || !reorderModeActive) return;
    const container = gridRef.current;
    if (!container) return;

    let dragCard: HTMLElement | null = null;
    let didMove = false;

    type CardRect = { el: HTMLElement; cx: number; cy: number; left: number; width: number };
    let rectCache: CardRect[] = [];

    const refreshRectCache = () => {
      rectCache = Array.from(container.querySelectorAll('.fav-card:not(.drag-source)')).map(cardEl => {
        const r = (cardEl as HTMLElement).getBoundingClientRect();
        return { el: cardEl as HTMLElement, cx: r.left + r.width / 2, cy: r.top + r.height / 2, left: r.left, width: r.width };
      });
    };

    const getClosestCard = (clientX: number, clientY: number): CardRect | null => {
      let closest: CardRect | null = null;
      let closestDist = Infinity;
      for (const entry of rectCache) {
        const dist = Math.hypot(clientX - entry.cx, clientY - entry.cy);
        if (dist < closestDist) { closestDist = dist; closest = entry; }
      }
      return closest;
    };

    let rafId = 0;
    let pendingEvent: DragEvent | null = null;
    let lastMoveX = 0;
    let prevMoveX = 0;

    // Which side of the target card the dragged card lands on is decided by
    // the direction of travel, not a static 50/50 split — self-stabilizing,
    // avoids the oscillation flicker a fixed midpoint check causes.
    const reorderTick = () => {
      rafId = 0;
      if (!dragCard || !pendingEvent) return;
      lastMoveX = pendingEvent.clientX;
      const target = getClosestCard(pendingEvent.clientX, pendingEvent.clientY);
      if (target && target.el !== dragCard) {
        const movingRight = lastMoveX >= prevMoveX;
        const midpoint = target.left + target.width / 2;
        const passedMidpoint = movingRight ? lastMoveX > midpoint : lastMoveX < midpoint;
        if (passedMidpoint) {
          didMove = true;
          if (movingRight) container.insertBefore(dragCard, target.el.nextSibling);
          else container.insertBefore(dragCard, target.el);
          refreshRectCache();
        }
      }
      prevMoveX = lastMoveX;
    };

    const onDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.fav-crown-btn')) { e.preventDefault(); return; } // ignore drags starting on the crown button

      const card = target.closest<HTMLElement>('.fav-card');
      if (!card || !container.contains(card)) { e.preventDefault(); return; }

      dragCard = card;
      prevMoveX = e.clientX;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id ?? '');
      }
      // Dim the source a frame later — the browser snapshots the drag
      // ghost synchronously, so dimming it right away would fade the ghost
      // that follows the cursor too.
      requestAnimationFrame(() => card.classList.add('drag-source'));
      container.classList.add('is-dragging');
      refreshRectCache();
    };

    const onDragOver = (e: DragEvent) => {
      if (!dragCard) return;
      e.preventDefault(); // required for this to be a valid drop target
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      pendingEvent = e;
      if (!rafId) rafId = requestAnimationFrame(reorderTick);
    };

    const finishDrag = async () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      pendingEvent = null;
      if (!dragCard) return;

      dragCard.classList.remove('drag-source');
      container.classList.remove('is-dragging');
      dragCard = null;
      const moved = didMove;
      didMove = false;
      if (!moved) return;

      const newOrder = Array.from(container.querySelectorAll('.fav-card'))
        .map(c => (c as HTMLElement).dataset.id)
        .filter(Boolean) as string[];
      const next = { ...favDataRef.current, [activeCatKeyRef.current]: newOrder };
      await persistFavData(next);
    };

    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      finishDrag();
    };

    // Fires whether the drag ended on a valid drop target or not (e.g.
    // released outside the grid) — always cleans up either way.
    const onDragEnd = () => finishDrag();

    container.addEventListener('dragstart', onDragStart);
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('drop', onDrop);
    container.addEventListener('dragend', onDragEnd);
    return () => {
      container.removeEventListener('dragstart', onDragStart);
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('drop', onDrop);
      container.removeEventListener('dragend', onDragEnd);
      if (rafId) cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reorderModeActive, activeCatKey]);

  if (items === null) return null;

  const cat = categories.find(c => c.key === activeCatKey) || categories[0];
  const catItems = getOrderedItems(activeCatKey);

  return (
    <div className="fav-layout">
      <div className="fav-tabs-row">
        <div className="fav-tabs">
          {categories.map(c => {
            const count = getOrderedItems(c.key).length;
            return (
              <button
                key={c.key}
                type="button"
                className={`fav-tab-btn ${c.key === activeCatKey ? 'active' : ''}`}
                onClick={() => setActiveCatKey(c.key)}
              >
                <span dangerouslySetInnerHTML={{ __html: c.icon }} />
                <span>{c.label}</span>
                {count > 0 && <span className="fav-tab-count">{count}</span>}
              </button>
            );
          })}
        </div>
        {!readOnly && (
          <button
            type="button"
            className={`fav-tab-btn fav-reorder-btn ${reorderModeActive ? 'active' : ''}`}
            title={p.reorder}
            onClick={() => setReorderModeActive(a => !a)}
            dangerouslySetInnerHTML={{ __html: REORDER_ICON }}
          />
        )}
      </div>
      <div className="fav-grid-container">
        {catItems.length > 0 ? (
          <div className="fav-grid" ref={gridRef} key={activeCatKey}>
            {catItems.map((item, idx) => {
              const isCrowned = Boolean(favData.multimedia?.includes(item.external_id));
              return (
                <MemoizedFavCard
                  key={item.external_id}
                  item={item}
                  idx={idx}
                  catalogMap={catalogMap}
                  characterMap={characterMap}
                  customImageMap={customImageMap}
                  reorderModeActive={reorderModeActive}
                  readOnly={readOnly}
                  isCrowned={isCrowned && activeCatKey !== 'multimedia'}
                  onToggleCrown={toggleCrown}
                  onRemove={removeFavorite}
                  onEditImage={editImage}
                />
              );
            })}
          </div>
        ) : (
          <div className="fav-empty-state">
            <span dangerouslySetInnerHTML={{ __html: EMPTY_ICON }} />
            <h3 className="fav-empty-title">{cat.label}</h3>
            <p className="fav-empty-text">{p.empty_favorites}</p>
          </div>
        )}
      </div>
    </div>
  );
}
