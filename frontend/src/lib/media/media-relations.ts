// Relation sorting, legacy-label normalization, and DB↔UI shape conversion
// for media relations/authors/characters — extracted from mediaService.ts
// (still re-exported from there).
import type { MediaPageData, MediaAuthor, MediaCharacter, MediaRelation } from './types';
import { getMediaRelations, getMediaAuthors, saveMediaRelations, type DbMediaRelation, type DbMediaAuthor } from '../tauri/catalog';
import type { DbMediaCharacter } from '../tauri/characters';
import { getT } from '../../i18n/client';
import { normalizeLegacyRelationType } from './sagaTypes';

// Order of relations: Fuente > Prequel > Sequel > Side story (Historia paralela) > Alternative > Other
const RELATION_SORT_PRIORITY: Record<string, number> = {
  // Fuente
  SOURCE: 1,
  PARENT: 1,
  ADAPTATION: 1,
  REL_ADAPTATION: 1,

  // Prequel
  PREQUEL: 2,

  // Sequel
  SEQUEL: 3,

  // Side story
  SIDE_STORY: 4,
  SPIN_OFF: 4,

  // Alternative
  ALTERNATIVE: 5,
  REL_ALTERNATIVE: 5,

  // Other
  OTHER: 6,
  SUMMARY: 6,
  REMAKE: 6,
  REMASTER: 6,
  EXPANDED_GAME: 6,
  REL_UPDATE: 6,
  DLC: 6,
  EXPANSION: 6,
  STANDALONE: 6,
  FORK: 6,
};

function normalizeLegacyDbRelation(rel: DbMediaRelation): DbMediaRelation {
  const canonical = normalizeLegacyRelationType(rel.relation_type);
  if (canonical === rel.relation_type) return rel;
  return { ...rel, relation_type: canonical, type_label: getT().media.relations[canonical as keyof ReturnType<typeof getT>['media']['relations']] ?? rel.type_label };
}

export function sortRelationsForDisplay(rels: DbMediaRelation[]): { relations: MediaPageData['relations']; hasSaga: boolean } {
  const sorted = [...rels].sort((a, b) => {
    const priorityA = RELATION_SORT_PRIORITY[a.relation_type] ?? 99;
    const priorityB = RELATION_SORT_PRIORITY[b.relation_type] ?? 99;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.title.localeCompare(b.title);
  });
  return {
    relations: sorted.map(r => ({
      typeLabel: r.type_label,
      relationType: r.relation_type,
      title: r.title,
      cover: r.cover || undefined,
      url: `/media?id=${r.related_media_external_id}`,
      // Without this, mergeRelationGraph's "already have this id" dedup Set
      // (built by reading relatedExternalId off whatever's already in
      // data.relations) never sees DB-sourced rows — since they only had
      // `url` set — so the transitive relation-graph walk could rediscover
      // and re-add an already-saved relation under a second, different type.
      relatedExternalId: r.related_media_external_id,
    })),
    hasSaga: rels.some(r => r.relation_type === 'PREQUEL' || r.relation_type === 'SEQUEL'),
  };
}

export function sortMediaRelations(relations: MediaRelation[]): MediaRelation[] {
  return [...relations].sort((a, b) => {
    const rTypeA = a.relationType?.toUpperCase() ?? '';
    const rTypeB = b.relationType?.toUpperCase() ?? '';
    const priorityA = RELATION_SORT_PRIORITY[rTypeA] ?? 99;
    const priorityB = RELATION_SORT_PRIORITY[rTypeB] ?? 99;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.title.localeCompare(b.title);
  });
}

export function dbAuthorToMediaAuthor(a: DbMediaAuthor): MediaAuthor {
  return {
    external_id: a.external_id,
    name: a.name,
    image: a.image || undefined,
    role: a.role || undefined,
    url: `/author?id=${a.external_id}`,
  };
}

export function dbCharacterToMediaCharacter(c: DbMediaCharacter): MediaCharacter {
  return {
    id: c.external_id,
    name: c.name,
    image: c.image_url || undefined,
    role: c.relation_type || c.character_name || undefined,
  };
}

// Shared by fetchMediaData and fetchMediaDataWithFallback (mediaService.ts)
// — both need "load whatever's already curated in the DB for this media"
// before deciding whether to trust it as-is or enrich it with a live API
// fetch.
export async function loadDbRelationsAndAuthors(rawId: string): Promise<{ relations: DbMediaRelation[]; authors: DbMediaAuthor[] }> {
  const [relations, authors] = await Promise.all([
    getMediaRelations(rawId).catch(() => []),
    getMediaAuthors(rawId).catch(() => []),
  ]);
  return { relations, authors };
}

// Merges freshly-fetched relations (from any source — the direct IGDB
// fetch, or the transitive relation-graph walk) into whatever's already
// saved, instead of only ever syncing once per title. IGDB keeps adding
// DLCs/standalone expansions/etc. to a game's entry over time, and a plain
// "skip if dbRels isn't empty" gate meant any title that already had one
// curated/synced relation (e.g. a manually-added PREQUEL) would never pick
// up newly-listed ones again — they'd render fine on that one page load
// (from live memory) but silently never reach media_relations, so they
// never showed up as an editable relation in the collaborative catalog
// editor. Existing DB rows always win on id conflicts since they may have
// been hand-edited (saga grouping, relation-type fixes) via PrEditorModal
// and must not be clobbered by a fresh IGDB fetch.
//
// Also normalizes any legacy-labeled DB rows even when there's nothing new
// to merge — that must not be gated behind "there's something to add", or a
// title whose relations were all saved under the old raw-label scheme (and
// whose live fetch happens to add nothing new) would never get corrected.
export async function mergeAndPersistRelations(rawId: string, fetchedRelations: MediaPageData['relations']): Promise<void> {
  const { relations: dbRels } = await loadDbRelationsAndAuthors(rawId);

  const normalizedDbRels = dbRels.map(normalizeLegacyDbRelation);
  const changedLegacyTypes = normalizedDbRels.some((r, i) => r.relation_type !== dbRels[i].relation_type);

  const dbIds = new Set(dbRels.map(r => r.related_media_external_id));
  const newFromApi = (fetchedRelations ?? [])
    .filter(r => r.relatedExternalId && !dbIds.has(r.relatedExternalId))
    .map(r => ({
      related_media_external_id: r.relatedExternalId!,
      relation_type: r.relationType ?? 'RELATED',
      type_label: r.typeLabel,
      title: r.title,
      cover: r.cover || null,
    }));

  if (newFromApi.length > 0 || changedLegacyTypes) {
    await saveMediaRelations(rawId, [...normalizedDbRels, ...newFromApi]).catch(console.error);
  }
}
