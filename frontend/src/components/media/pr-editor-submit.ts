// handleSubmit's I/O sequence, split out of PrEditorModal.tsx: builds the
// saga-chain relation edges, persists everything locally, propagates
// reciprocal relations to bundled/contained/chain members, and (in
// 'proposal' mode) submits the GitHub PR. Takes fully-computed diff values
// (editedFields/changeSummary/sagaChanged/charactersChanged) rather than the
// component's own diff closures, so this function has no hidden dependency
// on component state beyond what's passed in.
import { invoke } from '../../lib/tauri';
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

// Every user's local catalog can carry a different, auto-fetched snapshot of
// the same work (synopsis/genres/platforms/score are all just whatever the
// live API happened to return whenever this install last synced) — none of
// that is a curator decision worth proposing, and different users uploading
// their own random subset of it would make the shared catalog inconsistent
// for no reason (every install re-fetches those fields from the live API on
// its own anyway). A proposal's media_catalog only ever needs enough to
// identify the row (id/external_id/type/title_main/source) plus whichever
// fields the user actually hand-edited — `editedFields` — so the GitHub diff
// reads as "here's what I curated", not "here's my whole local cache".
function minimalProposalCatalogEntry(entry: MediaCatalogEntry, editedFields: readonly (keyof MediaCatalogEntry)[]): MediaCatalogEntry {
  const minimal: MediaCatalogEntry = {
    id: entry.id,
    external_id: entry.external_id,
    type: entry.type,
    title_main: entry.title_main,
    source: entry.source,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    // A block decision is always a deliberate curator action, never
    // auto-fetched — carried over unconditionally like the identity fields,
    // independent of whether it happens to be in `editedFields`.
    blocked_at: entry.blocked_at,
  };
  for (const field of editedFields) {
    (minimal as any)[field] = entry[field];
  }
  return minimal;
}

// Builds a self-contained GitHub proposal file for a saga member other than
// the one actually open in the editor — same shape as the primary entry's
// own bundle, just carrying only that member's own relations instead of a
// snapshot of the whole saga. Never edited by hand here — only its relations
// were touched — so its own media_catalog carries no scalar fields beyond
// identity.
function buildRelatedProposalBundle(
  externalId: string,
  catalogEntry: MediaCatalogEntry,
  relations: DbMediaRelation[],
  sagaGroups: Record<string, string>,
  sagaName: string,
): { externalId: string; bundle: ProposalBundle } {
  return {
    externalId,
    bundle: {
      media_catalog: minimalProposalCatalogEntry(catalogEntry, []),
      media_relations: relations.map(r => ({ ...r, media_external_id: externalId })),
      characters: [],
      media_authors: [],
      saga_groups: sagaGroups,
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

  // sagaOrder is the whole saga's chronological order (this entry included)
  // — classifySagaChain clusters it into groups (main/alternative ids
  // sharing a Concept Group name) and standalone source/episode/update
  // entries. Walked pairwise, every adjacent *group* produces a SEQUEL edge
  // (earlier → later) and a PREQUEL edge (later → earlier) — for every id in
  // the chain, not just the one currently open in the editor.
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

  // 2. Alternative relations within each group. The trailing "#N" in
  // type_label is each side's own position within group.ids (which mirrors
  // the exact drag order the user just set) — there's no SEQUEL/PREQUEL edge
  // between two alternates, so without this hint reconstructSagaOrder had
  // nothing but release date to break the tie between them on next load,
  // silently reverting any manual reorder within a Concept Group.
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

  // Current entry: Editable Relations + Bundled In + its own slice of the
  // chain-derived edges. Editable Relations already carries every
  // pre-existing relation that isn't part of the saga chain, so nothing else
  // needs to pass through untouched.
  const currentChainRows = chainRelations.filter(r => r.media_external_id === externalId);
  const currentFinalRelations: DbMediaRelation[] = [...editableDbRelations, ...bundledDbRelations, ...containedDbRelations, ...currentChainRows];
  await saveMediaRelations(externalId, currentFinalRelations)
    .catch(err => console.error('Failed to save relations:', err));

  if (p.charactersChanged) {
    await saveCharactersSkeleton(externalId, p.characters)
      .catch(err => console.error('Failed to save characters:', err));
  }

  await invoke('save_media_saga_groups', { groups: p.sagaGroups })
    .catch(err => console.error('Failed to save local saga groups:', err));

  // Every other entry in the chain also needs its own new prequel/sequel edge
  // written locally — fetch its existing relations first so this only
  // replaces the specific chain-managed edges pointing at something inside
  // this chain, keeping everything else untouched. Also covers entries just
  // *removed* from the saga (union with originalSagaOrder): their own row
  // still carries the old SEQUEL/PREQUEL/ALTERNATIVE edges back into the
  // chain, and get_transitive_relation_ids walks relations from every owner
  // — so a removed film's stale reciprocal edge alone was enough to pull it
  // right back into the saga next time. Only runs when the saga itself
  // actually changed, not on every single save.
  const otherChainIds = p.sagaChanged
    ? [...new Set([...fullChain, ...p.originalSagaOrder].filter(id => id !== externalId))]
    : [];

  // Each saga member gets its own self-contained proposal file, collected
  // here as the loop touches each one locally, so the same GitHub PR also
  // carries every other affected member's own updated relations.
  const otherProposalEntries: { externalId: string; bundle: ProposalBundle }[] = [];
  for (const otherId of otherChainIds) {
    try {
      const existing = await getMediaRelationsForEditor(otherId);
      const kept = (existing || []).filter(r =>
        !(ALL_CHAIN_RELATION_TYPES.includes(r.relation_type) && p.originalSagaOrder.includes(r.related_media_external_id))
      );
      const newRows = chainRelations.filter(r => r.media_external_id === otherId);
      const otherRelations = [...kept, ...newRows];
      await saveMediaRelations(otherId, otherRelations);

      // saveMediaRelations above already tombstoned (in deleted_relations)
      // any pair that was in `existing` but dropped from `otherRelations` —
      // that's what stops a live resync on this member from silently
      // reintroducing exactly what was just removed here.
      const otherEntry = await getCatalogEntry(otherId).catch(() => null);
      if (otherEntry && mode !== 'local') {
        otherProposalEntries.push(
          buildRelatedProposalBundle(otherId, otherEntry, otherRelations, p.sagaGroups, p.sagaName),
        );
      }
    } catch (err) {
      console.error(`Failed to propagate saga relation to ${otherId}:`, err);
    }
  }

  // Bundled In is reciprocal: the target needs an EPISODE relation pointing
  // back here. Re-synced each save so removing an entry also removes its
  // reciprocal side.
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

  // Same reciprocity, opposite direction: Contains needs a PART_OF relation
  // written back on each child.
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
    // Everything above already wrote straight to the local DB — the admin
    // catalog panel doesn't propose anything upstream.
    p.setStatusMsg('Guardado en la base de datos local.');
    setTimeout(() => p.onClose(), 1000);
    return;
  }

  // The PR touches more than the flat catalog row — it's a bundle so this
  // entry's own collaborative-catalog file also carries its characters,
  // authors, and relations into the shared community database. Saga-chain
  // edges pointing at *other* members no longer ride along here — each
  // affected member gets its own self-contained file instead (see
  // otherProposalEntries above). Only the catalog fields actually hand-
  // edited in this session go along — see minimalProposalCatalogEntry.
  const bundle: ProposalBundle = {
    media_catalog: minimalProposalCatalogEntry(entry, p.editedFields),
    media_relations: currentFinalRelations.map(r => ({ ...r, media_external_id: externalId })),
    characters: p.characters,
    media_authors: p.mediaAuthors,
    saga_groups: p.sagaGroups,
    saga_name: p.sagaName || undefined,
  };

  const proposalEntries = [{ externalId, bundle }, ...otherProposalEntries];
  const prUrl = await submitCollaborativeProposal(externalId, proposalEntries, p.changeSummary, p.setStatusMsg);
  if (prUrl) openUrlInBrowser(prUrl);

  setTimeout(() => p.onClose(), 1500);
}
