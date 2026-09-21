import type { MediaCatalogEntry } from '../tauri/catalog';

const YEAR_TOLERANCE = 1;

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titlesFor(entry: MediaCatalogEntry): string[] {
  return [...new Set([
    entry.title_main,
    entry.title_english,
    entry.title_romaji,
    entry.title_native,
  ].map(normalize).filter(title => title.length >= 3))];
}

function metadataIsCompatible(a: MediaCatalogEntry, b: MediaCatalogEntry): boolean {
  const formatA = normalize(a.format);
  const formatB = normalize(b.format);
  if (formatA && formatB && formatA !== formatB) return false;

  if (a.release_year != null && b.release_year != null) {
    return Math.abs(a.release_year - b.release_year) <= YEAR_TOLERANCE;
  }
  return true;
}

/**
 * Returns local catalog IDs that have at least one plausible same-work match.
 * Matching is exact after title normalization, across primary/alternate
 * titles, and requires compatible type, format, and (when available) year.
 * This only produces a manual-review filter; it never merges or deletes rows.
 */
export function findCatalogDuplicateCandidateIds(entries: readonly MediaCatalogEntry[]): Set<string> {
  const titleGroups = new Map<string, MediaCatalogEntry[]>();

  for (const entry of entries) {
    const type = normalize(entry.type);
    if (!type) continue;

    for (const title of titlesFor(entry)) {
      const key = `${type}\u0000${title}`;
      const group = titleGroups.get(key);
      if (group) group.push(entry);
      else titleGroups.set(key, [entry]);
    }
  }

  const candidates = new Set<string>();
  for (const group of titleGroups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const first = group[i];
        const second = group[j];
        if (first.external_id === second.external_id || !metadataIsCompatible(first, second)) continue;
        candidates.add(first.external_id);
        candidates.add(second.external_id);
      }
    }
  }

  return candidates;
}
