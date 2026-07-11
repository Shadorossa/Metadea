import type { LocalFolderEntry } from '../../../lib/tauri';

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
): LocalFolderEntry | null {
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

      const folderSeason = extractTitleSeason(entry.name);
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

// Common resolution/bitrate numbers that show up in release filenames and
// would otherwise be misread as an episode/chapter number.
const NOISE_NUMBERS = new Set([360, 480, 720, 1080, 1440, 2160]);

// Season+episode markers (checked first, since they disambiguate which
// season a file belongs to when several seasons live in the same folder).
const SEASON_EPISODE_MARKERS = [
  /\bS(\d{1,2})[.\s_-]?E(?:p(?:isode)?)?[.\s_-]?(\d{1,4})\b/i,
  /\b(\d{1,2})x(\d{1,4})\b/i,
];

const EPISODE_MARKERS = [
  /\bE(?:p(?:isode)?)?[.\s_-]?(\d{1,4})\b/i,
  /\bcap(?:[ií]tulo)?[.\s_-]?(\d{1,4})\b/i,
  /\bch(?:apter)?[.\s_-]?(\d{1,4})\b/i,
  /[-_\s](\d{1,4})(?=\s*[[(]|\s*$)/,
];

export interface EpisodeInfo {
  season:  number | null;
  episode: number;
}

// Best-effort extraction of the season+episode a media filename represents.
// `season` is null when the filename carries no explicit season marker
// (typical when each season is stored in its own folder) — callers treat
// that as "season 1 or unknown", not as a mismatch.
export function extractEpisodeInfo(filename: string): EpisodeInfo | null {
  const base = filename.replace(/\.[a-z0-9]+$/i, '');

  for (const marker of SEASON_EPISODE_MARKERS) {
    const match = base.match(marker);
    if (match) return { season: parseInt(match[1], 10), episode: parseInt(match[2], 10) };
  }

  for (const marker of EPISODE_MARKERS) {
    const match = base.match(marker);
    if (match) return { season: null, episode: parseInt(match[1], 10) };
  }

  const allNumbers = base.match(/\d{1,4}/g)?.map(Number) ?? [];
  if (allNumbers.length === 0) return null;

  const meaningful = allNumbers.filter(n => !NOISE_NUMBERS.has(n));
  const pool = meaningful.length > 0 ? meaningful : allNumbers;
  return { season: null, episode: pool[pool.length - 1] };
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
  const candidates = entries
    .filter(e => !e.is_dir)
    .map(e => ({ entry: e, info: extractEpisodeInfo(e.name) }))
    .filter((c): c is { entry: LocalFolderEntry; info: EpisodeInfo } => c.info !== null && c.info.episode === targetEpisode);

  if (itemSeason == null) return candidates[0]?.entry ?? null;

  const exact = candidates.find(c => c.info.season === itemSeason);
  if (exact) return exact.entry;

  if (itemSeason === 1) {
    const implicit = candidates.find(c => c.info.season === null);
    if (implicit) return implicit.entry;
  }

  return null;
}
