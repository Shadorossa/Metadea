import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '../../lib/tauri';
import { getCatalogEntry, saveCatalogEntry, saveCachedSaga, getMediaRelations, saveMediaRelations, getMediaAuthors } from '../../lib/tauri/catalog';
import { invalidateCachedMediaData } from '../../lib/media/mediaService';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from '../../lib/tauri/catalog';
import { getMediaCharacters, type DbMediaCharacter } from '../../lib/tauri/characters';
import type { SagaEntry } from '../../lib/anilist/saga';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { MediaSearchPopup } from './MediaSearchPopup';
import { SlotInput } from './SlotInput';
import {
  BUNDLE_RELATION_TYPES, ALL_CHAIN_RELATION_TYPES, SAGA_RELATION_TYPE_OPTIONS, EDITABLE_RELATION_OPTIONS,
  isSagaRelationType, type SagaRelationType,
} from '../../lib/media/sagaTypes';
import { classifySagaChain, createMetaResolver, reconstructSagaOrder, type MediaMeta } from '../../lib/media/sagaGrouping';
import { submitCollaborativeProposal, openUrlInBrowser, type ProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import { ALL_PLATFORMS, ALL_GENRES } from '../../lib/constants/igdbData';
import { DIFF_FIELDS, REL_TYPE_TO_PAIR } from '../../lib/media/constants';
import { getReleaseDateKey, compareByReleaseDate } from '../../lib/media/mapper-utils';

interface BundledRelation {
  external_id: string;
  type: 'episode' | 'update';
  title?: string | null;
  cover?: string | null;
}

interface Props {
  externalId: string;
  onClose: () => void;
  onSaved?: () => void;
}


const normField = (v: unknown) => (v === '' || v === undefined ? null : v);

// True when two string records differ after normalizing each value (missing
// keys fall back through `normalize`), regardless of which record a key is in.
function recordsDiffer(a: Record<string, string>, b: Record<string, string>, normalize: (v?: string) => string): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (normalize(a[k]) !== normalize(b[k])) return true;
  }
  return false;
}

function ChangedDot({ show, className = 'pr-editor-changed-dot' }: { show: boolean; className?: string }) {
  return show ? <span className={className} /> : null;
}

function Field({ label, changed, small, full, children }: {
  label: string; changed: boolean; small?: boolean; full?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`pr-editor-field${small ? ' pr-editor-field--small' : ''}${full ? ' pr-editor-field--full' : ''}`}>
      <label>
        {label}
        <ChangedDot show={changed} />
      </label>
      {children}
    </div>
  );
}

// Relation type labels (Spanish) — matches i18n/es.ts relations dict
// REL_ADAPTATION / REL_ALTERNATIVE are namespaced (see EDITABLE_RELATION_OPTIONS
// in sagaTypes.ts) to avoid colliding with the saga-chain's own ADAPTATION /
// ALTERNATIVE relation_type strings, which the backend's transitive-chain walk
// would otherwise sweep into the Saga order the next time the editor loads.
const RELATION_TYPE_LABELS: Record<string, string> = {
  REL_ADAPTATION: 'Adaptación',
  SPIN_OFF: 'Spin-off',
  REL_ALTERNATIVE: 'Alternativa',
  PARENT: 'Fuente',
  SIDE_STORY: 'Side Story',
  SUMMARY: 'Resumen',
  REMASTER: 'Remaster',
  EXPANDED_GAME: 'Edición extendida',
};

export function PrEditorModal({ externalId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [entry, setEntry] = useState<MediaCatalogEntry | null>(null);
  const [originalEntry, setOriginalEntry] = useState<MediaCatalogEntry | null>(null);

  const [bundledRelations, setBundledRelations] = useState<BundledRelation[]>([]);
  const [originalBundledIds, setOriginalBundledIds] = useState<Set<string>>(new Set());

  // Editable relations: ADAPTATION, SPIN_OFF, ALTERNATIVE, etc (not saga-managed)
  interface EditableRelation {
    related_media_external_id: string;
    relation_type: string;
    type_label: string;
    title?: string | null;
    cover?: string | null;
  }
  const [editableRelations, setEditableRelations] = useState<EditableRelation[]>([]);
  const [originalEditableRelationIds, setOriginalEditableRelationIds] = useState<Set<string>>(new Set());

  // Saga — one single ordered chain (chronological order), including this
  // entry itself. Every adjacent pair in this order gets a SEQUEL edge
  // (earlier → later) and a PREQUEL edge (later → earlier) on submit — for
  // every id in the chain, not just the one currently open in the editor.
  const [sagaOrder, setSagaOrder] = useState<string[]>([externalId]);
  const [originalSagaOrder, setOriginalSagaOrder] = useState<string[]>([externalId]);

  // Display-only metadata (cover/title) for saga members other than this
  // entry, so tags can show a thumbnail instead of a bare id — populated
  // either from the existing relation rows (which already join title/cover
  // from media_catalog) or from the live API search result the user picked.
  const [sagaMeta, setSagaMeta] = useState<Record<string, MediaMeta>>({});
  // 'main'/'alternative' ids can share a free-text Concept Group name
  // (sagaGroups) to collapse into one saga-timeline step (e.g. a console
  // remaster + its PC original); 'source'/'episode'/'update' ids attach to
  // the nearest preceding group instead (see classifySagaChain).
  const [sagaRelationTypes, setSagaRelationTypes] = useState<Record<string, SagaRelationType>>({});
  const [sagaGroups, setSagaGroups] = useState<Record<string, string>>({});
  const [originalSagaRelationTypes, setOriginalSagaRelationTypes] = useState<Record<string, SagaRelationType>>({});
  const [originalSagaGroups, setOriginalSagaGroups] = useState<Record<string, string>>({});
  const [draggedSagaIndex, setDraggedSagaIndex] = useState<number | null>(null);
  const [sagaName, setSagaName] = useState('');
  const [originalSagaName, setOriginalSagaName] = useState('');


  const [characters, setCharacters] = useState<DbMediaCharacter[]>([]);
  const [mediaAuthors, setMediaAuthors] = useState<DbMediaAuthor[]>([]);

  const [searchPopupMode, setSearchPopupMode] = useState<'saga' | 'bundled' | 'relations' | null>(null);
  const [selectedRelationType, setSelectedRelationType] = useState<string>('REL_ADAPTATION');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getCatalogEntry(externalId);
        const resolved = res ?? {
          id: '',
          external_id: externalId,
          type: externalId.split(':')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setEntry(resolved);
        setOriginalEntry(resolved);
      } catch (err) {
        console.error('Failed to get catalog entry:', err);
        setErrorMsg('Error reading local data');
      }

      try {
        const rels = await getMediaRelations(externalId).catch(() => [] as DbMediaRelation[]);

        // Separate bundled relations (EPISODE, UPDATE)
        const bundled = rels
          .filter(r => BUNDLE_RELATION_TYPES.includes(r.relation_type))
          .map(r => ({
            external_id: r.related_media_external_id,
            type: (r.relation_type === 'UPDATE' ? 'update' : 'episode') as BundledRelation['type'],
            title: r.title,
            cover: r.cover,
          }));
        setBundledRelations(bundled);
        setOriginalBundledIds(new Set(bundled.map(r => r.external_id)));

        const transitiveIds = await invoke<string[]>('get_transitive_relation_ids', { mediaExternalId: externalId }).catch(() => [] as string[]);
        if (!transitiveIds.includes(externalId)) transitiveIds.push(externalId);
        const sagaMemberIds = new Set(transitiveIds);

        // Everything that isn't Bundled In and doesn't target a saga-chain
        // member shows up here — every existing relation the entry already
        // had (ADAPTATION, SPIN_OFF, ALTERNATIVE outside the saga, CHARACTER,
        // OTHER, ...), not just a fixed whitelist. Anything targeting a saga
        // member is re-derived by the saga chain builder on save instead.
        const editable = rels
          .filter(r => !BUNDLE_RELATION_TYPES.includes(r.relation_type) && !sagaMemberIds.has(r.related_media_external_id))
          .map(r => ({
            related_media_external_id: r.related_media_external_id,
            relation_type: r.relation_type,
            type_label: r.type_label || r.relation_type,
            title: r.title,
            cover: r.cover,
          }));
        setEditableRelations(editable);
        setOriginalEditableRelationIds(new Set(editable.map(r => r.related_media_external_id)));

        const entriesData = await Promise.all(
          transitiveIds.map(async id => ({ id, entry: await getCatalogEntry(id).catch(() => null) }))
        );
        const validEntries = entriesData.filter((x): x is { id: string; entry: MediaCatalogEntry } => x.entry !== null);

        const currentEntry = validEntries.find(x => x.id === externalId)?.entry;
        if (currentEntry) {
          setEntry(currentEntry);
          setOriginalEntry(currentEntry);
        }

        validEntries.sort((a, b) => compareByReleaseDate(
          { ...a.entry, id: a.id },
          { ...b.entry, id: b.id }
        ));

        const sortedIds = validEntries.map(x => x.id);

        const meta: Record<string, MediaMeta> = {};
        for (const x of validEntries) {
          meta[x.id] = { title: x.entry.title_main || x.id, cover: x.entry.cover_url || null };
        }
        setSagaMeta(meta);

        // Bootstraps sagaRelationTypes/sagaGroups from whatever SOURCE/
        // EPISODE/UPDATE/ALTERNATIVE edges already exist in the DB — this
        // is a one-time reverse-engineering of prior state, distinct from
        // classifySagaChain (which turns already-known sagaRelationTypes/
        // sagaGroups back into a display/relation structure).
        const [allRelsList, dbGroups, dbSagaName] = await Promise.all([
          Promise.all(sortedIds.map(id => getMediaRelations(id).catch(() => [] as DbMediaRelation[]))),
          invoke<Record<string, string>>('get_media_saga_groups', { mediaExternalIds: sortedIds }).catch(() => ({} as Record<string, string>)),
          invoke<string | null>('get_saga_name', { mediaExternalId: externalId }).catch(() => null),
        ]);
        // Reconstructs the manually-saved order (if any) from SEQUEL edges
        // among allRelsList instead of trusting release-date order alone —
        // otherwise a drag-reorder+submit looked saved but silently reverted
        // to release-date order the next time the editor was reopened.
        const reconstructedOrder = reconstructSagaOrder(sortedIds, allRelsList);
        setSagaOrder(reconstructedOrder);
        setOriginalSagaOrder(reconstructedOrder);

        const relTypesMap: Record<string, SagaRelationType> = {};
        const groupsMap: Record<string, string> = { ...dbGroups };
        let nextGroupNum = 1;

        for (let i = 0; i < sortedIds.length; i++) {
          const ownerId = sortedIds[i];
          for (const r of allRelsList[i]) {
            const otherId = r.related_media_external_id;
            if (r.relation_type === 'ALTERNATIVE') {
              if (!groupsMap[ownerId] && !groupsMap[otherId]) {
                groupsMap[ownerId] = groupsMap[otherId] = `Group ${nextGroupNum++}`;
              } else if (groupsMap[ownerId] && !groupsMap[otherId]) {
                groupsMap[otherId] = groupsMap[ownerId];
              } else if (!groupsMap[ownerId] && groupsMap[otherId]) {
                groupsMap[ownerId] = groupsMap[otherId];
              }
            } else {
              const lower = r.relation_type.toLowerCase();
              if (isSagaRelationType(lower) && lower !== 'main' && lower !== 'alternative') {
                relTypesMap[otherId] = lower;
              }
            }
          }
        }
        setSagaRelationTypes(relTypesMap);
        setOriginalSagaRelationTypes({ ...relTypesMap });
        setSagaGroups(groupsMap);
        setOriginalSagaGroups({ ...groupsMap });
        setSagaName(dbSagaName || '');
        setOriginalSagaName(dbSagaName || '');
      } catch (err) {
        console.error('Failed to load relations/saga:', err);
        setBundledRelations([]);
        setEditableRelations([]);
      } finally {
        setLoading(false);
      }
    };

    load();
    getMediaCharacters(externalId).then(setCharacters).catch(() => setCharacters([]));
    getMediaAuthors(externalId).then(setMediaAuthors).catch(() => setMediaAuthors([]));
  }, [externalId]);

  // ── Saga handlers ──────────────────────────────────────────────────────────

  const addToSaga = (result: ApiSearchResult) => {
    if (!sagaOrder.includes(result.externalId)) setSagaOrder([...sagaOrder, result.externalId]);
    setSagaMeta(prev => ({ ...prev, [result.externalId]: { title: result.titleMain, cover: result.coverUrl } }));
  };
  const removeFromSaga = (id: string) => {
    if (id === externalId) return; // this entry can move, not leave its own saga
    setSagaOrder(sagaOrder.filter(x => x !== id));
  };
  const reorderSaga = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= sagaOrder.length || toIndex >= sagaOrder.length) return;
    const next = [...sagaOrder];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setSagaOrder(next);
  };
  const updateSagaRelationType = (id: string, type: SagaRelationType) =>
    setSagaRelationTypes(prev => ({ ...prev, [id]: type }));
  const updateSagaGroup = (id: string, group: string) =>
    setSagaGroups(prev => ({ ...prev, [id]: group }));

  // Native HTML5 drag-and-drop is unreliable inside Tauri's webview, so
  // reordering is done with plain pointer events instead: press on a card,
  // then whichever card the pointer is currently over (found via
  // elementFromPoint + a data-saga-index marker) swaps into the dragged
  // card's slot live, left-to-right following the saga's chronological order.
  useEffect(() => {
    if (draggedSagaIndex === null) return;

    const handleMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const card = el?.closest<HTMLElement>('[data-saga-index]');
      if (!card) return;
      const overIndex = parseInt(card.dataset.sagaIndex || '', 10);
      if (Number.isNaN(overIndex) || overIndex === draggedSagaIndex) return;
      reorderSaga(draggedSagaIndex, overIndex);
      setDraggedSagaIndex(overIndex);
    };
    const handleUp = () => setDraggedSagaIndex(null);

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, [draggedSagaIndex, sagaOrder]);

  // ── Bundled-in handlers ────────────────────────────────────────────────────

  const addBundledRelation = (result: ApiSearchResult) => {
    if (!bundledRelations.some(r => r.external_id === result.externalId)) {
      setBundledRelations([...bundledRelations, {
        external_id: result.externalId,
        type: 'episode',
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const updateBundledRelationType = (id: string, type: BundledRelation['type']) =>
    setBundledRelations(prev => prev.map(r => r.external_id === id ? { ...r, type } : r));
  const removeBundledRelation = (id: string) =>
    setBundledRelations(prev => prev.filter(r => r.external_id !== id));

  // ── Editable relation handlers ────────────────────────────────────────────

  const addEditableRelation = (result: ApiSearchResult) => {
    if (!editableRelations.some(r => r.related_media_external_id === result.externalId)) {
      setEditableRelations([...editableRelations, {
        related_media_external_id: result.externalId,
        relation_type: selectedRelationType,
        type_label: RELATION_TYPE_LABELS[selectedRelationType] || selectedRelationType,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const updateEditableRelationType = (id: string, relationType: string) =>
    setEditableRelations(prev => prev.map(r => r.related_media_external_id === id
      ? { ...r, relation_type: relationType, type_label: RELATION_TYPE_LABELS[relationType] || relationType }
      : r));
  const removeEditableRelation = (id: string) =>
    setEditableRelations(prev => prev.filter(r => r.related_media_external_id !== id));

  const handleChange = (field: keyof MediaCatalogEntry, value: string | number | null) => {
    if (!entry) return;
    setEntry({ ...entry, [field]: value === '' ? null : value });
  };

  // ── Change detection (shared by hasChanges + the PR change summary) ───────

  const isFieldChanged = (field: keyof MediaCatalogEntry) =>
    !!originalEntry && normField(entry?.[field]) !== normField(originalEntry[field]);

  const getDiff = () => {
    const originalSagaIds = new Set(originalSagaOrder);
    return {
      addedBundled: bundledRelations.filter(r => !originalBundledIds.has(r.external_id)),
      removedBundledIds: [...originalBundledIds].filter(id => !bundledRelations.some(r => r.external_id === id)),
      addedEditableRelations: editableRelations.filter(r => !originalEditableRelationIds.has(r.related_media_external_id)),
      removedEditableRelationIds: [...originalEditableRelationIds].filter(id => !editableRelations.some(r => r.related_media_external_id === id)),
      addedSaga: sagaOrder.filter(id => id !== externalId && !originalSagaIds.has(id)),
      removedSaga: originalSagaOrder.filter(id => id !== externalId && !sagaOrder.includes(id)),
      sagaOrderChanged: sagaOrder.join(',') !== originalSagaOrder.join(','),
      relTypesChanged: recordsDiffer(sagaRelationTypes, originalSagaRelationTypes, v => v || 'main'),
      groupsChanged: recordsDiffer(sagaGroups, originalSagaGroups, v => (v || '').trim()),
      sagaNameChanged: sagaName !== originalSagaName,
    };
  };

  const hasChanges = () => {
    if (!entry || !originalEntry) return false;
    if (DIFF_FIELDS.some(([field]) => isFieldChanged(field))) return true;
    const d = getDiff();
    return d.addedBundled.length > 0 || d.removedBundledIds.length > 0
      || d.addedEditableRelations.length > 0 || d.removedEditableRelationIds.length > 0
      || d.addedSaga.length > 0 || d.removedSaga.length > 0
      || d.sagaOrderChanged || d.relTypesChanged || d.groupsChanged || d.sagaNameChanged;
  };

  // Human-readable "- " bullet list of everything this proposal adds or
  // changes, used as the PR body — diffs catalog fields against the entry as
  // it was when the modal opened, plus set-differences for the relation
  // buckets this editor manages (bundled-in, saga order).
  const buildChangeSummary = (resolveMeta: (id: string) => MediaMeta): string => {
    if (!entry) return '';
    const lines: string[] = [];

    for (const [field, label] of DIFF_FIELDS) {
      if (!isFieldChanged(field)) continue;
      const before = originalEntry?.[field] ?? null;
      const after = entry[field] ?? null;
      if (before == null || before === '') lines.push(`- Added ${label}: "${after}"`);
      else if (after == null || after === '') lines.push(`- Removed ${label} (was "${before}")`);
      else lines.push(`- Changed ${label}: "${before}" → "${after}"`);
    }

    const formatWork = (id: string, title?: string | null): string => {
      const displayTitle = title || resolveMeta(id).title;
      return displayTitle ? `${displayTitle} (${id})` : id;
    };

    const d = getDiff();
    for (const r of d.addedBundled) lines.push(`- Added Bundled In: ${formatWork(r.external_id, r.title)} (${r.type})`);
    for (const id of d.removedBundledIds) lines.push(`- Removed Bundled In: ${formatWork(id)}`);
    for (const r of d.addedEditableRelations) lines.push(`- Added Relation: ${formatWork(r.related_media_external_id, r.title)} (${r.type_label})`);
    for (const id of d.removedEditableRelationIds) lines.push(`- Removed Relation: ${formatWork(id)}`);

    if (d.addedSaga.length > 0 || d.removedSaga.length > 0 || d.sagaOrderChanged || d.relTypesChanged || d.groupsChanged || d.sagaNameChanged) {
      if (d.sagaNameChanged) {
        lines.push(`- Changed Saga Name: "${originalSagaName}" → "${sagaName}"`);
      }
      for (const id of d.addedSaga) {
        lines.push(`- Added to Saga: ${formatWork(id)} [type: ${sagaRelationTypes[id] || 'main'}]`);
      }
      for (const id of d.removedSaga) {
        lines.push(`- Removed from Saga: ${formatWork(id)}`);
      }
      if (d.sagaOrderChanged) {
        const chainLabel = sagaOrder.map(id => `${formatWork(id)} [type: ${sagaRelationTypes[id] || 'main'}]`).join(' → ');
        lines.push(d.addedSaga.length === 0 && d.removedSaga.length === 0
          ? `- Reordered Saga: ${chainLabel}`
          : `- Saga order: ${chainLabel}`);
      } else if (d.relTypesChanged || d.groupsChanged) {
        lines.push(`- Updated Saga relations/groups`);
      }
    }

    if (characters.length > 0) lines.push(`- Includes ${characters.length} cached character(s)`);
    if (mediaAuthors.length > 0) lines.push(`- Includes ${mediaAuthors.length} cached author/staff credit(s)`);

    return lines.length > 0 ? lines.join('\n') : '- No field changes detected (metadata refresh only)';
  };

  const handleSubmit = async () => {
    if (!entry) return;
    setSubmitting(true);
    setErrorMsg('');

    try {
      await saveCatalogEntry(entry);

      const resolveMeta = createMetaResolver(externalId, { title: entry.title_main || externalId, cover: entry.cover_url || null }, sagaMeta);

      // sagaOrder is the whole saga's chronological order (this entry
      // included) — classifySagaChain clusters it into groups (main/
      // alternative ids sharing a Concept Group name) and standalone source/
      // episode/update entries. Walked pairwise, every adjacent *group*
      // produces a SEQUEL edge (earlier → later) and a PREQUEL edge (later →
      // earlier) — for every id in the chain, not just the one currently
      // open in the editor.
      const fullChain = sagaOrder;
      const classified = classifySagaChain(fullChain, sagaRelationTypes, sagaGroups);
      const groups = classified.filter(e => e.kind === 'group');

      type TaggedRelation = DbMediaRelation & { media_external_id: string };
      const chainRelations: TaggedRelation[] = [];

      const addReciprocalPair = (
        aId: string, bId: string,
        aToB: { relation_type: string; type_label: string },
        bToA: { relation_type: string; type_label: string },
      ) => {
        chainRelations.push({ media_external_id: aId, related_media_external_id: bId, ...aToB, title: resolveMeta(bId).title || bId, cover: resolveMeta(bId).cover });
        chainRelations.push({ media_external_id: bId, related_media_external_id: aId, ...bToA, title: resolveMeta(aId).title || aId, cover: resolveMeta(aId).cover });
      };

      // 1. Prequel/Sequel between adjacent groups
      for (let g = 0; g < groups.length - 1; g++) {
        for (const prevId of groups[g].ids) {
          for (const nextId of groups[g + 1].ids) {
            addReciprocalPair(prevId, nextId,
              { relation_type: 'SEQUEL', type_label: 'Sequel' },
              { relation_type: 'PREQUEL', type_label: 'Prequel' });
          }
        }
      }

      // 2. Alternative relations within each group
      for (const group of groups) {
        for (const altId of group.ids) {
          if (altId === group.mainId) continue;
          addReciprocalPair(group.mainId, altId,
            { relation_type: 'ALTERNATIVE', type_label: 'Alternative Version' },
            { relation_type: 'ALTERNATIVE', type_label: 'Alternative Version' });
        }
      }

      // 3. Standalone source/episode/update entries attach to the nearest
      // preceding group (or this entry, if nothing precedes them yet).
      let lastGroupMainId = externalId;
      for (const e of classified) {
        if (e.kind === 'group') { lastGroupMainId = e.mainId; continue; }
        const [mainToItem, itemToMain] = REL_TYPE_TO_PAIR[e.kind];
        addReciprocalPair(lastGroupMainId, e.mainId, mainToItem, itemToMain);
      }

      // Local SagaViewer cache (separate feature/table from media_relations
      // above) — still gets the full ordered chain so grouping/browsing keeps
      // working exactly as before.
      if (fullChain.length > 1) {
        const chain: SagaEntry[] = fullChain.map(id => id === externalId ? {
          externalId,
          title: entry.title_main || externalId,
          cover: entry.cover_url || null,
          format: entry.format || null,
          mediaType: entry.type,
          year: entry.release_year ?? null,
          month: entry.release_month ?? null,
          day: entry.release_day ?? null,
        } : {
          externalId: id,
          title: resolveMeta(id).title || id,
          cover: resolveMeta(id).cover,
          format: null,
          mediaType: id.split(':')[0] || 'anime',
          year: null,
          month: null,
          day: null,
        });
        await saveCachedSaga(chain, sagaName).catch(err => console.error('Failed to save saga:', err));
      }

      const bundledDbRelations: DbMediaRelation[] = bundledRelations
        .filter(r => r.external_id.trim())
        .map(r => ({
          related_media_external_id: r.external_id.trim(),
          relation_type: r.type.toUpperCase(),
          type_label: r.type === 'update' ? 'Update' : 'Episode',
          title: r.title || r.external_id.trim(),
          cover: r.cover ?? null,
        }));

      const editableDbRelations: DbMediaRelation[] = editableRelations
        .filter(r => r.related_media_external_id.trim())
        .map(r => ({
          related_media_external_id: r.related_media_external_id.trim(),
          relation_type: r.relation_type,
          type_label: r.type_label,
          title: r.title || r.related_media_external_id.trim(),
          cover: r.cover ?? null,
        }));

      // Current entry: Editable Relations + Bundled In + its own slice of the
      // chain-derived edges. Editable Relations already carries every
      // pre-existing relation that isn't part of the saga chain, so nothing
      // else needs to pass through untouched.
      const currentChainRows = chainRelations.filter(r => r.media_external_id === externalId);
      const currentFinalRelations: DbMediaRelation[] = [...editableDbRelations, ...bundledDbRelations, ...currentChainRows];
      await saveMediaRelations(externalId, currentFinalRelations)
        .catch(err => console.error('Failed to save relations:', err));

      await invoke('save_media_saga_groups', { groups: sagaGroups })
        .catch(err => console.error('Failed to save local saga groups:', err));

      // Every other entry in the chain also needs its own new prequel/sequel
      // edge written locally — fetch its existing relations first so this
      // only replaces the specific chain-managed edges pointing at something
      // inside this chain, keeping everything else (including any relation
      // to media outside this chain) untouched.
      const otherChainIds = [...new Set(fullChain.filter(id => id !== externalId))];
      for (const otherId of otherChainIds) {
        try {
          const existing = await getMediaRelations(otherId);
          const kept = (existing || []).filter(r =>
            !(ALL_CHAIN_RELATION_TYPES.includes(r.relation_type) && fullChain.includes(r.related_media_external_id))
          );
          const newRows = chainRelations.filter(r => r.media_external_id === otherId);
          await saveMediaRelations(otherId, [...kept, ...newRows]);
        } catch (err) {
          console.error(`Failed to propagate saga relation to ${otherId}:`, err);
        }
      }

      // Invalidate frontend session cache so changes load instantly
      invalidateCachedMediaData(externalId);
      for (const otherId of otherChainIds) {
        invalidateCachedMediaData(otherId);
      }

      if (onSaved) onSaved();

      // The PR touches more than the flat catalog row — it's a bundle so a
      // single collaborative-catalog file can also carry the entry's
      // characters, authors, and relations (bundled-in episodes/updates plus
      // the whole saga chain's edges — tagged per-media since the chain spans
      // more than just this entry) into the shared community database (see
      // scripts/build-database.js, which fans each field out into its own
      // table by that tag instead of assuming everything belongs to this
      // file's own entry).
      const bundle: ProposalBundle = {
        media_catalog: entry,
        media_relations: [
          ...currentFinalRelations.map(r => ({ ...r, media_external_id: externalId })),
          ...chainRelations.filter(r => r.media_external_id !== externalId),
        ],
        characters,
        media_authors: mediaAuthors,
        saga_groups: sagaGroups,
        saga_name: sagaName || undefined,
      };
      const changeSummary = buildChangeSummary(resolveMeta);

      const prUrl = await submitCollaborativeProposal(externalId, bundle, changeSummary, setStatusMsg);
      if (prUrl) openUrlInBrowser(prUrl);

      setTimeout(() => onClose(), 1500);

    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : 'Error communicating with GitHub API');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="pr-editor-overlay">
        <div className="pr-editor-modal pr-editor-modal--loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (!entry) return null;

  // ── Render helpers (close over entry/handleChange/isFieldChanged) ─────────

  const textField = (field: keyof MediaCatalogEntry, label: string) => (
    <Field label={label} changed={isFieldChanged(field)}>
      <input type="text" value={(entry[field] as string) || ''} onChange={e => handleChange(field, e.target.value)} />
    </Field>
  );

  const numberField = (field: keyof MediaCatalogEntry, label: string) => (
    <Field label={label} changed={isFieldChanged(field)} small>
      <input type="number" value={(entry[field] as number) || ''}
        onChange={e => handleChange(field, e.target.value ? parseInt(e.target.value, 10) : null)} />
    </Field>
  );

  const slotField = (field: keyof MediaCatalogEntry, label: string, opts?: {
    allowed?: string[]; restrict?: boolean; preview?: boolean; fullWidth?: boolean; dotClass?: string;
  }) => (
    <div style={{ position: 'relative' }}>
      <SlotInput label={label} value={entry[field] as string | undefined} onChange={v => handleChange(field, v)}
        allowedSuggestions={opts?.allowed} restrictToSuggestions={opts?.restrict}
        preview={opts?.preview} fullWidth={opts?.fullWidth} />
      <ChangedDot show={isFieldChanged(field)}
        className={`pr-editor-changed-dot ${opts?.dotClass ?? 'pr-editor-changed-dot--slot'}`} />
    </div>
  );

  const sectionTitle = (title: string, fields: Array<keyof MediaCatalogEntry>) => (
    <span className="pr-editor-section-title">
      {title}
      {fields.some(isFieldChanged) && <span className="pr-editor-section-changed-dot" />}
    </span>
  );

  const resolveMeta = createMetaResolver(externalId, { title: entry.title_main ?? null, cover: entry.cover_url ?? null }, sagaMeta);

  return createPortal(
    <div className="pr-editor-overlay" onClick={onClose}>
      <div className="pr-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-header" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span className="pr-editor-title">Edit Collaborative Catalog Entry</span>
            <span className="pr-editor-subtitle">ID: {externalId}</span>
          </div>
          {statusMsg && (
            <div className="pr-editor-header-status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--accent, #7c6af7)' }}>
              <div className="spinner spinner--small" style={{ width: '14px', height: '14px', border: '2px solid rgba(124, 106, 247, 0.2)', borderTopColor: 'var(--accent, #7c6af7)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span>{statusMsg}</span>
            </div>
          )}
        </div>

        <div className="pr-editor-body pr-editor-body--grid">
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error pr-editor-field--full">{errorMsg}</div>}

          {/* Left Column: Titles, Synopsis, Release, Progress */}
          <div className="pr-editor-col pr-editor-col--left">
            <div className="pr-editor-section">
              {sectionTitle('Titles & Synopsis', ['title_main', 'title_romaji', 'title_native', 'synopsis'])}
              <div className="pr-editor-form-grid">
                {textField('title_main', 'Main Title')}
                {textField('title_romaji', 'Romaji Title')}
                {textField('title_native', 'Native Title')}
                <Field label="Synopsis / Description" changed={isFieldChanged('synopsis')} full>
                  <textarea rows={6} value={entry.synopsis || ''} onChange={e => handleChange('synopsis', e.target.value)} />
                </Field>
              </div>
            </div>

            <div className="pr-editor-section">
              {sectionTitle('Release & Progress', ['release_year', 'release_month', 'release_day', 'total_count', 'total_count_2'])}
              <div className="pr-editor-field-row">
                <div className="pr-editor-subgroup">
                  <div className="pr-editor-subgroup-fields">
                    {numberField('release_year', 'Year')}
                    {numberField('release_month', 'Month')}
                    {numberField('release_day', 'Day')}
                  </div>
                </div>

                <div className="pr-editor-subgroup-divider" />

                <div className="pr-editor-subgroup">
                  <div className="pr-editor-subgroup-fields">
                    {numberField('total_count', 'Episodes / Chapters')}
                    {numberField('total_count_2', 'Seasons / Volumes')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Media Assets, Classification, Saga, Collaborators */}
          <div className="pr-editor-col pr-editor-col--right">
            <div className="pr-editor-section">
              {sectionTitle('Media Assets', ['cover_url', 'banners_csv'])}
              <div className="pr-editor-assets-box">
                <div className="pr-editor-field pr-editor-cover-section">
                  <label>
                    Cover URL
                    <ChangedDot show={isFieldChanged('cover_url')} />
                  </label>
                  <div className="pr-editor-cover-uploader">
                    <div className="pr-editor-cover-preview-card">
                      {entry.cover_url ? (
                        <img src={entry.cover_url} alt="" />
                      ) : (
                        <span className="pr-editor-cover-placeholder">No Cover</span>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Paste cover image URL..."
                      value={entry.cover_url || ''}
                      onChange={e => handleChange('cover_url', e.target.value)}
                    />
                  </div>
                </div>

                <div className="pr-editor-field pr-editor-banner-section">
                  {slotField('banners_csv', 'Banner URLs', { preview: true, fullWidth: true, dotClass: 'pr-editor-changed-dot--banner' })}
                </div>
              </div>
            </div>

            <div className="pr-editor-section">
              {sectionTitle('Classification & Metadata', ['genres_csv', 'genres_tag_csv', 'platforms_csv', 'companies_cache_csv', 'authors_csv'])}
              <div className="pr-editor-classification-grid">
                {slotField('genres_csv', 'Genres', { allowed: ALL_GENRES, restrict: true })}
                {slotField('genres_tag_csv', 'Themes / Tags')}
                {slotField('platforms_csv', 'Platforms', { allowed: ALL_PLATFORMS, restrict: true })}
                {slotField('companies_cache_csv', 'Companies / Studios')}
                {slotField('authors_csv', 'Authors / Staff')}
              </div>
            </div>
          </div>

          {/* Column 3: Saga & Bundled */}
          <div className="pr-editor-col pr-editor-col--saga">
            <div className="pr-editor-section pr-editor-section--row">
              <div className="pr-editor-subsection pr-editor-subsection--saga">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1.25rem' }}>
                  <label className="pr-editor-subsection-label">Saga Name</label>
                  <input
                    type="text"
                    placeholder="Saga Name (e.g. Inazuma Eleven)"
                    value={sagaName}
                    onChange={e => setSagaName(e.target.value)}
                    className="pr-editor-media-card-group-input"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem', border: '1px solid rgba(124, 106, 247, 0.3)' }}
                  />
                </div>
                <label className="pr-editor-subsection-label">Saga order</label>
                <div className="pr-editor-media-group-cards" style={{ marginBottom: '1.25rem' }}>
                  {sagaOrder.map((id, index) => {
                    const meta = resolveMeta(id);
                    return (
                      <div
                        key={id}
                        data-saga-index={index}
                        className={`pr-editor-media-card${id === externalId ? ' pr-editor-media-card--current' : ''}${draggedSagaIndex === index ? ' pr-editor-media-card--dragging' : ''}`}
                        onPointerDown={() => setDraggedSagaIndex(index)}
                      >
                        <div className="pr-editor-media-card-cover">
                          {meta.cover
                            ? <img src={meta.cover} alt="" draggable={false} />
                            : <div className="pr-editor-media-card-placeholder" />}
                          {id !== externalId && (
                            <button
                              type="button"
                              className="pr-editor-media-card-remove"
                              onPointerDown={e => e.stopPropagation()}
                              onClick={() => removeFromSaga(id)}
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <div className="pr-editor-media-card-title" title={meta.title || id}>
                          {meta.title || id}
                        </div>
                        <select
                          value={sagaRelationTypes[id] || 'main'}
                          onChange={e => updateSagaRelationType(id, e.target.value as SagaRelationType)}
                          className="pr-editor-media-card-select"
                        >
                          {SAGA_RELATION_TYPE_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="Concept Group..."
                          value={sagaGroups[id] || ''}
                          onChange={e => updateSagaGroup(id, e.target.value)}
                          className="pr-editor-media-card-group-input"
                        />
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="pr-editor-add-btn" onClick={() => setSearchPopupMode('saga')}>+ Add to Saga</button>
              </div>

              <div className="pr-editor-subgroup-divider" style={{ alignSelf: 'stretch', width: '1px', background: 'var(--border-color, #2d2a24)' }} />

              <div className="pr-editor-subsection pr-editor-subsection--saga" style={{ flex: 1, minWidth: '200px' }}>
                <label className="pr-editor-subsection-label">Relations</label>
                <div className="pr-editor-media-group-cards" style={{ marginBottom: '1.25rem' }}>
                  {editableRelations.map(r => (
                    <div key={r.related_media_external_id} className="pr-editor-media-card">
                      <div className="pr-editor-media-card-cover">
                        {r.cover
                          ? <img src={r.cover} alt="" />
                          : <div className="pr-editor-media-card-placeholder" />}
                        <button
                          type="button"
                          className="pr-editor-media-card-remove"
                          onClick={() => removeEditableRelation(r.related_media_external_id)}
                        >
                          ×
                        </button>
                      </div>
                      <div className="pr-editor-media-card-title" title={r.title || r.related_media_external_id}>
                        {r.title || r.related_media_external_id}
                      </div>
                      <select
                        value={r.relation_type}
                        onChange={e => updateEditableRelationType(r.related_media_external_id, e.target.value)}
                        className="pr-editor-media-card-select"
                        style={{ fontSize: '0.7rem' }}
                      >
                        {/* Pre-existing relations can carry a type outside the
                            curated add-new list (CHARACTER, OTHER, ...) — keep
                            it selectable so the dropdown doesn't silently
                            snap to a different value on first render. */}
                        {!EDITABLE_RELATION_OPTIONS.includes(r.relation_type) && (
                          <option value={r.relation_type}>{r.type_label}</option>
                        )}
                        {EDITABLE_RELATION_OPTIONS.map(type => (
                          <option key={type} value={type}>
                            {RELATION_TYPE_LABELS[type] || type}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <select
                    value={selectedRelationType}
                    onChange={e => setSelectedRelationType(e.target.value)}
                    className="pr-editor-media-card-select"
                    style={{ fontSize: '0.7rem' }}
                  >
                    {EDITABLE_RELATION_OPTIONS.map(type => (
                      <option key={type} value={type}>
                        {RELATION_TYPE_LABELS[type] || type}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="pr-editor-add-btn" onClick={() => setSearchPopupMode('relations')}>+ Add Relation</button>
                </div>
              </div>

              <div className="pr-editor-subgroup-divider" style={{ alignSelf: 'stretch', width: '1px', background: 'var(--border-color, #2d2a24)' }} />

              <div className="pr-editor-subsection pr-editor-subsection--bundled" style={{ width: '220px', flexShrink: 0 }}>
                <label className="pr-editor-subsection-label">Bundled In</label>
                <div className="pr-editor-bundled-list">
                  {bundledRelations.map(r => (
                    <div key={r.external_id} className="pr-editor-bundled-row">
                      <div className="pr-editor-bundled-card">
                        <div className="pr-editor-bundled-card-cover">
                          {r.cover ? (
                            <img src={r.cover} alt="" />
                          ) : (
                            <div className="pr-editor-bundled-card-placeholder" />
                          )}
                          <button
                            type="button"
                            className="pr-editor-bundled-card-remove"
                            onClick={() => removeBundledRelation(r.external_id)}
                          >
                            ×
                          </button>
                        </div>
                        <div className="pr-editor-bundled-card-info">
                          <span className="pr-editor-bundled-card-title" title={r.title || r.external_id}>
                            {r.title || r.external_id}
                          </span>
                        </div>
                      </div>
                      <select
                        value={r.type}
                        onChange={e => updateBundledRelationType(r.external_id, e.target.value as BundledRelation['type'])}
                        className="pr-editor-bundled-select"
                      >
                        <option value="episode">Episode</option>
                        <option value="update">Update</option>
                      </select>
                    </div>
                  ))}
                </div>
                <button type="button" className="pr-editor-add-btn" onClick={() => setSearchPopupMode('bundled')}>+ Add</button>
              </div>
            </div>
          </div>
        </div>

        <div className="pr-editor-footer">
          <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleSubmit} disabled={submitting || !hasChanges()}>
            {submitting ? 'Submitting...' : 'Submit Proposal'}
          </button>
        </div>
      </div>

      {searchPopupMode === 'saga' && (
        <MediaSearchPopup
          onSelect={addToSaga}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={sagaOrder}
          closeOnSelect={false}
        />
      )}

      {searchPopupMode === 'bundled' && (
        <MediaSearchPopup
          onSelect={addBundledRelation}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...bundledRelations.map(r => r.external_id)]}
        />
      )}

      {searchPopupMode === 'relations' && (
        <MediaSearchPopup
          onSelect={addEditableRelation}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...editableRelations.map(r => r.related_media_external_id)]}
          closeOnSelect={false}
        />
      )}
    </div>,
    document.body
  );
}
