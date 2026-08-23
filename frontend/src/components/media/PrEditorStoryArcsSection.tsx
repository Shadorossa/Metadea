// "Arcos Argumentales" — a curator concept distinct from both
// media_relations (which media are related) and the saga chain
// (chronological order of whole entries): an arc groups specific *episode
// ranges* within one or more media entries under one name and optional
// custom cover. Two shapes this supports:
//   - Same media, several arcs: e.g. Bleach (2004) selected repeatedly to
//     create "Sociedad de Almas" (21-54), "Arrancar" (91-120), etc. — each
//     a separate arc pointing at the same media_external_id with its own
//     episode range.
//   - Several media, one arc: e.g. Bleach: Sennen Kessen-hen's 4 parts all
//     added as items of one "Thousand Year Blood War" arc.
// Saves directly to its own local-only table (see db.rs migration 41) as
// soon as each arc is saved — no GitHub proposal step, same as Favorites'
// custom images; this isn't part of the shared community catalog.
import { useEffect, useState } from 'react';
import { getStoryArcsForMedia, saveStoryArc, reorderStoryArcs, deleteStoryArc, type StoryArc, type StoryArcItem } from '../../lib/tauri/story-arcs';
import { getCatalogEntry, getMediaRelationsForEditor } from '../../lib/tauri/catalog';
import { openImageCropModal } from '../shared/ImageCropModal';
import { MediaSearchPopup } from './MediaSearchPopup';
import type { SearchResult as ApiSearchResult } from '../../lib/search';

interface EditingItem {
  media_external_id: string;
  title: string;
  cover: string | null;
  ep_start: number | null;
  ep_end: number | null;
}

interface EditingArc {
  id: string; // '' while creating a brand-new arc
  name: string;
  imageBase64: string | null;
  items: EditingItem[];
  // For arcs like Bleach's Thousand Year Blood War, which spans several
  // separately-released parts that don't each have their own meaningful
  // sub-range — one shared ep_start/ep_end gets written to every item
  // instead of asking the curator to fill in (and keep in sync) N copies of
  // the same numbers. Purely a UI convenience: story_arc_items still stores
  // a range per item either way, nothing new on the DB side.
  sharedRange: boolean;
}

interface Props {
  externalId: string;
  currentTitle: string;
  currentCover: string | null;
  // The saga chain already loaded in this same editor's "Saga" section —
  // lets "+ Añadir obra" offer picking one of those directly (e.g. Sennen
  // Kessen-hen's other 3 parts, already known here) instead of always
  // having to search the live APIs again for something already on screen.
  sagaOrder: string[];
  resolveSagaMeta: (id: string) => { title: string | null; cover: string | null };
  // Tells the parent editor this arc was deleted this session — needed for
  // the GitHub proposal's merge to actually drop it upstream too (see
  // submitCollaborativeProposal's mergeListByKey), since the local delete
  // above already happens immediately and can't be inferred from a diff.
  onArcDeleted?: (arcId: string) => void;
}

function formatRange(item: Pick<StoryArcItem, 'ep_start' | 'ep_end'>): string {
  if (item.ep_start != null && item.ep_end != null) return `${item.ep_start}-${item.ep_end}`;
  if (item.ep_start != null) return `${item.ep_start}+`;
  return '';
}

export function PrEditorStoryArcsSection({ externalId, currentTitle, currentCover, sagaOrder, resolveSagaMeta, onArcDeleted }: Props) {
  const [arcs, setArcs] = useState<StoryArc[]>([]);
  const [metaById, setMetaById] = useState<Record<string, { title: string; cover: string | null }>>({});
  const [editingArc, setEditingArc] = useState<EditingArc | null>(null);
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [showSagaPicker, setShowSagaPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  function resolveMeta(id: string): { title: string; cover: string | null } {
    if (id === externalId) return { title: currentTitle, cover: currentCover };
    return metaById[id] ?? { title: id, cover: null };
  }

  async function reload() {
    // Not just this entry's own arcs — any arc touching *any* member of the
    // saga chain this entry belongs to, so e.g. opening Sennen Kessen-hen
    // Part 2's editor still shows the "Thousand Year Blood War" arc even
    // though Part 2 itself might not be one of its items (only Parts 1 and
    // 3 could be, say) — the arc still concerns this saga, so it's worth
    // seeing (and editing) from any of its members' editors.
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

  // sagaOrder.join(',') instead of sagaOrder itself — a stable primitive so
  // this only re-fetches when saga membership actually changes, not on
  // every parent re-render that happens to pass a fresh array reference.
  useEffect(() => { reload(); }, [externalId, sagaOrder.join(',')]);

  function startNewArc() {
    setEditingArc({
      id: '',
      name: '',
      imageBase64: null,
      items: [{ media_external_id: externalId, title: currentTitle, cover: currentCover, ep_start: null, ep_end: null }],
      sharedRange: false,
    });
  }

  function startEditArc(arc: StoryArc) {
    const items = arc.items.map(i => ({ ...resolveMeta(i.media_external_id), media_external_id: i.media_external_id, ep_start: i.ep_start, ep_end: i.ep_end }));
    // Detects arcs that were already saved with the same range on every
    // item — re-opening one shows the shared-range control pre-checked
    // instead of looking like N independently-matching coincidences.
    const sharedRange = items.length > 1 && items.every(i => i.ep_start === items[0].ep_start && i.ep_end === items[0].ep_end);
    setEditingArc({ id: arc.id, name: arc.name, imageBase64: arc.image_base64, items, sharedRange });
  }

  // Same pick/pan/zoom modal Favorites and the character-photo editor both
  // use (ImageCropModal.tsx) — paste a URL, drag a file in, or drop one, and
  // the crop it returns is baked into a single PNG data: URL, same as
  // CharacterPrEditorModal's own "just wants the picked URL" usage. Stored
  // as-is in story_arcs.image_base64 — no separate pan/zoom persistence,
  // since (unlike Favorites) there's no need to reopen the *original* image
  // and re-crop it later.
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
      const [ep_start, ep_end] = sharedRangeValues(prev);
      return {
        ...prev,
        items: [...prev.items, { media_external_id: result.externalId, title: result.titleMain, cover: result.coverUrl, ep_start, ep_end }],
      };
    });
  }

  // Picking a work from the saga also pulls in its own SOURCE relation (the
  // original manga/novel/etc. it was adapted from), if it has one — one arc
  // then covers both the anime's episode range and the source material's
  // corresponding chapter range at once, instead of having to separately
  // remember to add the source afterward.
  async function addSagaItem(id: string) {
    const meta = resolveSagaMeta(id);
    setEditingArc(prev => {
      if (!prev) return prev;
      if (prev.items.some(i => i.media_external_id === id)) return prev;
      const [ep_start, ep_end] = sharedRangeValues(prev);
      return {
        ...prev,
        items: [...prev.items, { media_external_id: id, title: meta.title || id, cover: meta.cover, ep_start, ep_end }],
      };
    });
    setShowSagaPicker(false);

    // Works either direction — an anime's SOURCE (its original manga) or a
    // manga's ADAPTATION (its anime) — whichever this particular entry has.
    const rels = await getMediaRelationsForEditor(id).catch(() => []);
    const source = rels.find(r => r.relation_type === 'SOURCE' || r.relation_type === 'ADAPTATION');
    if (!source) return;
    setEditingArc(prev => {
      if (!prev) return prev;
      if (prev.items.some(i => i.media_external_id === source.related_media_external_id)) return prev;
      const [ep_start, ep_end] = sharedRangeValues(prev);
      return {
        ...prev,
        items: [...prev.items, {
          media_external_id: source.related_media_external_id,
          title: source.title || source.related_media_external_id,
          cover: source.cover || null,
          ep_start,
          ep_end,
        }],
      };
    });
  }

  function removeItem(id: string) {
    setEditingArc(prev => prev && { ...prev, items: prev.items.filter(i => i.media_external_id !== id) });
  }

  // Item order becomes each item's saved `position` (see handleSaveArc) —
  // matters for arcs like Thousand Year Blood War where the parts should
  // list in release/watch order, not whatever order they happened to be
  // added in.
  function moveItem(index: number, direction: -1 | 1) {
    setEditingArc(prev => {
      if (!prev) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.items.length) return prev;
      const items = [...prev.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...prev, items };
    });
  }

  // A brand-new item joining a shared-range arc should read the same range
  // as everything else already in it, instead of showing up blank next to
  // matching numbers on every other row.
  function sharedRangeValues(arc: EditingArc): [number | null, number | null] {
    if (!arc.sharedRange || arc.items.length === 0) return [null, null];
    return [arc.items[0].ep_start, arc.items[0].ep_end];
  }

  // In shared-range mode every item is kept in lockstep — editing any one
  // row's range updates all of them, so they never actually diverge while
  // the toggle is on.
  function updateItemRange(id: string, field: 'ep_start' | 'ep_end', value: string) {
    const num = value === '' ? null : parseInt(value, 10);
    const safeNum = num !== null && Number.isFinite(num) ? num : null;
    setEditingArc(prev => prev && {
      ...prev,
      items: prev.items.map(i => (prev.sharedRange || i.media_external_id === id) ? { ...i, [field]: safeNum } : i),
    });
  }

  // Turning it on consolidates everything to the first item's current
  // values (rather than leaving mismatched numbers around and pretending
  // they're unified); turning it off just stops keeping them in sync,
  // whatever values are already there stay put.
  function toggleSharedRange() {
    setEditingArc(prev => {
      if (!prev) return prev;
      const next = !prev.sharedRange;
      if (!next) return { ...prev, sharedRange: false };
      const [ep_start, ep_end] = [prev.items[0]?.ep_start ?? null, prev.items[0]?.ep_end ?? null];
      return { ...prev, sharedRange: true, items: prev.items.map(i => ({ ...i, ep_start, ep_end })) };
    });
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
          id: '', media_external_id: i.media_external_id, ep_start: i.ep_start, ep_end: i.ep_end, position: index,
        })),
        // Ignored by save_story_arc either way (see its own comment) — only
        // present to satisfy the type.
        sort_order: 0,
      });
      setEditingArc(null);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteArc(arcId: string) {
    if (!window.confirm('¿Eliminar este arco argumental?')) return;
    await deleteStoryArc(arcId);
    onArcDeleted?.(arcId);
    await reload();
  }

  // Swaps this arc with its neighbor and persists the whole visible list's
  // new order — reorder_story_arcs only touches the ids it's given, so this
  // never affects an arc outside what's currently shown here.
  async function moveArc(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= arcs.length) return;
    const reordered = [...arcs];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setArcs(reordered);
    await reorderStoryArcs(reordered.map(a => a.id));
  }

  return (
    <div className="pr-editor-section">
      <div className="pr-editor-section-header-row">
        <span className="pr-editor-section-title">Arcos Argumentales</span>
        {!editingArc && <button type="button" className="pr-editor-add-btn" onClick={startNewArc}>+ Nuevo arco</button>}
      </div>

      {!editingArc && (
        arcs.length === 0 ? (
          <p className="pr-editor-bundle-children-hint">Sin arcos argumentales todavía.</p>
        ) : (
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
                  <button type="button" className="pr-editor-add-btn" onClick={() => startEditArc(arc)}>Editar</button>
                  <button type="button" className="pr-editor-arc-card-delete" onClick={() => handleDeleteArc(arc.id)}>×</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {editingArc && (
        <div className="pr-editor-arc-editor">
          <div className="pr-editor-arc-editor-header">
            <button type="button" className="pr-editor-arc-image-picker" onClick={handleImagePick}>
              {editingArc.imageBase64
                ? <img src={editingArc.imageBase64} alt="" />
                : <span>+ Imagen</span>}
            </button>
            <input
              type="text"
              placeholder="Nombre del arco (ej. Sociedad de Almas)"
              value={editingArc.name}
              onChange={e => setEditingArc({ ...editingArc, name: e.target.value })}
              className="pr-editor-arc-name-input"
            />
          </div>

          <p className="pr-editor-arc-range-hint">El rango de episodios/capítulos es opcional.</p>

          {editingArc.items.length > 1 && (
            <label className="pr-editor-arc-shared-range-toggle">
              <input type="checkbox" checked={editingArc.sharedRange} onChange={toggleSharedRange} />
              Mismo rango de episodios para todas las obras (ej. arcos como Thousand Year Blood War, repartidos en varias partes)
            </label>
          )}

          <div className="pr-editor-arc-items-list">
            {editingArc.items.map((item, index) => (
              <div key={item.media_external_id} className="pr-editor-arc-item-row">
                {editingArc.items.length > 1 && (
                  <div className="pr-editor-arc-card-reorder">
                    <button type="button" className="pr-editor-arc-card-move" disabled={index === 0} onClick={() => moveItem(index, -1)}>▲</button>
                    <button type="button" className="pr-editor-arc-card-move" disabled={index === editingArc.items.length - 1} onClick={() => moveItem(index, 1)}>▼</button>
                  </div>
                )}
                <div className="pr-editor-arc-item-cover">
                  {item.cover ? <img src={item.cover} alt="" /> : <div className="pr-editor-media-card-placeholder" />}
                </div>
                <div className="pr-editor-arc-item-title" title={item.title}>{item.title}</div>
                <div className="pr-editor-arc-item-range">
                  <input
                    type="number" placeholder="Ep. inicio" value={item.ep_start ?? ''}
                    onChange={e => updateItemRange(item.media_external_id, 'ep_start', e.target.value)}
                    className="pr-editor-arc-item-range-input"
                  />
                  <span className="pr-editor-arc-item-range-sep">–</span>
                  <input
                    type="number" placeholder="Ep. fin" value={item.ep_end ?? ''}
                    onChange={e => updateItemRange(item.media_external_id, 'ep_end', e.target.value)}
                    className="pr-editor-arc-item-range-input"
                  />
                </div>
                {editingArc.items.length > 1 && (
                  <button type="button" className="pr-editor-arc-card-delete" onClick={() => removeItem(item.media_external_id)}>×</button>
                )}
              </div>
            ))}
          </div>

          <div className="pr-editor-arc-editor-footer">
            <div className="pr-editor-arc-add-item-group">
              {sagaOrder.length > 1 && (
                <div className="pr-editor-arc-saga-picker-wrap">
                  <button type="button" className="pr-editor-add-btn" onClick={() => setShowSagaPicker(v => !v)}>+ De la saga</button>
                  {showSagaPicker && (
                    <div className="pr-editor-arc-saga-picker">
                      {sagaOrder.filter(id => !editingArc.items.some(i => i.media_external_id === id)).length === 0 ? (
                        <span className="pr-editor-arc-saga-picker-empty">Ya están todas añadidas</span>
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
              <button type="button" className="pr-editor-add-btn" onClick={() => setShowItemSearch(true)}>+ Buscar obra</button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={() => setEditingArc(null)} disabled={saving}>Cancelar</button>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleSaveArc} disabled={saving || !editingArc.name.trim()}>
                {saving ? 'Guardando...' : 'Guardar arco'}
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
