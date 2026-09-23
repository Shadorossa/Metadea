import { getBaseEditionCandidatesForRedirect, getCatalogEntry, getCatalogEntryForEditor } from '../tauri';

// A PORT-format catalog entry (IGDB's own categorization for e.g. a Steam
// release that's specifically a port of an existing edition — Final Fantasy
// IX's Steam listing, cataloged as a port of its Remaster) isn't worth
// tracking progress on as its own distinct thing, so "editar" (the catalog's
// log editor) and "ver en catálogo" both redirect to whatever it's a port
// OF instead of opening the port's own (rarely meaningful on its own) entry.
// A blocked identity encountered by Local uses the same walk even when it
// isn't a PORT, so deleted editions fall back to an earlier visible release.
//
// Walks semantic BASE_EDITION ancestry past blocked editions. The database
// can represent an edge as edition -> BASE_EDITION -> base or, in older
// catalog data, as base -> REMASTER/EXPANDED_GAME -> edition.
const MAX_BASE_EDITION_HOPS = 8;

async function findVisibleBaseEdition(
  externalId: string,
  visited: Set<string>,
  depth: number,
): Promise<string | null> {
  if (depth > MAX_BASE_EDITION_HOPS || visited.has(externalId)) return null;
  const nextVisited = new Set(visited);
  nextVisited.add(externalId);

  const entry = await getCatalogEntryForEditor(externalId).catch(() => null);
  if (!entry) return null;
  if (!entry.blocked_at) return externalId;

  const candidates = await getBaseEditionCandidatesForRedirect(externalId).catch(() => []);
  for (const candidateId of candidates) {
    const resolved = await findVisibleBaseEdition(candidateId, nextVisited, depth + 1);
    if (resolved) return resolved;
  }
  return null;
}

export async function resolvePortRedirect(externalId: string): Promise<string | null> {
  const entry = await getCatalogEntryForEditor(externalId).catch(() => null);
  if (!entry) return null;
  const startsBlocked = !!entry.blocked_at;
  if (!startsBlocked && entry.format !== 'PORT') return externalId;

  const candidates = await getBaseEditionCandidatesForRedirect(externalId).catch(() => []);
  if (!candidates.length) return startsBlocked ? null : externalId;

  for (const candidateId of candidates) {
    const resolved = await findVisibleBaseEdition(candidateId, new Set([externalId]), 1);
    if (resolved) return resolved;
  }
  return null;
}

// Local installs can still point at a catalog identity blocked by the
// curator. In that case, show the first visible BASE_EDITION ancestor
// instead, without changing the installed game's own identity or launch data.
export async function getLocalCatalogEntry(externalId: string) {
  const exactEntry = await getCatalogEntryForEditor(externalId).catch(() => null);
  if (!exactEntry) return getCatalogEntry(externalId).catch(() => null);
  if (!exactEntry.blocked_at) return exactEntry;
  const targetId = await resolvePortRedirect(externalId);
  return !targetId || targetId === externalId ? null : getCatalogEntry(targetId).catch(() => null);
}
