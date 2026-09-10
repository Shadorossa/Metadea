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

// Filter items by a property value (used for extracting publishers, developers, etc.).
export function filterByProperty<T extends Record<string, any>>(
  items: T[],
  property: keyof T,
  value: any
): T[] {
  return items.filter((item) => item[property] === value);
}

// Extract names from items filtered by a property (the most common publisher use case).
export function getNamesByProperty<T extends Record<string, any> & { name: string }>(
  items: T[],
  property: keyof T,
  value: any
): string[] {
  return filterByProperty(items, property, value).map((item) => item.name);
}

// Extract publishers (developer/publisher role) and join to a string if needed.
export function getPublisherNames<T extends Record<string, any> & { name: string; role: string }>(
  items: T[]
): string[] {
  return getNamesByProperty(items, 'role', 'publisher');
}

// Convenience: get publishers as a joined string (most common in mappers).
export function getPublisherNamesString<T extends Record<string, any> & { name: string; role: string }>(
  items: T[],
  separator: string = ', '
): string {
  return getPublisherNames(items).join(separator);
}
