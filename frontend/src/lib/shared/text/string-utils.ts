// Common string parsing utilities extracted from repeated patterns across mappers.

// Parse CSV-like strings: split by delimiter, trim each item, filter empty.
// Handles both simple comma-separated lists and more complex delimiters.
export function parseDelimitedString(str: string | null | undefined, delimiter: string | RegExp = ','): string[] {
  if (!str) return [];
  return str
    .split(delimiter)
    .map(s => s.trim())
    .filter(Boolean);
}

// Shorter alias for the common case: CSV parsing.
export function parseCSV(str: string | null | undefined): string[] {
  return parseDelimitedString(str, ',');
}

// Extract publishers (developer/publisher role) and join to a string if needed.
export function getPublisherNames<T extends { name: string; role: string }>(
  items: T[]
): string[] {
  return items.filter((item) => item.role === 'publisher').map((item) => item.name);
}

// Convenience: get publishers as a joined string (most common in mappers).
export function getPublisherNamesString<T extends { name: string; role: string }>(
  items: T[],
  separator: string = ', '
): string {
  return getPublisherNames(items).join(separator);
}

// Empty string and undefined both mean "no value" for a catalog field; null is
// what the database stores for it.
export const normField = (v: unknown) => (v === '' || v === undefined ? null : v);
