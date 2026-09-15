import { getCatalogEntry, getMediaRelationsForEditor } from '../tauri';

// A PORT-format catalog entry (IGDB's own categorization for e.g. a Steam
// release that's specifically a port of an existing edition — Final Fantasy
// IX's Steam listing, cataloged as a port of its Remaster) isn't worth
// tracking progress on as its own distinct thing, so "editar" (the catalog's
// log editor) and "ver en catálogo" both redirect to whatever it's a port
// OF instead of opening the port's own (rarely meaningful on its own) entry.
//
// Walks the BASE_EDITION chain past any target that's itself blocked_at
// (a curator-hidden duplicate/unwanted edition — see MediaCatalogEntry's own
// doc comment) to the next one down, so a port whose immediate parent was
// removed from the catalog (Remaster deleted, only Base and Port left) still
// lands somewhere real instead of a dead end. Capped at a few hops as a
// safety net against a corrupt or circular BASE_EDITION chain.
export async function resolvePortRedirect(externalId: string): Promise<string> {
  const entry = await getCatalogEntry(externalId).catch(() => null);
  if (!entry || entry.format !== 'PORT') return externalId;

  let current = externalId;
  for (let hop = 0; hop < 5; hop++) {
    const relations = await getMediaRelationsForEditor(current).catch(() => []);
    const base = relations.find(r => r.relation_type === 'BASE_EDITION');
    if (!base?.related_media_external_id) return current;
    current = base.related_media_external_id;
    const baseEntry = await getCatalogEntry(current).catch(() => null);
    if (!baseEntry?.blocked_at) return current;
    // blocked_at set — this edition is hidden from the catalog, keep
    // walking down from here instead of landing on it.
  }
  return current;
}
