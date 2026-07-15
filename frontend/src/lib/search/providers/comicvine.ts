// Comics search backend — Comic Vine instead of OpenLibrary. OpenLibrary's
// catalog is crowd-sourced and routinely has multiple separate "work"
// records for the exact same comic; Comic Vine is curated specifically for
// comics (proper volume/issue structure) and doesn't have that problem
// nearly as badly. Comic Vine has no CORS headers, so — unlike every other
// browser-fetch provider here — this goes through Tauri (see igdb.ts for
// the same pattern, same underlying reason: IGDB requires a bearer token
// browser JS can't safely hold anyway, Comic Vine just blocks browser
// fetches outright).
import { comicVineSearch, comicVineGetVolume, comicVineGetIssues, comicVineGetIssue, comicVineGetIssuesCast, isTauri, type ComicVineVolume, type ComicVineIssue, type ComicVineIssueDetail, type ComicVineVolumeCast } from '../../tauri';
import type { SearchResult, SearchPage } from '../index';
import { MissingApiKeyError } from '../errors';

function coverUrlFrom(volume: ComicVineVolume): string | null {
  return volume.image?.medium_url ?? volume.image?.small_url ?? null;
}

function yearFrom(volume: ComicVineVolume): number | null {
  const y = volume.start_year ? parseInt(volume.start_year, 10) : NaN;
  return Number.isFinite(y) ? y : null;
}

function mapVolume(volume: ComicVineVolume): SearchResult {
  return {
    externalId:   `comic:${volume.id}`,
    type:         'comic',
    format:       '',
    source:       'comicvine' as SearchResult['source'],
    titleMain:    volume.name,
    titleRomaji:  null,
    titleNative:  null,
    coverUrl:     coverUrlFrom(volume),
    releaseYear:  yearFrom(volume),
    releaseMonth: null,
    releaseDay:   null,
    // Comic Vine's volume resource has no rating/score field.
    scoreGlobal:  null,
  };
}

export async function searchComics(searchQuery: string, _signal: AbortSignal, page = 1): Promise<SearchPage> {
  if (!isTauri()) {
    // No browser fallback: Comic Vine blocks direct browser fetches (no
    // CORS), so outside the desktop app there's genuinely nothing to call.
    return { results: [], hasMore: false };
  }

  let pageResult;
  try {
    pageResult = await comicVineSearch(searchQuery, page);
  } catch (e) {
    const message = typeof e === 'string' ? e : String(e);
    if (message.includes('Missing Comic Vine API key')) {
      throw new MissingApiKeyError(['comicvine']);
    }
    throw new Error(message);
  }

  return {
    results: pageResult.volumes.filter(v => coverUrlFrom(v)).map(mapVolume),
    hasMore: pageResult.has_more,
  };
}

export async function fetchComicVineVolume(volumeId: number): Promise<ComicVineVolume | null> {
  if (!isTauri()) return null;
  return comicVineGetVolume(volumeId).catch(() => null);
}

export async function fetchComicVineIssues(volumeId: number): Promise<ComicVineIssue[]> {
  if (!isTauri()) return [];
  return comicVineGetIssues(volumeId).catch(() => []);
}

export async function fetchComicVineIssue(issueId: number): Promise<ComicVineIssueDetail | null> {
  if (!isTauri()) return null;
  return comicVineGetIssue(issueId).catch(() => null);
}

const EMPTY_CAST: ComicVineVolumeCast = { characters: [], concepts: [] };

export async function fetchComicVineVolumeCast(issueIds: number[]): Promise<ComicVineVolumeCast> {
  if (!isTauri() || issueIds.length === 0) return EMPTY_CAST;
  return comicVineGetIssuesCast(issueIds).catch(() => EMPTY_CAST);
}
