import { saveCatalogEntry, getCatalogEntry, saveMediaRelations, saveMediaAuthors, type DbMediaRelation } from '../tauri/catalog';
import { saveCharactersSkeleton, type SkeletonCharacter } from '../tauri/characters';
import type { ProposalBundle } from './submitCollaborativeProposal';
import { fetchFileAtRef } from './api';
import { ALL_CHAIN_RELATION_TYPES } from '../media/sagaTypes';
import { fetchMediaData } from '../media/mediaService';

// Imports a merged GitHub catalog file into the local DB so the existing rich
// editor (PrEditorModal) has something to show/edit before submitting the
// change as a new proposal PR — relations tagged for other media (saga chain
// edges) get written to their own row, matching what PrEditorModal itself
// does on save.
export async function hydrateBundleIntoLocalCatalog(bundle: ProposalBundle): Promise<void> {
  const externalId = bundle.media_catalog.external_id;
  // bundle.media_catalog only carries identity + hand-edited fields — merge
  // onto the existing local row instead of replacing it (save_catalog_entry
  // is INSERT OR REPLACE, so passing this sparse object straight through
  // would wipe every richer field the live API sync already populated).
  const existing = await getCatalogEntry(externalId).catch(() => null);
  await saveCatalogEntry(existing ? { ...existing, ...bundle.media_catalog } : bundle.media_catalog);

  // A saga member nobody's visited as a full page has no cover/synopsis of
  // its own to merge onto — one live fetch, only if still missing, so a
  // populated install is never overwritten.
  const hydrated = await getCatalogEntry(externalId).catch(() => null);
  if (hydrated && !hydrated.cover_url && !hydrated.synopsis) {
    await fetchMediaData(externalId).catch(() => null);
  }

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
}

// A saga edit lands as one self-contained GitHub file per affected member,
// not one file carrying the whole chain — walks the saga relations
// breadth-first, hydrating each linked member's own file too, so
// PrEditorModal's local reconstruction still sees the complete saga.
export async function hydrateSagaChainFromGithub(token: string, startExternalId: string): Promise<void> {
  const visited = new Set<string>([startExternalId]);
  let frontier = [startExternalId];
  let hops = 0;
  while (frontier.length > 0 && hops < 25) {
    hops++;
    // Every id in a frontier level is an independent GitHub fetch — run the
    // whole level concurrently instead of one round trip after another.
    const hopResults = await Promise.all(frontier.map(async id => {
      const path = `database/${id.replace(':', '-')}.json`;
      try {
        const content = await fetchFileAtRef(token, path, 'main');
        return JSON.parse(content) as ProposalBundle;
      } catch {
        // No proposal file for this id (only merged into local DB via a
        // different sync path, or simply doesn't exist upstream) — not
        // fatal, just nothing more to hydrate from this hop.
        return null;
      }
    }));

    const bundles = hopResults.filter((b): b is ProposalBundle => b !== null);
    await Promise.all(bundles.map(hydrateBundleIntoLocalCatalog));

    const next: string[] = [];
    for (const bundle of bundles) {
      for (const rel of bundle.media_relations) {
        if (!ALL_CHAIN_RELATION_TYPES.includes(rel.relation_type)) continue;
        const targetId = rel.related_media_external_id;
        if (!visited.has(targetId)) {
          visited.add(targetId);
          next.push(targetId);
        }
      }
    }
    frontier = next;
  }
}
