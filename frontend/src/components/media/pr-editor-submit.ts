// handleSubmit's I/O sequence, split out of PrEditorModal.tsx: builds the
// saga-chain edges, persists locally, propagates reciprocal relations, and
// (in 'proposal' mode) submits the GitHub PR. Takes precomputed diff values
// instead of the component's own closures.
import { saveCatalogEntry, saveMediaRelations, getMediaRelationsForEditor, getCatalogEntry } from '../../lib/tauri/catalog';
import { saveCharactersSkeleton } from '../../lib/tauri/characters';
import { getStoryArcsForMedia, type StoryArc } from '../../lib/tauri/story-arcs';
import type { MediaCatalogEntry, DbMediaRelation, DbMediaAuthor } from '../../lib/tauri/catalog';
import type { DbMediaCharacter } from '../../lib/tauri/characters';
import type { SagaEntry } from '../../lib/anilist/saga';
import { saveCachedSaga } from '../../lib/tauri/catalog';
import { invalidateCachedMediaData } from '../../lib/media/mediaService';
import { classifySagaChain, createMetaResolver, type MediaMeta } from '../../lib/media/sagaGrouping';
import { submitCollaborativeProposal, openUrlInBrowser, type ProposalBundle, type ProposalFileEntry } from '../../lib/github/submitCollaborativeProposal';
import { REL_TYPE_TO_PAIR } from '../../lib/media/constants';
import { ALL_CHAIN_RELATION_TYPES, type SagaRelationType } from '../../lib/media/sagaTypes';
import { setField } from '../../lib/shared/object-utils';
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
    setField(minimal, field, entry[field]);
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
// removedRelationIds has to be passed through explicitly: mergeListByKey
// (submitCollaborativeProposal.ts) only ever deletes a key it's told to
// remove — without it, a member that just left the saga (its stale
// PREQUEL/SEQUEL to former saga-mates already stripped from `relations`
// below) would still have those upstream relations preserved in the PR's
// merge against whatever's already on GitHub, since nothing told it to drop
// them.
function buildRelatedProposalBundle(
  externalId: string,
  catalogEntry: MediaCatalogEntry,
  relations: DbMediaRelation[],
  sagaName: string,
  removedRelationIds: string[],
): { kind: 'media'; externalId: string; bundle: ProposalBundle; removedRelationIds: string[] } {
  return {
    kind: 'media',
    externalId,
    bundle: {
      media_catalog: minimalProposalCatalogEntry(catalogEntry, []),
      media_relations: relations.map(r => ({ ...r, media_external_id: externalId })),
      characters: [],
      media_authors: [],
      saga_name: sagaName || undefined,
    },
    removedRelationIds,
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
  // The bundle referenced via Bundled In (bundledRelations[0], if any) and
  // the rest of its own contents, edited inline instead of requiring a
  // separate visit to that bundle's own editor — see PrEditorModal's own
  // bundleChildren state comment for the full rationale.
  bundleId?: string;
  bundleChildren: BundledRelation[];
  originalBundleChildIds: Set<string>;
  editableRelations: EditableRelation[];
  // ComicVine issues — same shape/handling as bundledRelations/containedRelations,
  // just its own relation_type ('ISSUE') and its own collapsible section in
  // the editor (see PrEditorModal's own issueRelations state comment).
  issueRelations: BundledRelation[];
  characters: DbMediaCharacter[];
  charactersChanged: boolean;
  mediaAuthors: DbMediaAuthor[];
  sagaChanged: boolean;
  editedFields: (keyof MediaCatalogEntry)[];
  // Explicit removals this editor session made, for the GitHub upload merge
  // (see mergeListByKey in submitCollaborativeProposal.ts) — tells "the user
  // removed this" apart from "this session never loaded it" so an upstream
  // relation/character/author someone else added isn't silently dropped.
  removedRelationIds: string[];
  removedCharacterIds: string[];
  removedAuthorIds: string[];
  // Arcs deleted this session (PrEditorStoryArcsSection saves/deletes
  // directly, so this can't be derived from a before/after diff like the
  // other removed*Ids above — the section reports it as it happens).
  removedArcIds: string[];
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
  // recover a manual reorder instead of falling back to release date. The
  // part before "#N" carries the curator's own concept-group name (falling
  // back to the old generic text when they never typed one) — type_label is
  // never read for real display anywhere (sortRelationsForDisplay always
  // recomputes the shown label from relation_type instead, see its own
  // comment), so this is purely internal bookkeeping, free to repurpose.
  // Without this, the actual typed name was silently discarded on every
  // save, replaced by an auto "Group N" the next time the editor loaded.
  for (const group of groups) {
    const mainIndex = group.ids.indexOf(group.mainId);
    const groupName = (p.sagaGroups[group.mainId] || '').trim() || 'Alternative Version';
    for (const altId of group.ids) {
      if (altId === group.mainId) continue;
      const altIndex = group.ids.indexOf(altId);
      addReciprocalPair(group.mainId, altId,
        { relation_type: 'ALTERNATIVE', type_label: `${groupName} #${mainIndex}` },
        { relation_type: 'ALTERNATIVE', type_label: `${groupName} #${altIndex}` });
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

  const issueDbRelations: DbMediaRelation[] = p.issueRelations
    .filter(r => r.external_id.trim())
    .map(r => ({
      related_media_external_id: r.external_id.trim(),
      relation_type: 'ISSUE',
      type_label: 'Issue',
      title: r.title || r.external_id.trim(),
      cover: r.cover ?? null,
    }));

  // Editable Relations already carries every pre-existing relation outside the saga chain.
  const currentChainRows = chainRelations.filter(r => r.media_external_id === externalId);
  const currentFinalRelations: DbMediaRelation[] = dedupeRelations(
    [...editableDbRelations, ...issueDbRelations, ...bundledDbRelations, ...containedDbRelations, ...currentChainRows]
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
  const otherProposalEntries: Extract<ProposalFileEntry, { kind: 'media' }>[] = [];
  for (const otherId of otherChainIds) {
    try {
      const existing = await getMediaRelationsForEditor(otherId);
      const kept = (existing || []).filter(r =>
        !(ALL_CHAIN_RELATION_TYPES.includes(r.relation_type) && p.originalSagaOrder.includes(r.related_media_external_id))
      );
      const newRows = chainRelations.filter(r => r.media_external_id === otherId);
      const otherRelations = dedupeRelations([...kept, ...newRows]);
      await saveMediaRelations(otherId, otherRelations);

      // Targets that had a chain-type edge to a former saga-mate but no
      // longer do (dropped entirely, not just replaced by a new edge to the
      // same id) — these are what actually have to be told to the GitHub
      // merge as removals, or it'll keep whatever's already published there.
      const otherRelationIdsAfter = new Set(otherRelations.map(r => r.related_media_external_id));
      const removedForOther = (existing || [])
        .filter(r => ALL_CHAIN_RELATION_TYPES.includes(r.relation_type) && p.originalSagaOrder.includes(r.related_media_external_id))
        .map(r => r.related_media_external_id)
        .filter(id => !otherRelationIdsAfter.has(id));

      // saveMediaRelations already tombstoned any dropped pair, so a resync won't reintroduce it.
      const otherEntry = await getCatalogEntry(otherId).catch(() => null);
      if (otherEntry && mode !== 'local') {
        otherProposalEntries.push(
          buildRelatedProposalBundle(otherId, otherEntry, otherRelations, p.sagaName, removedForOther),
        );
      }
    } catch (err) {
      console.error(`Failed to propagate saga relation to ${otherId}:`, err);
    }
  }

  // Bundled In is reciprocal: the target needs an EPISODE relation back here, re-synced each save.
  // Same gap the saga propagation above used to have: the local DB write was
  // always correct, but without removedRelationIds on its own proposal entry
  // the GitHub PR's merge against the upstream JSON had nothing telling it to
  // drop a reciprocal edge that just got unbundled, so it silently kept it.
  const currentBundledIds = new Set(p.bundledRelations.map(r => r.external_id.trim()).filter(Boolean));
  const bundledTargetsToSync = new Set([...currentBundledIds, ...p.originalBundledIds]);
  // The referenced bundle's own Contains additions/removals (bundleChildren)
  // ride the exact same save_media_relations call as this entry's own
  // reciprocal EPISODE edge below — save_media_relations replaces a media's
  // whole relation list, so writing the bundle twice in this same submit
  // (once here, once in a separate bundleChildren-only loop) would have the
  // second call silently discard the first's edge.
  const removedBundleChildIds = [...p.originalBundleChildIds].filter(id => !p.bundleChildren.some(r => r.external_id === id));
  for (const targetId of bundledTargetsToSync) {
    try {
      const existing = await getMediaRelationsForEditor(targetId);
      const isReferencedBundle = targetId === p.bundleId;
      // Every child this session touched gets stripped here regardless of
      // add/remove — added ones are re-added fresh below with current title/
      // cover, removed ones just stay stripped.
      const staleChildIds = isReferencedBundle
        ? new Set([...p.originalBundleChildIds, ...p.bundleChildren.map(r => r.external_id)])
        : new Set<string>();
      const kept = (existing || []).filter(r => {
        if (r.relation_type !== 'EPISODE') return true;
        if (r.related_media_external_id === externalId) return false;
        return !staleChildIds.has(r.related_media_external_id);
      });
      const isStillBundled = currentBundledIds.has(targetId);
      const rows = [
        ...kept,
        ...(isStillBundled ? [{
          related_media_external_id: externalId,
          relation_type: 'EPISODE',
          type_label: 'Episode',
          title: entry.title_main || externalId,
          cover: entry.cover_url ?? null,
        }] : []),
        ...(isReferencedBundle ? p.bundleChildren.map(c => ({
          related_media_external_id: c.external_id,
          relation_type: 'EPISODE',
          type_label: 'Episode',
          title: c.title || c.external_id,
          cover: c.cover ?? null,
        })) : []),
      ];
      await saveMediaRelations(targetId, rows);
      invalidateCachedMediaData(targetId);

      const targetEntry = await getCatalogEntry(targetId).catch(() => null);
      if (targetEntry && mode !== 'local') {
        const removedForTarget = [
          ...(isStillBundled ? [] : [externalId]),
          ...(isReferencedBundle ? removedBundleChildIds : []),
        ];
        otherProposalEntries.push(
          buildRelatedProposalBundle(targetId, targetEntry, rows, p.sagaName, removedForTarget),
        );
      }
    } catch (err) {
      console.error(`Failed to propagate bundled-in relation to ${targetId}:`, err);
    }
  }

  // Reciprocal side of the block above: each bundleChildren addition needs a
  // PART_OF relation on that child pointing back at the referenced bundle —
  // same shape as the Contains loop right below, just targeting p.bundleId
  // instead of externalId, since this entry didn't add these children to its
  // own Contains, it added them to a *different* entry's (the bundle's).
  if (p.bundleId) {
    const bundleId = p.bundleId;
    const bundleTitle = p.bundledRelations[0]?.title || bundleId;
    const bundleCover = p.bundledRelations[0]?.cover ?? null;
    const currentBundleChildIds = new Set(p.bundleChildren.map(r => r.external_id.trim()).filter(Boolean));
    const bundleChildTargetsToSync = new Set([...currentBundleChildIds, ...p.originalBundleChildIds]);
    for (const childId of bundleChildTargetsToSync) {
      try {
        const existing = await getMediaRelationsForEditor(childId);
        const kept = (existing || []).filter(r =>
          !(r.relation_type === 'PART_OF' && r.related_media_external_id === bundleId)
        );
        const isStillChild = currentBundleChildIds.has(childId);
        const rows = isStillChild
          ? [...kept, {
              related_media_external_id: bundleId,
              relation_type: 'PART_OF',
              type_label: 'Part of',
              title: bundleTitle,
              cover: bundleCover,
            }]
          : kept;
        await saveMediaRelations(childId, rows);
        invalidateCachedMediaData(childId);

        const childEntry = await getCatalogEntry(childId).catch(() => null);
        if (childEntry && mode !== 'local') {
          otherProposalEntries.push(
            buildRelatedProposalBundle(childId, childEntry, rows, p.sagaName, isStillChild ? [] : [bundleId]),
          );
        }
      } catch (err) {
        console.error(`Failed to propagate bundle-child relation to ${childId}:`, err);
      }
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
      const isStillContained = currentContainedIds.has(childId);
      const rows = isStillContained
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

      const childEntry = await getCatalogEntry(childId).catch(() => null);
      if (childEntry && mode !== 'local') {
        otherProposalEntries.push(
          buildRelatedProposalBundle(childId, childEntry, rows, p.sagaName, isStillContained ? [] : [externalId]),
        );
      }
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

  // Arcs save/delete directly to the local DB as they're edited (no
  // "Submit" step of their own — see PrEditorStoryArcsSection), so the local
  // table already holds exactly what this session wants published: just
  // read it back fresh instead of tracking it through editor state. Same
  // "every saga member's own arcs" scope as that section's own reload().
  const arcIdsToCheck = p.sagaOrder.length > 0 ? p.sagaOrder : [externalId];
  const arcResults = await Promise.all(
    arcIdsToCheck.map(id => getStoryArcsForMedia(id).catch(() => [] as StoryArc[]))
  );
  const arcsById = new Map<string, StoryArc>();
  for (const arcsForId of arcResults) {
    for (const arc of arcsForId) arcsById.set(arc.id, arc);
  }

  // Saga-chain edges pointing at other members ride in otherProposalEntries
  // instead; only hand-edited catalog fields go along (minimalProposalCatalogEntry).
  const bundle: ProposalBundle = {
    media_catalog: minimalProposalCatalogEntry(entry, p.editedFields),
    media_relations: currentFinalRelations.map(r => ({ ...r, media_external_id: externalId })),
    characters: p.characters,
    media_authors: p.mediaAuthors,
    saga_name: p.sagaName || undefined,
    story_arcs: [...arcsById.values()],
  };

  // Each buildOutgoingContent commit merges against whatever's on `main`
  // independently — it has no idea about another entry in this same batch
  // for the same externalId, so two separate entries for the same id would
  // become two sequential commits to the same file, the second silently
  // discarding the first's relation changes. Can genuinely happen here: the
  // same otherId may be both a saga-chain member and a bundled/contained
  // target of the primary entry, each loop above pushing its own entry.
  const dedupedOtherEntries = new Map<string, Extract<ProposalFileEntry, { kind: 'media' }>>();
  for (const otherEntry of otherProposalEntries) {
    const already = dedupedOtherEntries.get(otherEntry.externalId);
    if (!already) {
      dedupedOtherEntries.set(otherEntry.externalId, otherEntry);
      continue;
    }
    dedupedOtherEntries.set(otherEntry.externalId, {
      ...already,
      bundle: {
        ...already.bundle,
        media_relations: dedupeRelations([...already.bundle.media_relations, ...otherEntry.bundle.media_relations])
          .map(r => ({ ...r, media_external_id: otherEntry.externalId })),
      },
      removedRelationIds: [...new Set([...(already.removedRelationIds ?? []), ...(otherEntry.removedRelationIds ?? [])])],
    });
  }

  const proposalEntries: ProposalFileEntry[] = [
    {
      kind: 'media', externalId, bundle,
      removedRelationIds: p.removedRelationIds,
      removedCharacterIds: p.removedCharacterIds,
      removedAuthorIds: p.removedAuthorIds,
      removedArcIds: p.removedArcIds,
    },
    ...dedupedOtherEntries.values(),
  ];
  const prUrl = await submitCollaborativeProposal(externalId, proposalEntries, p.changeSummary, p.setStatusMsg);
  if (prUrl) openUrlInBrowser(prUrl);

  setTimeout(() => p.onClose(), 1500);
}
