// Relation sorting, legacy-label normalization, and DB↔UI shape conversion
// for media relations/authors/characters — extracted from mediaService.ts
// (still re-exported from there).
import type { MediaPageData, MediaAuthor, MediaCharacter, MediaRelation } from './types';
import { getMediaRelations, getMediaAuthors, saveMediaRelations, type DbMediaRelation, type DbMediaAuthor } from '../tauri/catalog';
import type { DbMediaCharacter, SkeletonCharacter } from '../tauri/characters';
import { getT } from '../../i18n/client';
import { normalizeLegacyRelationType } from './sagaTypes';
import { lookupLabel } from './mapper-utils';

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
  // r.type_label is whatever locale was active when this row was first
  // saved (see mergeAndPersistRelations) and is never rewritten afterward —
  // comparing it against the *current* locale's translated string (as the
  // Related/Recommended/Editions tab split in MediaPage.tsx does) silently
  // fails once the UI language changes, dumping everything into "Related".
  // relation_type itself is stable/canonical, so re-deriving the label from
  // it at read time keeps the display correct regardless of what got saved.
  const tm = getT().media;
  return {
    relations: sorted.map(r => ({
      typeLabel: lookupLabel(tm.relations, r.relation_type, r.type_label),
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
    return 0;
  });
}

// A "full edition" of a base game (remake/remaster/expanded edition/port/
// fork) tends to inherit the base game's whole sibling-editions web in
// IGDB's own data — e.g. a remaster's own relations pointing at the
// *original, non-remastered* content — so those only ever show their
// Fuente/parent relation. Content attached to a specific release (DLC,
// expansion, standalone expansion, episode, season, mod, update) doesn't
// have that inheritance problem, so those keep their full relations.
const FULL_EDITION_FORMATS = new Set(['REMAKE', 'REMASTER', 'EXPANDED_GAME', 'PORT', 'FORK']);
const FULL_EDITION_ALLOWED_RELATION_TYPES = new Set([
  'PARENT', 'DLC', 'EXPANSION', 'STANDALONE', 'REMASTER', 'EXPANDED_GAME', 'REL_UPDATE',
  // Saga-chain edges (PrEditorModal's Saga Order) are explicit, user-set
  // relations, never IGDB-inherited noise — a remake/remaster/etc. with its
  // own saga chain must keep showing its prequels/sequels/alt versions
  // regardless of format.
  'PREQUEL', 'SEQUEL', 'ALTERNATIVE',
]);

export interface RelationBuckets {
  related: MediaRelation[];
  recommended: MediaRelation[];
  editions: MediaRelation[];
}

// Splits a media page's relations into the three tabs MediaPage.tsx renders
// (Related / Recommended / Editions-or-Issues). Always keys off the stable
// relationType, never typeLabel — typeLabel is locale-translated text (either
// the currently-active locale, for freshly-fetched data, or whatever locale
// was active when a row was first saved to media_relations/session cache),
// so comparing it against the *current* locale's translated string silently
// breaks this split after a language switch or for any relation loaded from
// an older cached/DB row. relationType never changes with locale.
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

// Inverse of dbCharacterToMediaCharacter — used before persisting a freshly-
// fetched cast (MediaPage.tsx calls this both for the initial full.characters
// and for a comic's later full-cast aggregation). char.role is overloaded per
// source: TMDB (movie/series) puts the actual character name played there,
// while AniList (anime/manga/etc.) puts the MAIN/SUPPORTING relation kind —
// they need to land in different DB columns instead of both piling into
// relation_type. Dedupes by external_id since a cast can list the same
// character more than once (e.g. AniList's multi-voice-actor edges).
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
// IGDB full editions (remake/remaster/expanded_game/port/fork, see
// FULL_EDITION_FORMATS above) used to have their REMAKE/REMASTER/
// EXPANDED_GAME/FORK relations derived straight from IGDB's inherited-from-
// the-base-game fields (see igdb-mapper.ts) — those rows are always fully
// re-derived from the live fetch for these formats, never something a user
// adds by hand for these specific types (manual additions go through
// PrEditorModal's own relation types), so a stale one left over from before
// that fix is safe to drop once the live fetch no longer reports it.
const STALE_INHERITED_RELATION_TYPES = new Set(['REMAKE', 'REMASTER', 'EXPANDED_GAME', 'FORK']);

export async function mergeAndPersistRelations(rawId: string, fetchedRelations: MediaPageData['relations'], format?: string): Promise<void> {
  const { relations: dbRels } = await loadDbRelationsAndAuthors(rawId);

  const normalizedDbRels = dbRels.map(normalizeLegacyDbRelation);

  const freshIds = new Set((fetchedRelations ?? []).map(r => r.relatedExternalId).filter(Boolean));
  const prunedDbRels = format && FULL_EDITION_FORMATS.has(format)
    ? normalizedDbRels.filter(r => !STALE_INHERITED_RELATION_TYPES.has(r.relation_type) || freshIds.has(r.related_media_external_id))
    : normalizedDbRels;

  const changedLegacyTypes = normalizedDbRels.some((r, i) => r.relation_type !== dbRels[i].relation_type);
  const prunedStale = prunedDbRels.length !== normalizedDbRels.length;

  const dbIds = new Set(prunedDbRels.map(r => r.related_media_external_id));
  const newFromApi = (fetchedRelations ?? [])
    .filter(r => r.relatedExternalId && !dbIds.has(r.relatedExternalId))
    .map(r => ({
      related_media_external_id: r.relatedExternalId!,
      relation_type: r.relationType ?? 'RELATED',
      type_label: r.typeLabel,
      title: r.title,
      cover: r.cover || null,
    }));

  if (newFromApi.length > 0 || changedLegacyTypes || prunedStale) {
    await saveMediaRelations(rawId, [...prunedDbRels, ...newFromApi]).catch(console.error);
  }
}
