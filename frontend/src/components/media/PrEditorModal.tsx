import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '../../lib/tauri';
import { getCatalogEntry, getMediaAuthors } from '../../lib/tauri/catalog';
import { invalidateCachedMediaData, fetchMediaDataInternal } from '../../lib/media/mediaService';
import { mapMediaDataToCatalogEntry } from '../../lib/media/catalog-mapper';
import type { MediaCatalogEntry, DbMediaAuthor } from '../../lib/tauri/catalog';
import { getMediaCharacters, getAllCharacters, type DbMediaCharacter, type CharacterEntry } from '../../lib/tauri/characters';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { submitPrEditorChanges } from './pr-editor-submit';
import { loadPrEditorRelationsAndSaga } from './pr-editor-load';
import { buildPrEditorChangeSummary } from './pr-editor-change-summary';
import { mergeResyncFields, buildResyncCharacters, appendResyncRelations } from './pr-editor-resync';
import { MediaSearchPopup } from './MediaSearchPopup';
import { CharacterSearchPopup } from './CharacterSearchPopup';
import { SlotInput } from './SlotInput';
import {
  EDITABLE_RELATION_OPTIONS,
  type SagaRelationType,
} from '../../lib/media/sagaTypes';
import { createMetaResolver, type MediaMeta } from '../../lib/media/sagaGrouping';
import { ALL_PLATFORMS, ALL_GENRES } from '../../lib/constants/igdbData';
import { DIFF_FIELDS } from '../../lib/media/constants';
import { getReleaseDateKey } from '../../lib/media/mapper-utils';
import { normField, ChangedDot, Field } from '../shared/PrEditorField';
import { useDragReorder } from './hooks/useDragReorder';
import { PrEditorCharactersSection } from './PrEditorCharactersSection';
import { PrEditorRelationCardList } from './PrEditorRelationCardList';
import { PrEditorSagaOrderSection } from './PrEditorSagaOrderSection';
import { PrEditorRelationsSection } from './PrEditorRelationsSection';
import { PrEditorChangelogPanel } from './PrEditorChangelogPanel';
import { getT } from '../../i18n/client';
import { CANONICAL_RELATION_LABELS } from '../../lib/media/canonical-relations';

// Always saved as a PART_OF relation — there's no per-item type to pick
// anymore (previously episode/update, shown as a dropdown).
export interface BundledRelation {
  external_id: string;
  title?: string | null;
  cover?: string | null;
}

// Editable relations: ADAPTATION, SPIN_OFF, ALTERNATIVE, etc (not saga-managed)
export interface EditableRelation {
  related_media_external_id: string;
  relation_type: string;
  type_label: string;
  title?: string | null;
  cover?: string | null;
}

interface Props {
  externalId: string;
  onClose: () => void;
  onSaved?: () => void;
  // 'local' (admin catalog panel) writes straight to the local DB and skips
  // branch/PR creation entirely — everything up to and including onSaved()
  // already writes locally regardless of mode, so this only gates the
  // GitHub submission step below it.
  mode?: 'proposal' | 'local';
  // Set when opened from an already-merged GitHub entry (CatalogAdminPanel's
  // "GitHub" tab) — field names present locally (media_catalog, possibly via
  // a live-fetch enrichment) but absent from the actual GitHub bundle that
  // was opened. Dimmed in the form so it's visually clear which values are
  // already on GitHub vs. which are just known locally and haven't been
  // proposed yet.
  nonGithubFields?: Set<string>;
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

export function PrEditorModal({ externalId, onClose, onSaved, mode = 'proposal', nonGithubFields }: Props) {
  const t = getT();
  const tm = t.media;
  // Shown in the editor, in the UI's own language.
  const relationLabels = tm.relations;
  // What actually gets persisted to type_label — always English, regardless
  // of UI language, so the shared catalog doesn't mix languages per-row.
  const canonicalRelationLabels = CANONICAL_RELATION_LABELS;

  const [loading, setLoading] = useState(true);
  // Every 'proposal'-mode edit ends in a GitHub submission — checked up
  // front instead of only at the very end of handleSubmit, so a signed-out
  // user isn't let in to spend time filling out an edit that can only fail
  // once they hit save. 'local' mode (the admin catalog panel) never
  // submits upstream, so it has nothing to gate here.
  const [githubGate, setGithubGate] = useState<'checking' | 'ok' | 'signed-out'>(mode === 'local' ? 'ok' : 'checking');
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
  const [originalMediaAuthors, setOriginalMediaAuthors] = useState<DbMediaAuthor[]>([]);

  const [searchPopupMode, setSearchPopupMode] = useState<'saga' | 'bundled' | 'contains' | 'relations' | null>(null);

  useEffect(() => {
    if (mode === 'local') return;
    let cancelled = false;
    invoke<string | null>('get_github_token').catch(() => null).then(token => {
      if (!cancelled) setGithubGate(token ? 'ok' : 'signed-out');
    });
    return () => { cancelled = true; };
  }, [mode]);

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
        const result = await loadPrEditorRelationsAndSaga(externalId);
        setBundledRelations(result.bundledRelations);
        setOriginalBundledIds(result.originalBundledIds);
        setContainedRelations(result.containedRelations);
        setOriginalContainedIds(result.originalContainedIds);
        setEditableRelations(result.editableRelations);
        setOriginalEditableRelationTypes(result.originalEditableRelationTypes);
        if (result.currentEntry) {
          setEntry(result.currentEntry);
          setOriginalEntry(result.currentEntry);
        }
        setSagaMeta(result.sagaMeta);
        setSagaOrder(result.sagaOrder);
        setOriginalSagaOrder(result.originalSagaOrder);
        setSagaRelationTypes(result.sagaRelationTypes);
        setOriginalSagaRelationTypes(result.originalSagaRelationTypes);
        setSagaGroups(result.sagaGroups);
        setOriginalSagaGroups(result.originalSagaGroups);
        setSagaName(result.sagaName);
        setOriginalSagaName(result.originalSagaName);
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
    getMediaAuthors(externalId).then(a => { setMediaAuthors(a); setOriginalMediaAuthors(a); }).catch(() => { setMediaAuthors([]); setOriginalMediaAuthors([]); });
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
  const reorderBundled = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= bundledRelations.length || toIndex >= bundledRelations.length) return;
    const next = [...bundledRelations];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setBundledRelations(next);
  };

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
  const reorderContained = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= containedRelations.length || toIndex >= containedRelations.length) return;
    const next = [...containedRelations];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setContainedRelations(next);
  };

  const { draggedIndex: draggedBundledIndex, setDraggedIndex: setDraggedBundledIndex } =
    useDragReorder('bundledIndex', reorderBundled);
  const { draggedIndex: draggedContainedIndex, setDraggedIndex: setDraggedContainedIndex } =
    useDragReorder('containedIndex', reorderContained);

  // ── Editable relation handlers ────────────────────────────────────────────

  const addEditableRelation = (result: ApiSearchResult) => {
    if (!editableRelations.some(r => r.related_media_external_id === result.externalId)) {
      // Type is picked afterward on the card's own select (same one shown
      // for pre-existing relations), not before adding — a default here is
      // just the starting point.
      setEditableRelations([...editableRelations, {
        related_media_external_id: result.externalId,
        relation_type: DEFAULT_NEW_RELATION_TYPE,
        type_label: canonicalRelationLabels[DEFAULT_NEW_RELATION_TYPE] || DEFAULT_NEW_RELATION_TYPE,
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };
  const updateEditableRelationType = (id: string, relationType: string) =>
    setEditableRelations(prev => prev.map(r => r.related_media_external_id === id
      ? { ...r, relation_type: relationType, type_label: canonicalRelationLabels[relationType] || relationType }
      : r));
  const removeEditableRelation = (id: string) =>
    setEditableRelations(prev => prev.filter(r => r.related_media_external_id !== id));

  const handleChange = (field: keyof MediaCatalogEntry, value: string | number | null) => {
    if (!entry) return;
    setEntry({ ...entry, [field]: value === '' ? null : value });
  };

  const [isResyncing, setIsResyncing] = useState(false);

  const handleResync = async () => {
    if (!externalId || isResyncing) return;
    setIsResyncing(true);
    setStatusMsg('Descargando datos oficiales...');

    try {
      invalidateCachedMediaData(externalId);
      const liveData = await fetchMediaDataInternal(externalId);

      if (!liveData) {
        setStatusMsg('No se encontraron datos en la API');
        setTimeout(() => setStatusMsg(''), 3000);
        setIsResyncing(false);
        return;
      }

      const partialFromLive = mapMediaDataToCatalogEntry(liveData, externalId);

      setEntry(prev => prev ? mergeResyncFields(prev, partialFromLive) : prev);

      const newCharacters = buildResyncCharacters(liveData, characters.length > 0);
      if (newCharacters) setCharacters(newCharacters);

      setEditableRelations(prev => appendResyncRelations(prev, liveData, externalId));

      setStatusMsg('Datos oficiales descargados para campos vacíos');
      setTimeout(() => setStatusMsg(''), 3500);
    } catch (err) {
      console.error('Error durante resync:', err);
      setStatusMsg('Error al descargar datos');
      setTimeout(() => setStatusMsg(''), 3000);
    } finally {
      setIsResyncing(false);
    }
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
      // Only used for the GitHub upload merge (submitCollaborativeProposal's
      // mergeListByKey) — tells "removed this session" apart from "never
      // loaded it" so an upstream row someone else added isn't clobbered.
      removedCharacterIds: originalCharacters
        .filter(c => !characters.some(cur => cur.external_id === c.external_id))
        .map(c => c.external_id),
      removedAuthorIds: originalMediaAuthors
        .filter(a => !mediaAuthors.some(cur => cur.external_id === a.external_id))
        .map(a => a.external_id),
    };
  };

  const hasChanges = () => {
    if (!entry || !originalEntry) return false;
    // Not in DIFF_FIELDS — it's a curator flag toggled by its own dedicated
    // "Eliminar de Metadea" button, not a regular diffable field with a
    // label, but flipping it is still a real change that must enable Submit.
    if (entry.blocked_at !== originalEntry.blocked_at) return true;
    if (DIFF_FIELDS.some(([field]) => isFieldChanged(field))) return true;
    const d = getDiff();
    return d.addedBundled.length > 0 || d.removedBundledIds.length > 0
      || d.addedContained.length > 0 || d.removedContainedIds.length > 0
      || d.addedEditableRelations.length > 0 || d.removedEditableRelationIds.length > 0 || d.changedEditableRelations.length > 0
      || d.addedSaga.length > 0 || d.removedSaga.length > 0
      || d.sagaOrderChanged || d.relTypesChanged || d.groupsChanged || d.sagaNameChanged;
  };

  const buildChangeSummary = (resolveMeta: (id: string) => MediaMeta): string => {
    if (!entry) return '';
    return buildPrEditorChangeSummary({
      entry,
      originalEntry,
      isFieldChanged,
      diff: getDiff(),
      resolveMeta,
      originalEditableRelationTypes,
      sagaOrder,
      sagaRelationTypes,
      sagaName,
      originalSagaName,
      charactersChanged: charactersChanged(),
      charactersCount: characters.length,
      mediaAuthorsCount: mediaAuthors.length,
    });
  };

  const handleSubmit = async () => {
    if (!entry) return;
    setSubmitting(true);
    setErrorMsg('');

    try {
      const resolveMeta = createMetaResolver(externalId, { title: entry.title_main || externalId, cover: entry.cover_url || null }, sagaMeta);
      const sagaChangeDiff = getDiff();
      const sagaChanged = sagaChangeDiff.sagaOrderChanged || sagaChangeDiff.relTypesChanged
        || sagaChangeDiff.groupsChanged || sagaChangeDiff.addedSaga.length > 0 || sagaChangeDiff.removedSaga.length > 0;
      const editedFields = DIFF_FIELDS.filter(([field]) => isFieldChanged(field)).map(([field]) => field);
      // Union of every relation-editing UI's own removals — media_relations
      // has no per-category split once saved (see mergeListByKey), so the
      // GitHub merge just needs "which related_media_external_id ids did
      // this session actually remove", regardless of which list they came from.
      const removedRelationIds = [
        ...sagaChangeDiff.removedBundledIds,
        ...sagaChangeDiff.removedContainedIds,
        ...sagaChangeDiff.removedEditableRelationIds,
      ];

      await submitPrEditorChanges({
        entry,
        externalId,
        mode,
        sagaOrder,
        originalSagaOrder,
        sagaRelationTypes,
        sagaGroups,
        sagaName,
        sagaMeta,
        bundledRelations,
        originalBundledIds,
        containedRelations,
        originalContainedIds,
        editableRelations,
        characters,
        charactersChanged: charactersChanged(),
        mediaAuthors,
        sagaChanged,
        editedFields,
        removedRelationIds,
        removedCharacterIds: sagaChangeDiff.removedCharacterIds,
        removedAuthorIds: sagaChangeDiff.removedAuthorIds,
        changeSummary: buildChangeSummary(resolveMeta),
        onSaved,
        onClose,
        setStatusMsg,
      });
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : 'Error communicating with GitHub API');
    } finally {
      setSubmitting(false);
    }
  };

  if (githubGate === 'checking') {
    return (
      <div className="pr-editor-overlay">
        <div className="pr-editor-modal pr-editor-modal--loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (githubGate === 'signed-out') {
    return createPortal(
      <div className="pr-editor-overlay" onClick={onClose}>
        <div className="pr-editor-modal pr-editor-modal--narrow" onClick={e => e.stopPropagation()}>
          <div className="pr-editor-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', textAlign: 'center', padding: '3rem 2rem' }}>
            <p className="pr-editor-title">Inicia sesión con GitHub para editar</p>
            <p className="pr-editor-subtitle">
              Cualquier edición aquí se propone como una Pull Request al catálogo comunitario —
              inicia sesión con GitHub en Settings antes de continuar.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" className="pr-editor-btn pr-editor-btn--cancel" onClick={onClose}>Cerrar</button>
              <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={() => { window.location.href = '/settings'; }}>
                Ir a Settings
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

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

  const isLocalOnly = (field: keyof MediaCatalogEntry) => nonGithubFields?.has(field) ?? false;

  const textField = (field: keyof MediaCatalogEntry, label: string) => (
    <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)}>
      <input type="text" value={(entry[field] as string) || ''} onChange={e => handleChange(field, e.target.value)} />
    </Field>
  );

  const numberField = (field: keyof MediaCatalogEntry, label: string) => (
    <Field label={label} changed={isFieldChanged(field)} small dim={isLocalOnly(field)}>
      <input type="number" value={(entry[field] as number) || ''}
        onChange={e => handleChange(field, e.target.value ? parseInt(e.target.value, 10) : null)} />
    </Field>
  );

  // Options come straight from the i18n formats dictionary (media.formats) —
  // it already carries every format key both AniList (TV/MOVIE/OVA/...) and
  // IGDB (GAME/REMAKE/REMASTER/.../VISUAL_NOVEL) mappers can produce, so this
  // never drifts out of sync with what a live fetch would set automatically.
  const mediaTypesDict = (tm.search?.types ?? {
    anime: 'Anime',
    manga: 'Manga',
    lnovel: 'Novela Ligera',
    game: 'Videojuego',
    vnovel: 'Novela Visual',
    movie: 'Película',
    series: 'Serie',
    book: 'Libro',
    comic: 'Cómic',
  }) as Record<string, string>;

  const typeField = (field: keyof MediaCatalogEntry, label: string) => {
    const currentType = entry[field] as string;
    const isGameOrVn = currentType === 'game' || currentType === 'vnovel';

    if (!isGameOrVn) {
      return (
        <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)}>
          <input type="text" value={mediaTypesDict[currentType] || currentType || ''} disabled style={{ opacity: 0.7 }} />
        </Field>
      );
    }

    return (
      <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)}>
        <select value={currentType || ''} onChange={e => handleChange(field, e.target.value || null)}>
          <option value="game">{mediaTypesDict.game || 'Videojuego'}</option>
          <option value="vnovel">{mediaTypesDict.vnovel || 'Novela Visual'}</option>
        </select>
      </Field>
    );
  };

  const formatField = (field: keyof MediaCatalogEntry, label: string) => (
    <Field label={label} changed={isFieldChanged(field)} dim={isLocalOnly(field)}>
      <select value={(entry[field] as string) || ''} onChange={e => handleChange(field, e.target.value || null)}>
        <option value="">—</option>
        {Object.keys(tm.formats)
          .sort((a, b) => tm.formats[a as keyof typeof tm.formats].localeCompare(tm.formats[b as keyof typeof tm.formats]))
          .map(key => (
            <option key={key} value={key}>{tm.formats[key as keyof typeof tm.formats]}</option>
          ))}
      </select>
    </Field>
  );

  const slotField = (field: keyof MediaCatalogEntry, label: string, opts?: {
    allowed?: string[]; restrict?: boolean; preview?: boolean; fullWidth?: boolean; dotClass?: string;
  }) => (
    <div style={{ position: 'relative' }} className={isLocalOnly(field) ? 'pr-editor-field--dim' : undefined}>
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
      <div className="pr-editor-modal pr-editor-modal--narrow" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-header" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span className="pr-editor-title">Edit Collaborative Catalog Entry</span>
            <span className="pr-editor-subtitle">ID: {externalId}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {statusMsg && (
              <div className="pr-editor-header-status" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--accent, #7c6af7)' }}>
                <div className="spinner spinner--small" style={{ width: '14px', height: '14px', border: '2px solid rgba(124, 106, 247, 0.2)', borderTopColor: 'var(--accent, #7c6af7)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span>{statusMsg}</span>
              </div>
            )}
            <button
              type="button"
              className="pr-editor-block-btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              title="Descarga los datos oficiales de la API para rellenar únicamente las secciones y campos vacíos sin sobrescribir tus cambios."
              disabled={isResyncing}
              onClick={handleResync}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: isResyncing ? 'spin 1s linear infinite' : undefined }}>
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
              {isResyncing ? 'Descargando...' : 'Re-sync datos vacíos'}
            </button>
            <button
              type="button"
              className={`pr-editor-block-btn${entry.blocked_at ? ' pr-editor-block-btn--active' : ''}`}
              title="Oculta esta entrada de búsqueda/relaciones/sagas para todos los usuarios — reserva el ID sin borrarlo. Vuelve a pulsar para deshacer."
              onClick={() => handleChange('blocked_at', entry.blocked_at ? null : new Date().toISOString())}
            >
              Eliminar de Metadea
            </button>
          </div>
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
                <Field label="Synopsis / Description" changed={isFieldChanged('synopsis')} full dim={isLocalOnly('synopsis')}>
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
                <div className={`pr-editor-field pr-editor-cover-section${isLocalOnly('cover_url') ? ' pr-editor-field--dim' : ''}`}>
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
              {sectionTitle('Classification & Metadata', ['type', 'format', 'genres_csv', 'genres_tag_csv', 'platforms_csv', 'authors_csv'])}
              <div className="pr-editor-classification-grid">
                {typeField('type', 'Type')}
                {formatField('format', 'Format')}
                {slotField('genres_csv', 'Genres', { allowed: ALL_GENRES, restrict: true })}
                {slotField('genres_tag_csv', 'Themes / Tags')}
                {slotField('platforms_csv', 'Platforms', { allowed: ALL_PLATFORMS, restrict: true })}
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

              <PrEditorRelationCardList
                label="Bundled In"
                addLabel="+ Add"
                dataAttr="bundled-index"
                relations={bundledRelations}
                draggedIndex={draggedBundledIndex}
                onStartDrag={setDraggedBundledIndex}
                onRemove={removeBundledRelation}
                onOpenSearch={() => setSearchPopupMode('bundled')}
              />

              <div className="pr-editor-subgroup-divider" style={{ alignSelf: 'stretch', width: '1px', background: 'var(--border-color, #2d2a24)' }} />
              <PrEditorRelationCardList
                label="Contains"
                addLabel="+ Add"
                dataAttr="contained-index"
                relations={containedRelations}
                draggedIndex={draggedContainedIndex}
                onStartDrag={setDraggedContainedIndex}
                onRemove={removeContainedRelation}
                onOpenSearch={() => setSearchPopupMode('contains')}
              />
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

      <PrEditorChangelogPanel />

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
          includeIgdbBundles
        />
      )}

      {searchPopupMode === 'contains' && (
        <MediaSearchPopup
          onSelect={addContainedRelation}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...containedRelations.map(r => r.external_id)]}
          closeOnSelect={false}
          includeIgdbExpandedEditions
          includeRemasters
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
