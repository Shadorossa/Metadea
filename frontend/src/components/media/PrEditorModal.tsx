import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '../../lib/tauri';
import { getCatalogEntry, saveCatalogEntry, saveCachedSaga, getMediaRelations, saveMediaRelations, getMediaAuthors } from '../../lib/tauri/catalog';
import { invalidateCachedMediaData } from '../../lib/media/mediaService';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from '../../lib/tauri/catalog';
import { getMediaCharacters, getAllCharacters, saveCharactersSkeleton, type DbMediaCharacter, type CharacterEntry } from '../../lib/tauri/characters';
import type { SagaEntry } from '../../lib/anilist/saga';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { MediaSearchPopup } from './MediaSearchPopup';
import { CharacterSearchPopup } from './CharacterSearchPopup';
import { SlotInput } from './SlotInput';
import {
  BUNDLE_RELATION_TYPES, PART_OF_RELATION_TYPES, CONTAINS_RELATION_TYPES,
  ALL_CHAIN_RELATION_TYPES, EDITABLE_RELATION_OPTIONS,
  isSagaRelationType, normalizeLegacyRelationType, type SagaRelationType,
} from '../../lib/media/sagaTypes';
import { classifySagaChain, createMetaResolver, reconstructSagaOrder, type MediaMeta } from '../../lib/media/sagaGrouping';
import { submitCollaborativeProposal, openUrlInBrowser, type ProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import { ALL_PLATFORMS, ALL_GENRES } from '../../lib/constants/igdbData';
import { DIFF_FIELDS, REL_TYPE_TO_PAIR } from '../../lib/media/constants';
import { getReleaseDateKey, compareByReleaseDate } from '../../lib/media/mapper-utils';
import { normField, ChangedDot, Field } from '../shared/PrEditorField';
import { useDragReorder } from './hooks/useDragReorder';
import { PrEditorCharactersSection } from './PrEditorCharactersSection';
import { PrEditorBundledSection } from './PrEditorBundledSection';
import { PrEditorContainsSection } from './PrEditorContainsSection';
import { PrEditorSagaOrderSection } from './PrEditorSagaOrderSection';
import { PrEditorRelationsSection } from './PrEditorRelationsSection';
import { getT } from '../../i18n/client';
import { CANONICAL_RELATION_LABELS } from '../../lib/media/canonical-relations';

// Always saved as a PART_OF relation — there's no per-item type to pick
// anymore (previously episode/update, shown as a dropdown).
interface BundledRelation {
  external_id: string;
  title?: string | null;
  cover?: string | null;
}

interface Props {
  externalId: string;
  onClose: () => void;
  onSaved?: () => void;
}


const DEFAULT_NEW_RELATION_TYPE = 'REL_ADAPTATION';

// True when two string records differ after normalizing each value (missing
// keys fall back through `normalize`), regardless of which record a key is in.
function recordsDiffer(a: Record<string, string>, b: Record<string, string>, normalize: (v?: string) => string): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (normalize(a[k]) !== normalize(b[k])) return true;
  }
  return false;
}

export function PrEditorModal({ externalId, onClose, onSaved }: Props) {
  const t = getT();
  const tm = t.media;
  // Shown in the editor, in the UI's own language.
  const relationLabels = tm.relations;
  // What actually gets persisted to type_label — always English, regardless
  // of UI language, so the shared catalog doesn't mix languages per-row.
  const canonicalRelationLabels = CANONICAL_RELATION_LABELS;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [entry, setEntry] = useState<MediaCatalogEntry | null>(null);
  const [originalEntry, setOriginalEntry] = useState<MediaCatalogEntry | null>(null);

  const [bundledRelations, setBundledRelations] = useState<BundledRelation[]>([]);
  const [originalBundledIds, setOriginalBundledIds] = useState<Set<string>>(new Set());

  // Reverse of Bundled In — items that have *this* entry as their Bundled In
  // (i.e. this entry is the container). Read/write mirrors bundledRelations
  // exactly, just the other direction (EPISODE instead of PART_OF).
  const [containedRelations, setContainedRelations] = useState<BundledRelation[]>([]);
  const [originalContainedIds, setOriginalContainedIds] = useState<Set<string>>(new Set());

  // Editable relations: ADAPTATION, SPIN_OFF, ALTERNATIVE, etc (not saga-managed)
  interface EditableRelation {
    related_media_external_id: string;
    relation_type: string;
    type_label: string;
    title?: string | null;
    cover?: string | null;
  }
  const [editableRelations, setEditableRelations] = useState<EditableRelation[]>([]);
  // Maps id -> its original relation_type, both to know which ids existed
  // before (Set-like via .has) and to detect an in-place type change on an
  // id that's still present (a plain id Set couldn't tell the two apart).
  const [originalEditableRelationTypes, setOriginalEditableRelationTypes] = useState<Map<string, string>>(new Map());

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
  // 'main' ids can share a free-text Concept Group name (sagaGroups) to
  // collapse into one saga-timeline step and become alternates of each other
  // (e.g. a console remaster + its PC original); 'source'/'episode'/'update'
  // ids attach to the nearest preceding group instead (see classifySagaChain).
  const [sagaRelationTypes, setSagaRelationTypes] = useState<Record<string, SagaRelationType>>({});
  const [sagaGroups, setSagaGroups] = useState<Record<string, string>>({});
  const [originalSagaRelationTypes, setOriginalSagaRelationTypes] = useState<Record<string, SagaRelationType>>({});
  const [originalSagaGroups, setOriginalSagaGroups] = useState<Record<string, string>>({});
  const [sagaName, setSagaName] = useState('');
  const [originalSagaName, setOriginalSagaName] = useState('');


  const [characters, setCharacters] = useState<DbMediaCharacter[]>([]);
  const [originalCharacters, setOriginalCharacters] = useState<DbMediaCharacter[]>([]);
  const [allCharacters, setAllCharacters] = useState<CharacterEntry[]>([]);
  const [showCharSearch, setShowCharSearch] = useState(false);
  const [mediaAuthors, setMediaAuthors] = useState<DbMediaAuthor[]>([]);

  const [searchPopupMode, setSearchPopupMode] = useState<'saga' | 'bundled' | 'contains' | 'relations' | null>(null);

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

        // Bundled In (this entry belongs to something else — PART_OF/UPDATE)
        // vs. Contains (something else belongs to this entry — EPISODE) are
        // opposite directions of the same relationship; BUNDLE_RELATION_TYPES
        // covers both only for excluding them from the plain Relations list
        // below.
        const bundled = rels
          .filter(r => PART_OF_RELATION_TYPES.includes(r.relation_type))
          .map(r => ({
            external_id: r.related_media_external_id,
            title: r.title,
            cover: r.cover,
          }));
        setBundledRelations(bundled);
        setOriginalBundledIds(new Set(bundled.map(r => r.external_id)));

        const contained = rels
          .filter(r => CONTAINS_RELATION_TYPES.includes(r.relation_type))
          .map(r => ({
            external_id: r.related_media_external_id,
            title: r.title,
            cover: r.cover,
          }));
        setContainedRelations(contained);
        setOriginalContainedIds(new Set(contained.map(r => r.external_id)));

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
          .map(r => {
            // Rows saved before game relations used canonical type keys
            // (see igdb-mapper.ts) still carry the raw English label as
            // relation_type (e.g. "Expanded Edition") — normalize on load so
            // the dropdown pre-selects the real, localized option instead of
            // rendering it as an extra unlocalized duplicate.
            const relationType = normalizeLegacyRelationType(r.relation_type);
            return {
              related_media_external_id: r.related_media_external_id,
              relation_type: relationType,
              type_label: (canonicalRelationLabels as any)[relationType] || r.type_label || relationType,
              title: r.title,
              cover: r.cover,
            };
          });
        setEditableRelations(editable);
        setOriginalEditableRelationTypes(new Map(editable.map(r => [r.related_media_external_id, r.relation_type])));

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
              if (isSagaRelationType(lower) && lower !== 'main') {
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
        setContainedRelations([]);
        setEditableRelations([]);
      } finally {
        setLoading(false);
      }
    };

    load();
    getMediaCharacters(externalId).then(chars => { setCharacters(chars); setOriginalCharacters(chars); }).catch(() => { setCharacters([]); setOriginalCharacters([]); });
    getMediaAuthors(externalId).then(setMediaAuthors).catch(() => setMediaAuthors([]));
    getAllCharacters().then(setAllCharacters).catch(() => setAllCharacters([]));
  }, [externalId]);

  // ── Character handlers ──────────────────────────────────────────────────────

  const removeCharacter = (charExternalId: string) =>
    setCharacters(characters.filter(c => c.external_id !== charExternalId));
  const updateCharacterRole = (charExternalId: string, role: string) =>
    setCharacters(characters.map(c => c.external_id === charExternalId ? { ...c, relation_type: role } : c));
  const addCharacter = (c: CharacterEntry | ApiSearchResult) => {
    const extId = 'externalId' in c ? c.externalId : c.external_id;
    const name = 'externalId' in c ? (c.titleMain || 'Unknown Name') : c.name;
    const imageUrl = 'externalId' in c ? (c.coverUrl || null) : c.image_url;

    if (characters.some(existing => existing.external_id === extId)) return;
    setCharacters([...characters, {
      external_id: extId,
      name: name,
      image_url: imageUrl,
      relation_type: 'SUPPORTING',
      character_name: null,
    }]);
  };
  const charactersChanged = () => {
    const key = (c: DbMediaCharacter) => `${c.external_id}::${c.relation_type ?? ''}`;
    const a = new Set(characters.map(key));
    const b = new Set(originalCharacters.map(key));
    return a.size !== b.size || [...a].some(k => !b.has(k));
  };

  // ── Saga handlers ──────────────────────────────────────────────────────────

  const addToSaga = (result: ApiSearchResult) => {
    if (sagaOrder.includes(result.externalId)) return;

    // Catches a *different* id with the same title (e.g. duplicate IGDB
    // entries per platform) — confirm rather than block outright, since two
    // different works can coincidentally share a title.
    const normalizedTitle = result.titleMain.trim().toLowerCase();
    const duplicateTitleId = sagaOrder.find(id => {
      const existingTitle = id === externalId ? entry?.title_main : sagaMeta[id]?.title;
      return existingTitle?.trim().toLowerCase() === normalizedTitle;
    });
    if (duplicateTitleId) {
      const proceed = window.confirm(
        `"${result.titleMain}" ya parece estar en la saga (mismo título, id distinto: ${duplicateTitleId} vs ${result.externalId}). ¿Añadirla de todas formas?`
      );
      if (!proceed) return;
    }

    setSagaOrder([...sagaOrder, result.externalId]);
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
  const updateSagaGroup = (id: string, group: string) =>
    setSagaGroups(prev => ({ ...prev, [id]: group }));

  const reorderRelations = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= editableRelations.length || toIndex >= editableRelations.length) return;
    const next = [...editableRelations];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setEditableRelations(next);
  };

  const { draggedIndex: draggedSagaIndex, setDraggedIndex: setDraggedSagaIndex } =
    useDragReorder('sagaIndex', reorderSaga);
  const { draggedIndex: draggedRelationIndex, setDraggedIndex: setDraggedRelationIndex } =
    useDragReorder('relationIndex', reorderRelations);

  // ── Bundled-in handlers ────────────────────────────────────────────────────

  const addBundledRelation = (result: ApiSearchResult) => {
    if (!bundledRelations.some(r => r.external_id === result.externalId)) {
      setBundledRelations([...bundledRelations, {
        external_id: result.externalId,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const removeBundledRelation = (id: string) =>
    setBundledRelations(prev => prev.filter(r => r.external_id !== id));

  // ── Contains handlers ──────────────────────────────────────────────────────

  const addContainedRelation = (result: ApiSearchResult) => {
    if (!containedRelations.some(r => r.external_id === result.externalId)) {
      setContainedRelations([...containedRelations, {
        external_id: result.externalId,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const removeContainedRelation = (id: string) =>
    setContainedRelations(prev => prev.filter(r => r.external_id !== id));

  // ── Editable relation handlers ────────────────────────────────────────────

  const addEditableRelation = (result: ApiSearchResult) => {
    if (!editableRelations.some(r => r.related_media_external_id === result.externalId)) {
      // Type is picked afterward on the card's own select (same one shown
      // for pre-existing relations), not before adding — a default here is
      // just the starting point.
      setEditableRelations([...editableRelations, {
        related_media_external_id: result.externalId,
        relation_type: DEFAULT_NEW_RELATION_TYPE,
        type_label: (canonicalRelationLabels as any)[DEFAULT_NEW_RELATION_TYPE] || DEFAULT_NEW_RELATION_TYPE,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const updateEditableRelationType = (id: string, relationType: string) =>
    setEditableRelations(prev => prev.map(r => r.related_media_external_id === id
      ? { ...r, relation_type: relationType, type_label: (canonicalRelationLabels as any)[relationType] || relationType }
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
      addedContained: containedRelations.filter(r => !originalContainedIds.has(r.external_id)),
      removedContainedIds: [...originalContainedIds].filter(id => !containedRelations.some(r => r.external_id === id)),
      addedEditableRelations: editableRelations.filter(r => !originalEditableRelationTypes.has(r.related_media_external_id)),
      removedEditableRelationIds: [...originalEditableRelationTypes.keys()].filter(id => !editableRelations.some(r => r.related_media_external_id === id)),
      changedEditableRelations: editableRelations.filter(r => {
        const originalType = originalEditableRelationTypes.get(r.related_media_external_id);
        return originalType !== undefined && originalType !== r.relation_type;
      }),
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
      || d.addedContained.length > 0 || d.removedContainedIds.length > 0
      || d.addedEditableRelations.length > 0 || d.removedEditableRelationIds.length > 0 || d.changedEditableRelations.length > 0
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
    for (const r of d.addedBundled) lines.push(`- Added Bundled In: ${formatWork(r.external_id, r.title)}`);
    for (const id of d.removedBundledIds) lines.push(`- Removed Bundled In: ${formatWork(id)}`);
    for (const r of d.addedContained) lines.push(`- Added Contains: ${formatWork(r.external_id, r.title)}`);
    for (const id of d.removedContainedIds) lines.push(`- Removed Contains: ${formatWork(id)}`);
    for (const r of d.addedEditableRelations) lines.push(`- Added Relation: ${formatWork(r.related_media_external_id, r.title)} (${r.type_label})`);
    for (const id of d.removedEditableRelationIds) lines.push(`- Removed Relation: ${formatWork(id)}`);
    for (const r of d.changedEditableRelations) {
      const before = originalEditableRelationTypes.get(r.related_media_external_id) ?? '';
      lines.push(`- Changed Relation Type: ${formatWork(r.related_media_external_id, r.title)} (${before} → ${r.relation_type})`);
    }

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

    if (charactersChanged()) lines.push(`- Characters: ${characters.length} character(s)`);
    else if (characters.length > 0) lines.push(`- Includes ${characters.length} cached character(s)`);
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
          relation_type: 'PART_OF',
          type_label: 'Part of',
          title: r.title || r.external_id.trim(),
          cover: r.cover ?? null,
        }));

      const containedDbRelations: DbMediaRelation[] = containedRelations
        .filter(r => r.external_id.trim())
        .map(r => ({
          related_media_external_id: r.external_id.trim(),
          relation_type: 'EPISODE',
          type_label: 'Episode',
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
      const currentFinalRelations: DbMediaRelation[] = [...editableDbRelations, ...bundledDbRelations, ...containedDbRelations, ...currentChainRows];
      await saveMediaRelations(externalId, currentFinalRelations)
        .catch(err => console.error('Failed to save relations:', err));

      if (charactersChanged()) {
        await saveCharactersSkeleton(externalId, characters)
          .catch(err => console.error('Failed to save characters:', err));
      }

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

      // Bundled In is reciprocal: the target needs an EPISODE relation
      // pointing back here. Re-synced each save so removing an entry also
      // removes its reciprocal side.
      const currentBundledIds = new Set(bundledRelations.map(r => r.external_id.trim()).filter(Boolean));
      const bundledTargetsToSync = new Set([...currentBundledIds, ...originalBundledIds]);
      for (const targetId of bundledTargetsToSync) {
        try {
          const existing = await getMediaRelations(targetId);
          const kept = (existing || []).filter(r =>
            !(r.relation_type === 'EPISODE' && r.related_media_external_id === externalId)
          );
          const rows = currentBundledIds.has(targetId)
            ? [...kept, {
                related_media_external_id: externalId,
                relation_type: 'EPISODE',
                type_label: 'Episode',
                title: entry.title_main || externalId,
                cover: entry.cover_url ?? null,
              }]
            : kept;
          await saveMediaRelations(targetId, rows);
          invalidateCachedMediaData(targetId);
        } catch (err) {
          console.error(`Failed to propagate bundled-in relation to ${targetId}:`, err);
        }
      }

      // Same reciprocity, opposite direction: Contains needs a PART_OF
      // relation written back on each child.
      const currentContainedIds = new Set(containedRelations.map(r => r.external_id.trim()).filter(Boolean));
      const containedTargetsToSync = new Set([...currentContainedIds, ...originalContainedIds]);
      for (const childId of containedTargetsToSync) {
        try {
          const existing = await getMediaRelations(childId);
          const kept = (existing || []).filter(r =>
            !(r.relation_type === 'PART_OF' && r.related_media_external_id === externalId)
          );
          const rows = currentContainedIds.has(childId)
            ? [...kept, {
                related_media_external_id: externalId,
                relation_type: 'PART_OF',
                type_label: 'Part of',
                title: entry.title_main || externalId,
                cover: entry.cover_url ?? null,
              }]
            : kept;
          await saveMediaRelations(childId, rows);
          invalidateCachedMediaData(childId);
        } catch (err) {
          console.error(`Failed to propagate contains relation to ${childId}:`, err);
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
                    {numberField('total_count', 'Eps / Chs')}
                    {numberField('total_count_2', 'Seas / Vols')}
                  </div>
                </div>
              </div>
            </div>

            <PrEditorCharactersSection
              t={t}
              characters={characters}
              changed={charactersChanged()}
              onRemove={removeCharacter}
              onUpdateRole={updateCharacterRole}
              onOpenSearch={() => setShowCharSearch(true)}
            />
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
              <PrEditorSagaOrderSection
                externalId={externalId}
                sagaName={sagaName}
                onSagaNameChange={setSagaName}
                sagaOrder={sagaOrder}
                sagaGroups={sagaGroups}
                draggedIndex={draggedSagaIndex}
                onStartDrag={setDraggedSagaIndex}
                onRemove={removeFromSaga}
                onUpdateGroup={updateSagaGroup}
                onOpenSearch={() => setSearchPopupMode('saga')}
                resolveMeta={resolveMeta}
              />

              <div className="pr-editor-subgroup-divider" style={{ alignSelf: 'stretch', width: '1px', background: 'var(--border-color, #2d2a24)' }} />

              <PrEditorRelationsSection
                editableRelations={editableRelations}
                relationOptions={EDITABLE_RELATION_OPTIONS}
                relationLabels={relationLabels as unknown as Record<string, string>}
                draggedIndex={draggedRelationIndex}
                onStartDrag={setDraggedRelationIndex}
                onRemove={removeEditableRelation}
                onUpdateType={updateEditableRelationType}
                onOpenSearch={() => setSearchPopupMode('relations')}
              />

              <div className="pr-editor-subgroup-divider" style={{ alignSelf: 'stretch', width: '1px', background: 'var(--border-color, #2d2a24)' }} />

              <PrEditorBundledSection
                bundledRelations={bundledRelations}
                onRemove={removeBundledRelation}
                onOpenSearch={() => setSearchPopupMode('bundled')}
              />

              {containedRelations.length > 0 && (
                <>
                  <div className="pr-editor-subgroup-divider" style={{ alignSelf: 'stretch', width: '1px', background: 'var(--border-color, #2d2a24)' }} />
                  <PrEditorContainsSection
                    containedRelations={containedRelations}
                    onRemove={removeContainedRelation}
                    onOpenSearch={() => setSearchPopupMode('contains')}
                  />
                </>
              )}
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
          closeOnSelect={false}
        />
      )}

      {searchPopupMode === 'contains' && (
        <MediaSearchPopup
          onSelect={addContainedRelation}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...containedRelations.map(r => r.external_id)]}
          closeOnSelect={false}
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

      {showCharSearch && (
        <CharacterSearchPopup
          onSelect={addCharacter}
          onClose={() => setShowCharSearch(false)}
          excludeIds={characters.map(c => c.external_id)}
        />
      )}
    </div>,
    document.body
  );
}
