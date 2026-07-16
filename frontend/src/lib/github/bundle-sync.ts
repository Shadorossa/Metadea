import { invoke } from '../tauri';
import { saveCatalogEntry, saveMediaRelations, saveMediaAuthors, type DbMediaRelation } from '../tauri/catalog';
import { saveCharactersSkeleton, type SkeletonCharacter } from '../tauri/characters';
import type { ProposalBundle } from './submitCollaborativeProposal';

// Imports a merged GitHub catalog file into the local DB so the existing rich
// editor (PrEditorModal) has something to show/edit before submitting the
// change as a new proposal PR — relations tagged for other media (saga chain
// edges) get written to their own row, matching what PrEditorModal itself
// does on save.
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
