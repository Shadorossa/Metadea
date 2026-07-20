// Relation sorting, legacy-label normalization, and DB↔UI shape conversion
// for media relations/authors/characters — extracted from mediaService.ts
// (still re-exported from there).
import type { MediaPageData, MediaAuthor, MediaCharacter, MediaStaffMember, MediaRelation } from './types';
import { getMediaRelations, getMediaAuthors, saveMediaRelations, getDeletedRelations, type DbMediaRelation, type DbMediaAuthor } from '../tauri/catalog';
import type { DbMediaCharacter, SkeletonCharacter } from '../tauri/characters';
import type { SkeletonStaffMember, DbMediaStaffMember } from '../tauri/staff';
import { getT } from '../../i18n/client';
import { normalizeLegacyRelationType } from './sagaTypes';
import { lookupLabel } from './mapper-utils';
import { CANONICAL_RELATION_LABELS as canonicalRelationLabels } from './canonical-relations';

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
    return 0;
  });
  // relation_type is the only source of truth for the label — r.type_label
  // (persisted, locale-frozen at save time) is never read, since trusting it
  // would drift from the current locale after a language switch.
  const tm = getT().media;
  return {
    relations: sorted.map(r => ({
      typeLabel: lookupLabel(tm.relations, r.relation_type, canonicalRelationLabels[r.relation_type] ?? r.relation_type),
      relationType: r.relation_type,
      title: r.title,
      cover: r.cover || undefined,
      url: `/media?id=${r.related_media_external_id}`,
      // Needed so mergeRelationGraph's dedup Set sees DB-sourced rows too.
      relatedExternalId: r.related_media_external_id,
    })),
    hasSaga: rels.some(r => r.relation_type === 'PREQUEL' || r.relation_type === 'SEQUEL'),
  };
}

function sortMediaRelations(relations: MediaRelation[]): MediaRelation[] {
  return [...relations].sort((a, b) => {
    const rTypeA = a.relationType?.toUpperCase() ?? '';
    const rTypeB = b.relationType?.toUpperCase() ?? '';
    const priorityA = RELATION_SORT_PRIORITY[rTypeA] ?? 99;
    const priorityB = RELATION_SORT_PRIORITY[rTypeB] ?? 99;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return 0;
  });
}

// A "full edition" of a base game inherits IGDB's whole sibling-editions web
// (e.g. a remaster's relations pointing at the original) — so it only shows
// its Fuente/parent relation. Content tied to one release (DLC, expansion,
// ...) doesn't have that problem and keeps its full relations.
const FULL_EDITION_FORMATS = new Set(['REMAKE', 'REMASTER', 'EXPANDED_GAME', 'PORT', 'FORK']);
const FULL_EDITION_ALLOWED_RELATION_TYPES = new Set([
  'PARENT', 'DLC', 'EXPANSION', 'STANDALONE', 'REMASTER', 'EXPANDED_GAME', 'REL_UPDATE',
  // Saga-chain edges and Bundled In are explicit, user-set relations, never
  // IGDB-inherited noise — always kept regardless of format.
  'PREQUEL', 'SEQUEL', 'ALTERNATIVE', 'PART_OF',
]);

export interface RelationBuckets {
  related: MediaRelation[];
  recommended: MediaRelation[];
  editions: MediaRelation[];
}

// Splits relations into the three tabs MediaPage.tsx renders. Always keys off
// the stable relationType, never typeLabel (locale-translated, so comparing
// it would break after a language switch).
export function bucketRelations(
  relations: MediaRelation[],
  format: string | undefined,
  editionsRelationType: string,
): RelationBuckets {
  const isFullEdition = FULL_EDITION_FORMATS.has(format ?? '');

  const related = sortMediaRelations(relations.filter(r =>
    r.relationType !== 'RECOMMENDATION' && r.relationType !== editionsRelationType &&
    (!isFullEdition || FULL_EDITION_ALLOWED_RELATION_TYPES.has(r.relationType ?? ''))
  ));
  const recommended = sortMediaRelations(relations.filter(r => r.relationType === 'RECOMMENDATION'));
  const editions = relations.filter(r => r.relationType === editionsRelationType);

  return { related, recommended, editions };
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

// Same conversion as dbCharacterToMediaCharacter, for the staff list
// (media_staff/staff_appearances).
export function dbStaffToMediaStaff(s: DbMediaStaffMember): MediaStaffMember {
  return {
    id: s.external_id,
    name: s.name,
    image: s.image_url || undefined,
    role: s.role || undefined,
  };
}

// Inverse of dbCharacterToMediaCharacter, before persisting a fetched cast.
// char.role is overloaded per source (TMDB: actual character name; AniList:
// MAIN/SUPPORTING kind), so isCastRole picks which DB column it lands in.
// Dedupes by external_id (a cast can list the same character twice).
export function mediaCharactersToSkeleton(characters: MediaCharacter[], isCastRole: boolean): SkeletonCharacter[] {
  const seen = new Set<string>();
  return characters
    .map(char => ({
      external_id: char.id || `character:${char.name}`,
      name: char.name,
      image_url: char.image || null,
      relation_type: isCastRole ? null : (char.role || null),
      character_name: isCastRole ? (char.role || null) : null,
    }))
    .filter(char => {
      if (seen.has(char.external_id)) return false;
      seen.add(char.external_id);
      return true;
    });
}

// Same shape/dedup logic as mediaCharactersToSkeleton, for staff.
export function mediaStaffToSkeleton(staff: MediaStaffMember[]): SkeletonStaffMember[] {
  const seen = new Set<string>();
  return staff
    .map(member => ({
      external_id: member.id || `staff:${member.name}`,
      name: member.name,
      image_url: member.image || null,
      role: member.role || null,
    }))
    .filter(member => {
      if (seen.has(member.external_id)) return false;
      seen.add(member.external_id);
      return true;
    });
}

// Shared by fetchMediaData and fetchMediaDataWithFallback — loads whatever's
// already curated in the DB before deciding to trust it or enrich it live.
export async function loadDbRelationsAndAuthors(rawId: string): Promise<{ relations: DbMediaRelation[]; authors: DbMediaAuthor[] }> {
  const [relations, authors] = await Promise.all([
    getMediaRelations(rawId).catch(() => []),
    getMediaAuthors(rawId).catch(() => []),
  ]);
  return { relations, authors };
}

// Merges freshly-fetched relations into whatever's already saved, instead of
// only ever syncing once per title (IGDB keeps adding DLCs/expansions/etc.
// over time). Existing DB rows always win on id conflicts since they may
// carry hand-edits (saga grouping, relation-type fixes) via PrEditorModal.
//
// Also normalizes legacy-labeled DB rows even with nothing new to merge, and
// drops stale REMAKE/REMASTER/EXPANDED_GAME/FORK rows (see
// FULL_EDITION_FORMATS) that are always IGDB-derived, never hand-added, so a
// live fetch no longer reporting one means it's safe to remove.
const STALE_INHERITED_RELATION_TYPES = new Set(['REMAKE', 'REMASTER', 'EXPANDED_GAME', 'FORK']);

// Returns whether it actually wrote anything new/changed — callers use this
// as a cheap "did this bring anything new" signal instead of re-reading
// relations back from the DB afterward just to diff a count.
export async function mergeAndPersistRelations(
  rawId: string,
  fetchedRelations: MediaPageData['relations'],
  format?: string,
): Promise<boolean> {
  const { relations: dbRels } = await loadDbRelationsAndAuthors(rawId);

  const normalizedDbRels = dbRels.map(normalizeLegacyDbRelation);

  const freshIds = new Set((fetchedRelations ?? []).map(r => r.relatedExternalId).filter(Boolean));
  const prunedDbRels = format && FULL_EDITION_FORMATS.has(format)
    ? normalizedDbRels.filter(r => !STALE_INHERITED_RELATION_TYPES.has(r.relation_type) || freshIds.has(r.related_media_external_id))
    : normalizedDbRels;

  const changedLegacyTypes = normalizedDbRels.some((r, i) => r.relation_type !== dbRels[i].relation_type);
  const prunedStale = prunedDbRels.length !== normalizedDbRels.length;

  const dbIds = new Set(prunedDbRels.map(r => r.related_media_external_id));
  let candidateNew = (fetchedRelations ?? [])
    .filter(r => r.relatedExternalId && !dbIds.has(r.relatedExternalId));

  // A pair the user deliberately deleted must never be silently re-added —
  // save_media_relations tombstones it in deleted_relations, so only that
  // specific pair is blocked, not every future relation this entry could gain.
  if (candidateNew.length > 0) {
    const deletedIds = new Set(await getDeletedRelations(rawId).catch(() => [] as string[]));
    if (deletedIds.size > 0) {
      candidateNew = candidateNew.filter(r => !deletedIds.has(r.relatedExternalId!));
    }
  }

  const newFromApi = candidateNew.map(r => ({
    related_media_external_id: r.relatedExternalId!,
    relation_type: r.relationType ?? 'RELATED',
    type_label: r.typeLabel,
    title: r.title,
    cover: r.cover || null,
    format: r.format || null,
  }));

  const changed = newFromApi.length > 0 || changedLegacyTypes || prunedStale;
  if (changed) {
    await saveMediaRelations(rawId, [...prunedDbRels, ...newFromApi]).catch(console.error);
  }
  return changed;
}
