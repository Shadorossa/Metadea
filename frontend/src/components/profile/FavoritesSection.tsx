import { useEffect, useMemo, useState, memo } from 'react';
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Crown, Star, Image as ImageIcon, Shuffle } from 'lucide-react';
import { getAllLibraryEntries, getAllCharactersLight, getAllFavoriteCustomImages, readUserFavoritesTyped, writeUserFavorites, wrapAssetUrl, saveLibraryEntry } from '../../lib/tauri';
import type { CatalogSummary, FavoriteCustomImage, CharacterEntry } from '../../lib/tauri';
import { getT } from '../../i18n/runtime';
import { showToast } from '../../lib/dom/toast';
import { typeIconMap } from '../../lib/dom/icon-strings';
import { openFavoriteImageEditor } from './mount/favorite-image-editor';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { ALL_MEDIA_TYPES } from '../../lib/media/media-types';
import { IconCharacter, IconX } from '../local/ui/icons';
import { toMediumCover } from '../../lib/media/small-cover';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type FavData = Record<string, string[]>;

// Per-media-type tab icons (anime/manga/game/...) still come from
// icon-strings.ts's typeIconMap rather than lucide-react directly — that
// module is the single source shared with the plain-HTML .astro pages
// (settings tabs, etc.), which can't render React/lucide components at all.
// Everything below this line WAS its own local hand-drawn <svg>-as-string
// (rendered via dangerouslySetInnerHTML) with no such cross-framework
// constraint, so those are real React icons now instead.
const TYPE_ICON = typeIconMap(16);

interface FavItem { external_id: string; type: string; }

interface FavCardDisplay { title: string; rawCover: string; customImg?: FavoriteCustomImage; mediaUrl: string }

// Pure derivation from an item + the viewer's own maps — shared between the
// live sortable card and its DragOverlay preview, same reasoning as
// ListsSection.tsx's resolveListItemDisplay.
function resolveFavCardDisplay(
  item: FavItem, catalogMap: Map<string, CatalogSummary>, characterMap: Map<string, CharacterEntry>,
  customImageMap: Map<string, FavoriteCustomImage>,
): FavCardDisplay {
  const title = item.type === 'character'
    ? (characterMap.get(item.external_id)?.name ?? item.external_id)
    : (catalogMap.get(item.external_id)?.title_main ?? item.external_id);
  const rawCover = item.type === 'character'
    ? (characterMap.get(item.external_id)?.image_url ?? '')
    : toMediumCover(catalogMap.get(item.external_id)?.cover_url ?? '');
  const mediaUrl = item.type === 'character'
    ? `/character?id=${item.external_id.replace('character:', '')}`
    : `/media?id=${encodeURIComponent(item.external_id)}`;
  return { title, rawCover, customImg: customImageMap.get(item.external_id), mediaUrl };
}

// Everything inside the card except the sortable wrapper div — shared
// between the live grid card (real drag listeners) and the DragOverlay
// clone (a plain floating visual, no listeners of its own).
function FavCardBody({ item, idx, display, isCrowned, readOnly, onToggleCrown, onRemove, onEditImage }: {
  item: FavItem;
  idx: number;
  display: FavCardDisplay;
  isCrowned: boolean;
  readOnly: boolean;
  onToggleCrown: (id: string) => void;
  onRemove: (id: string, type: string) => void;
  onEditImage: (item: FavItem) => void;
}) {
  const { title, rawCover, customImg, mediaUrl } = display;
  const p = getT().profile;
  return (
    <>
      <a className="fav-card-link" href={mediaUrl} draggable={false} />
      <div className="fav-badge">#{idx + 1}</div>

      {!readOnly && (
        <div className="fav-card-icons">
          <div className="fav-card-icons-row">
            {item.type !== 'character' && (
              <button
                type="button"
                className={`fav-crown-btn ${isCrowned ? 'active' : ''}`}
                title={p.favorites_multimedia}
                onClick={e => { e.stopPropagation(); onToggleCrown(item.external_id); }}
              >
                <Crown size={13} strokeWidth={2} color={isCrowned ? '#fbbf24' : 'currentColor'} fill={isCrowned ? '#fbbf24' : 'none'} />
              </button>
            )}
            <button
              type="button"
              className="fav-remove-btn"
              title={p.favorites_remove}
              onClick={e => { e.stopPropagation(); e.preventDefault(); onRemove(item.external_id, item.type); }}
            >
              <IconX size={11} strokeWidth={2.5} />
            </button>
          </div>
          <button
            type="button"
            className="fav-edit-image-btn"
            title={getT().character.edit_image}
            onClick={e => { e.stopPropagation(); e.preventDefault(); onEditImage(item); }}
          >
            <ImageIcon size={12} strokeWidth={2} />
          </button>
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
    </>
  );
}

interface FavCardProps {
  item: FavItem;
  idx: number;
  catalogMap: Map<string, CatalogSummary>;
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
  item, idx, catalogMap, characterMap, customImageMap, reorderModeActive, readOnly, isCrowned,
  onToggleCrown, onRemove, onEditImage,
}: FavCardProps) {
  // PointerSensor's own activation distance (see FavoritesSection's
  // dndSensors) is what used to be the old native-DnD implementation's
  // `target.closest('.fav-crown-btn, ...')` check in handleDragStart — a
  // plain click on one of those buttons never crosses that distance, so it
  // never starts a drag and the button's own onClick still fires normally,
  // without needing to special-case those elements by hand.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.external_id,
    disabled: !reorderModeActive || readOnly,
  });
  const display = resolveFavCardDisplay(item, catalogMap, characterMap, customImageMap);

  return (
    <div
      ref={setNodeRef}
      className={`fav-card ${reorderModeActive ? 'reordering' : ''}${isDragging ? ' drag-source' : ''}`}
      data-id={item.external_id}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      <FavCardBody
        item={item} idx={idx} display={display} isCrowned={isCrowned} readOnly={readOnly}
        onToggleCrown={onToggleCrown} onRemove={onRemove} onEditImage={onEditImage}
      />
    </div>
  );
});

interface Props {
  // Someone else's profile (UserProfileView) already has the mapped
  // library, the viewer's own catalogMap/characterMap, and the full synced
  // favData (profile-sync.ts sends the whole readUserFavoritesTyped() record,
  // every per-type key included, not just multimedia/character) in hand —
  // passing them in skips this component's own local-only fetch and the
  // is_favorite-reconciliation write below (which would be both wrong and
  // pointless against someone else's data). readOnly hides every crown/
  // remove/edit-image/reorder affordance — custom crop images aren't
  // synced either, so covers always show the plain, uncropped version.
  overrideItems?: Items;
  overrideCatalogMap?: Map<string, CatalogSummary>;
  overrideCharacterMap?: Map<string, CharacterEntry>;
  overrideFavData?: FavData;
  readOnly?: boolean;
}

export function FavoritesSection({ overrideItems, overrideCatalogMap, overrideCharacterMap, overrideFavData, readOnly }: Props = {}) {
  const t = getT();
  const p = t.profile;
  const s = t.search.types;

  const [items, setItems] = useState<Items | null>(overrideItems ?? null);
  const [catalogMap, setCatalogMap] = useState<Map<string, CatalogSummary>>(overrideCatalogMap ?? new Map());
  const [characterMap, setCharacterMap] = useState<Map<string, CharacterEntry>>(overrideCharacterMap ?? new Map());
  const [customImageMap, setCustomImageMap] = useState<Map<string, FavoriteCustomImage>>(new Map());
  const [favData, setFavData] = useState<FavData>(overrideFavData ?? {});
  const [activeCatKey, setActiveCatKey] = useState('multimedia');
  const [reorderModeActive, setReorderModeActive] = useState(false);

  useEffect(() => {
    if (overrideItems) return;
    let cancelled = false;

    const load = async () => {
      // A failed favourites read must never be "repaired" below: the
      // reconcile loop rebuilds each per-type list from library flags, but the
      // cross-type 'multimedia' order has no other source, so persisting a
      // fallback object wipes it. Render the fallback, skip the write.
      let favReadFailed = false;
      const [{ items: libItems, catalog: catalogEntries }, characterEntries, customImages, rawFavData] = await Promise.all([
        getCachedLibraryAndCatalog(),
        getAllCharactersLight().catch(err => {
          console.error('[Favorites] Failed to load characters — is the Tauri backend rebuilt?', err);
          return [] as CharacterEntry[];
        }),
        getAllFavoriteCustomImages().catch(() => [] as FavoriteCustomImage[]),
        readUserFavoritesTyped().catch(err => {
          console.error('[Favorites] Failed to read favourites; not persisting this session', err);
          favReadFailed = true;
          return {} as FavData;
        }),
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
      if (modified && !favReadFailed) await writeUserFavorites(rawFavData).catch(err => console.error('Failed to persist favorites reorder:', err));

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

  // Every tab's ordered items, resolved once per favData/library/catalog
  // change — the tab strip reads all ten counts on every render, and each
  // favourite used to be an items.find() scan of the whole library.
  const itemsById = useMemo(() => new Map((items ?? []).map(item => [item.external_id, item])), [items]);
  const orderedItemsByCategory = useMemo(() => {
    const byCategory = new Map<string, FavItem[]>();
    for (const [catKey, ids] of Object.entries(favData)) {
      if (!ids) continue;
      if (catKey === 'character') {
        byCategory.set(catKey, ids.map(id => ({ external_id: id, type: 'character' })));
        continue;
      }
      byCategory.set(catKey, ids.map(id => {
        const local = itemsById.get(id);
        if (local) return local;
        const meta = catalogMap.get(id);
        if (meta) return { external_id: id, type: meta.type };
        return null;
      }).filter((i): i is FavItem => i !== null));
    }
    return byCategory;
  }, [favData, itemsById, catalogMap]);
  const getOrderedItems = (catKey: string): FavItem[] => orderedItemsByCategory.get(catKey) ?? [];

  const categories = useMemo(() => [
    { key: 'multimedia', label: p.favorites_multimedia || 'Multimedia', icon: <Star size={14} strokeWidth={2} /> },
    { key: 'anime', label: s.anime, icon: <span dangerouslySetInnerHTML={{ __html: TYPE_ICON['anime'] }} /> },
    { key: 'manga', label: s.manga, icon: <span dangerouslySetInnerHTML={{ __html: TYPE_ICON['manga'] }} /> },
    { key: 'game', label: s.game, icon: <span dangerouslySetInnerHTML={{ __html: TYPE_ICON['game'] }} /> },
    { key: 'vnovel', label: s.vnovel, icon: <span dangerouslySetInnerHTML={{ __html: TYPE_ICON['vnovel'] }} /> },
    { key: 'lnovel', label: s.lnovel, icon: <span dangerouslySetInnerHTML={{ __html: TYPE_ICON['lnovel'] }} /> },
    { key: 'series', label: s.series, icon: <span dangerouslySetInnerHTML={{ __html: TYPE_ICON['series'] }} /> },
    { key: 'movie', label: s.movie, icon: <span dangerouslySetInnerHTML={{ __html: TYPE_ICON['movie'] }} /> },
    { key: 'book', label: s.book, icon: <span dangerouslySetInnerHTML={{ __html: TYPE_ICON['book'] }} /> },
    { key: 'character', label: s.character || 'Personajes', icon: <IconCharacter size={14} strokeWidth={2} /> },
     
  ], [p, s]);

  // Persists favData both to React state and to disk in one place, since
  // nearly every handler below does exactly this.
  const persistFavData = async (next: FavData) => {
    const previous = favData;
    setFavData(next);
    try {
      await writeUserFavorites(next);
    } catch (err) {
      console.error('Failed to persist favorites:', err);
      // The optimistic update above would otherwise show a list the
      // database never accepted.
      setFavData(previous);
      showToast(p.favorites_save_failed);
    }
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
        try {
          await saveLibraryEntry(entry);
        } catch (err) {
          // is_favorite on the library row and the favourites list are two
          // stores for one fact; dropping the list entry after this write
          // failed would leave them disagreeing.
          console.error('Failed to clear is_favorite:', err);
          entry.is_favorite = 1;
          showToast(p.favorites_save_failed);
          return;
        }
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

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const handleDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id));

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const list = [...(favData[activeCatKey] || [])];
    const oldIndex = list.indexOf(String(active.id));
    const newIndex = list.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    persistFavData({ ...favData, [activeCatKey]: arrayMove(list, oldIndex, newIndex) });
  };

  if (items === null) return null;

  const cat = categories.find(c => c.key === activeCatKey) || categories[0];
  const catItems = getOrderedItems(activeCatKey);
  const activeDragItem = activeDragId ? catItems.find(i => i.external_id === activeDragId) ?? null : null;

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
                {c.icon}
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
          >
            <Shuffle size={16} strokeWidth={2} />
          </button>
        )}
      </div>
      <div className="fav-grid-container">
        {catItems.length > 0 ? (
          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDragId(null)}
          >
            <SortableContext items={catItems.map(i => i.external_id)} strategy={rectSortingStrategy}>
              <div className={`fav-grid${activeDragId ? ' is-dragging' : ''}`} key={activeCatKey}>
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
                      readOnly={Boolean(readOnly)}
                      isCrowned={isCrowned && activeCatKey !== 'multimedia'}
                      onToggleCrown={toggleCrown}
                      onRemove={removeFavorite}
                      onEditImage={editImage}
                    />
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeDragItem && (
                <div className="fav-card fav-card--overlay">
                  <FavCardBody
                    item={activeDragItem}
                    idx={catItems.findIndex(i => i.external_id === activeDragItem.external_id)}
                    display={resolveFavCardDisplay(activeDragItem, catalogMap, characterMap, customImageMap)}
                    isCrowned={Boolean(favData.multimedia?.includes(activeDragItem.external_id)) && activeCatKey !== 'multimedia'}
                    readOnly={Boolean(readOnly)}
                    onToggleCrown={toggleCrown}
                    onRemove={removeFavorite}
                    onEditImage={editImage}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        ) : (
          <div className="fav-empty-state">
            <Star className="fav-empty-icon" size={48} strokeWidth={1.5} />
            <h3 className="fav-empty-title">{cat.label}</h3>
            <p className="fav-empty-text">{p.empty_favorites}</p>
          </div>
        )}
      </div>
    </div>
  );
}
