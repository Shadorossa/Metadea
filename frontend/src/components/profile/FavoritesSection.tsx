import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { motion } from 'motion/react';
import { Crown, Star, Image as ImageIcon, Shuffle } from 'lucide-react';
import { getAllLibraryEntries, getAllCharacters, getAllFavoriteCustomImages, readUserFavorites, writeUserFavorites, wrapAssetUrl, saveLibraryEntry } from '../../lib/tauri';
import type { MediaCatalogEntry, FavoriteCustomImage, CharacterEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { typeIconMap } from '../../lib/shared/icon-strings';
import { openFavoriteImageEditor } from '../../lib/profile/favorite-image-editor';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { ALL_MEDIA_TYPES } from '../../lib/constants/media';
import { IconCharacter, IconX } from '../local/ui/icons';

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

interface FavCardProps {
  item: FavItem;
  idx: number;
  catalogMap: Map<string, MediaCatalogEntry>;
  characterMap: Map<string, CharacterEntry>;
  customImageMap: Map<string, FavoriteCustomImage>;
  reorderModeActive: boolean;
  readOnly: boolean;
  isCrowned: boolean;
  isDragging?: boolean;
  onToggleCrown: (id: string) => void;
  onRemove: (id: string, type: string) => void;
  onEditImage: (item: FavItem) => void;
  onDragStart?: (e: React.DragEvent, idx: number) => void;
  onDragOver?: (e: React.DragEvent, idx: number) => void;
  onDragEnd?: () => void;
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
  isDragging,
  onToggleCrown,
  onRemove,
  onEditImage,
  onDragStart,
  onDragOver,
  onDragEnd,
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
    <motion.div
      layout
      transition={{ type: 'spring', damping: 25, stiffness: 350 }}
      className={`fav-card ${reorderModeActive ? 'reordering' : ''}${isDragging ? ' drag-source' : ''}`}
      data-id={item.external_id}
      draggable={reorderModeActive && !readOnly}
      onDragStart={(e: any) => onDragStart?.(e, idx)}
      onDragOver={(e: any) => onDragOver?.(e, idx)}
      onDragEnd={() => onDragEnd?.()}
    >
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
              >
                <Crown size={13} strokeWidth={2} color={isCrowned ? '#fbbf24' : 'currentColor'} fill={isCrowned ? '#fbbf24' : 'none'} />
              </button>
            )}
            <button
              type="button"
              className="fav-remove-btn"
              title="Eliminar"
              onClick={e => { e.stopPropagation(); e.preventDefault(); onRemove(item.external_id, item.type); }}
            >
              <IconX size={11} strokeWidth={2.5} />
            </button>
          </div>
          <button
            type="button"
            className="fav-edit-image-btn"
            title="Editar imagen"
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
    </motion.div>
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

  const dragIndexRef = useRef<number | null>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [isDraggingActive, setIsDraggingActive] = useState(false);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    if (readOnly || !reorderModeActive) return;
    const target = e.target as HTMLElement;
    if (target.closest('.fav-crown-btn, .fav-remove-btn, .fav-edit-image-btn')) {
      e.preventDefault();
      return;
    }
    dragIndexRef.current = idx;
    setDraggedIdx(idx);
    setIsDraggingActive(true);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    }
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    if (dragIndexRef.current === null || dragIndexRef.current === idx) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const from = dragIndexRef.current;
    const to = idx;
    dragIndexRef.current = to;
    setDraggedIdx(to);
    setFavData(prev => {
      const list = [...(prev[activeCatKey] || [])];
      if (from < 0 || from >= list.length || to < 0 || to >= list.length) return prev;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return { ...prev, [activeCatKey]: list };
    });
  };

  const handleDragEnd = async () => {
    dragIndexRef.current = null;
    setDraggedIdx(null);
    setIsDraggingActive(false);
    await persistFavData(favDataRef.current);
  };

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
          <div className={`fav-grid${isDraggingActive ? ' is-dragging' : ''}`} ref={gridRef} key={activeCatKey}>
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
                  isDragging={draggedIdx === idx}
                  onToggleCrown={toggleCrown}
                  onRemove={removeFavorite}
                  onEditImage={editImage}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                />
              );
            })}
          </div>
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
