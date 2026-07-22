// handleSubmit's I/O sequence, split out of PrEditorModal.tsx: builds the
// saga-chain edges, persists locally, propagates reciprocal relations, and
// (in 'proposal' mode) submits the GitHub PR. Takes precomputed diff values
// instead of the component's own closures.
import { saveCatalogEntry, saveMediaRelations, getMediaRelationsForEditor, getCatalogEntry } from '../../lib/tauri/catalog';
import { saveCharactersSkeleton } from '../../lib/tauri/characters';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from '../../lib/tauri/catalog';
import type { DbMediaCharacter } from '../../lib/tauri/characters';
import type { SagaEntry } from '../../lib/anilist/saga';
import { saveCachedSaga } from '../../lib/tauri/catalog';
import { invalidateCachedMediaData } from '../../lib/media/mediaService';
import { classifySagaChain, createMetaResolver, type MediaMeta } from '../../lib/media/sagaGrouping';
import { submitCollaborativeProposal, openUrlInBrowser, type ProposalBundle } from '../../lib/github/submitCollaborativeProposal';
import { REL_TYPE_TO_PAIR } from '../../lib/media/constants';
import { ALL_CHAIN_RELATION_TYPES, type SagaRelationType } from '../../lib/media/sagaTypes';
import type { BundledRelation, EditableRelation } from './PrEditorModal';

// A proposal only needs enough to identify the row plus whatever the user
// actually hand-edited (`editedFields`) — auto-fetched fields (synopsis,
// score, ...) would just make the shared catalog inconsistent across users.
function minimalProposalCatalogEntry(entry: MediaCatalogEntry, editedFields: readonly (keyof MediaCatalogEntry)[]): MediaCatalogEntry {
  const minimal: MediaCatalogEntry = {
    id: entry.id,
    external_id: entry.external_id,
    type: entry.type,
    title_main: entry.title_main,
    source: entry.source,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    blocked_at: entry.blocked_at, // always a deliberate curator action, never auto-fetched
  };
  for (const field of editedFields) {
    (minimal as any)[field] = entry[field];
  }
  return minimal;
}

// Last write wins per (related_media_external_id, relation_type) — the saga
// chain's freshly-resolved rows are concatenated last, so they win over a
// stale editable/existing row for the same pair.
function dedupeRelations(relations: DbMediaRelation[]): DbMediaRelation[] {
  const byKey = new Map<string, DbMediaRelation>();
  for (const rel of relations) {
    byKey.set(`${rel.related_media_external_id}:${rel.relation_type}`, rel);
  }
  return [...byKey.values()];
}

// Self-contained proposal bundle for a saga member other than the one open
// in the editor — only its relations changed, so no scalar catalog fields.
function buildRelatedProposalBundle(
  externalId: string,
  catalogEntry: MediaCatalogEntry,
  relations: DbMediaRelation[],
  sagaName: string,
): { externalId: string; bundle: ProposalBundle } {
  return {
    externalId,
    bundle: {
      media_catalog: minimalProposalCatalogEntry(catalogEntry, []),
      media_relations: relations.map(r => ({ ...r, media_external_id: externalId })),
      characters: [],
      media_authors: [],
      saga_name: sagaName || undefined,
    },
  };
}

export interface SubmitPrEditorParams {
  entry: MediaCatalogEntry;
  externalId: string;
  mode: 'proposal' | 'local';
  sagaOrder: string[];
  originalSagaOrder: string[];
  sagaRelationTypes: Record<string, SagaRelationType>;
  sagaGroups: Record<string, string>;
  sagaName: string;
  sagaMeta: Record<string, MediaMeta>;
  bundledRelations: BundledRelation[];
  originalBundledIds: Set<string>;
  containedRelations: BundledRelation[];
  originalContainedIds: Set<string>;
  editableRelations: EditableRelation[];
  characters: DbMediaCharacter[];
  charactersChanged: boolean;
  mediaAuthors: DbMediaAuthor[];
  sagaChanged: boolean;
  editedFields: (keyof MediaCatalogEntry)[];
  changeSummary: string;
  onSaved?: () => void;
  onClose: () => void;
  setStatusMsg: (msg: string) => void;
}

export async function submitPrEditorChanges(p: SubmitPrEditorParams): Promise<void> {
  const { entry, externalId, mode } = p;

  await saveCatalogEntry(entry);
  invalidateCachedMediaData(externalId);
  if (entry.external_id && entry.external_id !== externalId) {
    invalidateCachedMediaData(entry.external_id);
  }

  const resolveMeta = createMetaResolver(externalId, { title: entry.title_main || externalId, cover: entry.cover_url || null }, p.sagaMeta);

  // classifySagaChain clusters sagaOrder into groups + standalone entries;
  // walked pairwise below, every adjacent group gets a SEQUEL/PREQUEL edge.
  const fullChain = p.sagaOrder;
  const classified = classifySagaChain(fullChain, p.sagaRelationTypes, p.sagaGroups);
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

  // 2. Alternative relations within each group. The "#N" in type_label is
  // each side's position within group.ids, so reconstructSagaOrder can
  // recover a manual reorder instead of falling back to release date.
  for (const group of groups) {
    const mainIndex = group.ids.indexOf(group.mainId);
    for (const altId of group.ids) {
      if (altId === group.mainId) continue;
      const altIndex = group.ids.indexOf(altId);
      addReciprocalPair(group.mainId, altId,
        { relation_type: 'ALTERNATIVE', type_label: `Alternative Version #${mainIndex}` },
        { relation_type: 'ALTERNATIVE', type_label: `Alternative Version #${altIndex}` });
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

  // Local SagaViewer cache (separate from media_relations) still gets the full ordered chain.
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
    await saveCachedSaga(chain, p.sagaName).catch(err => console.error('Failed to save saga:', err));
  }

  const bundledDbRelations: DbMediaRelation[] = p.bundledRelations
    .filter(r => r.external_id.trim())
    .map(r => ({
      related_media_external_id: r.external_id.trim(),
      relation_type: 'PART_OF',
      type_label: 'Part of',
      title: r.title || r.external_id.trim(),
      cover: r.cover ?? null,
    }));

  const containedDbRelations: DbMediaRelation[] = p.containedRelations
    .filter(r => r.external_id.trim())
    .map(r => ({
      related_media_external_id: r.external_id.trim(),
      relation_type: 'EPISODE',
      type_label: 'Episode',
      title: r.title || r.external_id.trim(),
      cover: r.cover ?? null,
    }));

  const editableDbRelations: DbMediaRelation[] = p.editableRelations
    .filter(r => r.related_media_external_id.trim())
    .map(r => ({
      related_media_external_id: r.related_media_external_id.trim(),
      relation_type: r.relation_type,
      type_label: r.type_label,
      title: r.title || r.related_media_external_id.trim(),
      cover: r.cover ?? null,
    }));

  // Editable Relations already carries every pre-existing relation outside the saga chain.
  const currentChainRows = chainRelations.filter(r => r.media_external_id === externalId);
  const currentFinalRelations: DbMediaRelation[] = dedupeRelations(
    [...editableDbRelations, ...bundledDbRelations, ...containedDbRelations, ...currentChainRows]
  );
  await saveMediaRelations(externalId, currentFinalRelations)
    .catch(err => console.error('Failed to save relations:', err));

  if (p.charactersChanged) {
    await saveCharactersSkeleton(externalId, p.characters)
      .catch(err => console.error('Failed to save characters:', err));
  }

  // Every other chain member gets its chain-managed edges rewritten too — union
  // with originalSagaOrder so a just-removed member's stale reciprocal edge
  // doesn't pull it back into the saga via get_transitive_relation_ids.
  const otherChainIds = p.sagaChanged
    ? [...new Set([...fullChain, ...p.originalSagaOrder].filter(id => id !== externalId))]
    : [];

  // Each saga member gets its own proposal file, so the same PR carries every affected member's update.
  const otherProposalEntries: { externalId: string; bundle: ProposalBundle }[] = [];
  for (const otherId of otherChainIds) {
    try {
      const existing = await getMediaRelationsForEditor(otherId);
      const kept = (existing || []).filter(r =>
        !(ALL_CHAIN_RELATION_TYPES.includes(r.relation_type) && p.originalSagaOrder.includes(r.related_media_external_id))
      );
      const newRows = chainRelations.filter(r => r.media_external_id === otherId);
      const otherRelations = dedupeRelations([...kept, ...newRows]);
      await saveMediaRelations(otherId, otherRelations);

      // saveMediaRelations already tombstoned any dropped pair, so a resync won't reintroduce it.
      const otherEntry = await getCatalogEntry(otherId).catch(() => null);
      if (otherEntry && mode !== 'local') {
        otherProposalEntries.push(
          buildRelatedProposalBundle(otherId, otherEntry, otherRelations, p.sagaName),
        );
      }
    } catch (err) {
      console.error(`Failed to propagate saga relation to ${otherId}:`, err);
    }
  }

  // Bundled In is reciprocal: the target needs an EPISODE relation back here, re-synced each save.
  const currentBundledIds = new Set(p.bundledRelations.map(r => r.external_id.trim()).filter(Boolean));
  const bundledTargetsToSync = new Set([...currentBundledIds, ...p.originalBundledIds]);
  for (const targetId of bundledTargetsToSync) {
    try {
      const existing = await getMediaRelationsForEditor(targetId);
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

  // Same reciprocity, opposite direction: Contains needs a PART_OF relation on each child.
  const currentContainedIds = new Set(p.containedRelations.map(r => r.external_id.trim()).filter(Boolean));
  const containedTargetsToSync = new Set([...currentContainedIds, ...p.originalContainedIds]);
  for (const childId of containedTargetsToSync) {
    try {
      const existing = await getMediaRelationsForEditor(childId);
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

  if (p.onSaved) p.onSaved();

  if (mode === 'local') {
    // Already wrote straight to the local DB — nothing to propose upstream.
    p.setStatusMsg('Guardado en la base de datos local.');
    setTimeout(() => p.onClose(), 1000);
    return;
  }

  // Saga-chain edges pointing at other members ride in otherProposalEntries
  // instead; only hand-edited catalog fields go along (minimalProposalCatalogEntry).
  const bundle: ProposalBundle = {
    media_catalog: minimalProposalCatalogEntry(entry, p.editedFields),
    media_relations: currentFinalRelations.map(r => ({ ...r, media_external_id: externalId })),
    characters: p.characters,
    media_authors: p.mediaAuthors,
    saga_name: p.sagaName || undefined,
  };

  const proposalEntries = [{ externalId, bundle }, ...otherProposalEntries];
  const prUrl = await submitCollaborativeProposal(externalId, proposalEntries, p.changeSummary, p.setStatusMsg);
  if (prUrl) openUrlInBrowser(prUrl);

  setTimeout(() => p.onClose(), 1500);
}
