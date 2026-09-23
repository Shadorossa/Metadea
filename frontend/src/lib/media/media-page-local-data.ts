// Local-only (no network) enrichment of a media page from the IPC tables:
// relations/authors/characters/staff/companies/parent, plus the base-edition
// cast inheritance a remaster displays. Split out of media-page-data.ts
// (still re-exported from there) so the "before first paint" reads are
// readable apart from the live fetch and its catalog write-back.
import type { MediaCatalogEntry } from '../tauri';
import type { DbMediaAuthor, DbMediaRelation } from '../tauri/catalog';
import type { MediaPageData, MediaCompany, MediaCharacter } from './types';
import { getMediaCharacters, type DbMediaCharacter } from '../tauri/characters';
import type { DbMediaStaffMember } from '../tauri/staff';
import type { DbMediaCompany } from '../tauri/companies';
import { getPublisherNames } from '../shared/text/string-utils';
import { getCachedMediaData } from './media-cache';
import { mapCatalogEntryToPartialData } from './mappers/catalog-mapper';
import {
  sortRelationsForDisplay, dbAuthorToMediaAuthor, dbCharacterToMediaCharacter,
  dbStaffToMediaStaff, dbCompanyToMediaCompany,
} from './saga/media-relations';
import { fetchMediaDataInternal } from './media-page-fetch';
import {
  readBlockedExternalIdsCached, readCatalogEntryCached, readMediaRelationsCached, readMediaAuthorsCached,
  readMediaCharactersCached, readMediaStaffCached, readMediaCompaniesCached,
} from './media-page-read-cache';

// Same pair of reads as saga/media-relations' loadDbRelationsAndAuthors,
// with both row sets going through the visit-scoped memo (the relation
// rows are read again by the anime chain walk and the live-fetch merge; on
// the page's own id both come out of the mount bundle).
export async function loadDbRelationsAndAuthorsCached(rawId: string): Promise<{ relations: DbMediaRelation[]; authors: DbMediaAuthor[] }> {
  const [relations, authors] = await Promise.all([
    readMediaRelationsCached(rawId).catch(() => [] as DbMediaRelation[]),
    readMediaAuthorsCached(rawId).catch(() => [] as DbMediaAuthor[]),
  ]);
  return { relations, authors };
}

export async function loadBaseEditionCharacters(baseId: string, fetchIfMissing: boolean): Promise<MediaCharacter[]> {
  if ((await readBlockedExternalIdsCached().catch(() => [] as string[])).includes(baseId)) return [];
  const saved = await getMediaCharacters(baseId).catch(() => [] as DbMediaCharacter[]);
  if (saved.length > 0) return saved.map(dbCharacterToMediaCharacter);
  if (!fetchIfMissing) return [];

  // A remaster can be the first edition the user opens. In that case, use
  // the base game's provider cast for this render without writing duplicate
  // appearance rows to either edition.
  const cachedBase = getCachedMediaData(baseId);
  const liveBase = cachedBase ?? await fetchMediaDataInternal(baseId).catch(() => null);
  return liveBase?.characters ?? [];
}

export function getBaseEditionId(data: MediaPageData): string | null {
  const format = data.format?.toUpperCase();
  if (format !== 'REMASTER' && format !== 'EXPANDED_GAME') return null;
  return data.relations.find(relation => relation.relationType === 'BASE_EDITION')?.relatedExternalId ?? null;
}

// Fire-and-forget: call on hover to warm the local reads (catalog row +
// relations/characters/staff/companies) that fetchMediaDataWithFallback's
// own onPartial path reads fresh on every real visit anyway — local-only,
// never hits AniList/IGDB/TMDB/OpenLibrary/ComicVine. An entry that isn't
// already in the local media_catalog (nobody's opened its page yet) simply
// doesn't get prefetched, rather than sweeping the cursor across a browse
// grid quietly firing a live API request per card it merely passed over.
// Deliberately doesn't write to the shared media_cache_v3 cache: that cache
// means "this is the final, live-merged page", and fetchMediaDataWithFallback
// treats any hit there as reason to skip its own live refresh entirely — a
// local-only partial snapshot passed off as final would freeze that page on
// stale data.
export function prefetchMediaData(rawId: string): void {
  if (getCachedMediaData(rawId)) return;
  readCatalogEntryCached(rawId)
    .then(async catalog => {
      if (!catalog || !catalog.title_main) return;
      const localData = mapCatalogEntryToPartialData(catalog);
      await enrichLocalData(rawId, catalog, localData).catch(() => {});
    })
    .catch(() => {});
}

// Every mapper's display line is always the 'publisher' role (games: the
// actual publisher; anime: the producers/production committee, AniList's
// non-main studios; movies/series: TMDB's production companies, which
// aren't split into roles) — never 'developer', and never a format-label
// fallback (format has its own dedicated Stats row). Book/comic's line is
// authors, untouched by this.
export function companyMetaLine(companies: MediaCompany[]): string | undefined {
  const names = getPublisherNames(companies);
  return names.length > 0 ? names.join(', ') : undefined;
}

// Fills in relations/authors/characters/staff/parent from local IPC reads
// only (no network) — fast enough to run before first paint. During a page
// visit every row set here comes out of the one mount bundle (see
// media-page-read-cache.ts); the characters are the display-only flavour,
// which is fine since a 'local' render is never written back.
export async function enrichLocalData(rawId: string, catalog: MediaCatalogEntry, localData: MediaPageData): Promise<void> {
  const [{ relations: dbRels, authors: dbAuthors }, dbChars, dbStaff, dbCompanies, parentEntry] = await Promise.all([
    loadDbRelationsAndAuthorsCached(rawId),
    readMediaCharactersCached(rawId).catch(() => [] as DbMediaCharacter[]),
    readMediaStaffCached(rawId).catch(() => [] as DbMediaStaffMember[]),
    readMediaCompaniesCached(rawId).catch(() => [] as DbMediaCompany[]),
    // Resolved to a full {externalId, title, cover} so isBlockedEdition (MediaPage.tsx) sees it here too.
    catalog.parent_id ? readCatalogEntryCached(catalog.parent_id).catch(() => null) : Promise.resolve(null),
  ]);

  if (dbRels.length > 0) {
    const { relations, hasSaga } = sortRelationsForDisplay(dbRels);
    localData.relations = relations;
    localData.hasSaga = hasSaga;
  }
  if (dbAuthors.length > 0) localData.authors = dbAuthors.map(dbAuthorToMediaAuthor);
  const baseEditionRelation = dbRels.find(relation => relation.relation_type === 'BASE_EDITION');
  const inheritsBaseEditionCast = ['REMASTER', 'EXPANDED_GAME'].includes(localData.format?.toUpperCase() ?? '');
  if (inheritsBaseEditionCast && baseEditionRelation) {
    localData.characters = await loadBaseEditionCharacters(baseEditionRelation.related_media_external_id, false);
    localData.charactersInheritedFromBase = true;
  } else if (dbChars.length > 0) {
    localData.characters = dbChars.map(dbCharacterToMediaCharacter);
  }
  if (dbStaff.length > 0) localData.staff = dbStaff.map(dbStaffToMediaStaff);
  if (dbCompanies.length > 0) {
    localData.companies = dbCompanies.map(dbCompanyToMediaCompany);
    // The catalog-only fast path (mapCatalogEntryToPartialData) has no
    // company data to build this line from at all — companies are
    // relational now, not a catalog_media column — so it's patched in here
    // once the company table loads, same "flashes in late" tradeoff as
    // every other relational field on this page (authors, characters, ...).
    const companyLine = companyMetaLine(localData.companies);
    if (companyLine) localData.metaLines = [companyLine, ...localData.metaLines];
  }
  const hasExplicitBaseEditionRelation = !!catalog.parent_id && dbRels.some(
    relation => relation.relation_type === 'BASE_EDITION'
      && relation.related_media_external_id === catalog.parent_id,
  );
  if (parentEntry && hasExplicitBaseEditionRelation) {
    localData.parentGame = {
      externalId: parentEntry.external_id,
      title: parentEntry.title_main || parentEntry.external_id,
      cover: parentEntry.cover_url ?? undefined,
    };
  }
}
