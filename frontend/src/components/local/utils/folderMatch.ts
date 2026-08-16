import { scanFolderContents, type LocalFolderEntry } from '../../../lib/tauri';

// Strips accents/punctuation and collapses whitespace so folder names typed
// with different conventions ("Attack on Titan", "attack-on-titan_S1") can
// still be compared against catalog titles.
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// A catalog title like "Ghost in the Shell: Stand Alone Complex 2nd GIG" (or
// "... 2nd Season", "... Season 2", "... S2") tells us which season of a
// multi-season anime this library entry actually is — without this, a
// season-2 entry's title contains its season-1 title as a prefix
// ("... Stand Alone Complex" is a substring of "... Stand Alone Complex 2nd
// GIG"), so naive folder/file matching would silently pick season-1 media.
// Returns null when the title carries no season marker (single-season show,
// or an unnumbered "season 1").
const TITLE_SEASON_PATTERNS = [
  /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i,
  /\bseason\s+(\d{1,2})\b/i,
  /\b(\d{1,2})(?:st|nd|rd|th)\s+gig\b/i,
  /\bs(\d{1,2})\b/i,
];

export function extractTitleSeason(title: string | null | undefined): number | null {
  if (!title) return null;
  for (const pattern of TITLE_SEASON_PATTERNS) {
    const match = title.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > 0) return n;
    }
  }
  return null;
}

// external_id ("anime:123") contains a colon, which Windows won't allow in
// a filename at all — encoded as "anime-123" for the "[external_id]" tag
// instead. Shared by both the matcher (below) and buildLocateRenamePlan,
// which actually writes the tag when renaming.
export function encodeExternalIdForFilename(externalId: string): string {
  return externalId.replace(/:/g, '-');
}

// A "[external_id]" tag literally in the name — written by the "Localizar"
// flow (LocalMediaDetailPanel) when renaming a folder/file so it's always
// unambiguously recognized afterward, no fuzzy title matching needed at all.
function hasExternalIdTag(name: string, externalId: string): boolean {
  return name.includes(`[${encodeExternalIdForFilename(externalId)}]`);
}

// Looks for a subfolder whose (normalized) name best matches one of the
// work's known titles. Exact matches always win; among partial
// (substring-containment) matches, the one whose length is closest to the
// title's — i.e. the most specific match — wins, so a season-1 folder whose
// name is a prefix of a season-2 title doesn't get picked over the real
// season-2 folder. When the item's season is known, a folder whose own name
// carries a *conflicting* season marker is penalized, and a matching one is
// favored.
export function findMatchingFolder(
  entries: LocalFolderEntry[],
  candidateTitles: string[],
  itemSeason: number | null = null,
  externalId: string | null = null,
): LocalFolderEntry | null {
  if (externalId) {
    const tagged = entries.find(e => e.is_dir && hasExternalIdTag(e.name, externalId));
    if (tagged) return tagged;
  }

  const normTitles = candidateTitles.filter(Boolean).map(normalizeForMatch).filter(t => t.length > 0);
  if (normTitles.length === 0) return null;

  let best: LocalFolderEntry | null = null;
  let bestScore = -Infinity;

  for (const entry of entries) {
    if (!entry.is_dir) continue;
    const normName = normalizeForMatch(entry.name);
    if (!normName) continue;

    for (const t of normTitles) {
      let score: number | null = null;
      if (normName === t) {
        score = 100;
      } else if (normName.includes(t) || t.includes(normName)) {
        const overlap = Math.min(normName.length, t.length) / Math.max(normName.length, t.length);
        score = 50 * overlap;
      }
      if (score === null) continue;

      const folderSeason = extractFolderSeason(entry.name);
      if (itemSeason != null && folderSeason != null) {
        score += folderSeason === itemSeason ? 20 : -1000;
      }

      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
  }

  return best;
}

// Same as extractTitleSeason, plus a last-resort fallback for a bare
// trailing number ("Uchouten Kazoku" + "Uchouten Kazoku 2" as sibling
// folders, no "season"/"S" keyword at all) — a rip's own folder-naming
// convention, not something a catalog title itself would ever need
// (extractTitleSeason stays strict there, see its own comment) since a
// folder name is only ever compared against sibling folders for
// disambiguation, never trusted on its own as a season number.
function extractFolderSeason(name: string): number | null {
  const strict = extractTitleSeason(name);
  if (strict !== null) return strict;
  const match = name.trim().match(/(?:^|\s)([1-9])\s*$/);
  return match ? parseInt(match[1], 10) : null;
}

// Common resolution/bitrate numbers that show up in release filenames and
// would otherwise be misread as an episode/chapter number.
const NOISE_NUMBERS = new Set([360, 480, 720, 1080, 1440, 2160]);

// Shared with findMatchingEpisodeFile below and callers that need to check
// whether a folder has any playable media directly inside it (e.g. to decide
// whether to auto-descend into a single matching subfolder).
export const MEDIA_EXTENSIONS = /\.(mkv|mp4|avi|mov|flv|webm|mp3|m4a|aac|flac|wav|epub|pdf|mobi|azw3|djvu|cbz|cbr)$/i;

export function hasMediaFiles(entries: LocalFolderEntry[]): boolean {
  return entries.some(e => !e.is_dir && MEDIA_EXTENSIONS.test(e.name));
}

// Single-episode works (movies, one-shot OVAs/specials) are often the only
// file in their folder, with no episode number anywhere in the filename to
// numerically match against — if there's exactly one media file at all,
// that's it, no number needed.
export function soleMediaFile(entries: LocalFolderEntry[]): LocalFolderEntry | null {
  const files = entries.filter(e => !e.is_dir && MEDIA_EXTENSIONS.test(e.name));
  return files.length === 1 ? files[0] : null;
}

// Same idea as findMatchingFolder, but for a bare file living directly in
// the root category folder — a single-episode work often never gets its
// own subfolder made for it at all, so findMatchingFolder (directories
// only) never even gets a candidate to look at.
export function findMatchingFile(
  entries: LocalFolderEntry[],
  candidateTitles: string[],
  externalId: string | null = null,
): LocalFolderEntry | null {
  if (externalId) {
    const tagged = entries.find(e => !e.is_dir && MEDIA_EXTENSIONS.test(e.name) && hasExternalIdTag(e.name, externalId));
    if (tagged) return tagged;
  }

  const normTitles = candidateTitles.filter(Boolean).map(normalizeForMatch).filter(t => t.length > 0);
  if (normTitles.length === 0) return null;

  let best: LocalFolderEntry | null = null;
  let bestScore = -Infinity;

  for (const entry of entries) {
    if (entry.is_dir || !MEDIA_EXTENSIONS.test(entry.name)) continue;
    const normName = normalizeForMatch(entry.name);
    if (!normName) continue;

    for (const t of normTitles) {
      let score: number | null = null;
      if (normName === t) {
        score = 100;
      } else if (normName.includes(t)) {
        // Unlike findMatchingFolder, no t.includes(normName) side — a bare
        // filename plus release-group/quality tags is always longer than
        // the bare title, so that direction would only ever match by
        // coincidence here.
        score = 50 * (t.length / normName.length);
      }
      if (score === null) continue;
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
  }

  return best;
}

// "SxxExx" instead of a bare episode number — consistent with how a lot of
// the source filenames themselves already label things (e.g. "1 - Eizouken
// ni wa Te wo Dasu na! - S01E01"), even for a single-season show where the
// season would otherwise just be implied.
export function formatEpisodeLabel(season: number | null, episode: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `S${pad(season ?? 1)}E${pad(episode)}`;
}

// UI-facing fallback for when extractEpisodeInfo found no episodeTitle to
// show (e.g. "[SubsPlease] Burn the Witch - #0.8 (1080p) [6CE13449].mkv",
// where nothing meaningful follows the "#0.8" marker) — strips the same
// release-group/quality-tag noise extractEpisodeInfo already strips
// internally before matching, so the raw filename (brackets, resolution,
// hash, extension and all) is never what ends up on screen.
export function cleanFilenameForDisplay(filename: string): string {
  return filename
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Also drop a leading bare episode number ("04 - Show Name" -> "Show
    // Name") — already shown up front via formatEpisodeLabel, so leaving it
    // here would just show the same number twice.
    .replace(/^\d{1,4}[\s\-:._]+/, '');
}

// Season+episode markers (checked first, since they disambiguate which
// season a file belongs to when several seasons live in the same folder).
const SEASON_EPISODE_MARKERS = [
  /(?:^|[^0-9])S(\d{1,2})[.\s_-]?E(?:p(?:isode)?)?[.\s_-]?(\d{1,4})(?:$|[^0-9])/i,
  /(?:^|[^0-9])(\d{1,2})x(\d{1,4})(?:$|[^0-9])/i,
];

const EPISODE_MARKERS = [
  /(?:^|[^0-9])E(?:p(?:isode)?)?[.\s_-]?(\d{1,4})(?:$|[^0-9])/i,
  /(?:^|[^0-9])cap(?:[ií]tulo)?[.\s_-]?(\d{1,4})(?:$|[^0-9])/i,
  /(?:^|[^0-9])ch(?:apter)?[.\s_-]?(\d{1,4})(?:$|[^0-9])/i,
  /(?:^|[^0-9])OVA[.\s_-]?(\d{1,4})(?:$|[^0-9])/i,
  /(?:^|[^0-9])SP(?:ecial)?[.\s_-]?(\d{1,4})(?:$|[^0-9])/i,
  // "#0.8" style specials (SubsPlease and others number these with a decimal
  // instead of a whole episode) — kept as a float, never equals an integer
  // targetEpisode in findMatchingEpisodeFile, which is correct: a special
  // like this isn't "next episode N" and shouldn't be auto-picked as one.
  /(?:^|[^0-9])#\s?(\d{1,3}(?:\.\d{1,2})?)(?:$|[^0-9.])/,
  /[-_\s](\d{1,4})(?=\s*[[(]|\s*$)/,
];

export interface EpisodeInfo {
  season:       number | null;
  episode:      number;
  // Whatever text follows the episode number in the filename — e.g.
  // "SA - Section-9" out of "Ghost in the Shell (S.A.C) - S01 E01 - SA -
  // Section-9 (1080p - DUAL Audio).mkv". A lot of well-organized rips bake
  // the real episode title in right there; null when nothing meaningful
  // follows (most release-group filenames just have resolution/codec tags
  // after the number, already stripped before matching).
  episodeTitle: string | null;
}

// Whatever text sits around the matched episode number, minus the number
// itself — the text *after* the match usually wins (e.g. "SA - Section-9"
// out of "... S01 E01 - SA - Section-9 ..."), since that's where a real
// episode title normally lives. When there's nothing after it (e.g.
// "1 - Eizouken ni wa Te wo Dasu na! - S01E01", where the marker sits right
// at the end), falls back to the text *before* it instead — with its own
// leading bare number stripped, since the caller already shows that number
// up front (formatEpisodeLabel) and showing it twice would be redundant.
function textAroundMatch(base: string, match: RegExpMatchArray): string | null {
  const start = match.index ?? 0;
  const end = start + match[0].length;

  const after = base.slice(end).replace(/^[\s\-:._]+/, '').trim();
  if (after.length > 0) return after;

  const before = base.slice(0, start)
    .replace(/^[\s\-:._]*\d{1,4}[\s\-:._]+/, '')
    .replace(/[\s\-:._]+$/, '')
    .trim();
  return before.length > 0 ? before : null;
}

// Best-effort extraction of the season+episode a media filename represents.
// `season` is null when the filename carries no explicit season marker
// (typical when each season is stored in its own folder) — callers treat
// that as "season 1 or unknown", not as a mismatch.
export function extractEpisodeInfo(filename: string): EpisodeInfo | null {
  const cleaned = filename
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ');
  const base = cleaned.replace(/\.[a-z0-9]+$/i, '');

  for (const marker of SEASON_EPISODE_MARKERS) {
    const match = base.match(marker);
    if (match) {
      return { season: parseInt(match[1], 10), episode: parseFloat(match[2]), episodeTitle: textAroundMatch(base, match) };
    }
  }

  for (const marker of EPISODE_MARKERS) {
    const match = base.match(marker);
    if (match) {
      return { season: null, episode: parseFloat(match[1]), episodeTitle: textAroundMatch(base, match) };
    }
  }

  const allNumbers = base.match(/\d{1,4}/g)?.map(Number) ?? [];
  if (allNumbers.length === 0) return null;

  const meaningful = allNumbers.filter(n => !NOISE_NUMBERS.has(n));
  const pool = meaningful.length > 0 ? meaningful : allNumbers;
  return { season: null, episode: pool[pool.length - 1], episodeTitle: null };
}

// Finds the file inside a matched folder for a given episode/chapter number.
// When the work's season is known, a file whose own season marker conflicts
// is rejected outright; a file with no season marker at all is only
// accepted when the work's season is 1 or unknown (files without a marker
// are assumed to belong to whichever single season the folder holds).
export function findMatchingEpisodeFile(
  entries: LocalFolderEntry[],
  targetEpisode: number,
  itemSeason: number | null = null,
): LocalFolderEntry | null {
  const allCandidates = entries
    .filter(e => !e.is_dir && MEDIA_EXTENSIONS.test(e.name))
    .map(e => ({ entry: e, info: extractEpisodeInfo(e.name) }))
    .filter((c): c is { entry: LocalFolderEntry; info: EpisodeInfo } => c.info !== null);

  const directMatches = allCandidates.filter(c => c.info.episode === targetEpisode);

  if (itemSeason != null) {
    const exact = directMatches.find(c => c.info.season === itemSeason);
    if (exact) return exact.entry;

    if (itemSeason === 1) {
      const implicit = directMatches.find(c => c.info.season === null);
      if (implicit) return implicit.entry;
    }
    return null;
  }

  const directAbsolute = directMatches.find(c => c.info.season === null || c.info.season === 1);
  if (directAbsolute) return directAbsolute.entry;

  const seasonSizes: Record<number, number> = {};
  for (const c of allCandidates) {
    if (c.info.season !== null) {
      seasonSizes[c.info.season] = Math.max(seasonSizes[c.info.season] || 0, c.info.episode);
    }
  }

  if (Object.keys(seasonSizes).length > 0) {
    let remaining = targetEpisode;
    let currentSeason = 1;
    while (true) {
      const size = seasonSizes[currentSeason];
      if (size === undefined) break;
      if (remaining <= size) {
        const matched = allCandidates.find(c => c.info.season === currentSeason && c.info.episode === remaining);
        if (matched) return matched.entry;
        break;
      }
      remaining -= size;
      currentSeason++;
    }
  }

  return directMatches[0]?.entry ?? null;
}

// Filesystem-illegal characters on Windows (the primary target here) — also
// keeps "[" and "]" out of a title/name segment so it can never be confused
// with the "[external_id]" tag the rename flow appends itself.
const ILLEGAL_FS_CHARS = /[/\\:*?"<>|[\]]/g;

export function sanitizeForFilename(s: string): string {
  return s.replace(ILLEGAL_FS_CHARS, '').replace(/\s+/g, ' ').trim();
}

// Last path segment removed — "C:/a/b/c" -> "C:/a/b". Handles both slash
// styles since Tauri's file-picker dialog can return either depending on
// platform/how the user navigated.
export function dirname(path: string): string {
  const normalized = path.replace(/[/\\]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return idx === -1 ? '' : normalized.slice(0, idx);
}

export interface LocateRenamePlan {
  fileRenames: { entry: LocalFolderEntry; newName: string }[];
  folderNewName: string;
}

// Builds the "Localizar" flow's rename plan (see LocalMediaDetailPanel):
// every media file becomes "SxxExx - Work Title - Episode Title
// [external_id].ext" (falling back to sequential numbering, in filename
// order, for files with no detectable episode number of their own at all,
// and dropping the "- Episode Title" part when there isn't one), and the
// folder itself becomes "Work Title [external_id]" — both self-describing
// enough that findMatchingFolder/findMatchingFile's [external_id] fast path
// recognizes them on every future scan, no fuzzy title matching needed.
// `season` should be the CALLER's already-resolved season for this specific
// library entry (e.g. 2 for a "... 2nd Season" work) — passing the wrong
// one here is exactly what would mislabel a season-2 folder as S01.
export function buildLocateRenamePlan(
  entries: LocalFolderEntry[],
  workTitle: string,
  externalId: string,
  season: number | null,
): LocateRenamePlan {
  const mediaFiles = entries
    .filter(e => !e.is_dir && MEDIA_EXTENSIONS.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tag = encodeExternalIdForFilename(externalId);
  const titleSanitized = sanitizeForFilename(workTitle);
  let nextSequential = 1;
  const usedNames = new Set<string>();
  const fileRenames = mediaFiles.map(entry => {
    const info = extractEpisodeInfo(entry.name);
    // Decimal specials (see the "#0.8" marker) round to the nearest whole
    // episode for the SxxExx label — a real fractional episode number isn't
    // representable in that format, and this is a rare enough case that an
    // approximate label beats not labeling it at all.
    const episode = info ? Math.round(info.episode) : nextSequential;
    nextSequential = Math.max(nextSequential, episode + 1);
    // A file's OWN season marker (e.g. the original "S02 E01" in a folder
    // that mixes two seasons' episodes together) always wins over the
    // caller's single `season` — that param is only a fallback for files
    // that carry no season marker of their own. Blindly stamping every file
    // with the same `season` mislabeled a real mixed-season folder as if it
    // were all one season, with duplicate SxxExx numbers to boot.
    const fileSeason = info?.season ?? season;

    const ext = entry.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
    const episodeTitle = info?.episodeTitle ? sanitizeForFilename(info.episodeTitle) : '';
    const parts = [formatEpisodeLabel(fileSeason, episode), titleSanitized, episodeTitle].filter(Boolean);
    const base = `${parts.join(' - ')} [${tag}]`;

    let newName = `${base}${ext}`;
    let dupeIndex = 2;
    while (usedNames.has(newName.toLowerCase())) {
      newName = `${base} (${dupeIndex})${ext}`;
      dupeIndex++;
    }
    usedNames.add(newName.toLowerCase());
    return { entry, newName };
  });

  const folderNewName = `${titleSanitized} [${tag}]`;
  return { fileRenames, folderNewName };
}

export interface TaggedMatch {
  absPath: string;
  isDir: boolean;
}

// Recursively hunts for a "[external_id]" tag anywhere under basePath, up to
// maxDepth levels deep — the counterpart to findMatchingFolder/findMatchingFile's
// own root-level-only tag fast path, for a work whose folder ended up nested
// (e.g. "Koukaku Kidoutai/b. STAND Alone COMPLEX (2002-06)/", two levels
// under the category root) instead of being a direct child of it. Since the
// tag makes a match unambiguous regardless of *where* it's found, there's no
// need to ever move a renamed folder/file up to the root to make it
// reachable — this just looks further than the fast path already does.
// Depth-limited (not unbounded) purely to cap how many scanFolderContents
// round trips one failed match can cost.
export async function findTaggedPathRecursive(
  basePath: string,
  externalId: string,
  maxDepth = 3,
): Promise<TaggedMatch | null> {
  const tag = `[${encodeExternalIdForFilename(externalId)}]`;
  const entries = await scanFolderContents(basePath).catch(() => [] as LocalFolderEntry[]);

  const direct = entries.find(e => e.name.includes(tag));
  if (direct) return { absPath: `${basePath}/${direct.name}`, isDir: direct.is_dir };

  if (maxDepth <= 0) return null;
  for (const e of entries) {
    if (!e.is_dir) continue;
    const found = await findTaggedPathRecursive(`${basePath}/${e.name}`, externalId, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

export interface RelatedFileMatch {
  relatedExternalId: string;
  relatedTitle: string;
  containerPath: string;
  entry: LocalFolderEntry;
  newName: string;
}

// A folder scanned for candidate files, tagged with the absolute path it
// came from — e.g. "a. MOVIES (1995-2008)" sitting alongside the show's own
// folder under the same franchise-umbrella parent.
export interface CandidateFileGroup {
  containerPath: string;
  entries: LocalFolderEntry[];
}

// Used by "Localizar" for a saga entry (see LocalMediaDetailPanel) to also
// pick up movies/OVAs/etc. that this work has a *relation* to (not part of
// its own season chain — see ALL_CHAIN_RELATION_TYPES, filtered out by the
// caller before this runs) but that live loose in a sibling folder, like
// Ghost in the Shell's movies sitting next to its Stand Alone Complex
// folder under the same franchise parent. Matches each relation's own
// `title` against every candidate file's name (same normalize+substring
// scoring as findMatchingFile), one file per relation, never reusing a file
// for two different relations. `minScore` guards against tagging something
// on a weak coincidental match — silence (no match) is safer than a wrong tag.
export function matchRelationsToFiles(
  relations: { related_media_external_id: string; title: string }[],
  candidateGroups: CandidateFileGroup[],
  minScore = 20,
): RelatedFileMatch[] {
  const usedKeys = new Set<string>();
  const results: RelatedFileMatch[] = [];

  for (const rel of relations) {
    const normTitle = normalizeForMatch(rel.title);
    if (!normTitle) continue;

    let best: { containerPath: string; entry: LocalFolderEntry; score: number } | null = null;
    for (const group of candidateGroups) {
      for (const entry of group.entries) {
        if (entry.is_dir || !MEDIA_EXTENSIONS.test(entry.name)) continue;
        const key = `${group.containerPath}/${entry.name}`;
        if (usedKeys.has(key)) continue;

        const normName = normalizeForMatch(entry.name);
        if (!normName) continue;
        let score: number | null = null;
        if (normName === normTitle) score = 100;
        else if (normName.includes(normTitle)) score = 50 * (normTitle.length / normName.length);
        if (score === null) continue;
        if (!best || score > best.score) best = { containerPath: group.containerPath, entry, score };
      }
    }

    if (best && best.score >= minScore) {
      usedKeys.add(`${best.containerPath}/${best.entry.name}`);
      const tag = encodeExternalIdForFilename(rel.related_media_external_id);
      const ext = best.entry.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
      const titleSanitized = sanitizeForFilename(rel.title);
      results.push({
        relatedExternalId: rel.related_media_external_id,
        relatedTitle: rel.title,
        containerPath: best.containerPath,
        entry: best.entry,
        newName: `${formatEpisodeLabel(null, 1)} - ${titleSanitized} [${tag}]${ext}`,
      });
    }
  }

  return results;
}
