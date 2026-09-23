// Provider dispatch for a media page: picks the live provider + mapper pair
// from an external-id prefix. Split out of media-page-data.ts (still
// re-exported from there) so the routing table is readable on its own,
// separate from catalog persistence and the partial/full render staging.
import { fetchAniListDetail } from '../search/providers/anilist';
import { fetchOpenLibWork, fetchOpenLibAuthor, fetchOpenLibEditions } from '../search/providers/openlibrary';
import { fetchTmdbDetail } from '../search/providers/tmdb';
import { fetchComicVineVolume } from '../search/providers/comicvine';
import { fetchApiSportsEvent } from '../search/providers/apisports';
import { mapAniListToMedia } from './mappers/anilist-mapper';
import { mapOpenLibToMedia } from './mappers/openlibrary-mapper';
import { mapComicVineToMedia } from './mappers/comicvine-mapper';
import { mapTmdbToMedia } from './mappers/tmdb-mapper';
import { mapIgdbToMedia, dedupeRelationsByTarget } from './mappers/igdb-mapper';
import { igdbGetGameDetail } from '../tauri';
import { readBlockedExternalIdsCached } from './media-page-read-cache';
import type { MediaPageData, MediaAuthor } from './types';
import { parseExternalId } from './mappers/mapper-utils';
import { ANILIST_TYPES, IGDB_TYPES } from './media-types';

export function isAniListMediaType(value: string): value is typeof ANILIST_TYPES[number] {
  return (ANILIST_TYPES as readonly string[]).includes(value);
}

export function isIgdbMediaType(value: string): value is typeof IGDB_TYPES[number] {
  return (IGDB_TYPES as readonly string[]).includes(value);
}

// ── Fetch interno ─────────────────────────────────────────────────────────

export async function fetchMediaDataInternal(rawId: string, allowBlocked = false): Promise<MediaPageData | null> {
  if (!rawId) return null;
  if (!allowBlocked && (await readBlockedExternalIdsCached().catch(() => [] as string[])).includes(rawId)) return null;

  const { type, id: numericId } = parseExternalId(rawId);

  // Comic-Vine-sourced issue sub-entries (manga:issue-, lnovel:issue-,
  // comic:issue-) carry their parent work's own type prefix so catalog
  // classification matches the parent, but the actual fetch always goes
  // through ComicVine — must be checked before the type-based routing below,
  // since e.g. "manga" would otherwise match the AniList branch.
  const idStr = rawId.slice(rawId.indexOf(':') + 1);
  if (idStr.startsWith('issue-')) {
    // Issues are child cards, not standalone catalog works; they deliberately
    // have no independent media page.
    return null;
  }

  if (isAniListMediaType(type)) {
    if (!numericId) return null;
    const raw = await fetchAniListDetail(numericId);
    return raw ? mapAniListToMedia(raw, type) : null;
  }

  if (isIgdbMediaType(type)) {
    if (!numericId) return null;

    // Banner/store links ride along as Game sub-fields in one request.
    const game = await igdbGetGameDetail(numericId);
    if (!game) return null;
    const data = mapIgdbToMedia(game, rawId);
    data.relations = dedupeRelationsByTarget(data.relations);
    // Base-game/relation-graph queries are slow — deferred to fetchExtraRelations.
    return data;
  }

  if (type === 'movie' || type === 'series') {
    if (!numericId) return null;
    const raw = await fetchTmdbDetail(numericId, type);
    return raw ? mapTmdbToMedia(raw, type, rawId) : null;
  }

  if (type === 'event') {
    return fetchApiSportsEvent(rawId);
  }

  if (type === 'comic') {
    const volumeId = parseInt(idStr, 10);
    if (!Number.isFinite(volumeId)) return null;
    const volume = await fetchComicVineVolume(volumeId);
    return volume ? mapComicVineToMedia(volume, rawId) : null;
  }

  if (type === 'book') {
    const idStr = rawId.slice(rawId.indexOf(':') + 1);
    const cachedNames = sessionStorage.getItem(`book_authors:${rawId}`);
    const preloadNames: string[] | null = cachedNames ? JSON.parse(cachedNames) : null;

    const work = await fetchOpenLibWork(idStr);
    if (!work) return null;

    // Every author, not just the first — the search result's own cached key
    // (book_author_key) only ever carries one, since SearchResult.authorKey
    // is itself documented as "first author key... OpenLibrary only"; the
    // Work's own `authors` list is the only place co-authors show up at all.
    const authorKeys = (work.authors ?? []).map(a => a.author?.key).filter((k): k is string => !!k);
    const authorDetails = authorKeys.length
      ? await Promise.all(authorKeys.map(k => fetchOpenLibAuthor(k)))
      : [];

    let richAuthors: MediaAuthor[] = authorDetails
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map(a => ({
        external_id: a.key ? `author:${a.key}` : `author:${a.name}`,
        name: a.name,
        image: a.image || undefined,
        url: a.key ? `/author?id=author:${a.key}` : undefined,
      }));
    if (richAuthors.length === 0 && preloadNames) {
      richAuthors = preloadNames.map(name => ({ external_id: `author:${name}`, name }));
    }

    let firstEditionCover: number | undefined;
    if (!work.covers?.[0]) {
      const editions = await fetchOpenLibEditions(idStr);
      firstEditionCover = editions[0]?.covers?.[0];
    }

    return mapOpenLibToMedia(work, richAuthors, rawId, type, firstEditionCover);
  }

  return null;
}
