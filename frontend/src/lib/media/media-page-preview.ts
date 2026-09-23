// Read-only preview of what a collaborative proposal would look like once
// merged, for the PR preview modal. Split out of media-page-data.ts (still
// re-exported from there) — pure: no IPC, no cache, no network.
import type { MediaCatalogEntry } from '../tauri';
import type { MediaPageData } from './types';
import { mapCatalogEntryToPartialData, mapMediaDataToCatalogEntry } from './mappers/catalog-mapper';
import { sortRelationsForDisplay, dbAuthorToMediaAuthor, dbCharacterToMediaCharacter } from './saga/media-relations';
import type { ProposalBundle } from '../github/submit-collaborative-proposal';

// Simulates a merged proposal PR for the preview modal - never writes
// anything. `sourceData` supplies the full provider-backed work, and the
// proposal bundle overlays its contributed fields and related records.
export function buildPreviewMediaPageData(
  bundle: ProposalBundle,
  baseline: MediaCatalogEntry | null,
  sourceData: MediaPageData | null = null,
): MediaPageData {
  const sourceEntry = sourceData
    ? mapMediaDataToCatalogEntry(sourceData, bundle.media_catalog.external_id)
    : null;
  const baseEntry = sourceEntry ?? baseline ?? bundle.media_catalog;
  // GitHub proposal bundles intentionally omit fields they don't contribute.
  // Ignore nulls too: in the shared catalog they often mean "not supplied",
  // and must not erase real provider data in the preview.
  const proposalFields = Object.fromEntries(
    Object.entries(bundle.media_catalog).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<MediaCatalogEntry>;
  const mergedEntry: MediaCatalogEntry = { ...baseEntry, ...proposalFields };
  const catalogData = mapCatalogEntryToPartialData(mergedEntry);
  const base = sourceData ?? mapCatalogEntryToPartialData(baseline ?? mergedEntry);

  const ownRelations = (bundle.media_relations ?? []).filter(
    r => !r.media_external_id || r.media_external_id === bundle.media_catalog.external_id,
  );
  const proposalRelations = sortRelationsForDisplay(ownRelations).relations;
  const relationsById = new Map(
    base.relations.map(relation => [
      relation.relatedExternalId ?? relation.url ?? `${relation.relationType}:${relation.title}`,
      relation,
    ] as const),
  );
  for (const relation of proposalRelations) {
    relationsById.set(relation.relatedExternalId ?? relation.url ?? `${relation.relationType}:${relation.title}`, relation);
  }

  const charactersById = new Map((base.characters ?? []).map(character => [character.id ?? character.name, character] as const));
  for (const character of (bundle.characters ?? []).map(dbCharacterToMediaCharacter)) {
    charactersById.set(character.id ?? character.name, character);
  }

  const authorsById = new Map((base.authors ?? []).map(author => [author.external_id, author] as const));
  for (const author of (bundle.media_authors ?? []).map(dbAuthorToMediaAuthor)) {
    authorsById.set(author.external_id, author);
  }

  const relations = [...relationsById.values()];
  return {
    ...base,
    ...catalogData,
    // These values are richer/provider-specific and aren't part of the
    // scalar catalog overlay; keep them from the underlying work.
    bannerColor: base.bannerColor,
    metaLines: base.metaLines,
    relations,
    hasSaga: base.hasSaga || relations.some(r => r.relationType === 'PREQUEL' || r.relationType === 'SEQUEL'),
    characters: [...charactersById.values()],
    authors: [...authorsById.values()],
  };
}
