// Unified deduplication utilities consolidating 6+ scattered implementations
// across the codebase. All follow the same Set-based pattern.

export interface Deduped<T> {
  (items: T[]): T[];
}

// Generic dedupe function: remove duplicates by calling a key function on each item
export function dedupeByKey<T>(
  items: T[],
  keyFn: (item: T) => string | number
): T[] {
  const seen = new Set<string | number>();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Dedupe by a specific property (common case)
export function dedupeByProperty<T extends Record<string, any>>(
  items: T[],
  property: keyof T
): T[] {
  return dedupeByKey(items, item => String(item[property]));
}

// Dedupe by externalId (media items)
export function dedupeByExternalId<T extends { externalId: string }>(items: T[]): T[] {
  return dedupeByProperty(items, 'externalId');
}

// Dedupe by external_id (database records)
export function dedupeByExtId<T extends { external_id: string }>(items: T[]): T[] {
  return dedupeByProperty(items, 'external_id');
}

// Dedupe by id field
export function dedupeById<T extends { id: any }>(items: T[]): T[] {
  return dedupeByProperty(items, 'id');
}
