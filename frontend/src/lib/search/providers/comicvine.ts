// Comics search backend — Comic Vine instead of OpenLibrary. OpenLibrary's
// catalog is crowd-sourced and routinely has multiple separate "work"
// records for the exact same comic; Comic Vine is curated specifically for
// comics (proper volume/issue structure) and doesn't have that problem
// nearly as badly. Comic Vine has no CORS headers, so — unlike every other
// browser-fetch provider here — this goes through Tauri (see igdb.ts for
// the same pattern, same underlying reason: IGDB requires a bearer token
// browser JS can't safely hold anyway, Comic Vine just blocks browser
// fetches outright).
import { comicVineSearch, comicVineSearchCharacters, comicVineGetVolume, comicVineGetIssues, comicVineGetIssue, comicVineGetIssuesCast, isTauri, type ComicVineVolume, type ComicVineIssue, type ComicVineIssueDetail, type ComicVineVolumeCast } from '../../tauri';
import type { SearchResult, SearchPage, MediaType } from '../index';
import { MissingApiKeyError } from '../errors';

function coverUrlFrom(volume: ComicVineVolume): string | null {
  return volume.image?.medium_url ?? volume.image?.small_url ?? null;
}

function yearFrom(volume: ComicVineVolume): number | null {
  const y = volume.start_year ? parseInt(volume.start_year, 10) : NaN;
  return Number.isFinite(y) ? y : null;
}

// Comic Vine has no API field for "this volume collects/reprints that
// other volume" (its website's own "Collected Editions" box on a volume
// page is curated wiki data, not exposed via the public API — confirmed
// against their docs) — so a collected/deluxe/omnibus reprint of an
// ongoing or limited series shows up as its own unrelated volume in
// search, indistinguishable from the "real" numbered-issues run except by
// name and issue count. Same best-effort heuristic approach as isManga()
// below: a title match on common reprint-format wording, since there's
// nothing more reliable to go on.
const COLLECTED_EDITION_REGEX = /\b(deluxe edition|omnibus|compendium|complete collection|collected edition|absolute edition|trade paperback|tpb|box set|anthology)\b/i;

// Comic Vine doesn't always bother adding any of the wording above to a
// reprint's name either — a hardcover collection can be titled exactly the
// same as the run it collects (e.g. "Batman: White Knight" appearing
// twice: an 8-issue limited series and, separately, a single-tome
// "complete volume" reprint under the identical name). A low issue count
// of its own is the only remaining signal in that case.
const NO_KEYWORD_ISSUE_CAP = 3;

type VolumeIdentity = Pick<ComicVineVolume, 'id' | 'name' | 'count_of_issues'>;

export function isCollectedEditionVolume(v: VolumeIdentity): boolean {
  return COLLECTED_EDITION_REGEX.test(v.name) && (v.count_of_issues ?? 0) <= NO_KEYWORD_ISSUE_CAP;
}

// Strips the matched reprint-format wording (plus whatever punctuation/
// connector was sitting right before it, e.g. ": ", " - ") so "Batman:
// White Knight: The Deluxe Edition" and "Batman: White Knight" reduce to
// the same comparable base name. A title with no such wording (the
// same-name case above) reduces to itself, trimmed/lowercased.
export function collectedEditionBaseName(name: string): string {
  return name
    .replace(new RegExp(`[:\\-–—]?\\s*(the\\s+)?${COLLECTED_EDITION_REGEX.source}.*$`, 'i'), '')
    .trim()
    .toLowerCase();
}

// True when `v` looks like a reprint/collected edition of `original` —
// either by the keyword+base-name match above, or by sharing `original`'s
// exact name while carrying far fewer issues of its own (the no-wording
// case). The issue-count cap keeps this from misfiring on an ongoing or
// rebooted series that legitimately shares an older run's exact title and
// simply hasn't caught up in issue count yet — capped low enough that a
// real ongoing series would only ever false-positive in its first couple
// of issues, and even then only against another volume with the exact
// same name, which is already a narrow coincidence.
export function isReprintOf(v: VolumeIdentity, original: VolumeIdentity): boolean {
  if (v.id === original.id) return false;
  const vCount = v.count_of_issues ?? 0;
  const originalCount = original.count_of_issues ?? 0;
  if (isCollectedEditionVolume(v) && collectedEditionBaseName(v.name) === collectedEditionBaseName(original.name)) {
    return true;
  }
  if (vCount > 0 && vCount <= NO_KEYWORD_ISSUE_CAP && originalCount > vCount &&
      v.name.trim().toLowerCase() === original.name.trim().toLowerCase()) {
    return true;
  }
  return false;
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
    // No genre data on Comic Vine's volume search resource.
    genres:       [],
  };
}

const MANGA_PUBLISHERS = new Set([
  'shueisha',
  'kodansha',
  'shogakukan',
  'kadokawa',
  'kadokawa shoten',
  'hakusensha',
  'square enix',
  'tokyopop',
  'viz media',
  'viz',
  'yen press',
  'seven seas',
  'seven seas entertainment',
  'dark horse manga',
  'gangan comics',
  'akita shoten',
  'futabasha',
  'chuang yi',
  'tokuma shoten',
  'chuokoransha',
  'ichijinsha',
  'media factory',
  'nihon bungeisha',
  'shonengahosha'
]);

function isManga(v: ComicVineVolume): boolean {
  const pubName = v.publisher?.name?.toLowerCase().trim();
  if (pubName) {
    if (MANGA_PUBLISHERS.has(pubName) || pubName.includes('manga')) {
      return true;
    }
  }

  const name = v.name.toLowerCase();
  const mangaWordRegex = /\b(manga|light novel|manhua|manhwa|shonen|shoujo|seinen|josei)\b/;
  if (mangaWordRegex.test(name)) {
    return true;
  }

  const desc = (v.description ?? '').toLowerCase();
  const deck = (v.deck ?? '').toLowerCase();
  const mangaPhraseRegex = /\b(is a|the|original|english|translated|published) manga\b|\b(manga|light novel) (series|adaptation|version|by)\b/;
  if (mangaPhraseRegex.test(desc) || mangaPhraseRegex.test(deck)) {
    return true;
  }

  return false;
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

  const candidates = pageResult.volumes.filter(v => coverUrlFrom(v) && !isManga(v));

  // Hide a collected/deluxe/omnibus reprint from the results list when the
  // "real" numbered-issues run it reprints is sitting right there in the
  // same page too — keeps search from showing both "Batman: White Knight"
  // and "Batman: White Knight: The Deluxe Edition" (or even two volumes
  // both named exactly "Batman: White Knight" — see isReprintOf) as if
  // they were unrelated comics. Only when a sibling is actually present,
  // though: a reprint with no matching run in this page of results (e.g.
  // the run itself never got its own volume, or just didn't rank into this
  // page) still needs to show up, or it'd vanish from search entirely with
  // no way to find it. The reprint itself isn't lost either way — it's
  // resurfaced as an "Editions" relation on the run's own page, see
  // comic-collected-editions.ts.
  const results = candidates
    .filter(v => !candidates.some(other => isReprintOf(v, other)))
    .map(mapVolume);

  return {
    results,
    hasMore: pageResult.has_more,
  };
}

function isMangaCharacter(c: ComicVineCharacterCredit): boolean {
  const pubName = c.publisher?.name?.toLowerCase().trim();
  if (pubName) {
    if (MANGA_PUBLISHERS.has(pubName) || pubName.includes('manga')) {
      return true;
    }
  }

  const name = c.name.toLowerCase();
  const mangaWordRegex = /\b(manga|light novel|manhua|manhwa|shonen|shoujo|seinen|josei)\b/;
  if (mangaWordRegex.test(name)) {
    return true;
  }

  const desc = (c.description ?? '').toLowerCase();
  const deck = (c.deck ?? '').toLowerCase();
  const mangaPhraseRegex = /\b(is a|the|original|english|translated|published) manga\b|\b(manga|light novel) (character|series|adaptation|version|by)\b/;
  if (mangaPhraseRegex.test(desc) || mangaPhraseRegex.test(deck)) {
    return true;
  }

  return false;
}

// Comic Vine characters are real, independently-searchable entities (unlike
// TMDB, which only has a "character" text field on a cast credit, not its
// own resource) — so unlike movies/series/games, character search is
// actually possible here.
export async function searchComicVineCharacters(searchQuery: string, _signal: AbortSignal, page = 1): Promise<SearchPage> {
  if (!isTauri()) return { results: [], hasMore: false };

  let pageResult;
  try {
    pageResult = await comicVineSearchCharacters(searchQuery, page);
  } catch (e) {
    const message = typeof e === 'string' ? e : String(e);
    if (message.includes('Missing Comic Vine API key')) {
      throw new MissingApiKeyError(['comicvine']);
    }
    throw new Error(message);
  }

  const results: SearchResult[] = pageResult.characters
    .filter(c => (c.image?.medium_url || c.image?.small_url) && !isMangaCharacter(c))
    .map(c => ({
      externalId: `character:co:${c.id}`,
      type: 'character' as MediaType,
      format: '',
      source: 'comicvine' as const,
      titleMain: c.name,
      titleRomaji: null,
      titleNative: null,
      coverUrl: c.image?.medium_url ?? c.image?.small_url ?? null,
      releaseYear: null,
      releaseMonth: null,
      releaseDay: null,
      scoreGlobal: null,
      genres: [],
    }));

  return { results, hasMore: pageResult.has_more };
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
