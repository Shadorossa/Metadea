import { invoke } from '../tauri';
import { saveCatalogEntry, saveMediaRelations, saveMediaAuthors, type DbMediaRelation } from '../tauri/catalog';
import { saveCharactersSkeleton, type SkeletonCharacter } from '../tauri/characters';
import type { ProposalBundle } from './submitCollaborativeProposal';
import { fetchFileAtRef } from './api';
import { ALL_CHAIN_RELATION_TYPES } from '../media/sagaTypes';

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

// A saga edit now lands as one self-contained GitHub file per affected
// member (see submitCollaborativeProposal.ts) instead of a single file
// carrying every member's relations — so opening just one member's file no
// longer hydrates the local DB with the whole saga's data like it used to
// when everything lived in one JSON. This walks the saga-chain relation
// targets breadth-first, fetching + hydrating each linked member's own
// GitHub file too, so PrEditorModal's local reconstruction (get_transitive_
// relation_ids + per-member getCatalogEntry/getMediaRelations) still sees
// the complete saga exactly as before, regardless of how many files it's
// actually split across.
export async function hydrateSagaChainFromGithub(token: string, startExternalId: string): Promise<void> {
  const visited = new Set<string>([startExternalId]);
  let frontier = [startExternalId];
  let hops = 0;
  while (frontier.length > 0 && hops < 25) {
    hops++;
    const next: string[] = [];
    for (const id of frontier) {
      const path = `database/${id.replace(':', '-')}.json`;
      try {
        const content = await fetchFileAtRef(token, path, 'main');
        const bundle = JSON.parse(content) as ProposalBundle;
        await hydrateBundleIntoLocalCatalog(bundle);
        for (const rel of bundle.media_relations) {
          if (!ALL_CHAIN_RELATION_TYPES.includes(rel.relation_type)) continue;
          const targetId = rel.related_media_external_id;
          if (!visited.has(targetId)) {
            visited.add(targetId);
            next.push(targetId);
          }
        }
      } catch {
        // No proposal file for this id (only merged into local DB via a
        // different sync path, or simply doesn't exist upstream) — not
        // fatal, just nothing more to hydrate from this hop.
      }
    }
    frontier = next;
  }
}
