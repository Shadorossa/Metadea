// handleSubmit's I/O sequence, split out of PrEditorModal.tsx: builds the
// saga-chain edges, persists locally, propagates reciprocal relations, and
// (in 'proposal' mode) submits the GitHub PR. Every diff it needs (edited
// fields, removed ids, whether the saga changed) is derived from the editor
// state via pr-editor-state.ts instead of the component's own closures.
import { saveCatalogEntry, saveMediaRelations, getMediaRelationsForEditor, getCatalogEntry } from '../../../lib/tauri/catalog';
import { saveCharactersSkeleton } from '../../../lib/tauri/characters';
import { getStoryArcsForMedia, type StoryArc } from '../../../lib/tauri/story-arcs';
import type { MediaCatalogEntry, DbMediaRelation } from '../../../lib/tauri/catalog';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { removeSagaMember, saveCachedSaga } from '../../../lib/tauri/catalog';
import { invalidateCachedMediaData } from '../../../lib/media/media-page-data';
import { classifySagaChain, createMetaResolver, type MediaMeta } from '../../../lib/media/saga/saga-grouping';
import { submitCollaborativeProposal, openSubmittedProposal, type ProposalBundle, type ProposalFileEntry } from '../../../lib/github/submit-collaborative-proposal';
import { REL_TYPE_TO_PAIR } from '../../../lib/media/constants';
import { ALL_CHAIN_RELATION_TYPES } from '../../../lib/media/saga/saga-relation-types';
import { setField } from '../../../lib/shared/collections/object-utils';
import { uploadImageToSharedCatalog } from '../../../lib/character/shared-image-storage';
import type { BundledRelation } from '../../../lib/media/editor/pr-editor-types';
import {
  charactersChanged, editedFields as computeEditedFields, getPrEditorDiff,
  originalBundleChildIds, originalBundledIds, originalContainedIds, toRecommendationRelation,
  type PrEditorContext, type PrEditorState,
} from './pr-editor-state';

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

// Bundled In / Contains / Issues are all a flat id list persisted under one
// fixed relation type; only that type and its label differ between them.
function toDbRelations(list: BundledRelation[], relationType: string, typeLabel: string): DbMediaRelation[] {
  return list
    .filter(r => r.external_id.trim())
    .map(r => ({
      related_media_external_id: r.external_id.trim(),
      relation_type: relationType,
      type_label: typeLabel,
      title: r.title || r.external_id.trim(),
      cover: r.cover ?? null,
    }));
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

export interface SubmitPrEditorParams extends PrEditorContext {
  state: PrEditorState;
  mode: 'proposal' | 'local';
  sagaMeta: Record<string, MediaMeta>;
  // Arcs deleted this session (PrEditorStoryArcsSection saves/deletes
  // directly, so this can't be derived from a before/after diff like the
  // other removed ids — the section reports it as it happens).
  removedArcIds: string[];
  changeSummary: string;
  prepareOnly?: boolean;
  onSaved?: () => void;
  onBlockedSubmitted?: (externalId: string) => void;
  onClose: () => void;
  setStatusMsg: (msg: string) => void;
}

// The concrete inputs the persistence sequence below works from, derived
// once from the state pair. Kept as one flat object so the body reads the
// same as when the modal handed these in precomputed.
function resolveSubmitInputs(state: PrEditorState, ctx: PrEditorContext) {
  const { draft, baseline } = state;
  const diff = getPrEditorDiff(state, ctx);
  const entry = draft.entry;
  return {
    entry,
    sagaOrder: draft.sagaOrder,
    originalSagaOrder: baseline.sagaOrder,
    sagaRelationTypes: draft.sagaRelationTypes,
    sagaGroups: draft.sagaGroups,
    sagaName: draft.sagaName,
    bundledRelations: draft.bundledRelations,
    originalBundledIds: originalBundledIds(state),
    containedRelations: draft.containedRelations,
    originalContainedIds: originalContainedIds(state),
    // The bundle referenced via Bundled In (bundledRelations[0], if any) and
    // the rest of its own contents, edited inline instead of requiring a
    // separate visit to that bundle's own editor — see PrEditorDraft's
    // bundleChildren comment for the full rationale.
    bundleId: draft.bundledRelations[0]?.external_id,
    bundleChildren: draft.bundleChildren,
    originalBundleChildIds: originalBundleChildIds(state),
    editableRelations: [...draft.editableRelations, ...draft.recommendations.map(r => toRecommendationRelation(r, ctx.recommendationLabel))],
    // ComicVine issues — same shape/handling as bundledRelations/containedRelations,
    // just its own relation_type ('ISSUE') and its own section in the editor.
    issueRelations: draft.issueRelations,
    characters: draft.characters,
    charactersChanged: charactersChanged(state),
    mediaAuthors: draft.mediaAuthors,
    sagaChanged: !!entry?.blocked_at || diff.sagaOrderChanged || diff.relTypesChanged
      || diff.groupsChanged || diff.addedSaga.length > 0 || diff.removedSaga.length > 0,
    editedFields: computeEditedFields(state),
    // Explicit removals this editor session made, for the GitHub upload merge
    // (see mergeListByKey in submitCollaborativeProposal.ts) — tells "the user
    // removed this" apart from "this session never loaded it" so an upstream
    // relation/character/author someone else added isn't silently dropped.
    // Union of every relation-editing UI's own removals — media_relations
    // has no per-category split once saved, so the merge just needs "which
    // related_media_external_id ids did this session actually remove",
    // regardless of which list they came from.
    removedRelationIds: [
      ...diff.removedBundledIds,
      ...diff.removedContainedIds,
      ...diff.removedEditableRelationIds,
      ...diff.removedIssueIds,
    ],
    removedCharacterIds: diff.removedCharacterIds,
    removedAuthorIds: diff.removedAuthorIds,
  };
}

export async function submitPrEditorChanges(params: SubmitPrEditorParams): Promise<ProposalFileEntry[] | null> {
  const { externalId, mode } = params;
  const inputs = resolveSubmitInputs(params.state, params);
  const { entry } = inputs;
  if (!entry) return null;
  const p = { ...params, ...inputs, entry };

  await saveCatalogEntry(entry);
  invalidateCachedMediaData(externalId);
  if (entry.external_id && entry.external_id !== externalId) {
    invalidateCachedMediaData(entry.external_id);
  }

  const resolveMeta = createMetaResolver(externalId, { title: entry.title_main || externalId, cover: entry.cover_url || null, release_year: entry.release_year ?? null }, p.sagaMeta);

  // classifySagaChain clusters sagaOrder into groups + standalone entries;
  // walked pairwise below, every adjacent group gets a SEQUEL/PREQUEL edge.
  const removeBlockedWorkFromSaga = Boolean(entry.blocked_at);
  const fullChain = removeBlockedWorkFromSaga
    ? p.sagaOrder.filter(id => id !== externalId)
    : p.sagaOrder;
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
  if (removeBlockedWorkFromSaga) {
    await removeSagaMember(externalId).catch(err => console.error('Failed to remove blocked work from saga cache:', err));
  }

  const bundledDbRelations = toDbRelations(p.bundledRelations, 'PART_OF', 'Part of');
  const containedDbRelations = toDbRelations(p.containedRelations, 'EPISODE', 'Episode');
  const issueDbRelations = toDbRelations(p.issueRelations, 'ISSUE', 'Issue');

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
  // Blocking removes this entry from the visible saga, but its own outgoing
  // chain edges are still needed for source/base ancestry (e.g. Local can walk
  // past blocked editions). Neighbor entries are rewritten below without the
  // blocked id, making the edge intentionally one-sided in the saved catalog.
  const blockedOwnedChainRows = removeBlockedWorkFromSaga
    ? (await getMediaRelationsForEditor(externalId).catch(() => []))
      .filter(r => ALL_CHAIN_RELATION_TYPES.includes(r.relation_type))
    : [];
  const currentFinalRelations: DbMediaRelation[] = dedupeRelations(
    [...editableDbRelations, ...issueDbRelations, ...bundledDbRelations, ...containedDbRelations, ...currentChainRows, ...blockedOwnedChainRows]
  );
  // The GitHub bundle merge preserves upstream relation rows unless their
  // related id is explicitly tombstoned. Remove every old saga-member key
  // first, then mergeListByKey re-adds only the currently valid rows from
  // currentFinalRelations. This also handles a pair that remains connected
  // as SEQUEL/PREQUEL after its old ALTERNATIVE edge is removed.
  const removedSagaRelationIds = p.sagaChanged
    ? p.originalSagaOrder.filter(id => id !== externalId)
    : [];
  // Not caught here: everything below this point builds and submits the
  // GitHub proposal. Swallowing a failed local write would publish a proposal
  // the local database does not match, and saveMediaRelations is also what
  // writes the deletion tombstones — so a silent failure lets a later resync
  // reintroduce relations the curator deliberately removed.
  await saveMediaRelations(externalId, currentFinalRelations);

  if (p.charactersChanged) {
    await saveCharactersSkeleton(externalId, p.characters);
  }

  // Every other chain member gets its chain-managed edges rewritten too — union
  // with originalSagaOrder so a just-removed member's stale reciprocal edge
  // doesn't pull it back into the saga via get_transitive_relation_ids.
  const otherChainIds = (p.sagaChanged || removeBlockedWorkFromSaga)
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

      // Replace all former saga-member keys on this owner before re-adding
      // its freshly-derived rows. This is needed when an ALTERNATIVE becomes
      // a SEQUEL/PREQUEL for the same related id: a relation-type change is
      // still an explicit deletion + addition in the upstream merge.
      const removedForOther = p.originalSagaOrder.filter(id => id !== otherId);

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

  // A child of a Contains list needs the reciprocal PART_OF edge pointing back
  // at its parent. Two lists need exactly this bookkeeping: this entry's own
  // Contains, and — since bundleChildren are added to a *different* entry's
  // Contains — the referenced bundle's.
  const syncPartOfChildren = async (
    parent: { id: string; title: string; cover: string | null },
    currentChildIds: Set<string>,
    originalChildIds: Set<string>,
    label: string,
  ) => {
    for (const childId of new Set([...currentChildIds, ...originalChildIds])) {
      try {
        const existing = await getMediaRelationsForEditor(childId);
        const kept = (existing || []).filter(r =>
          !(r.relation_type === 'PART_OF' && r.related_media_external_id === parent.id)
        );
        const isStillChild = currentChildIds.has(childId);
        const rows = isStillChild
          ? [...kept, {
              related_media_external_id: parent.id,
              relation_type: 'PART_OF',
              type_label: 'Part of',
              title: parent.title,
              cover: parent.cover,
            }]
          : kept;
        await saveMediaRelations(childId, rows);
        invalidateCachedMediaData(childId);

        const childEntry = await getCatalogEntry(childId).catch(() => null);
        if (childEntry && mode !== 'local') {
          otherProposalEntries.push(
            buildRelatedProposalBundle(childId, childEntry, rows, p.sagaName, isStillChild ? [] : [parent.id]),
          );
        }
      } catch (err) {
        console.error(`Failed to propagate ${label} relation to ${childId}:`, err);
      }
    }
  };

  if (p.bundleId) {
    const bundleId = p.bundleId;
    const currentBundleChildIds = new Set(p.bundleChildren.map(r => r.external_id.trim()).filter(Boolean));
    await syncPartOfChildren(
      { id: bundleId, title: p.bundledRelations[0]?.title || bundleId, cover: p.bundledRelations[0]?.cover ?? null },
      currentBundleChildIds,
      p.originalBundleChildIds,
      'bundle-child',
    );
  }

  const currentContainedIds = new Set(p.containedRelations.map(r => r.external_id.trim()).filter(Boolean));
  await syncPartOfChildren(
    { id: externalId, title: entry.title_main || externalId, cover: entry.cover_url ?? null },
    currentContainedIds,
    p.originalContainedIds,
    'contains',
  );

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
    return null;
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
  let proposalCatalogEntry = entry;
  const imageFieldsChanged = p.editedFields.includes('cover_url') || p.editedFields.includes('banners_csv');
  if (imageFieldsChanged) {
    p.setStatusMsg('Preparando imágenes de la obra para el catálogo compartido…');
    if (p.editedFields.includes('cover_url') && entry.cover_url) {
      proposalCatalogEntry = {
        ...proposalCatalogEntry,
        cover_url: await uploadImageToSharedCatalog(entry.cover_url, 'media'),
      };
    }
    if (p.editedFields.includes('banners_csv') && entry.banners_csv) {
      const bannerValue = entry.banners_csv.trim();
      const banners = bannerValue.startsWith('data:image/')
        ? [bannerValue]
        : bannerValue.split(',').map(value => value.trim()).filter(Boolean);
      const sharedBanners: string[] = [];
      for (const banner of banners) sharedBanners.push(await uploadImageToSharedCatalog(banner, 'media'));
      proposalCatalogEntry = { ...proposalCatalogEntry, banners_csv: sharedBanners.join(',') };
    }
  }

  const bundle: ProposalBundle = {
    media_catalog: minimalProposalCatalogEntry(proposalCatalogEntry, p.editedFields),
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
      // A blocked entry keeps its own outgoing relation rows for ancestry and
      // fallback lookup. The reciprocal rows are removed from visible
      // neighbors above and their own proposal entries carry those removals.
      removedRelationIds: [...new Set([...p.removedRelationIds, ...removedSagaRelationIds])],
      removedCharacterIds: p.removedCharacterIds,
      removedAuthorIds: p.removedAuthorIds,
      removedArcIds: p.removedArcIds,
    },
    ...dedupedOtherEntries.values(),
  ];
  if (p.prepareOnly) return proposalEntries;
  const proposal = await submitCollaborativeProposal(externalId, proposalEntries, p.changeSummary, p.setStatusMsg);
  if (proposal) {
    openSubmittedProposal(proposal);
    if (entry.blocked_at) p.onBlockedSubmitted?.(externalId);
  }

  setTimeout(() => p.onClose(), 1500);
  return null;
}
