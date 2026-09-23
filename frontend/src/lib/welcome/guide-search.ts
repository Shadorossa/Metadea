// Text filter for the in-app user guide (components/guide/GuideView.tsx).
// Accent- and case-insensitive, every word of the query must appear somewhere
// in the section — "ajustes emulador" finds the ROM section even though the
// two words are far apart. Pure so the matching rules are unit-tested.

/**
 * Lowercases, strips accents from Latin letters and collapses whitespace.
 * Marks on other scripts are kept: in Japanese or Russian they change the
 * letter itself (プ is not フ, й is not и), so dropping them would match
 * unrelated words.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The query split into normalised words; empty when there is nothing to filter by. */
export function queryTerms(query: string): string[] {
  const normalized = normalizeForSearch(query);
  return normalized ? normalized.split(' ') : [];
}

/** True when every term occurs in the (already normalised) haystack. */
export function matchesTerms(normalizedHaystack: string, terms: readonly string[]): boolean {
  return terms.every(term => normalizedHaystack.includes(term));
}

/** Ids of the sections whose text contains every word of the query, in input order. */
export function filterSections<T extends { id: string; text: string }>(
  sections: readonly T[],
  query: string,
): string[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return sections.map(section => section.id);
  return sections
    .filter(section => matchesTerms(normalizeForSearch(section.text), terms))
    .map(section => section.id);
}
