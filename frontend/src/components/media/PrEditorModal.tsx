import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  getCatalogEntry, saveCatalogEntry,
  saveCachedSaga,
  getMediaRelations, saveMediaRelations,
  getMediaAuthors,
} from '../../lib/tauri/catalog';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from '../../lib/tauri/catalog';
import { getMediaCharacters, type MediaCharacter } from '../../lib/tauri/characters';
import type { SagaEntry } from '../../lib/anilist/saga';
import type { SearchResult as ApiSearchResult } from '../../lib/search';
import { MediaSearchPopup } from './MediaSearchPopup';
import { SlotInput } from './SlotInput';
import {
  BUNDLE_RELATION_TYPES, ALL_CHAIN_RELATION_TYPES, SAGA_RELATION_TYPE_OPTIONS,
  isSagaRelationType, type SagaRelationType,
} from '../../lib/media/sagaTypes';
import { classifySagaChain, createMetaResolver, type MediaMeta } from '../../lib/media/sagaGrouping';
import { submitCollaborativeProposal, openUrlInBrowser, type ProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import { ALL_PLATFORMS, ALL_GENRES } from '../../lib/constants/igdbData';

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

export function PrEditorModal({ externalId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [entry, setEntry] = useState<MediaCatalogEntry | null>(null);
  const [originalEntry, setOriginalEntry] = useState<MediaCatalogEntry | null>(null);

  const [bundledRelations, setBundledRelations] = useState<BundledRelation[]>([]);
  const [originalBundledIds, setOriginalBundledIds] = useState<Set<string>>(new Set());

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

  // Every other relation type (ADAPTATION, SIDE_STORY, SPIN_OFF, ...) is kept
  // as an untouched pass-through — save_media_relations replaces the *entire*
  // relation set for this media_external_id in one shot, so anything not
  // resurfaced here (e.g. from an AniList auto-sync) would otherwise be wiped
  // the moment this form saves.
  const [otherRelations, setOtherRelations] = useState<DbMediaRelation[]>([]);

  const [characters, setCharacters] = useState<MediaCharacter[]>([]);
  const [mediaAuthors, setMediaAuthors] = useState<DbMediaAuthor[]>([]);

  const [searchPopupMode, setSearchPopupMode] = useState<'saga' | 'bundled' | null>(null);

  useEffect(() => {
    getCatalogEntry(externalId)
      .then(res => {
        const resolved = res ?? {
          id: '',
          external_id: externalId,
          type: externalId.split(':')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        setEntry(resolved);
        setOriginalEntry(resolved);
      })
      .catch(err => {
        console.error('Failed to get catalog entry:', err);
        setErrorMsg('Error reading local data');
      })
      .finally(() => {
        (async () => {
          try {
            const rels = await getMediaRelations(externalId).catch(() => [] as DbMediaRelation[]);
            const bundled = rels.filter(r => BUNDLE_RELATION_TYPES.includes(r.relation_type));
            const others = rels.filter(r => !ALL_CHAIN_RELATION_TYPES.includes(r.relation_type));

            const bundledMapped = bundled.map(r => ({
              external_id: r.related_media_external_id,
              type: (r.relation_type === 'UPDATE' ? 'update' : 'episode') as BundledRelation['type'],
              title: r.title,
              cover: r.cover,
            }));
            setBundledRelations(bundledMapped);
            setOriginalBundledIds(new Set(bundledMapped.map(r => r.external_id)));
            setOtherRelations(others);

            const transitiveIds = await invoke<string[]>('get_transitive_relation_ids', { mediaExternalId: externalId }).catch(() => [] as string[]);
            if (!transitiveIds.includes(externalId)) {
              transitiveIds.push(externalId);
            }

            const entriesData = await Promise.all(
              transitiveIds.map(async id => ({ id, entry: await getCatalogEntry(id).catch(() => null) }))
            );
            const validEntries = entriesData.filter((x): x is { id: string; entry: MediaCatalogEntry } => x.entry !== null);

            const currentEntry = validEntries.find(x => x.id === externalId)?.entry;
            if (currentEntry) {
              setEntry(currentEntry);
              setOriginalEntry(currentEntry);
            }

            validEntries.sort((a, b) => {
              const yA = a.entry.release_year ?? Infinity, yB = b.entry.release_year ?? Infinity;
              if (yA !== yB) return yA - yB;
              const mA = a.entry.release_month ?? Infinity, mB = b.entry.release_month ?? Infinity;
              if (mA !== mB) return mA - mB;
              const dA = a.entry.release_day ?? Infinity, dB = b.entry.release_day ?? Infinity;
              if (dA !== dB) return dA - dB;
              return a.id.localeCompare(b.id);
            });

            const sortedIds = validEntries.map(x => x.id);
            setSagaOrder(sortedIds);
            setOriginalSagaOrder(sortedIds);

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
              invoke<string | null>('get_saga_name', { mediaExternalId: externalId }).catch(() => null)
            ]);
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
                } else if (r.relation_type === 'SOURCE' || r.relation_type === 'EPISODE' || r.relation_type === 'UPDATE') {
                  const lower = r.relation_type.toLowerCase();
                  if (isSagaRelationType(lower)) relTypesMap[otherId] = lower;
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
            setOtherRelations([]);
          } finally {
            setLoading(false);
          }
        })();

        getMediaCharacters(externalId).then(setCharacters).catch(() => setCharacters([]));
        getMediaAuthors(externalId).then(setMediaAuthors).catch(() => setMediaAuthors([]));
      });
  }, [externalId]);

  const addToSaga = (result: ApiSearchResult) => {
    if (!sagaOrder.includes(result.externalId)) setSagaOrder([...sagaOrder, result.externalId]);
    setSagaMeta(prev => ({ ...prev, [result.externalId]: { title: result.titleMain, cover: result.coverUrl } }));
  };
  const removeFromSaga = (external_id: string) => {
    if (external_id === externalId) return; // this entry can move, not leave its own saga
    setSagaOrder(sagaOrder.filter(id => id !== external_id));
  };
  const reorderSaga = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= sagaOrder.length || toIndex >= sagaOrder.length) return;
    const next = [...sagaOrder];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setSagaOrder(next);
  };

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

  const addBundledRelation = (result: ApiSearchResult) => {
    if (!bundledRelations.find(r => r.external_id === result.externalId)) {
      setBundledRelations([...bundledRelations, {
        external_id: result.externalId,
        type: 'episode',
        title: result.titleMain,
        cover: result.coverUrl,
      }]);
    }
  };

  const updateBundledRelation = (index: number, patch: Partial<BundledRelation>) => {
    setBundledRelations(bundledRelations.map((r, i) => i === index ? { ...r, ...patch } : r));
  };

  const removeBundledRelation = (index: number) => {
    setBundledRelations(bundledRelations.filter((_, i) => i !== index));
  };

  const handleChange = (field: keyof MediaCatalogEntry, value: string | number | null) => {
    if (!entry) return;
    setEntry({ ...entry, [field]: value === '' ? null : value });
  };

  // Human-readable "- " bullet list of everything this proposal adds or
  // changes, used as the PR body — diffs catalog fields against the entry as
  // it was when the modal opened, plus set-differences for the relation
  // buckets this editor manages (bundled-in, saga order).
  const buildChangeSummary = (resolveMeta: (id: string) => MediaMeta): string => {
    if (!entry) return '';
    const lines: string[] = [];

    const DIFF_FIELDS: Array<[keyof MediaCatalogEntry, string]> = [
      ['title_main', 'Main Title'], ['title_romaji', 'Romaji Title'], ['title_native', 'Native Title'],
      ['synopsis', 'Synopsis'], ['cover_url', 'Cover URL'], ['banners_csv', 'Banner URLs'],
      ['release_year', 'Release Year'], ['release_month', 'Release Month'], ['release_day', 'Release Day'],
      ['total_count', 'Episodes/Chapters'], ['total_count_2', 'Seasons/Volumes'],
      ['genres_csv', 'Genres'], ['genres_tag_csv', 'Themes/Tags'],
      ['platforms_csv', 'Platforms'], ['companies_cache_csv', 'Companies/Studios'], ['authors_csv', 'Authors/Staff'],
    ];
    for (const [field, label] of DIFF_FIELDS) {
      const before = originalEntry?.[field] ?? null;
      const after = entry[field] ?? null;
      if (before === after) continue;
      if (before == null || before === '') lines.push(`- Added ${label}: "${after}"`);
      else if (after == null || after === '') lines.push(`- Removed ${label} (was "${before}")`);
      else lines.push(`- Changed ${label}: "${before}" → "${after}"`);
    }

    const formatWork = (id: string, title?: string | null): string => {
      const displayTitle = title || resolveMeta(id).title;
      return displayTitle ? `${displayTitle} (${id})` : id;
    };

    const addedBundled = bundledRelations.filter(r => !originalBundledIds.has(r.external_id));
    for (const r of addedBundled) lines.push(`- Added Bundled In: ${formatWork(r.external_id, r.title)} (${r.type})`);
    const removedBundled = [...originalBundledIds].filter(id => !bundledRelations.some(r => r.external_id === id));
    for (const id of removedBundled) lines.push(`- Removed Bundled In: ${formatWork(id)}`);

    const originalSagaIds = new Set(originalSagaOrder);
    const addedSaga = sagaOrder.filter(id => id !== externalId && !originalSagaIds.has(id));
    const removedSaga = originalSagaOrder.filter(id => id !== externalId && !sagaOrder.includes(id));
    const sagaOrderChanged = sagaOrder.join(',') !== originalSagaOrder.join(',');

    const hasRelationTypesChanged = () => {
      const keys = new Set([...Object.keys(sagaRelationTypes), ...Object.keys(originalSagaRelationTypes)]);
      for (const k of keys) {
        if ((sagaRelationTypes[k] || 'main') !== (originalSagaRelationTypes[k] || 'main')) return true;
      }
      return false;
    };

    const hasGroupsChanged = () => {
      const keys = new Set([...Object.keys(sagaGroups), ...Object.keys(originalSagaGroups)]);
      for (const k of keys) {
        if ((sagaGroups[k] || '').trim() !== (originalSagaGroups[k] || '').trim()) return true;
      }
      return false;
    };

    const sagaRelationTypesChanged = hasRelationTypesChanged();
    const sagaGroupsChanged = hasGroupsChanged();
    const sagaNameChanged = sagaName !== originalSagaName;

    if (addedSaga.length > 0 || removedSaga.length > 0 || sagaOrderChanged || sagaRelationTypesChanged || sagaGroupsChanged || sagaNameChanged) {
      if (sagaNameChanged) {
        lines.push(`- Changed Saga Name: "${originalSagaName}" → "${sagaName}"`);
      }
      for (const id of addedSaga) {
        lines.push(`- Added to Saga: ${formatWork(id)} [type: ${sagaRelationTypes[id] || 'main'}]`);
      }
      for (const id of removedSaga) {
        lines.push(`- Removed from Saga: ${formatWork(id)}`);
      }
      if (sagaOrderChanged) {
        const chainLabel = sagaOrder.map(id => `${formatWork(id)} [type: ${sagaRelationTypes[id] || 'main'}]`).join(' → ');
        lines.push(addedSaga.length === 0 && removedSaga.length === 0
          ? `- Reordered Saga: ${chainLabel}`
          : `- Saga order: ${chainLabel}`);
      } else if (sagaRelationTypesChanged || sagaGroupsChanged) {
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
      const REL_TYPE_TO_PAIR: Record<'source' | 'episode' | 'update', [{ relation_type: string; type_label: string }, { relation_type: string; type_label: string }]> = {
        source:  [{ relation_type: 'SOURCE', type_label: 'Source Material' }, { relation_type: 'ADAPTATION', type_label: 'Adaptation' }],
        episode: [{ relation_type: 'EPISODE', type_label: 'Episode' }, { relation_type: 'PART_OF', type_label: 'Part of' }],
        update:  [{ relation_type: 'UPDATE', type_label: 'Update' }, { relation_type: 'PART_OF', type_label: 'Part of' }],
      };
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

      // Current entry: otherRelations (untouched pass-through) + Bundled In +
      // its own slice of the chain-derived edges.
      const currentChainRows = chainRelations.filter(r => r.media_external_id === externalId);
      const currentFinalRelations: DbMediaRelation[] = [...otherRelations, ...bundledDbRelations, ...currentChainRows];
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

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error communicating with GitHub API');
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

  const isFieldChanged = (field: keyof MediaCatalogEntry) => {
    if (!originalEntry) return false;
    const current = entry[field];
    const original = originalEntry[field];
    const normCurrent = current === '' || current === undefined ? null : current;
    const normOriginal = original === '' || original === undefined ? null : original;
    return normCurrent !== normOriginal;
  };

  const resolveMeta = createMetaResolver(externalId, { title: entry.title_main ?? null, cover: entry.cover_url ?? null }, sagaMeta);
  const sagaGroupEntries = classifySagaChain(sagaOrder, sagaRelationTypes, sagaGroups);

  return createPortal(
    <div className="pr-editor-overlay" onClick={onClose}>
      <div className="pr-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-header">
          <span className="pr-editor-title">Edit Collaborative Catalog Entry</span>
          <span className="pr-editor-subtitle">ID: {externalId}</span>
        </div>

        <div className="pr-editor-body pr-editor-body--grid">
          {errorMsg && <div className="pr-editor-alert pr-editor-alert--error pr-editor-field--full">{errorMsg}</div>}
          {statusMsg && <div className="pr-editor-alert pr-editor-alert--status pr-editor-field--full">{statusMsg}</div>}

          {/* Left Column: Titles, Synopsis, Release, Progress */}
          <div className="pr-editor-col pr-editor-col--left">
            <div className="pr-editor-section">
              <span className="pr-editor-section-title">
                Titles &amp; Synopsis
                {['title_main', 'title_romaji', 'title_native', 'synopsis'].some(f => isFieldChanged(f as any)) && (
                  <span className="pr-editor-section-changed-dot" />
                )}
              </span>
              <div className="pr-editor-form-grid">
                <div className="pr-editor-field">
                  <label>
                    Main Title
                    {isFieldChanged('title_main') && <span className="pr-editor-changed-dot" />}
                  </label>
                  <input type="text" value={entry.title_main || ''} onChange={e => handleChange('title_main', e.target.value)} />
                </div>

                <div className="pr-editor-field">
                  <label>
                    Romaji Title
                    {isFieldChanged('title_romaji') && <span className="pr-editor-changed-dot" />}
                  </label>
                  <input type="text" value={entry.title_romaji || ''} onChange={e => handleChange('title_romaji', e.target.value)} />
                </div>

                <div className="pr-editor-field">
                  <label>
                    Native Title
                    {isFieldChanged('title_native') && <span className="pr-editor-changed-dot" />}
                  </label>
                  <input type="text" value={entry.title_native || ''} onChange={e => handleChange('title_native', e.target.value)} />
                </div>

                <div className="pr-editor-field pr-editor-field--full">
                  <label>
                    Synopsis / Description
                    {isFieldChanged('synopsis') && <span className="pr-editor-changed-dot" />}
                  </label>
                  <textarea rows={6} value={entry.synopsis || ''} onChange={e => handleChange('synopsis', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="pr-editor-section">
              <span className="pr-editor-section-title">
                Release &amp; Progress
                {['release_year', 'release_month', 'release_day', 'total_count', 'total_count_2'].some(f => isFieldChanged(f as any)) && (
                  <span className="pr-editor-section-changed-dot" />
                )}
              </span>
              <div className="pr-editor-field-row">
                <div className="pr-editor-subgroup">
                  <div className="pr-editor-subgroup-fields">
                    <div className="pr-editor-field pr-editor-field--small">
                      <label>
                        Year
                        {isFieldChanged('release_year') && <span className="pr-editor-changed-dot" />}
                      </label>
                      <input type="number" value={entry.release_year || ''} onChange={e => handleChange('release_year', e.target.value ? parseInt(e.target.value, 10) : null)} />
                    </div>
                    <div className="pr-editor-field pr-editor-field--small">
                      <label>
                        Month
                        {isFieldChanged('release_month') && <span className="pr-editor-changed-dot" />}
                      </label>
                      <input type="number" value={entry.release_month || ''} onChange={e => handleChange('release_month', e.target.value ? parseInt(e.target.value, 10) : null)} />
                    </div>
                    <div className="pr-editor-field pr-editor-field--small">
                      <label>
                        Day
                        {isFieldChanged('release_day') && <span className="pr-editor-changed-dot" />}
                      </label>
                      <input type="number" value={entry.release_day || ''} onChange={e => handleChange('release_day', e.target.value ? parseInt(e.target.value, 10) : null)} />
                    </div>
                  </div>
                </div>

                <div className="pr-editor-subgroup-divider" />

                <div className="pr-editor-subgroup">
                  <div className="pr-editor-subgroup-fields">
                    <div className="pr-editor-field pr-editor-field--small">
                      <label>
                        Episodes / Chapters
                        {isFieldChanged('total_count') && <span className="pr-editor-changed-dot" />}
                      </label>
                      <input type="number" value={entry.total_count || ''} onChange={e => handleChange('total_count', e.target.value ? parseInt(e.target.value, 10) : null)} />
                    </div>
                    <div className="pr-editor-field pr-editor-field--small">
                      <label>
                        Seasons / Volumes
                        {isFieldChanged('total_count_2') && <span className="pr-editor-changed-dot" />}
                      </label>
                      <input type="number" value={entry.total_count_2 || ''} onChange={e => handleChange('total_count_2', e.target.value ? parseInt(e.target.value, 10) : null)} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Media Assets, Classification, Saga, Collaborators */}
          <div className="pr-editor-col pr-editor-col--right">
            <div className="pr-editor-section">
              <span className="pr-editor-section-title">
                Media Assets
                {['cover_url', 'banners_csv'].some(f => isFieldChanged(f as any)) && (
                  <span className="pr-editor-section-changed-dot" />
                )}
              </span>
              <div className="pr-editor-assets-box">
                <div className="pr-editor-field pr-editor-cover-section">
                  <label>
                    Cover URL
                    {isFieldChanged('cover_url') && <span className="pr-editor-changed-dot" />}
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
                  <div style={{ position: 'relative' }}>
                    <SlotInput label="Banner URLs" value={entry.banners_csv} onChange={v => handleChange('banners_csv', v)} preview fullWidth />
                    {isFieldChanged('banners_csv') && <span className="pr-editor-changed-dot pr-editor-changed-dot--banner" />}
                  </div>
                </div>
              </div>
            </div>

            <div className="pr-editor-section">
              <span className="pr-editor-section-title">
                Classification &amp; Metadata
                {['genres_csv', 'genres_tag_csv', 'platforms_csv', 'companies_cache_csv', 'authors_csv'].some(f => isFieldChanged(f as any)) && (
                  <span className="pr-editor-section-changed-dot" />
                )}
              </span>
              <div className="pr-editor-classification-grid">
                <div style={{ position: 'relative' }}>
                  <SlotInput label="Genres" value={entry.genres_csv} onChange={v => handleChange('genres_csv', v)} allowedSuggestions={ALL_GENRES} restrictToSuggestions />
                  {isFieldChanged('genres_csv') && <span className="pr-editor-changed-dot pr-editor-changed-dot--slot" />}
                </div>
                <div style={{ position: 'relative' }}>
                  <SlotInput label="Themes / Tags" value={entry.genres_tag_csv} onChange={v => handleChange('genres_tag_csv', v)} />
                  {isFieldChanged('genres_tag_csv') && <span className="pr-editor-changed-dot pr-editor-changed-dot--slot" />}
                </div>
                <div style={{ position: 'relative' }}>
                  <SlotInput label="Platforms" value={entry.platforms_csv} onChange={v => handleChange('platforms_csv', v)} allowedSuggestions={ALL_PLATFORMS} restrictToSuggestions />
                  {isFieldChanged('platforms_csv') && <span className="pr-editor-changed-dot pr-editor-changed-dot--slot" />}
                </div>
                <div style={{ position: 'relative' }}>
                  <SlotInput label="Companies / Studios" value={entry.companies_cache_csv} onChange={v => handleChange('companies_cache_csv', v)} />
                  {isFieldChanged('companies_cache_csv') && <span className="pr-editor-changed-dot pr-editor-changed-dot--slot" />}
                </div>
                <div style={{ position: 'relative' }}>
                  <SlotInput label="Authors / Staff" value={entry.authors_csv} onChange={v => handleChange('authors_csv', v)} />
                  {isFieldChanged('authors_csv') && <span className="pr-editor-changed-dot pr-editor-changed-dot--slot" />}
                </div>
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
                  {sagaOrder.map(id => {
                    const meta = resolveMeta(id);
                    const index = sagaOrder.indexOf(id);
                    const relType = sagaRelationTypes[id] || 'main';
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
                          value={relType}
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

              <div className="pr-editor-subsection pr-editor-subsection--bundled" style={{ width: '220px', flexShrink: 0 }}>
                <label className="pr-editor-subsection-label">Bundled In</label>
                <div className="pr-editor-bundled-list">
                  {bundledRelations.map((r, i) => (
                    <div key={i} className="pr-editor-bundled-row">
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
                        onChange={e => updateBundledRelationType(r.external_id, e.target.value as 'episode' | 'update')}
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
          <button type="button" className="pr-editor-btn pr-editor-btn--submit" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Proposal'}
          </button>
        </div>
      </div>

      {searchPopupMode === 'saga' && (
        <MediaSearchPopup
          onSelect={result => addToSaga(result)}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={sagaOrder}
          closeOnSelect={false}
        />
      )}

      {searchPopupMode === 'bundled' && (
        <MediaSearchPopup
          onSelect={result => addBundledRelation(result)}
          onClose={() => setSearchPopupMode(null)}
          excludeIds={[externalId, ...bundledRelations.map(r => r.external_id)]}
        />
      )}
    </div>,
    document.body
  );
}
