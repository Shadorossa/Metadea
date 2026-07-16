import { invoke } from '../tauri';
import {
  saveCatalogEntry, getCatalogEntry, saveMediaRelations, getMediaRelations,
  saveMediaAuthors, getMediaAuthors, getMediaSagaGroups, type DbMediaRelation,
} from '../tauri/catalog';
import { saveCharactersSkeleton, getMediaCharacters, type SkeletonCharacter } from '../tauri/characters';
import type { ProposalBundle } from './submitCollaborativeProposal';

// Imports a merged GitHub catalog file into the local DB so the existing rich
// editor (PrEditorModal, mode="local") can edit it exactly like any local
// entry — relations tagged for other media (saga chain edges) get written to
// their own row, matching what PrEditorModal itself does on save.
export async function hydrateBundleIntoLocalCatalog(bundle: ProposalBundle): Promise<void> {
  const externalId = bundle.media_catalog.external_id;
  await saveCatalogEntry(bundle.media_catalog);

  const byMedia = new Map<string, DbMediaRelation[]>();
  for (const rel of bundle.media_relations) {
    const owner = rel.media_external_id || externalId;
    if (!byMedia.has(owner)) byMedia.set(owner, []);
    byMedia.get(owner)!.push(rel);
  }
  for (const [owner, rels] of byMedia) {
    await saveMediaRelations(owner, rels);
  }

  await saveCharactersSkeleton(externalId, bundle.characters as SkeletonCharacter[]);
  await saveMediaAuthors(externalId, bundle.media_authors);
  await invoke('save_media_saga_groups', { groups: bundle.saga_groups || {} }).catch(() => {});
}

// Inverse — rebuilds a ProposalBundle for a single entry from whatever is
// currently in the local DB, to commit back to GitHub after a local edit.
// Only this entry's own relations are included (not the whole saga chain) —
// other entries touched by the edit keep their local copy, but pushing every
// one of their files back to GitHub is out of scope here.
export async function buildBundleFromLocal(externalId: string): Promise<ProposalBundle | null> {
  const entry = await getCatalogEntry(externalId);
  if (!entry) return null;

  const [relations, characters, authors, sagaGroups] = await Promise.all([
    getMediaRelations(externalId),
    getMediaCharacters(externalId),
    getMediaAuthors(externalId),
    getMediaSagaGroups([externalId]),
  ]);

  return {
    media_catalog: entry,
    media_relations: relations.map(r => ({ ...r, media_external_id: externalId })),
    characters,
    media_authors: authors,
    saga_groups: sagaGroups,
  };
}
