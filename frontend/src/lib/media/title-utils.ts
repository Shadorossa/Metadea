// Strips "Edition"/"Collection"/"Version" as standalone words from game
// titles shown in lists (search results, related versions) — these are
// redundant once the entry is already labeled as an edition/collection/
// version elsewhere in the UI. Word-boundary matched so it never touches
// substrings like "Expedition".
const EDITION_WORDS = /\b(edition|collection|version)s?\b/gi;

export function cleanEditionTitle(title: string): string {
  return title
    .replace(EDITION_WORDS, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s:—-]+$/, '')
    .trim() || title;
}
