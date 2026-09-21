// Relation sorting, legacy-label normalization, and DB↔UI shape conversion
// for media relations/authors/characters — extracted from mediaService.ts
// (still re-exported from there).
import type { MediaPageData, MediaAuthor, MediaCharacter, MediaStaffMember, MediaRelation, MediaCompany } from './types';
import { getMediaRelations, getMediaAuthors, saveMediaRelations, getDeletedRelations, getBlockedExternalIds, type DbMediaRelation, type DbMediaAuthor } from '../tauri/catalog';
import type { DbMediaCharacter, SkeletonCharacter } from '../tauri/characters';
import type { SkeletonStaffMember, DbMediaStaffMember } from '../tauri/misc-commands';
import type { DbMediaCompany } from '../tauri/misc-commands';
import { getT } from '../../i18n/client';
import { normalizeLegacyRelationType } from './sagaTypes';
import { lookupLabel } from './mapper-utils';
import { CANONICAL_RELATION_LABELS as canonicalRelationLabels } from './canonical-relations';

// Order of relations: Fuente > Prequel > Sequel > Adaptation > Side story
// (Historia paralela) > Alternative > Other. SOURCE (the original work an
// adaptation/summary/fork/side story is based on) and BASE_EDITION (the base
// edition/volume a game edition or comic issue belongs to — a distinct
// concept, see canonical-relations.ts) both sort first since either one is
// "what this entry depends on" — ADAPTATION is the derivative work, so it
// belongs after Prequel/Sequel, not grouped alongside the source. PARENT
// (AniList's own "main story this side content is attached to") sorts here
// too, for the same "what this entry depends on" reasoning.
const RELATION_SORT_PRIORITY: Record<string, number> = {
  // Fuente
  SOURCE: 1,
  REL_SOURCE: 1,
  PARENT: 1,
  BASE_EDITION: 1,

  // Prequel
  PREQUEL: 2,

  // Sequel
  SEQUEL: 3,

  // Adaptation
  ADAPTATION: 4,
  REL_ADAPTATION: 4,

  // Side story
  SIDE_STORY: 5,
  SPIN_OFF: 5,

  // Alternative
  ALTERNATIVE: 6,
  REL_ALTERNATIVE: 6,

  // Other
  OTHER: 7,
  SUMMARY: 7,
  REMAKE: 7,
  REMASTER: 7,
  EXPANDED_GAME: 7,
  REL_UPDATE: 7,
  DLC: 7,
  EXPANSION: 7,
  STANDALONE: 7,
  FORK: 7,
};

// A bundle's own EPISODE relations (e.g. Umineko's 8 visual-novel episodes)
// almost always carry their own number right in the title ("Episode 8 -
// Twilight of the Golden Witch"), which is far more reliable than
// release_year/month/day for this specific relation type — those columns
// are only ever populated when the source that curated the edge happened to
// supply a release date for the related title, which a manually-added or
// IGDB-sourced EPISODE relation often doesn't, leaving every entry tied at
// the same fallback date and sorted in whatever arbitrary order they were
// saved in instead of release order.
const EPISODE_NUMBER_RE = /\b(?:episode|episodio|cap[ií]tulo|chapter)\s+(\d+(?:\.\d+)?)\b/i;

export function extractEpisodeNumberFromTitle(title: string | null | undefined): number | null {
  if (!title) return null;
  const match = EPISODE_NUMBER_RE.exec(title);
  return match ? parseFloat(match[1]) : null;
}

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
    // An EPISODE relation's own title almost always carries its real number
    // ("Episode 8 - ...") — more reliable than release date for this type,
    // whose release_year/month/day is often never populated at all.
    if (a.relation_type === 'EPISODE' && b.relation_type === 'EPISODE') {
      const epA = extractEpisodeNumberFromTitle(a.title);
      const epB = extractEpisodeNumberFromTitle(b.title);
      if (epA !== null && epB !== null && epA !== epB) return epA - epB;
    }
    // Within same relation type, sort by full release date (ascending: older first)
    const dateA = (a.release_year ?? 9999) * 10000 + (a.release_month ?? 12) * 100 + (a.release_day ?? 31);
    const dateB = (b.release_year ?? 9999) * 10000 + (b.release_month ?? 12) * 100 + (b.release_day ?? 31);
    if (dateA !== dateB) return dateA - dateB;
    return 0;
  });
  const seenRelatedIds = new Set<string>();
  const seenEditionVisuals = new Set<string>();
  const editionTypes = new Set(['BASE_EDITION', 'REMASTER', 'REMAKE', 'EXPANDED_GAME', 'PORT', 'FORK']);
  const deduped = sorted.filter(relation => {
    if (seenRelatedIds.has(relation.related_media_external_id)) return false;
    seenRelatedIds.add(relation.related_media_external_id);

    // IGDB can expose several edition records for the same product family,
    // especially on a remaster page. When they resolve to the same relation
    // type/title/cover, showing every row produces three identical cards.
    // Keep the first row because the sort above already puts the most useful
    // relation type first.
    if (editionTypes.has(relation.relation_type)) {
      const visualKey = `${relation.title.trim().toLocaleLowerCase()}|${relation.cover ?? ''}`;
      if (seenEditionVisuals.has(visualKey)) return false;
      seenEditionVisuals.add(visualKey);
    }
    return true;
  });
  // relation_type is the only source of truth for the label - r.type_label
  // (persisted, locale-frozen at save time) is never read, since trusting it
  // would drift from the current locale after a language switch.
  const tm = getT().media;
  return {
    relations: deduped.map(r => ({
      typeLabel: lookupLabel(tm.relations, r.relation_type, canonicalRelationLabels[r.relation_type] ?? r.relation_type),
      relationType: r.relation_type,
      title: r.title,
      cover: r.cover || undefined,
      url: r.relation_type === 'ISSUE' ? undefined : `/media?id=${r.related_media_external_id}`,
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
    // An EPISODE relation's own title almost always carries its real number
    // ("Episode 8 - ...") — more reliable than release date for this type,
    // whose releaseYear/Month/Day is often never populated at all.
    if (rTypeA === 'EPISODE' && rTypeB === 'EPISODE') {
      const epA = extractEpisodeNumberFromTitle(a.title);
      const epB = extractEpisodeNumberFromTitle(b.title);
      if (epA !== null && epB !== null && epA !== epB) return epA - epB;
    }
    // Within same relation type, sort by full release date (ascending: older first)
    const dateA = (a.releaseYear ?? 9999) * 10000 + (a.releaseMonth ?? 12) * 100 + (a.releaseDay ?? 31);
    const dateB = (b.releaseYear ?? 9999) * 10000 + (b.releaseMonth ?? 12) * 100 + (b.releaseDay ?? 31);
    if (dateA !== dateB) return dateA - dateB;
    return 0;
  });
}

// A "full edition" of a base game inherits IGDB's whole sibling-editions web
// (e.g. a remaster's relations pointing at the original) — so it only shows
// its Fuente/parent relation. Content tied to one release (DLC, expansion,
// ...) doesn't have that problem and keeps its full relations.
const FULL_EDITION_FORMATS = new Set(['REMAKE', 'REMASTER', 'EXPANDED_GAME', 'PORT', 'FORK']);
const FULL_EDITION_ALLOWED_RELATION_TYPES = new Set([
  'BASE_EDITION', 'DLC', 'EXPANSION', 'STANDALONE', 'REMASTER', 'EXPANDED_GAME', 'REL_UPDATE',
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
  const visibleRelations = relations.filter(r => r.format?.trim().toUpperCase() !== 'SUMMARY');

  const related = sortMediaRelations(visibleRelations.filter(r =>
    r.relationType !== 'RECOMMENDATION' && r.relationType !== editionsRelationType &&
    (!isFullEdition || FULL_EDITION_ALLOWED_RELATION_TYPES.has(r.relationType ?? ''))
  ));
  const recommended = sortMediaRelations(visibleRelations.filter(r => r.relationType === 'RECOMMENDATION'));
  const editions = visibleRelations.filter(r => r.relationType === editionsRelationType);

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

export function dbCompanyToMediaCompany(c: DbMediaCompany): MediaCompany {
  return {
    external_id: c.external_id,
    name: c.name,
    logo_url: c.logo_url ?? null,
    role: c.role,
  };
}

export function dbCharacterToMediaCharacter(c: DbMediaCharacter): MediaCharacter {
  return {
    id: c.external_id,
    hrefId: c.merged_character_external_id || c.external_id,
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
  // Manual "Reintentar sincronización" only — see fetchMediaData's own
  // comment on its refreshSourceAdaptation option for why this one pair
  // needs an escape hatch from the usual "existing DB rows always win" rule.
  forceRefreshSourceAdaptation = false,
  context?: { dbRelations?: DbMediaRelation[]; blockedIds?: readonly string[] },
): Promise<boolean> {
  const dbRels = context?.dbRelations ?? (await loadDbRelationsAndAuthors(rawId)).relations;

  const normalizedDbRels = dbRels.map(normalizeLegacyDbRelation);
  const deletedRelationIds = await getDeletedRelations(rawId).catch(() => [] as string[]);
  const blockedIds = context?.blockedIds ?? await getBlockedExternalIds().catch(() => [] as string[]);
  const deletedIds = new Set(deletedRelationIds);
  const blocked = new Set(blockedIds);

  const freshIds = new Set((fetchedRelations ?? []).map(r => r.relatedExternalId).filter(Boolean));
  let prunedDbRels = format && FULL_EDITION_FORMATS.has(format)
    ? normalizedDbRels.filter(r => !STALE_INHERITED_RELATION_TYPES.has(r.relation_type) || freshIds.has(r.related_media_external_id))
    : normalizedDbRels;

  // A globally blocked work must not leak back into relations through an
  // existing SQLite row or a fresh provider response. Prune both directions
  // before persisting so repeated syncs cannot resurrect its external_id.
  const beforeBlockedFilter = prunedDbRels.length;
  prunedDbRels = prunedDbRels.filter(r => !blocked.has(r.related_media_external_id));
  const prunedByBlock = prunedDbRels.length !== beforeBlockedFilter;

  // A deletion tombstone must take precedence over an already-cached row as
  // well as a newly fetched API relation. Previously only candidateNew was
  // checked below, so a reciprocal save or a relation-type change (e.g.
  // OTHER -> SIDE_STORY) could leave the old id in SQLite and keep rendering
  // it after the curator had removed it.
  const beforeTombstoneFilter = prunedDbRels.length;
  prunedDbRels = prunedDbRels.filter(r => !deletedIds.has(r.related_media_external_id));
  const prunedByTombstone = prunedDbRels.length !== beforeTombstoneFilter;

  // Correct just this one mismatch instead of leaving whichever direction
  // got cached first (possibly wrong — AniList's own raw data isn't always
  // reciprocally curated, see anilist-mapper.ts) stuck forever. Only ever
  // flips SOURCE<->ADAPTATION against what the fresh fetch says for the
  // exact same related id — never touches any other relation type or adds/
  // removes a row.
  let sourceAdaptationChanged = false;
  if (forceRefreshSourceAdaptation && fetchedRelations) {
    const freshDirectionByRelatedId = new Map(
      fetchedRelations
        .filter((r): r is typeof r & { relatedExternalId: string; relationType: string } =>
          !!r.relatedExternalId && (r.relationType === 'SOURCE' || r.relationType === 'ADAPTATION'))
        .map(r => [r.relatedExternalId, r]),
    );
    prunedDbRels = prunedDbRels.map(r => {
      if (r.relation_type !== 'SOURCE' && r.relation_type !== 'ADAPTATION') return r;
      const fresh = freshDirectionByRelatedId.get(r.related_media_external_id);
      if (!fresh || fresh.relationType === r.relation_type) return r;
      sourceAdaptationChanged = true;
      return { ...r, relation_type: fresh.relationType, type_label: fresh.typeLabel };
    });
  }

  const changedLegacyTypes = normalizedDbRels.some((r, i) => r.relation_type !== dbRels[i].relation_type);
  const prunedStale = prunedDbRels.length !== normalizedDbRels.length;

  const dbIds = new Set(prunedDbRels.map(r => r.related_media_external_id));
  let candidateNew = (fetchedRelations ?? [])
    .filter(r => r.relatedExternalId && !blocked.has(r.relatedExternalId) && !dbIds.has(r.relatedExternalId));

  // A pair the user deliberately deleted must never be silently re-added -
  // save_media_relations tombstones it in deleted_relations, so only that
  // specific pair is blocked, not every future relation this entry could gain.
  if (candidateNew.length > 0) {
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

  const changed = newFromApi.length > 0 || changedLegacyTypes || prunedStale || prunedByTombstone || prunedByBlock || sourceAdaptationChanged;
  if (changed) {
    await saveMediaRelations(rawId, [...prunedDbRels, ...newFromApi]).catch(console.error);
  }
  return changed;
}
