import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Unlink2, Trash2 } from 'lucide-react';
import { getStoryArcsForMedia, saveStoryArc, reorderStoryArcs, deleteStoryArc, type StoryArc, type StoryArcItem } from '../../../lib/tauri/story-arcs';
import { getCatalogEntry, getMediaRelationsForEditor } from '../../../lib/tauri/catalog';
import { fetchMediaEpisodes } from '../../../lib/media/episode-list';
import type { MediaEpisode } from '../../../lib/tauri';
import { openImageCropModal } from '../../shared/ImageCropModal';
import { MediaSearchPopup } from '../MediaSearchPopup';
import type { SearchResult as ApiSearchResult } from '../../../lib/search';
import { getT } from '../../../i18n/client';

interface EditingItem {
  media_external_id: string;
  title: string;
  cover: string | null;
  ep_start: number | null;
  ep_end: number | null;
  group_id?: string | null;
}

interface EditingArc {
  id: string;
  name: string;
  imageBase64: string | null;
  items: EditingItem[];
}

interface DisplayUnit {
  id: string;
  isGroup: boolean;
  groupId: string | null;
  items: EditingItem[];
}

interface UnifiedEpisode {
  generalEpNumber: number;
  seasonEpNumber: number;
  mediaExternalId: string;
  mediaTitle: string;
  name: string | null;
  coverUrl: string | null;
}

interface Props {
  externalId: string;
  currentTitle: string;
  currentCover: string | null;
  sagaOrder: string[];
  resolveSagaMeta: (id: string) => { title: string | null; cover: string | null };
  onArcDeleted?: (arcId: string) => void;
}

function formatRange(item: Pick<StoryArcItem, 'ep_start' | 'ep_end'>): string {
  if (item.ep_start != null && item.ep_end != null) return `${item.ep_start}-${item.ep_end}`;
  if (item.ep_start != null) return `${item.ep_start}+`;
  return '';
}

function buildDisplayUnits(items: EditingItem[], sagaOrder: string[] = []): DisplayUnit[] {
  const units: DisplayUnit[] = [];
  const visited = new Set<number>();

  for (let i = 0; i < items.length; i++) {
    if (visited.has(i)) continue;
    const item = items[i];

    if (item.group_id) {
      const groupItems: EditingItem[] = [];
      for (let j = 0; j < items.length; j++) {
        if (items[j].group_id === item.group_id) {
          visited.add(j);
          groupItems.push(items[j]);
        }
      }
      if (sagaOrder.length > 1) {
        groupItems.sort((a, b) => {
          const idxA = sagaOrder.indexOf(a.media_external_id);
          const idxB = sagaOrder.indexOf(b.media_external_id);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return 0;
        });
      }
      units.push({
        id: item.group_id,
        isGroup: groupItems.length > 1,
        groupId: item.group_id,
        items: groupItems,
      });
    } else {
      visited.add(i);
      units.push({
        id: item.media_external_id,
        isGroup: false,
        groupId: null,
        items: [item],
      });
    }
  }

  return units;
}

function canGroupUnits(u1: DisplayUnit | undefined, u2: DisplayUnit | undefined, sagaOrder: string[]): boolean {
  if (!u1 || !u2 || !sagaOrder || sagaOrder.length <= 1) return false;
  return u1.items.every(i => sagaOrder.includes(i.media_external_id)) &&
         u2.items.every(i => sagaOrder.includes(i.media_external_id));
}

export function PrEditorStoryArcsSection({ externalId, currentTitle, currentCover, sagaOrder, resolveSagaMeta, onArcDeleted }: Props) {
  const t = getT().pr_editor.story_arcs;
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  const [metaById, setMetaById] = useState<Record<string, { title: string; cover: string | null }>>({});
  const [editingArc, setEditingArc] = useState<EditingArc | null>(null);
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [showSagaPicker, setShowSagaPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Episodes cache for anime/series items
  const [episodesMap, setEpisodesMap] = useState<Record<string, MediaEpisode[]>>({});
  const [activePopoverUnitId, setActivePopoverUnitId] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Drag and drop state
  const [draggedUnitIdx, setDraggedUnitIdx] = useState<number | null>(null);
  const [dropTargetUnitIdx, setDropTargetUnitIdx] = useState<number | null>(null);
  const [dropTargetMode, setDropTargetMode] = useState<'before' | 'after' | 'group' | null>(null);

  function resolveMeta(id: string): { title: string; cover: string | null } {
    if (id === externalId) return { title: currentTitle, cover: currentCover };
    return metaById[id] ?? { title: id, cover: null };
  }

  async function reload() {
    const idsToCheck = sagaOrder.length > 0 ? sagaOrder : [externalId];
    const perIdResults = await Promise.all(
      idsToCheck.map(id => getStoryArcsForMedia(id).catch(() => [] as StoryArc[]))
    );
    const byId = new Map<string, StoryArc>();
    for (const arcsForId of perIdResults) {
      for (const arc of arcsForId) byId.set(arc.id, arc);
    }
    const result = [...byId.values()];
    setArcs(result);

    const missingIds = new Set<string>();
    for (const arc of result) {
      for (const item of arc.items) {
        if (item.media_external_id !== externalId) missingIds.add(item.media_external_id);
      }
    }
    if (missingIds.size === 0) return;
    const entries = await Promise.all(
      [...missingIds].map(async id => [id, await getCatalogEntry(id).catch(() => null)] as const)
    );
    setMetaById(prev => {
      const next = { ...prev };
      for (const [id, entry] of entries) {
        if (entry) next[id] = { title: entry.title_main || id, cover: entry.cover_url || null };
      }
      return next;
    });
  }

  useEffect(() => { reload(); }, [externalId, sagaOrder.join(',')]);

  // Fetch episodes for anime/series items when editing an arc
  useEffect(() => {
    if (!editingArc) return;
    const animeIds = editingArc.items
      .map(i => i.media_external_id)
      .filter(id => (id.startsWith('anime:') || id.startsWith('series:')) && !episodesMap[id]);

    if (animeIds.length === 0) return;
    animeIds.forEach(id => {
      fetchMediaEpisodes(id).then(eps => {
        setEpisodesMap(prev => ({ ...prev, [id]: eps }));
      }).catch(() => {
        setEpisodesMap(prev => ({ ...prev, [id]: [] }));
      });
    });
  }, [editingArc, episodesMap]);

  // Close episode popover on click outside
  useEffect(() => {
    if (!activePopoverUnitId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.pr-editor-arc-ep-popover') && !target.closest('.pr-editor-arc-ep-trigger')) {
        setActivePopoverUnitId(null);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [activePopoverUnitId]);

  function startNewArc() {
    setEditingArc({
      id: '',
      name: '',
      imageBase64: null,
      items: [{ media_external_id: externalId, title: currentTitle, cover: currentCover, ep_start: null, ep_end: null, group_id: null }],
    });
  }

  function startEditArc(arc: StoryArc) {
    const items = arc.items.map(i => ({
      ...resolveMeta(i.media_external_id),
      media_external_id: i.media_external_id,
      ep_start: i.ep_start,
      ep_end: i.ep_end,
      group_id: i.group_id ?? null,
    }));
    setEditingArc({ id: arc.id, name: arc.name, imageBase64: arc.image_base64, items });
  }

  async function handleImagePick() {
    const result = await openImageCropModal({
      title: 'Imagen del arco',
      initialUrl: editingArc?.imageBase64 ?? '',
      aspectRatio: 2 / 3,
      saveLabel: 'Usar esta imagen',
      removeLabel: editingArc?.imageBase64 ? 'Quitar imagen' : undefined,
    });
    if (result.action === 'saved') setEditingArc(prev => prev && { ...prev, imageBase64: result.imageUrl });
    else if (result.action === 'removed') setEditingArc(prev => prev && { ...prev, imageBase64: null });
  }

  function addItem(result: ApiSearchResult) {
    setEditingArc(prev => {
      if (!prev) return prev;
      if (prev.items.some(i => i.media_external_id === result.externalId)) return prev;
      return {
        ...prev,
        items: [...prev.items, { media_external_id: result.externalId, title: result.titleMain, cover: result.coverUrl, ep_start: null, ep_end: null, group_id: null }],
      };
    });
  }

  async function addSagaItem(id: string) {
    const meta = resolveSagaMeta(id);
    setEditingArc(prev => {
      if (!prev) return prev;
      if (prev.items.some(i => i.media_external_id === id)) return prev;
      return {
        ...prev,
        items: [...prev.items, { media_external_id: id, title: meta.title || id, cover: meta.cover, ep_start: null, ep_end: null, group_id: null }],
      };
    });
    setShowSagaPicker(false);

    const rels = await getMediaRelationsForEditor(id).catch(() => []);
    const source = rels.find(r => r.relation_type === 'SOURCE' || r.relation_type === 'ADAPTATION');
    if (!source) return;
    setEditingArc(prev => {
      if (!prev) return prev;
      if (prev.items.some(i => i.media_external_id === source.related_media_external_id)) return prev;
      return {
        ...prev,
        items: [...prev.items, {
          media_external_id: source.related_media_external_id,
          title: source.title || source.related_media_external_id,
          cover: source.cover || null,
          ep_start: null,
          ep_end: null,
          group_id: null,
        }],
      };
    });
  }

  function removeItem(id: string) {
    setEditingArc(prev => prev && { ...prev, items: prev.items.filter(i => i.media_external_id !== id) });
  }

  function updateItemRange(id: string, field: 'ep_start' | 'ep_end', value: string) {
    const num = value === '' ? null : parseInt(value, 10);
    const safeNum = num !== null && Number.isFinite(num) ? num : null;
    setEditingArc(prev => prev && {
      ...prev,
      items: prev.items.map(i => i.media_external_id === id ? { ...i, [field]: safeNum } : i),
    });
  }

  // Ungroup a grouped display unit
  function ungroupUnit(unit: DisplayUnit) {
    setEditingArc(prev => {
      if (!prev) return prev;
      const memberIds = new Set(unit.items.map(i => i.media_external_id));
      return {
        ...prev,
        items: prev.items.map(i => memberIds.has(i.media_external_id) ? { ...i, group_id: null } : i),
      };
    });
  }

  // Get unified continuous episodes for a display unit
  function getUnifiedEpisodes(unit: DisplayUnit): UnifiedEpisode[] {
    const result: UnifiedEpisode[] = [];
    let cumulativeOffset = 0;

    for (const item of unit.items) {
      const eps = (episodesMap[item.media_external_id] || []).filter(e => e.episode_number > 0);
      if (eps.length > 0) {
        eps.sort((a, b) => a.episode_number - b.episode_number);
        const baseOffset = cumulativeOffset;
        for (let i = 0; i < eps.length; i++) {
          const ep = eps[i];
          const seasonEpNumber = i + 1;
          const generalEpNumber = Math.max(Math.round(ep.episode_number), baseOffset + i + 1);

          result.push({
            generalEpNumber,
            seasonEpNumber,
            mediaExternalId: item.media_external_id,
            mediaTitle: item.title,
            name: ep.name,
            coverUrl: ep.cover_url,
          });
        }
        cumulativeOffset = result[result.length - 1].generalEpNumber;
      }
    }
    return result;
  }

  function getUnitGlobalRange(unit: DisplayUnit, unifiedEps: UnifiedEpisode[]): { globalStart: number | null; globalEnd: number | null } {
    if (unifiedEps.length === 0) return { globalStart: null, globalEnd: null };

    let globalStart: number | null = null;
    let globalEnd: number | null = null;

    for (const item of unit.items) {
      if (item.ep_start != null && globalStart == null) {
        const match = unifiedEps.find(ep => ep.mediaExternalId === item.media_external_id && (ep.generalEpNumber === item.ep_start || ep.seasonEpNumber === item.ep_start));
        if (match) globalStart = match.generalEpNumber;
      }
      if (item.ep_end != null) {
        const match = unifiedEps.find(ep => ep.mediaExternalId === item.media_external_id && (ep.generalEpNumber === item.ep_end || ep.seasonEpNumber === item.ep_end));
        if (match) globalEnd = match.generalEpNumber;
      }
    }
    return { globalStart, globalEnd };
  }

  function applyGlobalRangeToUnit(unit: DisplayUnit, unifiedEps: UnifiedEpisode[], startGen: number | null, endGen: number | null) {
    if (startGen == null && endGen == null) {
      setEditingArc(prev => {
        if (!prev) return prev;
        const ids = new Set(unit.items.map(i => i.media_external_id));
        return {
          ...prev,
          items: prev.items.map(i => ids.has(i.media_external_id) ? { ...i, ep_start: null, ep_end: null } : i),
        };
      });
      return;
    }

    const effectiveStart = startGen ?? unifiedEps[0].generalEpNumber;
    const effectiveEnd = endGen ?? startGen ?? unifiedEps[unifiedEps.length - 1].generalEpNumber;
    const minG = Math.min(effectiveStart, effectiveEnd);
    const maxG = Math.max(effectiveStart, effectiveEnd);

    setEditingArc(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(item => {
          if (!unit.items.some(u => u.media_external_id === item.media_external_id)) return item;
          const itemEps = unifiedEps.filter(ep => ep.mediaExternalId === item.media_external_id);
          if (itemEps.length === 0) return item;
          const itemMinG = itemEps[0].generalEpNumber;
          const itemMaxG = itemEps[itemEps.length - 1].generalEpNumber;

          if (maxG < itemMinG || minG > itemMaxG) {
            return { ...item, ep_start: null, ep_end: null };
          }

          const clampedStartG = Math.max(minG, itemMinG);
          const clampedEndG = Math.min(maxG, itemMaxG);

          return {
            ...item,
            ep_start: clampedStartG,
            ep_end: clampedEndG,
          };
        }),
      };
    });
  }

  function handleEpisodeClick(
    unit: DisplayUnit,
    unifiedEps: UnifiedEpisode[],
    clickedEp: number,
    globalStart: number | null,
    globalEnd: number | null,
    isCtrl: boolean,
  ) {
    if (isCtrl) {
      // Ctrl + Clic: fija el final (Hasta)
      const currentStart = globalStart ?? clickedEp;
      const effectiveStart = Math.min(currentStart, clickedEp);
      applyGlobalRangeToUnit(unit, unifiedEps, effectiveStart, clickedEp);
    } else {
      // Clic izquierdo: fija el inicio (Desde)
      const hasExplicitRange = globalStart != null && globalEnd != null && globalEnd > globalStart;
      const effectiveEnd = (hasExplicitRange && globalEnd != null && globalEnd >= clickedEp)
        ? globalEnd
        : clickedEp;
      applyGlobalRangeToUnit(unit, unifiedEps, clickedEp, effectiveEnd);
    }
  }

  // Drag and drop mechanics
  function handleDragStart(unitIdx: number) {
    setDraggedUnitIdx(unitIdx);
  }

  function handleDragOverCard(e: React.DragEvent, unitIdx: number) {
    e.preventDefault();
    if (draggedUnitIdx === null || draggedUnitIdx === unitIdx) {
      setDropTargetUnitIdx(null);
      setDropTargetMode(null);
      return;
    }

    const draggedUnit = displayUnits[draggedUnitIdx];
    const targetUnit = displayUnits[unitIdx];
    const canGroup = canGroupUnits(draggedUnit, targetUnit, sagaOrder);

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const width = rect.width;

    if (offsetX < width * 0.22 || (!canGroup && offsetX <= width * 0.5)) {
      setDropTargetMode('before');
    } else if (offsetX > width * 0.78 || (!canGroup && offsetX > width * 0.5)) {
      setDropTargetMode('after');
    } else if (canGroup) {
      setDropTargetMode('group');
    } else {
      setDropTargetMode(null);
    }
    setDropTargetUnitIdx(unitIdx);
  }

  function handleDrop(units: DisplayUnit[]) {
    if (draggedUnitIdx === null || dropTargetUnitIdx === null || draggedUnitIdx === dropTargetUnitIdx) {
      setDraggedUnitIdx(null);
      setDropTargetUnitIdx(null);
      setDropTargetMode(null);
      return;
    }

    const draggedUnit = units[draggedUnitIdx];
    const targetUnit = units[dropTargetUnitIdx];

    if (dropTargetMode === 'group') {
      if (!canGroupUnits(draggedUnit, targetUnit, sagaOrder)) {
        setDraggedUnitIdx(null);
        setDropTargetUnitIdx(null);
        setDropTargetMode(null);
        return;
      }

      const sharedGroupId = targetUnit.groupId || draggedUnit.groupId || `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const mergedItems = [...targetUnit.items, ...draggedUnit.items].map(i => ({ ...i, group_id: sharedGroupId }));

      // Order items strictly by prequel/sequel chain
      if (sagaOrder.length > 1) {
        mergedItems.sort((a, b) => {
          const idxA = sagaOrder.indexOf(a.media_external_id);
          const idxB = sagaOrder.indexOf(b.media_external_id);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return 0;
        });
      }

      const nextUnits = units.filter((_, idx) => idx !== draggedUnitIdx && idx !== dropTargetUnitIdx);
      const insertAt = dropTargetUnitIdx > draggedUnitIdx ? dropTargetUnitIdx - 1 : dropTargetUnitIdx;
      nextUnits.splice(insertAt, 0, {
        id: sharedGroupId,
        isGroup: true,
        groupId: sharedGroupId,
        items: mergedItems,
      });

      const nextFlatItems = nextUnits.flatMap(u => u.items);
      setEditingArc(prev => prev ? { ...prev, items: nextFlatItems } : prev);
    } else {
      const remainingUnits = units.filter((_, idx) => idx !== draggedUnitIdx);
      let insertIdx = remainingUnits.indexOf(targetUnit);
      if (dropTargetMode === 'after') insertIdx++;
      remainingUnits.splice(insertIdx, 0, draggedUnit);

      const nextFlatItems = remainingUnits.flatMap(u => u.items);
      setEditingArc(prev => prev ? { ...prev, items: nextFlatItems } : prev);
    }

    setDraggedUnitIdx(null);
    setDropTargetUnitIdx(null);
    setDropTargetMode(null);
  }

  async function handleSaveArc() {
    if (!editingArc || !editingArc.name.trim() || editingArc.items.length === 0) return;
    setSaving(true);
    try {
      await saveStoryArc({
        id: editingArc.id,
        name: editingArc.name.trim(),
        image_base64: editingArc.imageBase64,
        items: editingArc.items.map((i, index) => ({
          id: '',
          media_external_id: i.media_external_id,
          ep_start: i.ep_start,
          ep_end: i.ep_end,
          position: index,
          group_id: i.group_id ?? null,
        })),
        sort_order: 0,
      });
      setEditingArc(null);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteArc(arcId: string) {
    if (!window.confirm(t.delete_confirm)) return;
    await deleteStoryArc(arcId);
    onArcDeleted?.(arcId);
    await reload();
  }

  async function moveArc(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= arcs.length) return;
    const reordered = [...arcs];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setArcs(reordered);
    await reorderStoryArcs(reordered.map(a => a.id));
  }

  const displayUnits = editingArc ? buildDisplayUnits(editingArc.items, sagaOrder) : [];

  return (
    <div className="pr-editor-section">
      {!editingArc && (
        <div className="pr-editor-section-header-row pr-editor-section-header-row--actions-right">
          <button type="button" className="pr-editor-add-btn" onClick={startNewArc}>{t.new_arc}</button>
        </div>
      )}

      {!editingArc && arcs.length > 0 && (
          <div className="pr-editor-arcs-list">
            {arcs.map((arc, index) => (
              <div key={arc.id} className="pr-editor-arc-card">
                <div className="pr-editor-arc-card-reorder">
                  <button type="button" className="pr-editor-arc-card-move" disabled={index === 0} onClick={() => moveArc(index, -1)}>▲</button>
                  <button type="button" className="pr-editor-arc-card-move" disabled={index === arcs.length - 1} onClick={() => moveArc(index, 1)}>▼</button>
                </div>
                <div className="pr-editor-arc-card-cover">
                  {arc.image_base64
                    ? <img src={arc.image_base64} alt="" />
                    : <div className="pr-editor-media-card-placeholder" />}
                </div>
                <div className="pr-editor-arc-card-info">
                  <div className="pr-editor-arc-card-name">{arc.name}</div>
                  <div className="pr-editor-arc-card-items">
                    {arc.items.map(item => {
                      const range = formatRange(item);
                      return (
                        <span key={item.id} className="pr-editor-arc-card-item-chip">
                          {resolveMeta(item.media_external_id).title}{range ? ` (${range})` : ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="pr-editor-arc-card-actions">
                  <button type="button" className="pr-editor-add-btn" onClick={() => startEditArc(arc)}>{t.edit}</button>
                  <button type="button" className="pr-editor-arc-card-delete" onClick={() => handleDeleteArc(arc.id)}>×</button>
                </div>
              </div>
            ))}
          </div>
      )}

      {editingArc && (
        <div className="pr-editor-arc-editor">
          <div className="pr-editor-arc-editor-header">
            <button type="button" className="pr-editor-arc-image-picker" onClick={handleImagePick}>
              {editingArc.imageBase64
                ? <img className="cover-image-fill" src={editingArc.imageBase64} alt="" />
                : <span>{t.add_image}</span>}
            </button>
            <input
              type="text"
              placeholder={t.name_ph}
              value={editingArc.name}
              onChange={e => setEditingArc({ ...editingArc, name: e.target.value })}
              className="pr-editor-arc-name-input"
            />
          </div>

          <div className="pr-editor-arc-items-list">
            {displayUnits.map((unit, unitIdx) => {
              const isDragging = draggedUnitIdx === unitIdx;
              const isDropTarget = dropTargetUnitIdx === unitIdx;
              const isGroupTarget = isDropTarget && dropTargetMode === 'group';
              const isBeforeTarget = isDropTarget && dropTargetMode === 'before';
              const isAfterTarget = isDropTarget && dropTargetMode === 'after';

              const unifiedEps = getUnifiedEpisodes(unit);
              const { globalStart, globalEnd } = getUnitGlobalRange(unit, unifiedEps);
              const hasEpisodes = unifiedEps.length > 0;

              const rangeLabel = globalStart != null && globalEnd != null
                ? (globalStart === globalEnd ? `Ep. ${globalStart}` : `Ep. ${globalStart}–${globalEnd}`)
                : (globalStart != null ? `Ep. ${globalStart}+` : 'Episodios');

              return (
                <div
                  key={unit.id}
                  className={`pr-editor-arc-item-row ${isDragging ? 'is-dragging' : ''} ${isGroupTarget ? 'is-drop-target-group' : ''} ${isBeforeTarget ? 'is-drop-target-before' : ''} ${isAfterTarget ? 'is-drop-target-after' : ''}`}
                  draggable
                  onDragStart={() => handleDragStart(unitIdx)}
                  onDragOver={e => handleDragOverCard(e, unitIdx)}
                  onDragLeave={() => {
                    if (dropTargetUnitIdx === unitIdx) {
                      setDropTargetUnitIdx(null);
                      setDropTargetMode(null);
                    }
                  }}
                  onDrop={() => handleDrop(displayUnits)}
                  title={unit.items.map(i => i.title).join(' + ')}
                >
                  {isGroupTarget && (
                    <div className="pr-editor-arc-group-overlay">
                      + Agrupar
                    </div>
                  )}

                  <div className="pr-editor-arc-item-cover-col">
                    {unit.isGroup ? (
                      <div className="pr-editor-arc-stacked-covers">
                        {unit.items.slice(0, 3).map((item, idx) => (
                          <div key={item.media_external_id} className="pr-editor-arc-stacked-covers-item">
                            {item.cover ? <img className="cover-image-fill" src={item.cover} alt="" /> : <div className="pr-editor-media-card-placeholder" />}
                          </div>
                        ))}
                        <span className="pr-editor-arc-group-count-badge">{unit.items.length} obras</span>
                      </div>
                    ) : (
                      <div className="pr-editor-arc-item-cover">
                        {unit.items[0].cover ? <img className="cover-image-fill" src={unit.items[0].cover} alt="" /> : <div className="pr-editor-media-card-placeholder" />}
                      </div>
                    )}

                    {hasEpisodes ? (
                      <button
                        type="button"
                        className={`pr-editor-arc-ep-trigger ${activePopoverUnitId === unit.id ? 'is-active' : ''}`}
                        onClick={e => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const top = rect.bottom + 6 + 280 > window.innerHeight ? Math.max(10, rect.top - 280) : rect.bottom + 6;
                          const left = Math.min(Math.max(10, rect.left - 60), window.innerWidth - 380);
                          setPopoverPos({ top, left });
                          setActivePopoverUnitId(activePopoverUnitId === unit.id ? null : unit.id);
                        }}
                      >
                        <span>{rangeLabel}</span>
                        <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>▼</span>
                      </button>
                    ) : (
                      <div className="pr-editor-arc-item-range">
                        <input
                          type="number"
                          placeholder={t.ep_start_ph}
                          value={unit.items[0].ep_start ?? ''}
                          onChange={e => updateItemRange(unit.items[0].media_external_id, 'ep_start', e.target.value)}
                          className="pr-editor-arc-item-range-input"
                        />
                        <span className="pr-editor-arc-item-range-sep">–</span>
                        <input
                          type="number"
                          placeholder={t.ep_end_ph}
                          value={unit.items[0].ep_end ?? ''}
                          onChange={e => updateItemRange(unit.items[0].media_external_id, 'ep_end', e.target.value)}
                          className="pr-editor-arc-item-range-input"
                        />
                      </div>
                    )}
                  </div>

                  <div className="pr-editor-arc-item-actions">
                    {unit.isGroup && (
                      <button
                        type="button"
                        className="pr-editor-arc-card-action-btn"
                        onClick={e => {
                          e.stopPropagation();
                          ungroupUnit(unit);
                        }}
                        title="Separar obras agrupadas"
                      >
                        <Unlink2 size={12} strokeWidth={2.2} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="pr-editor-arc-card-delete"
                      onClick={e => {
                        e.stopPropagation();
                        unit.items.forEach(i => removeItem(i.media_external_id));
                      }}
                      title="Eliminar del arco"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Episode Selector Dropdown Popover */}
          {activePopoverUnitId && popoverPos && (() => {
            const unit = displayUnits.find(u => u.id === activePopoverUnitId);
            if (!unit) return null;
            const unifiedEps = getUnifiedEpisodes(unit);
            const { globalStart, globalEnd } = getUnitGlobalRange(unit, unifiedEps);

            return createPortal(
              <div
                className="pr-editor-arc-ep-popover"
                style={{ top: popoverPos.top, left: popoverPos.left }}
                onClick={e => e.stopPropagation()}
              >
                <div className="pr-editor-arc-ep-range-row">
                  <div className="pr-editor-arc-ep-range-field">
                    <span className="pr-editor-arc-ep-range-label">Desde:</span>
                    <select
                      className="pr-editor-arc-ep-select"
                      value={globalStart ?? ''}
                      onChange={e => {
                        const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                        applyGlobalRangeToUnit(unit, unifiedEps, val, globalEnd ?? val);
                      }}
                    >
                      <option value="">(Inicio)</option>
                      {unifiedEps.map(ep => (
                        <option key={ep.generalEpNumber} value={ep.generalEpNumber}>
                          Ep. {ep.generalEpNumber}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pr-editor-arc-ep-range-field">
                    <span className="pr-editor-arc-ep-range-label">Hasta:</span>
                    <select
                      className="pr-editor-arc-ep-select"
                      value={globalEnd ?? ''}
                      onChange={e => {
                        const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                        applyGlobalRangeToUnit(unit, unifiedEps, globalStart ?? unifiedEps[0]?.generalEpNumber ?? val, val);
                      }}
                    >
                      <option value="">(Fin)</option>
                      {unifiedEps.map(ep => (
                        <option key={ep.generalEpNumber} value={ep.generalEpNumber}>
                          Ep. {ep.generalEpNumber}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    className="pr-editor-arc-ep-clear-btn"
                    onClick={() => applyGlobalRangeToUnit(unit, unifiedEps, null, null)}
                    title="Limpiar rango"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="pr-editor-arc-ep-list">
                  {unifiedEps.map(ep => {
                    const isSelected = globalStart != null && globalEnd != null
                      && ep.generalEpNumber >= Math.min(globalStart, globalEnd)
                      && ep.generalEpNumber <= Math.max(globalStart, globalEnd);
                    return (
                      <button
                        type="button"
                        key={ep.generalEpNumber}
                        className={`pr-editor-arc-ep-item ${isSelected ? 'is-selected' : ''}`}
                        title="Clic: fijar inicio (Desde) · Ctrl+Clic: fijar final (Hasta)"
                        onClick={e => {
                          handleEpisodeClick(unit, unifiedEps, ep.generalEpNumber, globalStart, globalEnd, e.ctrlKey || e.metaKey);
                        }}
                      >
                        {ep.coverUrl ? (
                          <img className="pr-editor-arc-ep-thumb" src={ep.coverUrl} alt="" />
                        ) : (
                          <div className="pr-editor-arc-ep-thumb" />
                        )}
                        <div className="pr-editor-arc-ep-info">
                          <span className="pr-editor-arc-ep-name">
                            Ep. {ep.generalEpNumber}{ep.name ? ` · ${ep.name}` : ''}
                            {(unit.isGroup || ep.generalEpNumber !== ep.seasonEpNumber) && (
                              <> (<strong className="pr-editor-arc-ep-season-num">Ep. {ep.seasonEpNumber}</strong>)</>
                            )}
                          </span>
                          {unit.isGroup && (
                            <span className="pr-editor-arc-ep-sub">{ep.mediaTitle}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>,
              document.body,
            );
          })()}

          <div className="pr-editor-arc-editor-footer">
            <div className="pr-editor-arc-add-item-group">
              {sagaOrder.length > 1 && (
                <div className="pr-editor-arc-saga-picker-wrap">
                  <button type="button" className="pr-editor-add-btn" onClick={() => setShowSagaPicker(v => !v)}>{t.from_saga}</button>
                  {showSagaPicker && (
                    <div className="pr-editor-arc-saga-picker">
                      {sagaOrder.filter(id => !editingArc.items.some(i => i.media_external_id === id)).length === 0 ? (
                        <span className="pr-editor-arc-saga-picker-empty">{t.all_added}</span>
                      ) : (
                        sagaOrder
                          .filter(id => !editingArc.items.some(i => i.media_external_id === id))
                          .map(id => {
                            const meta = id === externalId ? { title: currentTitle, cover: currentCover } : resolveSagaMeta(id);
                            return (
                              <button type="button" key={id} className="pr-editor-arc-saga-picker-item" onClick={() => addSagaItem(id)}>
                                {meta.cover ? <img src={meta.cover} alt="" /> : <div className="pr-editor-media-card-placeholder" />}
                                <span>{meta.title || id}</span>
                              </button>
                            );
                          })
                      )}
                    </div>
                  )}
                </div>
              )}
              <button type="button" className="pr-editor-add-btn" onClick={() => setShowItemSearch(true)}>{t.search_media}</button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={() => setEditingArc(null)} disabled={saving}>{t.cancel}</button>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleSaveArc} disabled={saving || !editingArc.name.trim()}>
                {saving ? '...' : t.edit}
              </button>
            </div>
          </div>
        </div>
      )}

      {showItemSearch && (
        <MediaSearchPopup
          onSelect={addItem}
          onClose={() => setShowItemSearch(false)}
          excludeIds={editingArc?.items.map(i => i.media_external_id) ?? []}
          closeOnSelect={false}
        />
      )}
    </div>
  );
}
