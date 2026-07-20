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

function isEditionVariant(title: string): boolean {
  EDITION_WORDS.lastIndex = 0; // stateful due to /g — reset before each test
  return EDITION_WORDS.test(title);
}

// Within one relation category (e.g. all "remakes" of the game being viewed),
// IGDB often lists both a plain entry and one or more edition/collection/
// version SKUs of that same release. The edition SKUs aren't a distinct
// related game — drop them when a plain sibling already covers that entry;
// if every entry in the group happens to be an edition variant, keep just
// one so the category isn't dropped entirely.
export function dedupeEditionVariants<T extends { name: string }>(items: T[]): T[] {
  if (items.length <= 1) return items;
  const plain = items.filter(i => !isEditionVariant(i.name));
  return plain.length > 0 ? plain : items.slice(0, 1);
}
